import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarPlus, Radio, Clock, ShieldAlert } from "lucide-react";
import { api, ApiError } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../components/ui/Toast";
import { Card, Badge, Button, MoneyText, Select, Input, EmptyState, ErrorState, Skeleton } from "../../components/ui";
import { formatPhone } from "../../format";

function TrafficSources() {
  const [period, setPeriod] = useState("week");
  const { data, error, retry } = useApiData(() => api.getMarketingAnalytics({ period }), [period]);

  const totalSessions = data?.sources.reduce((s, r) => s + r.sessions, 0) || 0;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">Traffic Sources</span>
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
        <Skeleton className="h-40 w-full" />
      ) : data.trackingEnabled === false ? (
        <p className="text-body-sm text-ink-tertiary">Traffic sources aren't tracked yet, so there's nothing real to show here.</p>
      ) : (
        <div className="flex flex-col sm:flex-row gap-6 items-center">
          <svg width="140" height="140" viewBox="0 0 140 140" className="flex-none">
            {(() => {
              let angle = -90;
              const colors = ["#7C5CFF", "#00D4AA", "#3E8BFF", "#E8A317", "#E5484D"];
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
                return <path key={s.source} d={d} fill={colors[i % colors.length]} stroke="var(--bg-surface)" strokeWidth="1.5" />;
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
                {data.sources.map((s) => (
                  <tr key={s.source} className="border-t border-line-subtle">
                    <td className="py-1.5 text-ink-primary">{s.source}</td>
                    <td className="py-1.5 text-right tabular-nums">{s.sessions}</td>
                    <td className="py-1.5 text-right tabular-nums">{s.conversions}</td>
                    <td className="py-1.5 text-right tabular-nums">{s.conversionRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}

function CompTicketPanel({ events }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [eventId, setEventId] = useState(events?.[0]?.id || "");
  const [tierId, setTierId] = useState(events?.[0]?.tiers[0]?.id || "");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (!events || events.length === 0) {
    return (
      <Card padding="p-0">
        <EmptyState title="No active events right now" description="Create an event to get started." actionLabel="Create Event" onAction={() => navigate("/organiser/events/new")} />
      </Card>
    );
  }

  const event = events.find((e) => e.id === eventId) || events[0];

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.sendComplimentaryTicket({ eventId: event.id, tierId: tierId || event.tiers[0]?.id, recipientName: name, recipientPhone: phone, note });
      toast.push(`Complimentary ticket sent to ${name}.`, { tone: "success" });
      setName(""); setPhone(""); setNote("");
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Couldn't send the ticket.", { tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">Send Complimentary Tickets</span>
      <form onSubmit={submit} className="grid sm:grid-cols-2 gap-3">
        <Select label="Event" value={eventId} onChange={(e) => setEventId(e.target.value)}>
          {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </Select>
        <Select label="Tier" value={tierId} onChange={(e) => setTierId(e.target.value)}>
          {event.tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <Input label="Recipient name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" required />
        <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="sm:col-span-2" />
        <Button type="submit" loading={busy} className="sm:col-span-2 w-auto px-6">Send ticket</Button>
      </form>
    </Card>
  );
}

/** A new organisation is reviewed by ChainTix (Admin → Organiser Accounts). */
function ReviewNotice() {
  const { activeOrganisation } = useAuth();
  const status = activeOrganisation?.verificationStatus;
  if (status === "pending") {
    return (
      <Card className="flex items-start gap-3 border-warning/30 bg-warning-bg">
        <Clock size={18} className="flex-none mt-0.5 text-warning" aria-hidden="true" />
        <div className="text-body-sm text-ink-secondary">
          <p className="font-semibold text-ink-primary">ChainTix is reviewing {activeOrganisation.businessName}</p>
          <p>
            You can set up events and your team now. If an event needs ChainTix's approval before it goes on sale, it shows
            as <span className="font-medium">in review</span> under Events. Add your <Link to="/organiser/profile" className="underline">contact details</Link> and{" "}
            <Link to="/organiser/payouts" className="underline">payout details</Link> to speed things up.
          </p>
        </div>
      </Card>
    );
  }
  if (status === "rejected") {
    return (
      <Card className="flex items-start gap-3 border-danger/30 bg-danger-bg">
        <ShieldAlert size={18} className="flex-none mt-0.5 text-danger" aria-hidden="true" />
        <p className="text-body-sm text-ink-secondary">
          <span className="font-semibold text-ink-primary">ChainTix couldn't verify {activeOrganisation.businessName}.</span>{" "}
          Its events can't go on sale. Contact ChainTix support if you think this is a mistake.
        </p>
      </Card>
    );
  }
  return null;
}

export default function ControlCenter() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, error, retry } = useApiData(() => api.getControlCenter());

  return (
    <div className="mx-auto max-w-5xl px-4 lg:px-6 py-6 flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-h1 text-ink-primary">Welcome back, {data?.organiserName || (user ? formatPhone(user.phoneNumber).slice(0, 9) : "there")}</h1>
        <Button variant="primary" iconLeft={<CalendarPlus size={15} />} onClick={() => navigate("/organiser/events/new")} className="w-auto px-5">
          Drop New Event
        </Button>
      </div>

      <ReviewNotice />

      {error ? (
        <ErrorState description={error} onRetry={retry} />
      ) : !data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          {data.activePlans.length > 0 && (
            <div className="flex gap-2">
              {data.activePlans.map((p) => <Badge key={p} tone="brand">{p}</Badge>)}
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-3">
            <Card className="bg-success-bg border-success/20">
              <p className="text-caption text-ink-tertiary">Available</p>
              {data.wallet.available === 0 ? (
                <p className="text-h3 text-ink-tertiary mt-1">No balance yet</p>
              ) : (
                <MoneyText value={data.wallet.available} size="metric" variant="positive" />
              )}
            </Card>
            <Card>
              <p className="text-caption text-ink-tertiary">Pending</p>
              <MoneyText value={data.wallet.pending} size="metric" variant="pending" />
              {data.wallet.pending > 0 && <p className="text-caption text-ink-tertiary mt-1">Releasing soon</p>}
            </Card>
          </div>

          <Card className="grid grid-cols-2 divide-x divide-line-subtle">
            <div className="pr-4">
              <p className="text-caption text-ink-tertiary">All-time tickets</p>
              <p className="text-metric font-bold tabular-nums text-ink-primary">{data.allTimeTickets}</p>
            </div>
            <div className="pl-4">
              <p className="text-caption text-ink-tertiary">All-time revenue</p>
              <MoneyText value={data.allTimeRevenueKes} size="metric" />
            </div>
          </Card>

          {data.liveNow.length > 0 && (
            <Card emphasised className="flex flex-col gap-2">
              <span className="flex items-center gap-1.5 text-label uppercase tracking-[0.06em] text-brand-primary-on-tint font-semibold">
                <Radio size={13} className="animate-pulse" /> Live Now
              </span>
              {data.liveNow.map((e) => (
                <div key={e.event_id} className="flex flex-wrap items-center gap-x-5 gap-y-1 text-body-sm">
                  <span className="font-semibold text-ink-primary">{e.event_title}</span>
                  <span className="text-ink-secondary tabular-nums">{e.ticketsScanned} scanned</span>
                  <span className="text-ink-secondary tabular-nums">{e.admissionRate}% admitted</span>
                  <span className="text-ink-secondary tabular-nums">{e.gatesOnline} gates online</span>
                </div>
              ))}
            </Card>
          )}

          <CompTicketPanel events={data.events} />
          <TrafficSources />
        </>
      )}
    </div>
  );
}
