import { api } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { PAYOUT_STATUS } from "../../lib/payouts";
import { Table, MoneyText, Badge, EmptyState, ErrorState } from "../../components/ui";

/** Nav item "Payout History" — the withdrawals from the same ledger Wallet shows. */
export default function PayoutHistory() {
  const { data: wallet, error, retry } = useApiData(() => api.getWallet());
  const rows = wallet ? wallet.transactions.filter((t) => t.type === "withdrawal") : null;

  return (
    <div className="mx-auto max-w-4xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <h1 className="text-h1 text-ink-primary">Payout History</h1>
      {error ? <ErrorState description={error} onRetry={retry} /> : (
        <Table
          loading={rows === null}
          data={rows || []}
          getRowId={(t) => t.id}
          empty={<EmptyState title="No payouts yet" description="Withdrawals to M-Pesa will show up here." />}
          columns={[
            { key: "created_at", header: "Date", render: (t) => <span className="tabular-nums">{new Date(t.created_at).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}</span> },
            { key: "description", header: "Destination", render: (t) => t.payout?.destination || t.description },
            { key: "amount", header: "Withdrawn", render: (t) => <MoneyText value={Math.abs(t.amount)} /> },
            { key: "net", header: "Received", render: (t) => (t.payout ? <MoneyText value={t.payout.status === "paid" ? t.payout.net_kes : 0} variant="positive" /> : "—") },
            { key: "receipt", header: "M-Pesa receipt", render: (t) => <span className="font-mono text-caption">{t.payout?.mpesa_receipt || "—"}</span> },
            {
              key: "status", header: "Status", render: (t) => {
                const s = PAYOUT_STATUS[t.payout?.status] || { label: t.status, tone: "neutral" };
                return (
                  <div className="flex flex-col gap-0.5 items-start">
                    <Badge tone={s.tone}>{s.label}</Badge>
                    {t.payout?.note && ["failed", "rejected"].includes(t.payout.status) && <span className="text-caption text-ink-tertiary">{t.payout.note}</span>}
                  </div>
                );
              },
            },
          ]}
        />
      )}
    </div>
  );
}
