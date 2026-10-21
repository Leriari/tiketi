import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { WifiOff, Sun, Repeat, UserPlus, Wallet, ChevronRight, CheckCircle2 } from "lucide-react";
import { api, ApiError } from "../../api";
import { useToast } from "../../components/ui/Toast";
import {
  QRDisplay, CountdownRing, Badge, Button, Drawer, Input, Skeleton, ErrorState,
} from "../../components/ui";
import { formatPhone } from "../../format";
import EventCover from "../../components/EventCover";

const ROTATION_S = 30;
const BRIGHTNESS_DISMISSED_KEY = "chaintix_brightness_prompt_seen";

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-line-subtle last:border-b-0">
      <span className="text-caption text-ink-tertiary">{label}</span>
      <span className="text-body-sm text-ink-primary font-medium tabular-nums">{value}</span>
    </div>
  );
}

export default function TicketCredential() {
  const { ticketId } = useParams();
  const navigate = useNavigate();

  const [detail, setDetail] = useState(null);
  const [payload, setPayload] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(ROTATION_S);
  const [error, setError] = useState(null);
  const [showBrightness, setShowBrightness] = useState(false);
  const tickRef = useRef(null);

  const refreshPayload = useCallback(async () => {
    try {
      const seed = await api.getTicketSeed(ticketId);
      setPayload(seed.qr_payload);
    } catch (err) {
      setError(err.message);
    }
  }, [ticketId]);

  useEffect(() => {
    api.getTicketDetail(ticketId).then(setDetail).catch((err) => setError(err.message));
    refreshPayload();
    if (!localStorage.getItem(BRIGHTNESS_DISMISSED_KEY)) setShowBrightness(true);
  }, [ticketId, refreshPayload]);

  useEffect(() => {
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
  }, [refreshPayload]);

  function dismissBrightness() {
    localStorage.setItem(BRIGHTNESS_DISMISSED_KEY, "1");
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
      {showBrightness && (
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
          {detail.gate_assignment && <p className="text-caption text-ink-tertiary mt-0.5">Enter via {detail.gate_assignment}</p>}
        </div>
        <Badge tone="verified" icon={<WifiOff size={11} />} className="flex-none">Works offline</Badge>
      </div>

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

      <div className="rounded-md border border-line-subtle bg-surface px-4">
        <DetailRow label="Ticket ID" value={`#${detail.ticket_id.slice(0, 8).toUpperCase()}`} />
        <DetailRow label="Tier" value={detail.tier_name} />
        <DetailRow label="Seat" value={detail.seat_number || "General admission"} />
        <DetailRow label="Token ID" value={detail.nft_token_id ? `#${detail.nft_token_id}` : "Minting…"} />
      </div>

      <div className="flex flex-col gap-2">
        <Button
          variant="secondary"
          iconLeft={<Repeat size={15} />}
          onClick={() => navigate(`/seller/sell?ticket=${detail.ticket_id}`)}
        >
          Sell this ticket
        </Button>
        <TransferAction ticketId={detail.ticket_id} />
        <ClaimWalletAction ticketId={detail.ticket_id} claimed={detail.self_custodied} walletAddress={detail.wallet_address} onClaimed={() => api.getTicketDetail(ticketId).then(setDetail)} />
      </div>
    </div>
  );
}

function TransferAction({ ticketId }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.transferTicket(ticketId, { recipient: recipient.trim() });
      toast.push(`Ticket transferred to ${formatPhone(recipient.trim())}.`, { tone: "success" });
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't transfer this ticket.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" iconLeft={<UserPlus size={15} />} onClick={() => setOpen(true)}>
        Transfer to a friend
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} side="bottom" title="Transfer to a friend">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Input
            label="Recipient's phone number"
            placeholder="0712 345 678"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            required
          />
          <p className="text-caption text-ink-tertiary">This ticket will be permanently transferred — your current credential is invalidated instantly.</p>
          {error && <div className="text-body-sm text-danger">{error}</div>}
          <Button type="submit" loading={busy} disabled={!recipient.trim()}>Confirm transfer</Button>
        </form>
      </Drawer>
    </>
  );
}

function ClaimWalletAction({ ticketId, claimed, walletAddress, onClaimed }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const REQUIRED_TEXT = "CLAIM";

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.claimTicketToWallet(ticketId, { walletAddress: address.trim() });
      toast.push("Ticket claimed to your wallet.", { tone: "success" });
      setOpen(false);
      onClaimed?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't claim this ticket.");
    } finally {
      setBusy(false);
    }
  }

  if (claimed) {
    return (
      <div className="flex items-center gap-2 rounded-sm border border-line px-4 py-3 text-body-sm text-ink-secondary">
        <CheckCircle2 size={15} className="text-chain-verified flex-none" />
        Claimed to {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
      </div>
    );
  }

  return (
    <>
      <Button variant="ghost" iconLeft={<Wallet size={15} />} onClick={() => setOpen(true)} className="justify-between w-full">
        <span className="flex items-center gap-2"><Wallet size={15} /> Claim to my own wallet</span>
        <ChevronRight size={15} />
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} side="bottom" title="Claim to your own wallet">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="rounded-md bg-warning-bg text-warning-on-tint p-3 text-body-sm flex flex-col gap-1.5">
            <p><strong>What this does:</strong> moves this ticket out of your ChainTix custodial wallet into a wallet only you control.</p>
            <p><strong>What changes:</strong> you'll manage the private key yourself from now on.</p>
            <p><strong>What doesn't:</strong> the ticket still works the same way at the gate.</p>
            <p><strong>Heads up:</strong> ChainTix support cannot recover a claimed ticket if you lose access to that wallet.</p>
          </div>
          <Input label="Your wallet address" placeholder="0x…" value={address} onChange={(e) => setAddress(e.target.value)} required />
          <Input
            label={`Type ${REQUIRED_TEXT} to confirm`}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={REQUIRED_TEXT}
            required
          />
          {error && <div className="text-body-sm text-danger">{error}</div>}
          <Button type="submit" variant="danger" loading={busy} disabled={confirmText !== REQUIRED_TEXT || !address.trim()}>
            Claim ticket
          </Button>
        </form>
      </Drawer>
    </>
  );
}
