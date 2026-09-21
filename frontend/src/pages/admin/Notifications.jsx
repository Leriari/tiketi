import { Link } from "react-router-dom";
import { AlertTriangle, Info, ChevronRight } from "lucide-react";
import { api } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { Card, EmptyState, ErrorState, Skeleton } from "../../components/ui";

export default function Notifications() {
  const { data: notices, error, retry } = useApiData(() => api.getAdminNotifications());

  return (
    <div className="mx-auto max-w-2xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <div>
        <h1 className="text-h1 text-ink-primary">Notifications</h1>
        <p className="text-body-sm text-ink-tertiary">What needs your attention right now, drawn live from the queues below.</p>
      </div>

      {error ? (
        <ErrorState description={error} onRetry={retry} />
      ) : notices === null ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : notices.length === 0 ? (
        <EmptyState title="You're all caught up" description="No pending reviews, fraud signals, or payout backlogs right now." />
      ) : (
        notices.map((n) => (
          <Link key={n.id} to={n.link}>
            <Card className="flex items-center gap-3 hover:border-line-strong transition-colors">
              {n.severity === "warning" ? <AlertTriangle size={18} className="text-warning flex-none" /> : <Info size={18} className="text-info flex-none" />}
              <p className="text-body-sm text-ink-primary flex-1">{n.text}</p>
              <ChevronRight size={16} className="text-ink-tertiary flex-none" />
            </Card>
          </Link>
        ))
      )}
    </div>
  );
}
