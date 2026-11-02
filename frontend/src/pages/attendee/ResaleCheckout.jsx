import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Smartphone, RotateCcw, Zap, ShieldCheck, Loader2, Clock } from "lucide-react";
import { api, ApiError } from "../../api";
import { useAuth } from "../../context/AuthContext";
import { useApiData } from "../../lib/useApiData";
import { Card, MoneyText, Input, Checkbox, Button, Modal, CountdownRing, Skeleton, ErrorState, EmptyState } from "../../components/ui";
import ListingOnChainCheck from "../../components/ListingOnChainCheck";
import EventCover from "../../components/EventCover";
import { isValidKenyanPhone, normalizeKenyanPhone, maskPhone, formatPhone, formatEventDate } from "../../format";

const POLL_MS = 2000;
const WAIT_SECONDS = 60;

/**
 * Buying a resale ticket. Same M-Pesa prompt as a normal purchase, plus one
 * extra stage the buyer can see: after paying, the ticket is transferred
 * into their name (and the seller's QR code cancelled) before it shows up in
 * My Tickets. getResalePurchase drives the whole thing:
 * awaiting_payment -> transferring -> complete (or failed / delayed).
 */
export default function ResaleCheckout() {
  const { listingId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: listing, error: loadError, retry } = useApiData(() => api.getResaleListing(listingId), [listingId]);

  const [phone, setPhone] = useState(() => (user?.phoneNumber ? formatPhone(user.phoneNumber) : ""));
  const [phoneError, setPhoneError] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [isDev, setIsDev] = useState(false);
  const [simulating, setSimulating] = useState(false);
  // stage: null | { paymentId, phase: awaiting|transferring|delayed|timeout|failed, secondsLeft, reason }
  const [stage, setStage] = useState(null);
  const pollRef = useRef(null);
  const tickRef = useRef(null);

  useEffect(() => {
    // The "Simulate M-Pesa success" button: the server says whether it's on.
    api.health().then((h) => setIsDev(h.simulated_payments ?? h.env === "development")).catch(() => {});
  }, []);

  useEffect(() => () => stopTimers(), []);

  function stopTimers() {
    clearInterval(pollRef.current);
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
    if (!validatePhone() || !agreed) return;
    stopTimers();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.buyResaleListing(listingId, { phoneNumber: normalizeKenyanPhone(phone) });
      follow(res.payment_id);
    } catch (err) {
      setStage(null);
      setError(err instanceof ApiError ? err.message : "Couldn't start the payment.");
    } finally {
      setSubmitting(false);
    }
  }

  function follow(paymentId) {
    setStage({ paymentId, phase: "awaiting", secondsLeft: WAIT_SECONDS, reason: null });

    pollRef.current = setInterval(async () => {
      try {
        const p = await api.getResalePurchase(paymentId);
        if (p.status === "complete") {
          stopTimers();
          navigate(`/tickets/${p.ticket_id}`, { replace: true, state: { resaleBought: true } });
        } else if (p.status === "failed") {
          stopTimers();
          setStage((s) => ({ ...s, phase: "failed", reason: p.failure_reason || "The payment could not be completed." }));
        } else if (p.status === "transferring" || p.status === "delayed") {
          clearInterval(tickRef.current); // paid — the M-Pesa countdown no longer applies
          setStage((s) => ({ ...s, phase: p.status }));
        }
      } catch {
        // transient — keep polling
      }
    }, POLL_MS);

    tickRef.current = setInterval(() => {
      setStage((s) => {
        if (!s || s.phase !== "awaiting") return s;
        if (s.secondsLeft <= 1) {
          clearInterval(pollRef.current);
          clearInterval(tickRef.current);
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

      <form onSubmit={pay} className="flex flex-col gap-4">
        <Input
          label="M-Pesa phone number"
          placeholder="0712 345 678"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={validatePhone}
          error={phoneError}
          required
        />
        <Checkbox
          checked={agreed}
          onChange={setAgreed}
          label="I agree to the terms of sale. Resale tickets can't be refunded once transferred."
        />
        {error && <div role="alert" className="text-body-sm text-danger">{error}</div>}
        <Button type="submit" disabled={!agreed || submitting} loading={submitting}>
          Pay <MoneyText value={listing.price} size="body" className="text-brand-accent-ink" /> with M-Pesa
        </Button>
      </form>

      <Modal open={Boolean(stage)} dismissible={false} title={stage?.phase === "awaiting" ? "Check your phone" : undefined}>
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
