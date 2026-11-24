import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Smartphone, RotateCcw, Zap, ShieldCheck, Loader2, Clock, CreditCard, Wallet } from "lucide-react";
import { api, ApiError } from "../../api";
import { useAuth } from "../../context/AuthContext";
import { useApiData } from "../../lib/useApiData";
import {
  Card, MoneyText, Input, Checkbox, Button, Modal, CountdownRing, Skeleton, ErrorState, EmptyState, RadioGroup,
} from "../../components/ui";
import ListingOnChainCheck from "../../components/ListingOnChainCheck";
import EventCover from "../../components/EventCover";
import { isValidKenyanPhone, normalizeKenyanPhone, maskPhone, formatPhone, formatEventDate, formatKES } from "../../format";

const POLL_MS = 2000;
const WAIT_SECONDS = 60;
// After Paystack sends the buyer back: how long to confirm at full speed
// before saying it's taking a while (and checking less often).
const CARD_CONFIRM_MS = 20000;
const CARD_SLOW_POLL_MS = 5000;

/**
 * Buying a resale ticket, three ways:
 *  - M-Pesa: the same STK prompt as a normal purchase.
 *  - Card: Paystack's own page, which sends the buyer back here
 *    (?payment=…&card=done|cancelled).
 *  - Wallet: the buyer's available ChainTix balance (money from tickets
 *    they've sold), paid at once.
 * Then one extra stage the buyer can see: the ticket is transferred into
 * their name (and the seller's QR code cancelled) before it shows up in My
 * Tickets. getResalePurchase drives it all:
 * awaiting_payment -> transferring -> complete (or failed / delayed).
 */
