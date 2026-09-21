import { api } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { Card, ProgressBar, EmptyState, ErrorState, Skeleton } from "../../components/ui";

export default function Attendance() {
  const { data: rows, error, retry } = useApiData(() => api.getAttendanceSummary());

  return (
    <div className="mx-auto max-w-4xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <h1 className="text-h1 text-ink-primary">Attendance</h1>
      <p className="text-body-sm text-ink-tertiary">Tickets sold vs. actually scanned at the gate, per event.</p>

      {error && <ErrorState description={error} onRetry={retry} />}

      {!error && rows === null && <div className="flex flex-col gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>}

      {rows?.length === 0 && <EmptyState title="No events yet" description="Attendance data appears here once an event has ticket sales." />}

      {rows?.map((r) => (
        <Card key={r.event_id} className="flex flex-col gap-2">
          <div className="flex items-center justify-between flex-wrap gap-1">
            <span className="text-h3 text-ink-primary">{r.event_title}</span>
            <span className="text-caption text-ink-tertiary">{new Date(r.event_date).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}</span>
          </div>
          <div className="flex justify-between text-body-sm text-ink-secondary">
            <span>Admitted {r.admitted} of {r.sold} sold ({r.capacity} capacity)</span>
            <span className="tabular-nums font-semibold text-ink-primary">{r.admissionRate}%</span>
          </div>
          <ProgressBar value={r.admitted} max={r.sold || 1} ariaLabel={`Admitted for ${r.event_title}`} />
        </Card>
      ))}
    </div>
  );
}
