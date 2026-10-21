import { useState } from "react";
import { Download } from "lucide-react";
import { api } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { useToast } from "../../components/ui/Toast";
import { Breadcrumb, Card, StatCard, MoneyText, Button, Table, Badge, Skeleton, EmptyState, ErrorState } from "../../components/ui";
import { formatEventDate } from "../../format";

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
  const toast = useToast();
  const { data, error, retry } = useApiData(() => api.getEarnings());
  const [expanded, setExpanded] = useState(null);

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

  const belowThreshold = data.wallet.availableBalance > 0 && data.wallet.availableBalance < data.wallet.minPayoutKes;

  return (
    <div className="mx-auto max-w-5xl px-4 lg:px-6 py-6 flex flex-col gap-6">
      <Breadcrumb items={[{ label: "Dashboard", to: "/organiser" }, { label: "Earnings" }]} />
      <div>
        <h1 className="text-h1 text-ink-primary">Earnings</h1>
        <p className="text-body-sm text-ink-tertiary">Primary ticket and resale revenue breakdown — your complete earnings picture.</p>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">Your Wallet</span>
        <Button variant="secondary" size="sm" iconLeft={<Download size={14} />} onClick={() => toast.push("Reports & Statement export isn't wired to real files in this preview.", { tone: "info" })}>
          Reports &amp; Statement
        </Button>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <Card>
          <p className="text-caption text-ink-tertiary">Online Pending</p>
          <MoneyText value={data.wallet.onlinePending} size="metric" variant="pending" />
          <p className="text-caption text-ink-tertiary mt-1">Released automatically 4 days after your event.</p>
        </Card>
        <Card emphasised>
          <p className="text-caption text-ink-tertiary">Available Balance</p>
          <MoneyText value={data.wallet.availableBalance} size="metric" variant="positive" />
          <p className="text-caption text-ink-tertiary mt-1">Gate sales funds are shown per event below.</p>
        </Card>
        <Card>
          <p className="text-caption text-ink-tertiary">Total Paid Out</p>
          <MoneyText value={data.wallet.totalPaidOut} size="metric" />
          <p className="text-caption text-ink-tertiary mt-1">Lifetime disbursed amount.</p>
        </Card>
      </div>

      {belowThreshold && (
        <div className="rounded-md bg-warning-bg text-warning-on-tint px-4 py-2.5 text-body-sm">
          Your available balance is too low to request a payout. Minimum is <MoneyText value={data.wallet.minPayoutKes} size="body" className="text-warning-on-tint" />.
        </div>
      )}

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
              { key: "status", header: "Payout status", render: (r) => <Badge tone={r.payout_status === "Paid out" || r.payout_status === "Available" ? "success" : "warning"}>{r.payout_status}</Badge> },
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
