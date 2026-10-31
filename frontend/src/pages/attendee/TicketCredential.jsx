import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { WifiOff, Sun, Repeat, UserPlus, CheckCircle2, Tag, Mail, Receipt } from "lucide-react";
import { api, ApiError } from "../../api";
import { useToast } from "../../components/ui/Toast";
import { useAuth } from "../../context/AuthContext";
import {
  QRDisplay, CountdownRing, Badge, Button, Drawer, Input, Skeleton, ErrorState, MoneyText,
} from "../../components/ui";
import { formatEventDate } from "../../format";
import EventCover from "../../components/EventCover";
import AddToCalendar from "../../components/AddToCalendar";
import OnChainRecord from "../../components/OnChainRecord";

const ROTATION_S = 30;
const BRIGHTNESS_DISMISSED_KEY = "chaintix_brightness_prompt_seen";
const MINT_POLL_MS = 5000;

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-line-subtle last:border-b-0">
      <span className="text-caption text-ink-tertiary flex-none">{label}</span>
      <span className="text-body-sm text-ink-primary font-medium tabular-nums text-right min-w-0 truncate">{value}</span>
    </div>
  );
}

function when(iso) {
  return iso ? new Date(iso).toLocaleString("en-KE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
}

export default function TicketCredential() {
  const { ticketId } = useParams();
  const navigate = useNavigate();
  const { roles } = useAuth();

  const [detail, setDetail] = useState(null);
  const [payload, setPayload] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(ROTATION_S);
  const [error, setError] = useState(null);
  const [showBrightness, setShowBrightness] = useState(false);
  const tickRef = useRef(null);

  const active = detail?.status === "active";

  const loadDetail = useCallback(
    () => api.getTicketDetail(ticketId).then(setDetail).catch((err) => setError(err.message)),
    [ticketId],
  );

  const refreshPayload = useCallback(async () => {
    try {
      const seed = await api.getTicketSeed(ticketId);
      setPayload(seed.qr_payload);
    } catch (err) {
      setError(err.message);
    }
  }, [ticketId]);

  useEffect(() => {
    loadDetail();
    let seen = false;
    try { seen = Boolean(localStorage.getItem(BRIGHTNESS_DISMISSED_KEY)); } catch { /* private mode */ }
    if (!seen) setShowBrightness(true);
  }, [loadDetail]);

  // The QR only exists for an unused, unlisted ticket.
  useEffect(() => {
    if (!active) return undefined;
    refreshPayload();
    tickRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          refreshPayload();
          return ROTATION_S;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(tickRef.current);
  }, [active, refreshPayload]);

  // Picks up the mint (and the on-chain record) without a reload.
  useEffect(() => {
    if (!detail || detail.chain_status === "verified") return undefined;
    const t = setTimeout(loadDetail, MINT_POLL_MS);
    return () => clearTimeout(t);
  }, [detail, loadDetail]);

  function dismissBrightness() {
    try { localStorage.setItem(BRIGHTNESS_DISMISSED_KEY, "1"); } catch { /* private mode */ }
    setShowBrightness(false);
  }

  if (error && !detail) return <ErrorState className="mt-10" description={error} onRetry={() => location.reload()} />;
  if (!detail) {
    return (
      <div className="mx-auto max-w-sm px-4 py-8 flex flex-col items-center gap-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-72 w-72 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-6 flex flex-col gap-5">
      {active && showBrightness && (
        <div className="flex items-center gap-2 rounded-md bg-info-bg text-info-on-tint px-3 py-2 text-caption">
          <Sun size={14} className="flex-none" />
          <span className="flex-1">Turn up your screen brightness so the gate can scan this easily.</span>
          <button onClick={dismissBrightness} className="font-semibold">Got it</button>
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <EventCover event={detail} eager className="h-14 w-14 rounded-md flex-none" />
        <div className="flex-1 min-w-0">
          <h1 className="text-h1 text-ink-primary">{detail.event_title}</h1>
          <p className="text-body-sm text-ink-secondary">{detail.venue}</p>
          <p className="text-caption text-ink-tertiary mt-0.5">{formatEventDate(detail.event_date)}</p>
          {detail.gate_assignment && <p className="text-caption text-ink-secondary font-semibold mt-0.5">Enter via {detail.gate_assignment}</p>}
        </div>
        {active && <Badge tone="verified" icon={<WifiOff size={11} />} className="flex-none">Works offline</Badge>}
      </div>

      {active ? (
        <div className="flex flex-col items-center gap-3 py-2">
          <div
            className="rounded-xl p-1"
            style={{ background: `conic-gradient(var(--brand-accent) ${(secondsLeft / ROTATION_S) * 360}deg, var(--border-subtle) 0deg)` }}
          >
            {payload ? <QRDisplay value={payload} size={240} /> : <Skeleton className="h-[264px] w-[264px] rounded-lg" />}
          </div>
          <CountdownRing secondsLeft={secondsLeft} totalSeconds={ROTATION_S} size={40} tone="brand">
            <span className="text-caption font-bold tabular-nums text-ink-primary">{secondsLeft}</span>
          </CountdownRing>
          <p className="text-caption text-ink-tertiary text-center">Refreshes every 30 seconds — screenshots will not work.</p>
        </div>
      ) : (
        <StatusPanel detail={detail} />
      )}

      <div className="rounded-md border border-line-subtle bg-surface px-4">
        {roles.displayName && <DetailRow label="Ticket holder" value={roles.displayName} />}
        <DetailRow label="Ticket ID" value={`#${detail.ticket_id.slice(0, 8).toUpperCase()}`} />
        <DetailRow label="Tier" value={`${detail.tier_name || "General"}${detail.is_complimentary ? " (complimentary)" : ""}`} />
        <DetailRow label="Seat" value={detail.seat_number || "General admission"} />
      </div>

      {detail.payment && <PaymentCard ticketId={detail.ticket_id} payment={detail.payment} receiptEmail={detail.receipt_email} />}

      <OnChainRecord ticketId={detail.ticket_id} detail={detail} />

      {active && (
        <div className="flex flex-col gap-2">
          <AddToCalendar event={detail} ticketId={detail.ticket_id} className="w-full" />
          <Button variant="secondary" iconLeft={<Repeat size={15} />} onClick={() => navigate(`/seller/sell?ticket=${detail.ticket_id}`)}>
            Sell this ticket
          </Button>
          <TransferAction ticketId={detail.ticket_id} eventTitle={detail.event_title} onTransferred={() => navigate("/tickets", { replace: true })} />
        </div>
      )}
    </div>
  );
}

function StatusPanel({ detail }) {
  if (detail.status === "used") {
    return (
      <div className="flex flex-col items-center gap-2 py-6 rounded-md bg-success-bg text-center">
        <CheckCircle2 size={40} className="text-success" />
        <p className="text-h3 text-ink-primary">Admitted</p>
        <p className="text-body-sm text-ink-secondary">Scanned in on {when(detail.admitted_at)}. Enjoy the event!</p>
      </div>
    );
  }
  if (detail.status === "resale") {
    return (
      <div className="flex flex-col items-center gap-2 py-6 rounded-md bg-info-bg text-center px-4">
        <Tag size={36} className="text-info-on-tint" />
        <p className="text-h3 text-ink-primary">Listed for resale</p>
        <p className="text-body-sm text-ink-secondary">Its QR code is paused while it's on sale. Take it off sale to use it yourself.</p>
        <Link to="/seller/listings" className="text-body-sm font-semibold text-brand-primary-on-tint hover:underline">Manage my listings</Link>
      </div>
    );
  }
  return (
    <div className="py-6 rounded-md bg-surface-inset text-center px-4">
      <p className="text-h3 text-ink-primary">{detail.status === "cancelled" ? "Cancelled" : "Not active yet"}</p>
      <p className="text-body-sm text-ink-secondary">
        {detail.status === "cancelled" ? "This ticket was cancelled and can't be used." : "This ticket is waiting for its payment to complete."}
      </p>
    </div>
  );
}

function PaymentCard({ ticketId, payment, receiptEmail }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function resend() {
    setBusy(true);
    try {
      const res = await api.resendReceipt(ticketId);
      toast.push(`Receipt sent to ${res.email}.`, { tone: "success" });
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Couldn't send the receipt.", { tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="payment-heading" className="rounded-md border border-line-subtle bg-surface px-4 py-3">
      <h2 id="payment-heading" className="text-body font-semibold text-ink-primary flex items-center gap-2 mb-1">
        <Receipt size={16} className="text-ink-tertiary" aria-hidden="true" /> Payment
      </h2>
      <DetailRow label="Paid" value={<MoneyText value={payment.amount_kes} />} />
      {payment.quantity > 1 && <DetailRow label="Order" value={`${payment.quantity} tickets`} />}
      {payment.method === "card"
        ? <DetailRow label="Card" value={payment.paid_with || "Card"} />
        : <DetailRow label="M-Pesa receipt" value={payment.mpesa_receipt || "—"} />}
      <DetailRow label="Date" value={when(payment.paid_at)} />
      {receiptEmail && (
        <button
          type="button"
          onClick={resend}
          disabled={busy}
          className="mt-2 inline-flex items-center gap-1.5 text-body-sm font-semibold text-brand-primary-on-tint hover:underline disabled:opacity-60"
        >
          <Mail size={14} aria-hidden="true" /> {busy ? "Sending…" : `Email the receipt to ${receiptEmail}`}
        </button>
      )}
    </section>
  );
}

function TransferAction({ ticketId, eventTitle, onTransferred }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.transferTicket(ticketId, { recipient: recipient.trim() });
      toast.push(`Your ${eventTitle} ticket is now ${res.recipient_name}'s.`, { tone: "success" });
      setOpen(false);
      onTransferred?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't transfer this ticket.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" iconLeft={<UserPlus size={15} />} onClick={() => setOpen(true)}>
        Give to a friend
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} side="bottom" title="Give this ticket to a friend">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Input
            label="Their phone number or email"
            placeholder="0712 345 678 or name@example.com"
            hint="They need a ChainTix account. If they don't have one yet, ask them to sign up first."
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            required
          />
          <label className="flex items-start gap-2 text-body-sm text-ink-secondary">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-1" />
            <span>I understand this is free and permanent: the ticket moves to their account, and my QR code stops working straight away.</span>
          </label>
          {error && <div role="alert" className="text-body-sm text-danger">{error}</div>}
          <Button type="submit" loading={busy} disabled={!recipient.trim() || !confirm}>Give ticket</Button>
        </form>
      </Drawer>
    </>
  );
}
