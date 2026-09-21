import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { api, ApiError } from "../../api";
import { useToast } from "../../components/ui/Toast";
import { useAuth } from "../../context/AuthContext";
import { useApiData } from "../../lib/useApiData";
import {
  Card, MoneyText, Button, Tooltip, Modal, Input, Select, FilterBar, Table, Badge, EmptyState, ErrorState, Skeleton,
} from "../../components/ui";
import { formatPhone, normalizeKenyanPhone } from "../../format";

const STATUS_TONE = { success: "success", pending: "warning", failed: "danger" };
const TYPE_LABEL = { sale: "Sale", withdrawal: "Withdrawal" };

function WithdrawModal({ wallet, defaultPhone, onClose, onDone }) {
  const [amount, setAmount] = useState(String(wallet.available));
  const [phone, setPhone] = useState(defaultPhone || "");
  const [editingPhone, setEditingPhone] = useState(false);
  const [otp, setOtp] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const feeKes = 0; // withdrawals to M-Pesa are fee-free in this build
  const net = Math.max(0, Number(amount || 0) - feeKes);

  async function submit(e) {
    e.preventDefault();
    if (editingPhone && otp.length !== 6) {
      setError("Enter the 6-digit code sent to your new number.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.withdrawToMpesa({ amount: Number(amount), phoneNumber: normalizeKenyanPhone(phone) });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Withdrawal failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Withdraw to M-Pesa">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="w-amount" className="text-label uppercase tracking-[0.06em] font-medium text-ink-tertiary">Amount (KES)</label>
            <button type="button" onClick={() => setAmount(String(wallet.available))} className="text-caption font-semibold text-brand-primary-on-tint">Max</button>
          </div>
          <input
            id="w-amount"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            max={wallet.available}
            className="h-11 rounded-sm bg-surface-inset border border-line-strong px-3 text-h3 text-ink-primary tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-primary"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-label uppercase tracking-[0.06em] font-medium text-ink-tertiary">Destination number</span>
            {!editingPhone && (
              <button type="button" onClick={() => setEditingPhone(true)} className="text-caption font-semibold text-brand-primary-on-tint">Change</button>
            )}
          </div>
          {editingPhone ? (
            <div className="flex flex-col gap-2">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
              <Input label="Verification code" placeholder="6-digit code" value={otp} onChange={(e) => setOtp(e.target.value)} hint="Any 6 digits work in this preview." />
            </div>
          ) : (
            <p className="text-body text-ink-primary">{formatPhone(phone)}</p>
          )}
        </div>

        <div className="flex flex-col gap-1 text-body-sm text-ink-secondary">
          <div className="flex justify-between"><span>Fee</span><MoneyText value={feeKes} size="body" /></div>
          <div className="flex justify-between pt-1 border-t border-line-subtle text-ink-primary font-semibold">
            <span>You'll receive</span><MoneyText value={net} size="h3" variant="positive" />
          </div>
        </div>

        {error && <p className="text-body-sm text-danger">{error}</p>}
        <Button type="submit" loading={busy}>Confirm withdrawal</Button>
      </form>
    </Modal>
  );
}

export default function Wallet() {
  const { user } = useAuth();
  const toast = useToast();
  const { data: wallet, error, retry } = useApiData(() => api.getWallet());
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const ledger = useMemo(() => {
    if (!wallet) return [];
    const asc = [...wallet.transactions].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    let running = 0;
    const withBalance = asc.map((t) => {
      running += t.amount;
      return { ...t, balance_after: running };
    });
    return withBalance
      .filter((t) => typeFilter === "all" || t.type === typeFilter)
      .filter((t) => statusFilter === "all" || t.status === statusFilter)
      .reverse();
  }, [wallet, typeFilter, statusFilter]);

  const nextRelease = useMemo(() => {
    if (!wallet) return null;
    const upcoming = wallet.transactions
      .filter((t) => t.type === "sale" && new Date(t.available_at) > new Date())
      .sort((a, b) => new Date(a.available_at) - new Date(b.available_at))[0];
    return upcoming ? new Date(upcoming.available_at).toLocaleDateString("en-KE", { day: "numeric", month: "long" }) : null;
  }, [wallet]);

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <ErrorState description={error} onRetry={retry} />
      </div>
    );
  }

  if (!wallet) {
    return (
      <div className="mx-auto max-w-5xl px-4 lg:px-6 py-6 flex flex-col gap-4">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-3 gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-md" />)}</div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const belowMinimum = wallet.available < wallet.minWithdrawalKes;

  return (
    <div className="mx-auto max-w-5xl px-4 lg:px-6 py-6 flex flex-col gap-6">
      <h1 className="text-h1 text-ink-primary">Wallet</h1>

      <div className="grid sm:grid-cols-3 gap-3">
        <Card>
          <p className="text-caption text-ink-tertiary">Available</p>
          <MoneyText value={wallet.available} size="metric" variant="positive" />
        </Card>
        <Card>
          <p className="text-caption text-ink-tertiary">Pending (T+2)</p>
          <MoneyText value={wallet.pending} size="metric" variant="pending" />
          {nextRelease && <p className="text-caption text-ink-tertiary mt-1">Releases {nextRelease}</p>}
        </Card>
        <Card>
          <p className="text-caption text-ink-tertiary">On Hold</p>
          <MoneyText value={wallet.onHold} size="metric" />
          {wallet.onHold > 0 && <p className="text-caption text-ink-tertiary mt-1">Held pending dispute</p>}
        </Card>
      </div>

      <div>
        {belowMinimum ? (
          <Tooltip content={`Minimum withdrawal is KES ${wallet.minWithdrawalKes}`}>
            <Button disabled className="w-auto px-6">Withdraw to M-Pesa</Button>
          </Tooltip>
        ) : (
          <Button className="w-auto px-6" onClick={() => setWithdrawOpen(true)}>Withdraw to M-Pesa</Button>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <FilterBar>
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-40" aria-label="Type">
            <option value="all">All types</option>
            <option value="sale">Sale</option>
            <option value="withdrawal">Withdrawal</option>
          </Select>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40" aria-label="Status">
            <option value="all">All statuses</option>
            <option value="success">Success</option>
            <option value="pending">Pending</option>
          </Select>
        </FilterBar>

        <Table
          data={ledger}
          getRowId={(t) => t.id}
          empty={<EmptyState title="No transactions yet" description="Sold-ticket proceeds and withdrawals will show up here." />}
          columns={[
            { key: "created_at", header: "Date", render: (t) => <span className="tabular-nums">{new Date(t.created_at).toLocaleDateString("en-KE", { day: "2-digit", month: "short" })}</span> },
            { key: "type", header: "Type", render: (t) => TYPE_LABEL[t.type] },
            { key: "description", header: "Description" },
            { key: "amount", header: "Amount", render: (t) => <MoneyText value={t.amount} variant={t.amount < 0 ? "negative" : "positive"} /> },
            { key: "balance_after", header: "Balance after", render: (t) => <MoneyText value={t.balance_after} /> },
            { key: "status", header: "Status", render: (t) => <Badge tone={STATUS_TONE[t.status] || "neutral"}>{t.status}</Badge> },
          ]}
          rowActions={() => [{ label: "Download receipt", icon: <Download size={14} />, onClick: () => toast.push("Receipt download isn't wired up in this preview.", { tone: "info" }) }]}
        />
      </div>

      {withdrawOpen && (
        <WithdrawModal
          wallet={wallet}
          defaultPhone={user?.phoneNumber}
          onClose={() => setWithdrawOpen(false)}
          onDone={() => { setWithdrawOpen(false); toast.push("Withdrawal sent to M-Pesa.", { tone: "success" }); retry(); }}
        />
      )}
    </div>
  );
}
