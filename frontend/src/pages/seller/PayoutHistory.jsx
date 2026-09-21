import { useEffect, useState } from "react";
import { api } from "../../api";
import { Table, MoneyText, Badge, EmptyState } from "../../components/ui";

/** Nav item "Payout History" — a filtered view of the same ledger Wallet shows. */
export default function PayoutHistory() {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    api.getWallet().then((w) => setRows(w.transactions.filter((t) => t.type === "withdrawal")));
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <h1 className="text-h1 text-ink-primary">Payout History</h1>
      <Table
        loading={rows === null}
        data={rows || []}
        getRowId={(t) => t.id}
        empty={<EmptyState title="No payouts yet" description="Withdrawals to M-Pesa will show up here." />}
        columns={[
          { key: "created_at", header: "Date", render: (t) => <span className="tabular-nums">{new Date(t.created_at).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}</span> },
          { key: "description", header: "Destination" },
          { key: "amount", header: "Amount", render: (t) => <MoneyText value={Math.abs(t.amount)} variant="negative" /> },
          { key: "status", header: "Status", render: (t) => <Badge tone="success">{t.status}</Badge> },
        ]}
      />
    </div>
  );
}
