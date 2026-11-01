import { useEffect, useState } from "react";
import { api, ApiError } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { BANK_PAYBILLS } from "../../lib/payouts";
import { useToast } from "../../components/ui/Toast";
import { Select, Input, Button, Card, ErrorState, Skeleton } from "../../components/ui";

// What the form shows. The server knows mpesa | paybill | till; a bank is
// a paybill (its own) with the account number.
function toForm(d) {
  const bank = d.payoutMethod === "paybill" && BANK_PAYBILLS.find((b) => b.paybill === d.payoutDestination);
  if (d.payoutMethod === "bank") {
    // Saved before payouts existed: just an account number, no bank paybill.
    return { kind: "bank", bank: "", destination: "", account: d.payoutDestination, label: "", legacy: true };
  }
  return {
    kind: bank ? "bank" : d.payoutMethod,
    bank: bank ? bank.paybill : "",
    destination: d.payoutDestination,
    account: d.payoutAccount,
    label: d.payoutLabel,
  };
}

function toPayload(f) {
  if (f.kind === "bank") {
    const bank = BANK_PAYBILLS.find((b) => b.paybill === f.bank);
    return { payoutMethod: "paybill", payoutDestination: f.bank, payoutAccount: f.account, payoutLabel: bank?.name || "" };
  }
  return {
    payoutMethod: f.kind,
    payoutDestination: f.destination,
    payoutAccount: f.kind === "paybill" ? f.account : "",
    payoutLabel: f.kind === "mpesa" ? "" : f.label,
  };
}

export default function PayoutDetails() {
  const toast = useToast();
  const { data, error, retry } = useApiData(() => api.getPayoutDetails());
  const [form, setForm] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setForm(toForm(data));
  }, [data]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setSaveError(null);
    try {
      setForm(toForm(await api.updatePayoutDetails(toPayload(form))));
      toast.push("Payout details saved.", { tone: "success" });
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn't save your payout details.");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="mx-auto max-w-lg px-4 py-6"><ErrorState description={error} onRetry={retry} /></div>;
  if (!form) return <div className="mx-auto max-w-lg px-4 py-6"><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="mx-auto max-w-lg px-4 lg:px-6 py-6 flex flex-col gap-4">
      <h1 className="text-h1 text-ink-primary">Payout Details</h1>
      <p className="text-body-sm text-ink-tertiary">Where ChainTix sends your money when you request a payout from Earnings.</p>

      {form.legacy && (
        <div className="rounded-md bg-warning-bg text-warning-on-tint px-4 py-2.5 text-body-sm">
          Choose your bank again so ChainTix knows which paybill to pay into.
        </div>
      )}

      <form onSubmit={save} className="card flex flex-col gap-4">
        <Select label="Pay me by" value={form.kind} onChange={(e) => set({ kind: e.target.value, legacy: false })}>
          <option value="mpesa">M-Pesa (to a phone number)</option>
          <option value="bank">Bank account</option>
          <option value="paybill">Paybill</option>
          <option value="till">Till (Buy Goods)</option>
        </Select>

        {form.kind === "mpesa" && (
          <Input label="M-Pesa number" value={form.destination} onChange={(e) => set({ destination: e.target.value })} placeholder="0712 345 678" required />
        )}

        {form.kind === "bank" && (
          <>
            <Select label="Bank" value={form.bank} onChange={(e) => set({ bank: e.target.value })} required>
              <option value="">Choose your bank</option>
              {BANK_PAYBILLS.map((b) => <option key={b.paybill} value={b.paybill}>{b.name} (paybill {b.paybill})</option>)}
            </Select>
            <Input label="Account number" value={form.account} onChange={(e) => set({ account: e.target.value })} placeholder="0123456789" required
              hint="Bank not listed? Choose Paybill and enter your bank's paybill number." />
          </>
        )}

        {form.kind === "paybill" && (
          <>
            <Input label="Paybill number" value={form.destination} onChange={(e) => set({ destination: e.target.value })} placeholder="247247" inputMode="numeric" required />
            <Input label="Account number" value={form.account} onChange={(e) => set({ account: e.target.value })} required />
            <Input label="Name (optional)" value={form.label} onChange={(e) => set({ label: e.target.value })} placeholder="e.g. Stanbic Bank" />
          </>
        )}

        {form.kind === "till" && (
          <>
            <Input label="Till number" value={form.destination} onChange={(e) => set({ destination: e.target.value })} placeholder="5123456" inputMode="numeric" required />
            <Input label="Business name (optional)" value={form.label} onChange={(e) => set({ label: e.target.value })} />
          </>
        )}

        {saveError && <p role="alert" className="text-body-sm text-danger">{saveError}</p>}
        <Button type="submit" loading={busy}>Save payout details</Button>
      </form>

      <Card className="text-caption text-ink-tertiary">
        Earnings become available a few days after each event. Request a payout from Earnings and ChainTix reviews it, then sends it through M-Pesa.
        M-Pesa's transfer charge is taken off the amount sent. A payout already requested still goes to the details it was requested with.
      </Card>
    </div>
  );
}