export default function ResaleCheckout() {
  const { listingId } = useParams();
  const [params, setParams] = useSearchParams();
  // Set when Paystack's card page sends the buyer back here (see resale.py buy_listing).
  const returningPayment = params.get("payment");
  const cardReturn = params.get("card"); // "done" | "cancelled" | null
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: listing, error: loadError, retry } = useApiData(() => api.getResaleListing(listingId), [listingId]);

  const [method, setMethod] = useState("mpesa");
  // What the server offers for cards: { available, testMode }.
  const [card, setCard] = useState({ available: false, testMode: false });
  // The buyer's spendable wallet balance (KES), or null until known / when signed out.
  const [walletBalance, setWalletBalance] = useState(null);
  const [phone, setPhone] = useState(() => (user?.phoneNumber ? formatPhone(user.phoneNumber) : ""));
  const [phoneError, setPhoneError] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [isDev, setIsDev] = useState(false);
  const [simulating, setSimulating] = useState(false);
  // stage: null | { paymentId, phase: awaiting|confirming|slow|transferring|delayed|timeout|failed, secondsLeft, reason }
  const [stage, setStage] = useState(null);
  const pollRef = useRef(null);
  const tickRef = useRef(null);

  useEffect(() => {
    // The "Simulate M-Pesa success" button and the card option: the server says whether they're on.
    api.health().then((h) => {
      setIsDev(h.simulated_payments ?? h.env === "development");
      setCard({ available: Boolean(h.card_payments), testMode: Boolean(h.card_test_mode) });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    api.getWallet().then((w) => setWalletBalance(w.available)).catch(() => setWalletBalance(null));
  }, [user]);

  useEffect(() => () => stopTimers(), []);

  // Back from Paystack: confirm a paid card payment, or release a cancelled one.
  useEffect(() => {
    if (!returningPayment || !cardReturn) return;
    setParams({}, { replace: true });
    if (cardReturn === "cancelled") {
      api.cancelPayment(returningPayment)
        .then((s) => {
          // Paid in another tab after all: that wins.
          if (s.status === "success") follow(returningPayment, "card");
          else { setNotice("Card payment cancelled. You haven't been charged."); retry(); }
        })
        .catch(() => { setNotice("Card payment cancelled."); retry(); });
      return;
    }
    setMethod("card");
    follow(returningPayment, "card");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returningPayment, cardReturn]);

  function stopTimers() {
    clearInterval(pollRef.current);
    clearTimeout(pollRef.current);
    clearInterval(tickRef.current);
  }

  function validatePhone() {
    if (!isValidKenyanPhone(phone)) {
      setPhoneError("Enter a valid Kenyan phone number, e.g. 0712 345 678");
      return false;
    }
    setPhoneError(null);
    return true;
  }

  async function pay(e) {
    e?.preventDefault();
    if (!agreed) return;
    if (payBy === "mpesa" && !validatePhone()) return;
    stopTimers();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const res = await api.buyResaleListing(listingId, {
        method: payBy,
        phoneNumber: payBy === "mpesa" ? normalizeKenyanPhone(phone) : undefined,
      });
      if (payBy === "card") {
        // Off to Paystack's own page; it sends the buyer back here after.
        window.location.assign(res.checkout_url);
        return;
      }
      follow(res.payment_id, payBy);
    } catch (err) {
      setStage(null);
      setError(err instanceof ApiError ? err.message : "Couldn't start the payment.");
    } finally {
      setSubmitting(false);
    }
  }

  /** Poll the purchase until it settles. kind: "mpesa" | "card" | "wallet". */
  function follow(paymentId, kind) {
    stopTimers();
    const started = Date.now();
    const initialPhase = kind === "mpesa" ? "awaiting" : kind === "card" ? "confirming" : "transferring";
    setStage({ paymentId, kind, phase: initialPhase, secondsLeft: WAIT_SECONDS, reason: null });

    const poll = async () => {
      let next = POLL_MS;
      try {
        const p = await api.getResalePurchase(paymentId);
        if (p.status === "complete") {
          stopTimers();
          navigate(`/tickets/${p.ticket_id}`, { replace: true, state: { resaleBought: true } });
          return;
        }
        if (p.status === "failed") {
          stopTimers();
          setStage((s) => ({ ...s, phase: "failed", reason: p.failure_reason || "The payment could not be completed." }));
          if (kind === "wallet") api.getWallet().then((w) => setWalletBalance(w.available)).catch(() => {});
          return;
        }
        if (p.status === "transferring" || p.status === "delayed") {
          clearInterval(tickRef.current); // paid — the M-Pesa countdown no longer applies
          setStage((s) => ({ ...s, phase: p.status }));
        } else if (kind === "card" && Date.now() - started > CARD_CONFIRM_MS) {
          setStage((s) => (s?.phase === "confirming" ? { ...s, phase: "slow" } : s));
          next = CARD_SLOW_POLL_MS;
        }
      } catch {
        // transient — keep polling
      }
      pollRef.current = setTimeout(poll, next);
    };
    pollRef.current = setTimeout(poll, kind === "wallet" ? 0 : POLL_MS);

    if (kind !== "mpesa") return;
    tickRef.current = setInterval(() => {
      setStage((s) => {
        if (!s || s.phase !== "awaiting") return s;
        if (s.secondsLeft <= 1) {
          stopTimers();
          return { ...s, secondsLeft: 0, phase: "timeout" };
        }
        return { ...s, secondsLeft: s.secondsLeft - 1 };
      });
    }, 1000);
  }

  async function simulate() {
    if (!stage) return;
    setSimulating(true);
    try {
      await api.devConfirmPayment(stage.paymentId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't simulate the payment.");
    } finally {
      setSimulating(false);
    }
  }

  function backToDetails() {
    stopTimers();
    setStage(null);
  }

  if (loadError) {
    return <div className="mx-auto max-w-lg px-4 py-8"><ErrorState description={loadError} onRetry={retry} /></div>;
  }
  if (!listing) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8 flex flex-col gap-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (!listing.buyable && !stage) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <EmptyState
          title="This ticket isn't available"
          description={listing.unavailable_reason || "It may have just been bought by someone else."}
          actionLabel="See other resale tickets"
          onAction={() => navigate(`/resale?event=${listing.event_id}`)}
        />
      </div>
    );
  }

  const pct = listing.face_value_kes ? Math.round((listing.price / listing.face_value_kes) * 100) : null;
  const walletCovers = walletBalance != null && walletBalance + 1e-9 >= listing.price;
  const options = [
    { value: "mpesa", label: "M-Pesa", hint: "A prompt on your phone, then your PIN" },
    ...(card.available ? [{ value: "card", label: "Card", hint: "Visa or Mastercard, on Paystack's secure page" }] : []),
    ...(walletBalance != null ? [{
      value: "wallet",
      label: "ChainTix wallet",
      hint: walletCovers
        ? `Available balance KES ${formatKES(walletBalance)}, from tickets you've sold`
        : `Available balance KES ${formatKES(walletBalance)}, not enough for this ticket`,
      disabled: !walletCovers,
    }] : []),
  ];
  // Falls back to M-Pesa if the chosen way stops being offered.
  const payBy = options.some((o) => o.value === method && !o.disabled) ? method : "mpesa";
  const payLabel = { mpesa: "with M-Pesa", card: "by card", wallet: "from wallet" }[payBy];
  const payIcon = { mpesa: undefined, card: <CreditCard size={16} />, wallet: <Wallet size={16} /> }[payBy];

  return (
    <div className="mx-auto max-w-lg px-4 py-8 flex flex-col gap-6">
      <h1 className="text-h1 text-ink-primary">Buy resale ticket</h1>

      <Card padding="p-0" className="overflow-hidden">
        <EventCover event={listing} eager className="h-28" />
        <div className="p-5 flex flex-col gap-3">
          <div>
            <h2 className="text-h3 text-ink-primary">{listing.event_title}</h2>
            <p className="text-body-sm text-ink-secondary">{listing.venue} · {formatEventDate(listing.event_date)}</p>
            <p className="text-caption text-ink-tertiary mt-0.5">{listing.tier_name} ticket</p>
          </div>
          <div className="flex flex-col gap-1.5 text-body-sm border-t border-line-subtle pt-3">
            {listing.face_value_kes != null && (
              <div className="flex justify-between text-ink-secondary">
                <span>Original price</span>
                <MoneyText value={listing.face_value_kes} size="body" />
              </div>
            )}
            <div className="flex justify-between text-ink-primary font-semibold">
              <span>You pay</span>
              <MoneyText value={listing.price} size="h3" />
            </div>
            {pct != null && (
              <p className="text-caption text-ink-tertiary">
                {pct <= 100 ? "At or below the original price." : `${pct}% of the original price — within the organiser's resale limit.`}
              </p>
            )}
          </div>
        </div>
      </Card>

      <ListingOnChainCheck listingId={listing.id} listingTxUrl={listing.listing_tx_url} />

      <div className="flex items-start gap-2 rounded-md bg-chain-verified/5 border border-chain-verified/30 px-4 py-3 text-body-sm text-ink-secondary">
        <ShieldCheck size={16} className="text-chain-verified flex-none mt-0.5" />
        <span>After you pay, the ticket moves into your name and the seller's QR code is cancelled, so only you can get in.</span>
      </div>

      {notice && <div role="status" className="rounded-md border border-line px-4 py-3 text-body-sm text-ink-secondary">{notice}</div>}

      <form onSubmit={pay} className="flex flex-col gap-4">
        {options.length > 1 && <RadioGroup label="Pay with" value={payBy} onChange={setMethod} options={options} />}

        {payBy === "mpesa" && (
          <Input
            label="M-Pesa phone number"
            placeholder="0712 345 678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={validatePhone}
            error={phoneError}
            required
          />
        )}
        {payBy === "card" && (
          <div className="flex items-start gap-2 text-caption text-ink-tertiary">
            <ShieldCheck size={15} className="flex-none mt-0.5 text-brand-primary" />
            <span>
              You'll enter your card on Paystack's page, then come straight back here. ChainTix never sees your card number.
              {card.testMode && <> Test mode: use card <span className="text-ink-secondary font-medium tabular-nums">4084 0840 8408 4081</span>, expiry 10/27, CVV 408.</>}
            </span>
          </div>
        )}
        {payBy === "wallet" && (
          <div className="flex items-start gap-2 text-caption text-ink-tertiary">
            <Wallet size={15} className="flex-none mt-0.5 text-brand-primary" />
            <span>
              <MoneyText value={listing.price} size="caption" /> comes out of your wallet now, leaving{" "}
              <MoneyText value={walletBalance - listing.price} size="caption" />. Money still in escrow can't be spent.
            </span>
          </div>
        )}

        <Checkbox
          checked={agreed}
          onChange={setAgreed}
          label="I agree to the terms of sale. Resale tickets can't be refunded once transferred."
        />
        {error && <div role="alert" className="text-body-sm text-danger">{error}</div>}
        <Button type="submit" disabled={!agreed || submitting} loading={submitting} iconLeft={payIcon}>
          Pay <MoneyText value={listing.price} size="body" className="text-brand-accent-ink" /> {payLabel}
        </Button>
      </form>

      <Modal
        open={Boolean(stage)}
        dismissible={false}
        title={stage?.phase === "awaiting" ? "Check your phone" : stage?.phase === "confirming" || stage?.phase === "slow" ? "Confirming your payment" : undefined}
      >
        {stage?.phase === "awaiting" && (
          <div className="flex flex-col items-center text-center gap-3 py-2">
            <Smartphone size={32} className="text-brand-primary" />
            <p className="text-body text-ink-primary">Enter your M-Pesa PIN to confirm.</p>
            <CountdownRing secondsLeft={stage.secondsLeft} totalSeconds={WAIT_SECONDS} size={72}>
              <span className="text-h3 font-bold tabular-nums text-ink-primary">{stage.secondsLeft}</span>
            </CountdownRing>
            <p className="text-caption text-ink-tertiary tabular-nums">STK push sent to {maskPhone(normalizeKenyanPhone(phone))}</p>
            {isDev && (
              <Button variant="secondary" size="sm" iconLeft={<Zap size={14} />} loading={simulating} onClick={simulate} className="mt-1">
                Simulate M-Pesa success (dev only)
              </Button>
            )}
          </div>
        )}

        {(stage?.phase === "confirming" || stage?.phase === "slow") && (
          <div className="flex flex-col items-center text-center gap-3 py-2">
            <Loader2 size={32} className="text-brand-primary animate-spin" />
            {stage.phase === "confirming" ? (
              <p className="text-body text-ink-primary">Checking with Paystack…</p>
            ) : (
              <>
                <p className="text-body text-ink-primary">This is taking a little longer than usual.</p>
                <p className="text-body-sm text-ink-secondary">
                  We'll keep checking. If your card was charged, the ticket will appear in My Tickets.
                </p>
                <Link to="/tickets" className="w-full"><Button variant="secondary" className="w-full">Go to My Tickets</Button></Link>
              </>
            )}
          </div>
        )}

        {stage?.phase === "transferring" && (
          <div className="flex flex-col items-center text-center gap-3 py-2">
            <Loader2 size={32} className="text-brand-primary animate-spin" />
            <h3 className="text-h3 text-ink-primary">Payment received</h3>
            <p className="text-body-sm text-ink-secondary">Moving the ticket into your name. This usually takes a few seconds.</p>
          </div>
        )}

        {stage?.phase === "delayed" && (
          <div className="flex flex-col items-center text-center gap-3 py-2">
            <Clock size={32} className="text-warning" />
            <h3 className="text-h3 text-ink-primary">Payment received — transfer delayed</h3>
            <p className="text-body-sm text-ink-secondary">
              Your payment went through, but moving the ticket is taking longer than usual. It will appear in My Tickets
              automatically; you don't need to pay again.
            </p>
            <Link to="/tickets" className="w-full"><Button className="w-full">Go to My Tickets</Button></Link>
          </div>
        )}

        {stage?.phase === "timeout" && (
          <div className="flex flex-col items-center text-center gap-3 py-2">
            <h3 className="text-h3 text-ink-primary">Didn't receive it?</h3>
            <p className="text-body-sm text-ink-secondary">The M-Pesa prompt may have timed out. You can resend it or change your number.</p>
            <div className="flex gap-2 w-full">
              <Button variant="secondary" onClick={backToDetails} className="flex-1">Change number</Button>
              <Button variant="primary" iconLeft={<RotateCcw size={14} />} onClick={() => pay()} className="flex-1">Resend</Button>
            </div>
          </div>
        )}

        {stage?.phase === "failed" && (
          <div className="flex flex-col items-center text-center gap-3 py-2">
            <h3 className="text-h3 text-danger">Payment didn't go through</h3>
            <p className="text-body-sm text-ink-secondary">{stage.reason}</p>
            <Button variant="primary" onClick={() => { backToDetails(); retry(); }} className="w-full">Try again</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
