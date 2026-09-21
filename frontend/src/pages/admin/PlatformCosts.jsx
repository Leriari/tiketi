import { api } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { StatCard, MoneyText, Table, EmptyState, ErrorState, Skeleton } from "../../components/ui";

export default function PlatformCosts() {
  const { data, error, retry } = useApiData(() => api.getPlatformCosts());

  return (
    <div className="mx-auto max-w-5xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <div>
        <h1 className="text-h1 text-ink-primary">Platform Costs</h1>
        <p className="text-body-sm text-ink-tertiary">What it costs ChainTix to run — infrastructure, on-chain gas, SMS, and Daraja transaction charges.</p>
      </div>

      {error ? (
        <ErrorState description={error} onRetry={retry} />
      ) : !data ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Infrastructure" value={`$${data.infraMonthlyUsd}`} hint="Fixed monthly, hosting + services" />
            <StatCard label="Gas Spend" value={`$${data.gasSpendUsd}`} hint="On-chain minting, all-time" />
            <StatCard label="SMS Spend" value={<MoneyText value={data.smsSpendKes} />} hint="Transactional SMS, all-time" />
            <StatCard label="Daraja Charges" value={<MoneyText value={data.darajaChargesKes} />} hint="M-Pesa transaction fees, all-time" />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">Per-event unit economics</span>
            <Table
              data={data.perEvent}
              getRowId={(r) => r.event_id}
              empty={<EmptyState title="No cost data yet" description="Unit economics appear here once events start selling tickets." />}
              columns={[
                { key: "event_title", header: "Event" },
                { key: "tickets_sold", header: "Tickets", render: (r) => <span className="tabular-nums">{r.tickets_sold}</span> },
                { key: "revenue_kes", header: "Revenue", render: (r) => <MoneyText value={r.revenue_kes} /> },
                { key: "gas_cost_usd", header: "Gas cost", render: (r) => <span className="tabular-nums">${r.gas_cost_usd}</span> },
                { key: "sms_cost_kes", header: "SMS cost", render: (r) => <MoneyText value={r.sms_cost_kes} variant="negative" /> },
              ]}
            />
          </div>
        </>
      )}
    </div>
  );
}
