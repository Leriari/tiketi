import { api } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { Card, MoneyText, Table, EmptyState, ErrorState, Skeleton } from "../../components/ui";

const SLICE_COLORS = ["var(--brand-primary)", "var(--brand-accent)", "var(--info)", "var(--warning)", "var(--success)", "var(--danger)"];

export default function RevenueBreakdown() {
  const { data, error, retry } = useApiData(() => api.getRevenueBreakdown());

  return (
    <div className="mx-auto max-w-5xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <h1 className="text-h1 text-ink-primary">Revenue Breakdown</h1>

      {error && <ErrorState description={error} onRetry={retry} />}

      {!error && !data && <div className="flex flex-col gap-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}</div>}

      {data && <RevenueBreakdownBody data={data} />}
    </div>
  );
}

function RevenueBreakdownBody({ data }) {
  const total = data.byCategory.reduce((s, c) => s + c.revenue, 0);

  return (
    <>
      {total === 0 ? (
        <EmptyState title="No revenue yet" description="Revenue breaks down by category and tier here once tickets start selling." />
      ) : (
        <>
          <Card className="flex flex-col gap-3">
            <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">By category</span>
            <div className="flex flex-col gap-2">
              {data.byCategory.map((c, i) => {
                const pct = total ? Math.round((c.revenue / total) * 100) : 0;
                return (
                  <div key={c.category} className="flex items-center gap-3">
                    <span className="w-28 text-body-sm text-ink-primary capitalize flex-none truncate">{c.category}</span>
                    <div className="flex-1 h-2 rounded-full bg-surface-elevated overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: SLICE_COLORS[i % SLICE_COLORS.length] }} />
                    </div>
                    <MoneyText value={c.revenue} className="w-28 text-right flex-none" />
                  </div>
                );
              })}
            </div>
          </Card>

          <div className="flex flex-col gap-2">
            <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">By ticket tier</span>
            <Table
              data={data.byTier}
              getRowId={(r) => `${r.event_title}-${r.tier_name}`}
              columns={[
                { key: "event_title", header: "Event" },
                { key: "tier_name", header: "Tier" },
                { key: "tickets_sold", header: "Sold", render: (r) => <span className="tabular-nums">{r.tickets_sold}</span> },
                { key: "revenue", header: "Revenue", render: (r) => <MoneyText value={r.revenue} className="font-semibold" /> },
              ]}
            />
          </div>
        </>
      )}
    </>
  );
}
