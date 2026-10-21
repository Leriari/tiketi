import { useState } from "react";
import { api } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { Card, StatCard, MoneyText, Skeleton, Table, ErrorState, EmptyState } from "../../components/ui";

const COLORS = ["#7C5CFF", "#00D4AA", "#3E8BFF", "#E8A317", "#E5484D"];

export default function MarketingAnalytics() {
  const [period, setPeriod] = useState("week");
  const { data, error, retry } = useApiData(() => api.getMarketingAnalytics({ period }), [period]);

  const totalSessions = data?.sources.reduce((s, r) => s + r.sessions, 0) || 0;
  const totalConversions = data?.sources.reduce((s, r) => s + r.conversions, 0) || 0;
  const overallRate = totalSessions ? Math.round((totalConversions / totalSessions) * 1000) / 10 : 0;

  return (
    <div className="mx-auto max-w-5xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-h1 text-ink-primary">Marketing Analytics</h1>
        <div className="flex gap-1 rounded-sm bg-surface-inset p-1">
          {[["today", "Today"], ["week", "This Week"], ["month", "This Month"], ["all", "All Time"]].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setPeriod(v)}
              className={`px-2.5 py-1 rounded-sm text-caption font-semibold ${period === v ? "bg-surface text-ink-primary shadow-card" : "text-ink-tertiary"}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <ErrorState description={error} onRetry={retry} />
      ) : !data ? (
        <div className="flex flex-col gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : data.trackingEnabled === false ? (
        <Card padding="p-0">
          <EmptyState
            title="Traffic isn't tracked yet"
            description="ChainTix doesn't record where buyers come from (Instagram, WhatsApp, links), so there's no real traffic or campaign data to show. Sales figures are in Earnings and Revenue Breakdown."
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Sessions" value={totalSessions} />
            <StatCard label="Conversions" value={totalConversions} />
            <StatCard label="Conversion rate" value={`${overallRate}%`} />
          </div>

          <Card className="flex flex-col sm:flex-row gap-6 items-center">
            <svg width="160" height="160" viewBox="0 0 140 140" className="flex-none">
              {(() => {
                let angle = -90;
                return data.sources.map((s, i) => {
                  const frac = totalSessions ? s.sessions / totalSessions : 0;
                  const sweep = frac * 360;
                  const large = sweep > 180 ? 1 : 0;
                  const r = 60;
                  const cx = 70, cy = 70;
                  const toXY = (deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
                  const [x1, y1] = toXY(angle);
                  const [x2, y2] = toXY(angle + sweep);
                  const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
                  angle += sweep;
                  return <path key={s.source} d={d} fill={COLORS[i % COLORS.length]} stroke="var(--bg-surface)" strokeWidth="1.5" />;
                });
              })()}
              <circle cx="70" cy="70" r="32" fill="var(--bg-surface)" />
              <text x="70" y="66" textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--text-primary)">{totalSessions}</text>
              <text x="70" y="82" textAnchor="middle" fontSize="9" fill="var(--text-tertiary)">sessions</text>
            </svg>
            <div className="flex-1 w-full overflow-x-auto">
              <table className="w-full text-body-sm">
                <thead>
                  <tr className="text-caption text-ink-tertiary text-left">
                    <th className="pb-1.5 font-medium">Source</th>
                    <th className="pb-1.5 font-medium text-right">Sessions</th>
                    <th className="pb-1.5 font-medium text-right">Conversions</th>
                    <th className="pb-1.5 font-medium text-right">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sources.map((s, i) => (
                    <tr key={s.source} className="border-t border-line-subtle">
                      <td className="py-1.5 flex items-center gap-2"><span className="h-2 w-2 rounded-full flex-none" style={{ background: COLORS[i % COLORS.length] }} />{s.source}</td>
                      <td className="py-1.5 text-right tabular-nums">{s.sessions}</td>
                      <td className="py-1.5 text-right tabular-nums">{s.conversions}</td>
                      <td className="py-1.5 text-right tabular-nums">{s.conversionRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="flex flex-col gap-2">
            <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">Campaigns</span>
            <Table
              data={data.campaigns}
              getRowId={(c) => c.name}
              columns={[
                { key: "name", header: "Campaign" },
                { key: "clicks", header: "Clicks", render: (c) => <span className="tabular-nums">{c.clicks}</span> },
                { key: "conversions", header: "Conversions", render: (c) => <span className="tabular-nums">{c.conversions}</span> },
                { key: "spend_kes", header: "Spend", render: (c) => (c.spend_kes ? <MoneyText value={c.spend_kes} /> : <span className="text-ink-tertiary">Organic</span>) },
              ]}
            />
          </div>
        </>
      )}
    </div>
  );
}
