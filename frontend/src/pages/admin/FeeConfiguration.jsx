import { useEffect, useState } from "react";
import { api, ApiError } from "../../api";
import { useToast } from "../../components/ui/Toast";
import { Card, Input, Button, Table, EmptyState, ErrorState, Skeleton } from "../../components/ui";

const FIELDS = [
  { key: "platformFeePercent", label: "Platform fee", suffix: "%" },
  { key: "scanningFeeKes", label: "Scanning fee", suffix: "KES" },
  { key: "minPayoutKes", label: "Minimum payout", suffix: "KES" },
  { key: "sellerEscrowDays", label: "Seller escrow period", suffix: "days (T+N)" },
  { key: "organiserEscrowDays", label: "Organiser escrow period", suffix: "days (T+N)" },
];

export default function FeeConfiguration() {
  const toast = useToast();
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(null);

  function load() {
    setLoadError(null);
    api.getFeeConfig().then(({ current, history }) => {
      setCurrent(current);
      setHistory(history);
      setForm(current);
    }).catch((err) => setLoadError(err instanceof ApiError ? err.message : "Couldn't load the fee configuration."));
  }
  useEffect(load, []);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.updateFeeConfig({
        platformFeePercent: Number(form.platformFeePercent),
        scanningFeeKes: Number(form.scanningFeeKes),
        minPayoutKes: Number(form.minPayoutKes),
        sellerEscrowDays: Number(form.sellerEscrowDays),
        organiserEscrowDays: Number(form.organiserEscrowDays),
      });
      toast.push("Fee configuration updated.", { tone: "success" });
      load();
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Couldn't save the fee configuration.", { tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <div className="mx-auto max-w-2xl px-4 py-6"><ErrorState description={loadError} onRetry={load} /></div>;
  if (!form) return <div className="mx-auto max-w-2xl px-4 py-6"><Skeleton className="h-96 w-full" /></div>;

  return (
    <div className="mx-auto max-w-2xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <div>
        <h1 className="text-h1 text-ink-primary">Fee Configuration</h1>
        <p className="text-body-sm text-ink-tertiary">
          Effective from {new Date(current.effectiveFrom).toLocaleString("en-KE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}.
          Changes apply going forward only — they don't recompute past transactions.
        </p>
      </div>

      <form onSubmit={save} className="card flex flex-col gap-4">
        {FIELDS.map((f) => (
          <div key={f.key} className="flex items-center gap-3">
            <Input
              label={f.label}
              type="number"
              min="0"
              value={form[f.key]}
              onChange={(e) => setForm((cur) => ({ ...cur, [f.key]: e.target.value }))}
              className="flex-1"
            />
            <span className="text-caption text-ink-tertiary w-24 flex-none pt-5">{f.suffix}</span>
          </div>
        ))}
        <Button type="submit" loading={busy}>Save changes</Button>
      </form>

      <div className="flex flex-col gap-2">
        <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">Change history</span>
        <Table
          data={history}
          getRowId={(h) => h.id}
          empty={<EmptyState title="No changes yet" description="Every edit to fee configuration is logged here with a before/after." />}
          columns={[
            { key: "changed_at", header: "Date", render: (h) => <span className="tabular-nums">{new Date(h.changed_at).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span> },
            { key: "platformFeePercent", header: "Platform fee", render: (h) => `${h.before.platformFeePercent}% → ${h.after.platformFeePercent}%` },
            { key: "scanningFeeKes", header: "Scanning fee", render: (h) => `KES ${h.before.scanningFeeKes} → KES ${h.after.scanningFeeKes}` },
            { key: "minPayoutKes", header: "Min payout", render: (h) => `KES ${h.before.minPayoutKes} → KES ${h.after.minPayoutKes}` },
          ]}
        />
      </div>
    </div>
  );
}
