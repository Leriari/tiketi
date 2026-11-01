import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../../api";
import { useAuth } from "../../context/AuthContext";
import { useApiData } from "../../lib/useApiData";
import { PAYOUT_STATUS, transferCharge } from "../../lib/payouts";
import { useToast } from "../../components/ui/Toast";
import { Breadcrumb, Card, StatCard, MoneyText, Button, Table, Badge, Skeleton, EmptyState, ErrorState, Modal } from "../../components/ui";
import { formatEventDate } from "../../format";

function RequestPayoutModal({ info, onClose, onDone }) {
  const [amount, setAmount] = useState(String(Math.floor(info.available)));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const value = Number(amount || 0);
  const charge = value > 0 ? transferCharge(info.transferCharges, value) : 0;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.requestOrganiserPayout({ amount: value });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't request the payout.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Request a payout">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="p-amount" className="text-label uppercase tracking-[0.06em] font-medium text-ink-tertiary">Amount (KES)</label>
            <button type="button" onClick={() => setAmount(String(Math.floor(info.available)))} className="text-caption font-semibold text-brand-primary-on-tint">Max</button>
          </div>
          <input
            id="p-amount" type="number" inputMode="numeric" step="1" min={info.minPayoutKes} max={Math.floor(info.available)}
            value={amount} onChange={(e) => setAmount(e.target.value)}
            className="h-11 rounded-sm bg-surface-inset border border-line-strong px-3 text-h3 text-ink-primary tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-primary"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-label uppercase tracking-[0.06em] font-medium text-ink-tertiary">Sent to</span>
          <p className="text-body text-ink-primary">{info.destination}</p>
          <Link to="/organiser/payouts" className="text-caption text-brand-primary-on-tint underline w-fit">Change payout details</Link>
        </div>
        <div className="flex flex-col gap-1 text-body-sm text-ink-secondary">
          <div className="flex justify-between"><span>M-Pesa transfer charge</span><MoneyText value={charge} size="body" /></div>
          <div className="flex justify-between pt-1 border-t border-line-subtle text-ink-primary font-semibold">
            <span>You'll receive</span><MoneyText value={Math.max(0, value - charge)} size="h3" variant="positive" />
          </div>
        </div>
        <p className="text-caption text-ink-tertiary">ChainTix reviews each payout request before sending it.</p>
        {error && <p role="alert" className="text-body-sm text-danger">{error}</p>}
        <Button type="submit" loading={busy}>Request KES {(value || 0).toLocaleString("en-KE")}</Button>
      </form>
    </Modal>
  );
}

function Payouts({ info, canRequest, onRequested }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const blocked = info.blockedReason || (info.available < info.minPayoutKes
    ? `You can request a payout once at least KES ${info.minPayoutKes.toLocaleString("en-KE")} is available.` : null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">Payouts</span>
        {canRequest && <Button size="sm" className="w-auto px-4" disabled={!!blocked} onClick={() => setOpen(true)}>Request payout</Button>}
      </div>
      {canRequest && blocked && (
        <p className="text-body-sm text-ink-secondary">
          {blocked}{" "}
          {info.blockedReason?.includes("Payout Details") && <Link to="/organiser/payouts" className="text-brand-primary-on-tint underline">Add payout details</Link>}
        </p>
      )}
      {!canRequest && <p className="text-body-sm text-ink-tertiary">Only the organisation&apos;s owner can request payouts.</p>}
      <Table
        data={info.payouts}
        getRowId={(p) => p.id}
        empty={<EmptyState title="No payouts yet" description="Payouts you request will show up here." />}
        columns={[
          { key: "created_at", header: "Requested", render: (p) => <span className="tabular-nums">{new Date(p.created_at).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}</span> },
          { key: "destination", header: "To" },
          { key: "amount_kes", header: "Amount", render: (p) => <MoneyText value={p.amount_kes} /> },
          { key: "net_kes", header: "You receive", render: (p) => <MoneyText value={p.net_kes} variant="positive" /> },
          { key: "mpesa_receipt", header: "M-Pesa receipt", render: (p) => <span className="font-mono text-caption">{p.mpesa_receipt || "—"}</span> },
          {
            key: "status", header: "Status", render: (p) => (
              <div className="flex flex-col gap-0.5 items-start">
                <Badge tone={PAYOUT_STATUS[p.status]?.tone}>{PAYOUT_STATUS[p.status]?.label}</Badge>
                {p.note && ["failed", "rejected"].includes(p.status) && <span className="text-caption text-ink-tertiary">{p.note}</span>}
              </div>
            ),
          },
        ]}
      />
      {open && (
        <RequestPayoutModal
          info={info}
          onClose={() => setOpen(false)}
          onDone={() => { setOpen(false); toast.push("Payout requested. ChainTix will review it.", { tone: "success" }); onRequested(); }}
        />
      )}
    </div>
  );
}

