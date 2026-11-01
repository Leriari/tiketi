import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../../api";
import { useToast } from "../../components/ui/Toast";
import { useApiData } from "../../lib/useApiData";
import { PAYOUT_STATUS, transferCharge } from "../../lib/payouts";
import {
  Card, MoneyText, Button, Tooltip, Modal, Select, FilterBar, Table, Badge, EmptyState, ErrorState, Skeleton,
} from "../../components/ui";
import { formatPhone } from "../../format";

const STATUS_TONE = { success: "success", pending: "warning", failed: "danger" };
const STATUS_LABEL = { success: "Done", pending: "In progress", failed: "Failed" };
const TYPE_LABEL = { sale: "Sale", withdrawal: "Withdrawal" };

function WithdrawModal({ wallet, onClose, onDone }) {
  const [amount, setAmount] = useState(String(Math.floor(wallet.available)));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const value = Number(amount || 0);
  const charge = value > 0 ? transferCharge(wallet.transferCharges, value) : 0;
  const net = Math.max(0, value - charge);

  async function submit(e) {
    e.preventDefault();
    if (!Number.isInteger(value)) {
      setError("Enter a whole number of shillings.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payout = await api.withdrawToMpesa({ amount: value });
      if (payout.status === "failed") setError(payout.note || "M-Pesa couldn't send it. Your money is back in your wallet.");
      else onDone(payout);
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
            <button type="button" onClick={() => setAmount(String(Math.floor(wallet.available)))} className="text-caption font-semibold text-brand-primary-on-tint">Max</button>
          </div>
          <input
            id="w-amount"
            type="number"
            inputMode="numeric"
            step="1"
            min={wallet.minWithdrawalKes}
            max={Math.floor(wallet.available)}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-11 rounded-sm bg-surface-inset border border-line-strong px-3 text-h3 text-ink-primary tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-primary"
          />
          <p className="text-caption text-ink-tertiary">Any amount from KES {wallet.minWithdrawalKes.toLocaleString()} up to your available balance.</p>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-label uppercase tracking-[0.06em] font-medium text-ink-tertiary">Sent to</span>
          <p className="text-body text-ink-primary">{formatPhone(wallet.withdrawalPhone)}</p>
          <p className="text-caption text-ink-tertiary">Your account's M-Pesa number. To use another, change it in <Link to="/profile" className="underline">your profile</Link>.</p>
        </div>

        <div className="flex flex-col gap-1 text-body-sm text-ink-secondary">
          <div className="flex justify-between"><span>M-Pesa transfer charge</span><MoneyText value={charge} size="body" /></div>
          <div className="flex justify-between pt-1 border-t border-line-subtle text-ink-primary font-semibold">
            <span>You'll receive</span><MoneyText value={net} size="h3" variant="positive" />
          </div>
        </div>

        {!wallet.instantWithdrawals && (
          <p className="text-caption text-ink-tertiary">ChainTix sends withdrawals by hand for now. You'll see it marked paid here, with the M-Pesa receipt.</p>
        )}
        {error && <p role="alert" className="text-body-sm text-danger">{error}</p>}
        <Button type="submit" loading={busy}>Withdraw KES {(value || 0).toLocaleString("en-KE")}</Button>
      </form>
    </Modal>
  );
}

export default function Wallet() {
  const toast = useToast();
  const { data: wallet, error, retry } = useApiData(() => api.getWallet());
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const sending = wallet?.transactions.some((t) => t.payout?.status === "processing");
  // While M-Pesa is sending a withdrawal, check back until it lands.
  useEffect(() => {
    if (!sending) return undefined;
    const timer = setInterval(retry, 4000);
    return () => clearInterval(timer);
  }, [sending, retry]);

  const ledger = useMemo(() => {
    if (!wallet) return [];
    const asc = [...wallet.transactions].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    let running = 0;
    const withBalance = asc.map((t) => {
      if (t.status !== "failed") running += t.amount;
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
          <p className="text-caption text-ink-tertiary mt-1">Yours to withdraw, any amount, any time.</p>
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
            <option value="success">Done</option>
            <option value="pending">In progress</option>
            <option value="failed">Failed</option>
          </Select>
        </FilterBar>

        <Table
          data={ledger}
          getRowId={(t) => t.id}
          empty={<EmptyState title="No transactions yet" description="Sold-ticket proceeds and withdrawals will show up here." />}
          columns={[
            { key: "created_at", header: "Date", render: (t) => <span className="tabular-nums">{new Date(t.created_at).toLocaleDateString("en-KE", { day: "2-digit", month: "short" })}</span> },
            { key: "type", header: "Type", render: (t) => TYPE_LABEL[t.type] },
            {
              key: "description", header: "Description", render: (t) => (
                <div>
                  <p>{t.description}</p>
                  {t.payout && <p className="text-caption text-ink-tertiary">You receive <MoneyText value={t.payout.net_kes} size="caption" /> after the <MoneyText value={t.payout.charge_kes} size="caption" /> M-Pesa charge</p>}
                  {t.status === "failed" && t.payout?.note && <p className="text-caption text-danger">{t.payout.note}</p>}
                </div>
              ),
            },
            { key: "amount", header: "Amount", render: (t) => <MoneyText value={t.amount} variant={t.status === "failed" ? "neutral" : t.amount < 0 ? "negative" : "positive"} className={t.status === "failed" ? "line-through" : undefined} /> },
            { key: "balance_after", header: "Balance after", render: (t) => <MoneyText value={t.balance_after} /> },
            {
              key: "status", header: "Status", render: (t) => t.payout
                ? <Badge tone={PAYOUT_STATUS[t.payout.status]?.tone}>{PAYOUT_STATUS[t.payout.status]?.label}</Badge>
                : <Badge tone={STATUS_TONE[t.status] || "neutral"}>{STATUS_LABEL[t.status] || t.status}</Badge>,
            },
          ]}
        />
      </div>

      {withdrawOpen && (
        <WithdrawModal
          wallet={wallet}
          onClose={() => setWithdrawOpen(false)}
          onDone={(payout) => {
            setWithdrawOpen(false);
            toast.push(
              payout.status === "processing" ? "Sending to M-Pesa. You'll get an M-Pesa SMS when it arrives."
                : payout.status === "paid" ? "Withdrawal sent to M-Pesa."
                : "Withdrawal requested. ChainTix will send it to your M-Pesa.",
              { tone: "success" },
            );
            retry();
          }}
        />
      )}
    </div>
  );
}
