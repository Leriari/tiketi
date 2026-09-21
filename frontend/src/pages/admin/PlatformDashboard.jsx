import { api } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { StatCard, MoneyText, ErrorState, Skeleton } from "../../components/ui";

export default function PlatformDashboard() {
  const { data, error, retry } = useApiData(() => api.getPlatformDashboard());

  return (
    <div className="mx-auto max-w-5xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <div>
        <h1 className="text-h1 text-ink-primary">Platform Dashboard</h1>
        <p className="text-body-sm text-ink-tertiary">Everything happening across ChainTix right now.</p>
      </div>

      {error ? (
        <ErrorState description={error} onRetry={retry} />
      ) : !data ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Gross Merchandise Value" value={<MoneyText value={data.gmv} size="h3" />} hint="Primary + resale, all-time" emphasised />
          <StatCard label="Platform Fee Revenue" value={<MoneyText value={data.platformFeeRevenue} size="h3" variant="positive" />} hint="5% of primary sales" />
          <StatCard label="Active Events" value={data.activeEvents} hint="Live or sold out" />
          <StatCard label="Tickets Sold Today" value={data.ticketsSoldToday} />
          <StatCard label="Organisers" value={data.organiserCount} hint="Verified + pending" />
          <StatCard label="Failed Mints" value={data.failedMintCount} hint="Nothing stuck right now" />
          <StatCard label="Payout Queue Depth" value={data.payoutQueueDepth} hint="Pending seller + organiser payouts" />
        </div>
      )}
    </div>
  );
}