function RevenueChart({ rows }) {
  if (!rows.length) return <p className="text-body-sm text-ink-tertiary py-10 text-center">No revenue recorded yet.</p>;
  const max = Math.max(...rows.map((r) => r.primary + r.resale), 1);
  const w = 640, h = 160, pad = 24;
  const stepX = rows.length > 1 ? (w - pad * 2) / (rows.length - 1) : 0;
  const y = (v) => h - pad - (v / max) * (h - pad * 2);
  const primaryPath = rows.map((r, i) => `${i === 0 ? "M" : "L"} ${pad + i * stepX} ${y(r.primary + r.resale)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-40">
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="var(--border-subtle)" />
      <path d={primaryPath} fill="none" stroke="var(--brand-primary)" strokeWidth="2" />
      {rows.map((r, i) => (
        <circle key={r.date} cx={pad + i * stepX} cy={y(r.primary + r.resale)} r="2.5" fill="var(--brand-primary)" />
      ))}
      {rows.map((r, i) => (
        i % Math.ceil(rows.length / 6 || 1) === 0 && (
          <text key={r.date} x={pad + i * stepX} y={h - 6} fontSize="9" textAnchor="middle" fill="var(--text-tertiary)">
            {new Date(r.date).toLocaleDateString("en-KE", { day: "2-digit", month: "short" })}
          </text>
        )
      ))}
    </svg>
  );
}

export default function Earnings() {
  const { activeOrganisation } = useAuth();
  const { data, error, retry } = useApiData(() => api.getEarnings());
  const payouts = useApiData(() => api.getOrganiserPayouts());
  const [expanded, setExpanded] = useState(null);
  const reload = () => { retry(); payouts.retry(); };

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-4 lg:px-6 py-6">
        <ErrorState description={error} onRetry={retry} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-5xl px-4 lg:px-6 py-6 flex flex-col gap-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 lg:px-6 py-6 flex flex-col gap-6">
      <Breadcrumb items={[{ label: "Dashboard", to: "/organiser" }, { label: "Earnings" }]} />
      <div>
        <h1 className="text-h1 text-ink-primary">Earnings</h1>
        <p className="text-body-sm text-ink-tertiary">Primary ticket and resale revenue breakdown — your complete earnings picture.</p>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">Your Wallet</span>
        <Link to="/organiser/reports" className="text-body-sm font-semibold text-brand-primary-on-tint">Reports &amp; statements</Link>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <Card>
          <p className="text-caption text-ink-tertiary">Online Pending</p>
          <MoneyText value={data.wallet.onlinePending} size="metric" variant="pending" />
          <p className="text-caption text-ink-tertiary mt-1">Becomes available a few days after each event.</p>
        </Card>
        <Card emphasised>
          <p className="text-caption text-ink-tertiary">Available Balance</p>
          <MoneyText value={data.wallet.availableBalance} size="metric" variant="positive" />
          <p className="text-caption text-ink-tertiary mt-1">
            {data.wallet.payoutsInProgress > 0
              ? <>Plus <MoneyText value={data.wallet.payoutsInProgress} size="caption" /> in payouts on the way.</>
              : "Yours to request as a payout."}
          </p>
        </Card>
        <Card>
          <p className="text-caption text-ink-tertiary">Total Paid Out</p>
          <MoneyText value={data.wallet.totalPaidOut} size="metric" />
          <p className="text-caption text-ink-tertiary mt-1">Lifetime disbursed amount.</p>
        </Card>
      </div>

      {payouts.error && <ErrorState description={payouts.error} onRetry={payouts.retry} />}
      {payouts.data && <Payouts info={payouts.data} canRequest={activeOrganisation?.role === "owner"} onRequested={reload} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total Revenue" value={<MoneyText value={data.totals.totalRevenue} size="h3" />} hint="Online + gate sales" />
        <StatCard label="ChainTix Fee (5%)" value={<MoneyText value={data.totals.chaintixFee} variant="negative" size="h3" />} />
        <StatCard label="Scanning Fees" value={<MoneyText value={data.totals.scanningFees} variant="negative" size="h3" />} hint="Door scanning costs" />
        <StatCard label="Your Earnings" value={<MoneyText value={data.totals.yourEarnings} variant="positive" size="h3" />} hint="After all deductions" emphasised />
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <StatCard label="Tickets Sold" value={data.totals.ticketsSold} />
        <Card className="flex flex-col gap-1.5">
          <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">Royalty Income</span>
          <div className="flex justify-between text-body-sm"><span className="text-ink-secondary">Resales</span><span className="tabular-nums text-ink-primary">{data.royaltyIncome.resaleCount}</span></div>
          <div className="flex justify-between text-body-sm"><span className="text-ink-secondary">Gross resale value</span><MoneyText value={data.royaltyIncome.grossResaleValue} size="body" /></div>
          <div className="flex justify-between text-body-sm font-semibold"><span className="text-ink-primary">Royalty earned</span><MoneyText value={data.royaltyIncome.royaltyEarned} size="body" variant="positive" /></div>
        </Card>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">Revenue over time</span>
        <Card><RevenueChart rows={data.revenueOverTime} /></Card>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">Per-event breakdown</span>
        {data.perEventBreakdown.length === 0 ? (
          <Card padding="p-0"><EmptyState title="No revenue yet" description="Sell a ticket to see per-event earnings here." /></Card>
        ) : (
          <Table
            data={data.perEventBreakdown}
            getRowId={(r) => r.event_id}
            onRowClick={(r) => setExpanded(expanded === r.event_id ? null : r.event_id)}
            columns={[
              { key: "event", header: "Event", render: (r) => <div><p className="font-medium text-ink-primary">{r.event_title}</p><p className="text-caption text-ink-tertiary">{formatEventDate(r.event_date)}</p></div> },
              { key: "online", header: "Online sales", render: (r) => <MoneyText value={r.online_sales_kes} /> },
              { key: "gate", header: "Gate sales", render: (r) => <MoneyText value={r.gate_sales_kes} /> },
              { key: "royalties", header: "Resale royalties", render: (r) => <MoneyText value={r.resale_royalties_kes} variant="positive" /> },
              { key: "fees", header: "Fees", render: (r) => <MoneyText value={r.fees_kes} variant="negative" /> },
              { key: "net", header: "Net", render: (r) => <MoneyText value={r.net_kes} variant="positive" /> },
              { key: "status", header: "Funds", render: (r) => <Badge tone={r.payout_status === "Paid out" || r.payout_status === "Available" ? "success" : "warning"}>{r.payout_status}</Badge> },
            ]}
          />
        )}
        {expanded && (
          <Card className="flex flex-col gap-1.5">
            <span className="text-caption text-ink-tertiary uppercase tracking-wide">Tier breakdown</span>
            {data.perEventBreakdown.find((r) => r.event_id === expanded)?.tiers.map((t) => (
              <div key={t.name} className="flex justify-between text-body-sm">
                <span className="text-ink-secondary">{t.name} ({t.sold} sold)</span>
                <MoneyText value={t.revenue} size="body" />
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
