import { api } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { Table, Badge, MoneyText, EmptyState, ErrorState } from "../../components/ui";

const TYPE_TONE = { seller: "info", organiser: "brand" };

export default function PayoutQueue() {
  const { data: rows, error, retry } = useApiData(() => api.getPayoutQueue());

  const total = (rows || []).reduce((s, r) => s + r.amount_kes, 0);

  return (
    <div className="mx-auto max-w-4xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-h1 text-ink-primary">Payout Queue</h1>
          <p className="text-body-sm text-ink-tertiary">Every seller and organiser payout still in escrow, soonest release first.</p>
        </div>
        {rows && rows.length > 0 && <p className="text-body-sm text-ink-secondary">Total queued <MoneyText value={total} className="font-semibold text-ink-primary" /></p>}
      </div>

      {error && <ErrorState description={error} onRetry={retry} />}

      {!error && <Table
        loading={rows === null}
        data={rows || []}
        getRowId={(r) => r.id}
        empty={<EmptyState title="Queue is empty" description="Nothing is currently held in escrow awaiting release." />}
        columns={[
          { key: "type", header: "Type", render: (r) => <Badge tone={TYPE_TONE[r.type]}>{r.type}</Badge> },
          { key: "recipient", header: "Recipient" },
          { key: "description", header: "Description" },
          { key: "amount_kes", header: "Amount", render: (r) => <MoneyText value={r.amount_kes} variant="pending" /> },
          { key: "available_at", header: "Releases", render: (r) => <span className="tabular-nums">{new Date(r.available_at).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}</span> },
        ]}
      />}
    </div>
  );
}
