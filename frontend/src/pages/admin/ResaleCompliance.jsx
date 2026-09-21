import { ShieldCheck } from "lucide-react";
import { api } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { StatCard, Card, Table, EmptyState, ErrorState, Skeleton } from "../../components/ui";

export default function ResaleCompliance() {
  const { data, error, retry } = useApiData(() => api.getPlatformResaleCompliance());

  return (
    <div className="mx-auto max-w-4xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <div>
        <h1 className="text-h1 text-ink-primary">Resale Compliance</h1>
        <p className="text-body-sm text-ink-tertiary">Platform-wide view of resale price-cap enforcement, across every organiser.</p>
      </div>

      {error ? (
        <ErrorState description={error} onRetry={retry} />
      ) : !data ? (
        <div className="flex flex-col gap-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Blocked over-cap attempts" value={data.rejectedAboveCapAttempts} hint="Rejected before publishing, platform-wide" />
            <StatCard label="Listings paused by a cap change" value={data.listingsPausedByCapChange} />
          </div>

          {data.rejectedAboveCapAttempts === 0 && data.listingsPausedByCapChange === 0 && (
            <Card className="flex items-center gap-3 bg-success-bg">
              <ShieldCheck size={18} className="text-success flex-none" />
              <p className="text-body-sm text-ink-primary">No compliance issues platform-wide. Every active listing sits at or below its resale cap.</p>
            </Card>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">By event</span>
            <Table
              data={data.byEvent}
              getRowId={(r) => r.event_id}
              empty={<EmptyState title="No resale activity yet" description="Per-event resale compliance appears here once listings exist." />}
              columns={[
                { key: "event_title", header: "Event" },
                { key: "cap_percent", header: "Cap", render: (r) => `${r.cap_percent}%` },
                { key: "listings", header: "Active listings", render: (r) => <span className="tabular-nums">{r.listings}</span> },
                { key: "rejected", header: "Blocked attempts", render: (r) => <span className="tabular-nums">{r.rejected}</span> },
              ]}
            />
          </div>
        </>
      )}
    </div>
  );
}
