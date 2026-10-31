import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Smartphone, RotateCcw, Minus, Plus, Zap, CreditCard, Loader2, ShieldCheck } from "lucide-react";
import { api, ApiError } from "../../api";
import { useAuth } from "../../context/AuthContext";
import { useApiData } from "../../lib/useApiData";
import {
  TimelineStepper, Card, MoneyText, Input, Checkbox, Button, Modal, CountdownRing, Skeleton, ErrorState, RadioGroup,
} from "../../components/ui";
import { isValidKenyanPhone, normalizeKenyanPhone, maskPhone, formatPhone } from "../../format";

const MAX_QUANTITY = 10;

const POLL_MS = 2000;
const WAIT_SECONDS = 60;
// After Paystack sends the buyer back: how long to confirm at full speed
// before saying it's taking a while (and checking less often).
const CARD_CONFIRM_MS = 20000;
const CARD_SLOW_POLL_MS = 5000;

const STEPS = [{ label: "Details" }, { label: "Payment" }, { label: "Confirmation" }];

export default function Checkout() {
  const { eventId } = useParams();
  const [params, setParams] = useSearchParams();
  const tierId = params.get("tier");
  // Set when Paystack's card page sends the buyer back here (see payments.py).
  const returningPayment = params.get("payment");
  const cardReturn = params.get("card"); // "done" | "cancelled" | null
  const navigate = useNavigate();
  const { user, roles } = useAuth();

  const { data: event, error: eventError, retry: retryEvent } = useApiData(() => api.getEvent(eventId), [eventId]);
  // Pre-filled from the already-logged-in user (Work Order 05 A2 — identity
  // is established at /login now, not here) but still editable: the M-Pesa
  // number being charged doesn't have to be the same number the account is
  // registered under.
  const [phone, setPhone] = useState(() => (user?.phoneNumber ? formatPhone(user.phoneNumber) : ""));
  const [phoneError, setPhoneError] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const [step, setStep] = useState(0); // 0 Details, 1 Payment
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [isDev, setIsDev] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [method, setMethod] = useState("mpesa");
  // What the server offers for cards: { available, testMode }.
  const [card, setCard] = useState({ available: false, testMode: false });
  // After Paystack: null | { state: "checking" | "slow" | "failed", reason }
  const [cardCheck, setCardCheck] = useState(null);

  // wait: null | { paymentId, ticketId, secondsLeft, terminal: null|'timeout'|'failed', reason }
  const [wait, setWait] = useState(null);
  const pollRef = useRef(null);
  const tickRef = useRef(null);

  useEffect(() => {
    // The "Simulate M-Pesa success" button and the card option: the server says whether they're on.
    api.health().then((h) => {
      setIsDev(h.simulated_payments ?? h.env === "development");
      setCard({ available: Boolean(h.card_payments), testMode: Boolean(h.card_test_mode) });
    }).catch(() => {});
  }, []);

  useEffect(() => () => {
    clearInterval(pollRef.current);
    clearInterval(tickRef.current);
  }, []);

  // Back from Paystack: confirm a paid card payment, or release a cancelled one.
  useEffect(() => {
    if (!returningPayment || !cardReturn) return undefined;
    let stopped = false;
    let timer;
    const clearReturn = () => setParams(tierId ? { tier: tierId } : {}, { replace: true });

    if (cardReturn === "cancelled") {
      api.cancelPayment(returningPayment)
        .then((s) => {
          if (stopped) return;
          // Paid in another tab after all: that wins.
          if (s.status === "success") return navigate(`/confirmation/${s.ticket_id}`, { replace: true });
          setNotice("Card payment cancelled. You haven't been charged.");
          clearReturn();
        })
        .catch(() => {
          if (stopped) return;
          setNotice("Card payment cancelled.");
          clearReturn();
        });
      return () => { stopped = true; };
    }

    const started = Date.now();
    setCardCheck({ state: "checking" });
    const poll = async () => {
      try {
        const s = await api.getPaymentStatus(returningPayment);
        if (stopped) return;
        if (s.status === "success") return navigate(`/confirmation/${s.ticket_id}`, { replace: true });
        if (s.status === "failed") return setCardCheck({ state: "failed", reason: s.failure_reason || "The card payment could not be completed." });
      } catch {
        // transient — keep checking
      }
      if (stopped) return;
      const slow = Date.now() - started > CARD_CONFIRM_MS;
      if (slow) setCardCheck((c) => (c?.state === "checking" ? { state: "slow" } : c));
      timer = setTimeout(poll, slow ? CARD_SLOW_POLL_MS : POLL_MS);
    };
    poll();
    return () => { stopped = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returningPayment, cardReturn]);

  if (eventError) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8">
        <ErrorState description={eventError} onRetry={retryEvent} />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8 flex flex-col gap-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const tier = event.tiers.find((t) => t.id === tierId) || event.tiers[0];
  const maxQuantity = Math.min(MAX_QUANTITY, tier.tickets_remaining || MAX_QUANTITY);
  // Exactly what M-Pesa or Paystack will charge: the platform's fee comes
  // out of the organiser's side, not added on top for the buyer.
  const total = tier.price * quantity;
  const payBy = method === "card" && card.available ? "card" : "mpesa";

  function validatePhone() {
    if (!isValidKenyanPhone(phone)) {
      setPhoneError("Enter a valid Kenyan phone number, e.g. 0712 345 678");
      return false;
    }
    setPhoneError(null);
    return true;
  }

  async function handleDetailsSubmit(e) {
    e.preventDefault();
    if ((payBy === "mpesa" && !validatePhone()) || !agreed) return;
    setError(null);
    setNotice(null);
    setSubmitting(true);
    let leaving = false;
    try {
      // Identity is already established — RequireAuth (Work Order 05 A2/A4)
      // guards this whole route, so getting here means the user is logged in.
      const res = await api.purchaseTicket({
        event_id: event.id,
        tier_id: tier.id,
        quantity,
        method: payBy,
        ...(payBy === "mpesa" ? { phone_number: normalizeKenyanPhone(phone) } : {}),
      });
      if (payBy === "card") {
        // Off to Paystack's own page; it sends the buyer back here after.
        leaving = true;
        window.location.assign(res.checkout_url);
        return;
      }
      setStep(1);
      startWait(res.payment_id, res.ticket_id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start the payment.");
    } finally {
      if (!leaving) setSubmitting(false);
    }
  }

  function startWait(paymentId, ticketId) {
    setWait({ paymentId, ticketId, secondsLeft: WAIT_SECONDS, terminal: null, reason: null });

    pollRef.current = setInterval(async () => {
      try {
        const status = await api.getPaymentStatus(paymentId);
        if (status.status === "success") {
          clearInterval(pollRef.current);
          clearInterval(tickRef.current);
          navigate(`/confirmation/${ticketId}`, { replace: true });
        } else if (status.status === "failed") {
          clearInterval(pollRef.current);
          clearInterval(tickRef.current);
          setWait((w) => ({ ...w, terminal: "failed", reason: status.failure_reason || "The payment could not be completed." }));
        }
      } catch {
        // transient — keep polling
      }
    }, POLL_MS);

    tickRef.current = setInterval(() => {
      setWait((w) => {
        if (!w || w.terminal) return w;
        if (w.secondsLeft <= 1) {
          clearInterval(pollRef.current);
          return { ...w, secondsLeft: 0, terminal: "timeout" };
        }
        return { ...w, secondsLeft: w.secondsLeft - 1 };
      });
    }, 1000);
  }

  function handleResend() {
    clearInterval(pollRef.current);
    clearInterval(tickRef.current);
    handleDetailsSubmit({ preventDefault() {} });
  }

  function handleChangeNumber() {
    clearInterval(pollRef.current);
    clearInterval(tickRef.current);
    setWait(null);
    setStep(0);
  }

  function handleCardRetry() {
    setCardCheck(null);
    setParams(tierId ? { tier: tierId } : {}, { replace: true });
  }

  async function handleSimulateSuccess() {
    if (!wait) return;
    setSimulating(true);
    try {
      await api.devConfirmPayment(wait.paymentId);
      // The existing poll interval picks up the success within POLL_MS and
      // navigates on its own — no need to duplicate that here.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't simulate the payment.");
    } finally {
      setSimulating(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8 flex flex-col gap-6">
      <TimelineStepper steps={STEPS} activeIndex={cardCheck ? 1 : step} />

      <Card className="flex flex-col gap-3">
        <h2 className="text-h3 text-ink-primary">{event.title}</h2>

        <div className="flex items-center justify-between">
          <span className="text-body-sm text-ink-secondary">{tier.name}</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Decrease quantity"
              disabled={quantity <= 1}
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-line-strong text-ink-primary disabled:opacity-40 disabled:cursor-not-allowed hover:border-brand-primary"
            >
              <Minus size={14} />
            </button>
            <span className="w-4 text-center text-body font-semibold tabular-nums text-ink-primary">{quantity}</span>
            <button
              type="button"
              aria-label="Increase quantity"
              disabled={quantity >= maxQuantity}
              onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-line-strong text-ink-primary disabled:opacity-40 disabled:cursor-not-allowed hover:border-brand-primary"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 text-body-sm">
          <div className="flex justify-between text-ink-secondary">
            <span>{tier.name} × {quantity}</span>
            <MoneyText value={total} size="body" />
          </div>
          <div className="flex justify-between pt-2 border-t border-line-subtle text-ink-primary font-semibold">
            <span>Total</span>
            <MoneyText value={total} size="h3" />
          </div>
        </div>
      </Card>

      {notice && <div role="status" className="rounded-md border border-line px-4 py-3 text-body-sm text-ink-secondary">{notice}</div>}

      <form onSubmit={handleDetailsSubmit} className="flex flex-col gap-4">
        {card.available && (
          <RadioGroup
            label="Pay with"
            value={payBy}
            onChange={setMethod}
            options={[
              { value: "mpesa", label: "M-Pesa", hint: "A prompt on your phone, then your PIN" },
              { value: "card", label: "Card", hint: "Visa or Mastercard, on Paystack's secure page" },
            ]}
          />
        )}

        {payBy === "mpesa" ? (
          <Input
            label="M-Pesa phone number"
            placeholder="0712 345 678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={validatePhone}
            error={phoneError}
            required
          />
        ) : (
          <div className="flex items-start gap-2 text-caption text-ink-tertiary">
            <ShieldCheck size={15} className="flex-none mt-0.5 text-brand-primary" />
            <span>
              You'll enter your card on Paystack's page, then come straight back here. ChainTix never sees your card number.
              {card.testMode && <> Test mode: use card <span className="text-ink-secondary font-medium tabular-nums">4084 0840 8408 4081</span>, expiry 10/27, CVV 408.</>}
            </span>
          </div>
        )}

        {(roles.displayName || roles.email) && (
          <p className="text-caption text-ink-tertiary -mt-1">
            {roles.displayName ? <>Tickets in the name of <span className="text-ink-secondary font-medium">{roles.displayName}</span>. </> : null}
            {roles.email ? <>Receipt to <span className="text-ink-secondary font-medium">{roles.email}</span>. </> : null}
            <Link to="/profile" className="underline">Change</Link>
          </p>
        )}
        <Checkbox
          checked={agreed}
          onChange={setAgreed}
          label={
            <>
              I agree to the <span className="text-brand-primary-on-tint">terms of sale</span> and the resale policy above.
            </>
          }
        />
        {error && <div className="text-body-sm text-danger">{error}</div>}
        <Button type="submit" disabled={!agreed || submitting} loading={submitting} iconLeft={payBy === "card" ? <CreditCard size={16} /> : undefined}>
          Pay <MoneyText value={total} size="body" className="text-brand-accent-ink" /> {payBy === "card" ? "by card" : "with M-Pesa"}
        </Button>
      </form>

      <Modal open={Boolean(wait)} dismissible={false} title={wait?.terminal ? undefined : "Check your phone"}>
        {wait && !wait.terminal && (
          <div className="flex flex-col items-center text-center gap-3 py-2">
            <Smartphone size={32} className="text-brand-primary" />
            <p className="text-body text-ink-primary">Enter your M-Pesa PIN to confirm.</p>
            <CountdownRing secondsLeft={wait.secondsLeft} totalSeconds={WAIT_SECONDS} size={72}>
              <span className="text-h3 font-bold tabular-nums text-ink-primary">{wait.secondsLeft}</span>
            </CountdownRing>
            <p className="text-caption text-ink-tertiary tabular-nums">STK push sent to {maskPhone(normalizeKenyanPhone(phone))}</p>
            {isDev && (
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<Zap size={14} />}
                loading={simulating}
                onClick={handleSimulateSuccess}
                className="mt-1"
              >
                Simulate M-Pesa success (dev only)
              </Button>
            )}
          </div>
        )}

        {wait?.terminal === "timeout" && (
          <div className="flex flex-col items-center text-center gap-3 py-2">
            <h3 className="text-h3 text-ink-primary">Didn't receive it?</h3>
            <p className="text-body-sm text-ink-secondary">The M-Pesa prompt may have timed out. You can resend it or change your number.</p>
            <div className="flex gap-2 w-full">
              <Button variant="secondary" onClick={handleChangeNumber} className="flex-1">
                Change number
              </Button>
              <Button variant="primary" iconLeft={<RotateCcw size={14} />} onClick={handleResend} className="flex-1">
                Resend
              </Button>
            </div>
          </div>
        )}

        {wait?.terminal === "failed" && (
          <div className="flex flex-col items-center text-center gap-3 py-2">
            <h3 className="text-h3 text-danger">Payment didn't go through</h3>
            <p className="text-body-sm text-ink-secondary">{wait.reason}</p>
            <Button variant="primary" onClick={handleChangeNumber} className="w-full">
              Try again
            </Button>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(cardCheck)} dismissible={false} title={cardCheck?.state === "failed" ? undefined : "Confirming your payment"}>
        {cardCheck && cardCheck.state !== "failed" && (
          <div className="flex flex-col items-center text-center gap-3 py-2">
            <Loader2 size={32} className="text-brand-primary animate-spin" />
            {cardCheck.state === "checking" ? (
              <p className="text-body text-ink-primary">Checking with Paystack…</p>
            ) : (
              <>
                <p className="text-body text-ink-primary">This is taking longer than usual.</p>
                <p className="text-body-sm text-ink-secondary">
                  We'll keep checking. If your card was charged, your tickets will appear in My Tickets.
                </p>
                <Button variant="secondary" onClick={() => navigate("/tickets")} className="w-full">Go to My Tickets</Button>
              </>
            )}
          </div>
        )}
        {cardCheck?.state === "failed" && (
          <div className="flex flex-col items-center text-center gap-3 py-2">
            <h3 className="text-h3 text-danger">Payment didn't go through</h3>
            <p className="text-body-sm text-ink-secondary">{cardCheck.reason}</p>
            <Button variant="primary" onClick={handleCardRetry} className="w-full">Try again</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
