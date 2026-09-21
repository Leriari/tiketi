import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Smartphone, RotateCcw } from "lucide-react";
import { api, ApiError } from "../../api";
import { useAuth } from "../../context/AuthContext";
import { useApiData } from "../../lib/useApiData";
import {
  TimelineStepper, Card, MoneyText, Input, Checkbox, Button, Modal, CountdownRing, Skeleton, ErrorState,
} from "../../components/ui";
import { isValidKenyanPhone, normalizeKenyanPhone, maskPhone } from "../../format";

const SERVICE_FEE_KES = 50;
const POLL_MS = 2000;
const WAIT_SECONDS = 60;

const STEPS = [{ label: "Details" }, { label: "Payment" }, { label: "Confirmation" }];

export default function Checkout() {
  const { eventId } = useParams();
  const [params] = useSearchParams();
  const tierId = params.get("tier");
  const navigate = useNavigate();
  const { login } = useAuth();

  const { data: event, error: eventError, retry: retryEvent } = useApiData(() => api.getEvent(eventId), [eventId]);
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const [step, setStep] = useState(0); // 0 Details, 1 Payment
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // wait: null | { paymentId, ticketId, secondsLeft, terminal: null|'timeout'|'failed', reason }
  const [wait, setWait] = useState(null);
  const pollRef = useRef(null);
  const tickRef = useRef(null);

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
  const subtotal = tier.price;
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
      // No separate login screen for attendees (spec.md §3 never lists one) —
      // the checkout phone number *is* how identity is established.
      await login(normalizeKenyanPhone(phone));
      const res = await api.purchaseTicket({ event_id: event.id, tier_id: tier.id, phone_number: normalizeKenyanPhone(phone) });
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

  return (
    <div className="mx-auto max-w-lg px-4 py-8 flex flex-col gap-6">
      <TimelineStepper steps={STEPS} activeIndex={step} />

      <Card className="flex flex-col gap-3">
        <h2 className="text-h3 text-ink-primary">{event.title}</h2>
        <div className="flex flex-col gap-1.5 text-body-sm">
          <div className="flex justify-between text-ink-secondary">
            <span>{tier.name} × 1</span>
            <MoneyText value={tier.price} size="body" />
          </div>
          <div className="flex justify-between text-ink-secondary">
            <span>Subtotal</span>
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
