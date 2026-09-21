import { api } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { Table, MoneyText, Badge, EmptyState, ErrorState } from "../../components/ui";

export default function RoyaltyLedger() {
  const { data: rows, error, retry } = useApiData(() => api.getRoyaltyLedger());

  const total = (rows || []).reduce((sum, r) => sum + r.royalty_kes, 0);

  return (
    <div className="mx-auto max-w-5xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-h1 text-ink-primary">Royalty Ledger</h1>
        {rows && rows.length > 0 && (
          <p className="text-body-sm text-ink-secondary">
            Total royalties earned <MoneyText value={total} className="font-semibold text-ink-primary" />
          </p>
        )}
      </div>
      <p className="text-body-sm text-ink-tertiary">Every resale of your tickets pays you a royalty automatically, enforced on-chain — this is the full record.</p>

      {error && <ErrorState description={error} onRetry={retry} />}

      {!error && <Table
        loading={rows === null}
        data={rows || []}
        getRowId={(r) => r.id}
        empty={<EmptyState title="No royalties yet" description="Royalties appear here the first time one of your tickets resells." />}
        columns={[
          { key: "date", header: "Date", render: (r) => <span className="tabular-nums">{new Date(r.date).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}</span> },
          { key: "event_title", header: "Event" },
          { key: "ticket_id", header: "Ticket", render: (r) => <span className="font-mono text-caption">{r.ticket_id ? r.ticket_id.slice(0, 8) : "—"}</span> },
          { key: "resale_price_kes", header: "Resale price", render: (r) => <MoneyText value={r.resale_price_kes} /> },
          { key: "royalty_kes", header: "Your royalty", render: (r) => <MoneyText value={r.royalty_kes} variant="positive" className="font-semibold" /> },
          { key: "tx_hash", header: "Transaction", render: (r) => <span className="font-mono text-caption text-ink-tertiary truncate">{r.tx_hash.slice(0, 14)}…</span> },
          { key: "status", header: "Status", render: () => <Badge tone="success">Success</Badge> },
        ]}
      />}
    </div>
  );
}
