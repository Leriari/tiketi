import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2, CalendarPlus } from "lucide-react";
import { api } from "../../api";
import { Card, Button, ChainBadge, Skeleton } from "../../components/ui";
import { formatEventDate } from "../../format";
import { markFirstPurchase } from "../../components/InstallPrompt";

const BASESCAN_BASE = "https://sepolia.basescan.org/tx/";

export default function Confirmation() {
  const { ticketId } = useParams();
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    markFirstPurchase();
  }, []);

  useEffect(() => {
    let stop = false;
    async function poll() {
      const d = await api.getTicketDetail(ticketId);
      if (stop) return;
      setDetail(d);
      if (d.chain_status !== "verified") setTimeout(poll, 1000);
    }
    poll();
    return () => {
      stop = true;
    };
  }, [ticketId]);

  if (!detail) {
    return (
      <div className="mx-auto max-w-md px-4 py-10 flex flex-col gap-4 items-center">
        <Skeleton className="h-16 w-16 rounded-full" />
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10 flex flex-col items-center text-center gap-5">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success-bg animate-[popIn_320ms_cubic-bezier(0.32,0.72,0,1)]">
        <CheckCircle2 size={34} className="text-success" />
      </span>
      <div>
        <h1 className="text-h1 text-ink-primary">You're going!</h1>
        <p className="text-body-sm text-ink-tertiary tabular-nums mt-1">Order #{detail.ticket_id.slice(0, 8).toUpperCase()}</p>
      </div>

      <Card className="w-full flex flex-col gap-3 text-left">
        <div>
          <h2 className="text-h3 text-ink-primary">{detail.event_title}</h2>
          <p className="text-body-sm text-ink-secondary">{detail.venue} · {formatEventDate(detail.event_date)}</p>
          <p className="text-caption text-ink-tertiary mt-0.5">{detail.tier_name} ticket</p>
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-line-subtle">
          <span className="text-caption text-ink-tertiary">Ownership status</span>
          <ChainBadge
            status={detail.chain_status}
            txUrl={detail.nft_tx_hash ? BASESCAN_BASE + detail.nft_tx_hash : undefined}
          />
        </div>
      </Card>

      <p className="text-caption text-ink-tertiary">Your ticket is ready to use right now — you don't need to wait for the badge above.</p>

      <div className="flex flex-col gap-2 w-full">
        <Link to={`/tickets/${detail.ticket_id}`}>
          <Button variant="primary" className="w-full">View my ticket</Button>
        </Link>
        <Button variant="secondary" iconLeft={<CalendarPlus size={14} />}>
          Add to calendar
        </Button>
      </div>

      <style>{`@keyframes popIn { from { transform: scale(0.6); opacity: 0 } to { transform: scale(1); opacity: 1 } }`}</style>
    </div>
  );
}
