import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Smartphone, RotateCcw, Minus, Plus, Zap } from "lucide-react";
import { api, ApiError } from "../../api";
import { useAuth } from "../../context/AuthContext";
import { useApiData } from "../../lib/useApiData";
import {
  TimelineStepper, Card, MoneyText, Input, Checkbox, Button, Modal, CountdownRing, Skeleton, ErrorState,
} from "../../components/ui";
import { isValidKenyanPhone, normalizeKenyanPhone, maskPhone, formatPhone } from "../../format";

const MAX_QUANTITY = 10;

const SERVICE_FEE_KES = 2;
const POLL_MS = 2000;
const WAIT_SECONDS = 60;

const STEPS = [{ label: "Details" }, { label: "Payment" }, { label: "Confirmation" }];

export default function Checkout() {
  const { eventId } = useParams();
  const [params] = useSearchParams();
  const tierId = params.get("tier");
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
  const [submitting, setSubmitting] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [isDev, setIsDev] = useState(false);
  const [simulating, setSimulating] = useState(false);

  // wait: null | { paymentId, ticketId, secondsLeft, terminal: null|'timeout'|'failed', reason }
  const [wait, setWait] = useState(null);
  const pollRef = useRef(null);
  const tickRef = useRef(null);

  useEffect(() => {
    // The "Simulate M-Pesa success" button: the server says whether it's on.
    api.health().then((h) => setIsDev(h.simulated_payments ?? h.env === "development")).catch(() => {});
  }, []);

  useEffect(() => () => {
    clearInterval(pollRef.current);
    clearInterval(tickRef.current);
  }, []);

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
  const subtotal = tier.price * quantity;
  const total = subtotal + SERVICE_FEE_KES;

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
    if (!validatePhone() || !agreed) return;
    setError(null);
    setSubmitting(true);
    try {
      // Identity is already established — RequireAuth (Work Order 05 A2/A4)
      // guards this whole route, so getting here means the user is logged in.
      const res = await api.purchaseTicket({
        event_id: event.id,
        tier_id: tier.id,
        phone_number: normalizeKenyanPhone(phone),
        quantity,
      });
      setStep(1);
      startWait(res.payment_id, res.ticket_id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start the payment.");
    } finally {
      setSubmitting(false);
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
      <TimelineStepper steps={STEPS} activeIndex={step} />

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
            <MoneyText value={subtotal} size="body" />
          </div>
          <div className="flex justify-between text-ink-secondary">
            <span>Service fee</span>
            <MoneyText value={SERVICE_FEE_KES} size="body" />
          </div>
          <div className="flex justify-between pt-2 border-t border-line-subtle text-ink-primary font-semibold">
            <span>Total</span>
            <MoneyText value={total} size="h3" />
          </div>
        </div>
      </Card>

      <form onSubmit={handleDetailsSubmit} className="flex flex-col gap-4">
        <Input
          label="M-Pesa phone number"
          placeholder="0712 345 678"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={validatePhone}
          error={phoneError}
          required
        />
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
        <Button type="submit" disabled={!agreed || submitting} loading={submitting}>
          Pay <MoneyText value={total} size="body" className="text-brand-accent-ink" /> with M-Pesa
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
    </div>
  );
}
