import { useState } from "react";
import { api } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { useToast } from "../../components/ui/Toast";
import { Select, Input, Button, Card, ErrorState, Skeleton } from "../../components/ui";

export default function PayoutDetails() {
  const toast = useToast();
  const { data: form, setData: setForm, error, retry } = useApiData(() => api.getPayoutDetails());
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.updatePayoutDetails(form);
      toast.push("Payout details saved.", { tone: "success" });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="mx-auto max-w-lg px-4 py-6"><ErrorState description={error} onRetry={retry} /></div>;
  if (!form) return <div className="mx-auto max-w-lg px-4 py-6"><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="mx-auto max-w-lg px-4 lg:px-6 py-6 flex flex-col gap-4">
      <h1 className="text-h1 text-ink-primary">Payout Details</h1>
      <p className="text-body-sm text-ink-tertiary">Where your available balance goes when it's released — 4 days after each event, automatically.</p>

      <form onSubmit={save} className="card flex flex-col gap-4">
        <Select label="Payout method" value={form.payoutMethod} onChange={(e) => setForm((f) => ({ ...f, payoutMethod: e.target.value }))}>
          <option value="mpesa">M-Pesa</option>
          <option value="bank">Bank transfer</option>
        </Select>
        <Input
          label={form.payoutMethod === "bank" ? "Bank account number" : "M-Pesa number"}
          value={form.payoutDestination}
          onChange={(e) => setForm((f) => ({ ...f, payoutDestination: e.target.value }))}
          placeholder={form.payoutMethod === "bank" ? "0123456789" : "0712 345 678"}
          required
        />
        <Button type="submit" loading={busy}>Save payout details</Button>
      </form>

      <Card className="text-caption text-ink-tertiary">Payouts release automatically 4 days after your event — no manual withdrawal needed.</Card>
    </div>
  );
}
