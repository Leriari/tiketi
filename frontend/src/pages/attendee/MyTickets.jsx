import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { api } from "../../api";
import { Tabs, Badge, EmptyState, Skeleton } from "../../components/ui";
import { formatEventDate } from "../../format";
import EventCover from "../../components/EventCover";

const STATUS_TONE = { active: "success", used: "neutral", cancelled: "danger", resale: "warning", pending_payment: "warning" };
const STATUS_LABEL = { active: "Active", used: "Used", cancelled: "Cancelled", resale: "Listed", pending_payment: "Awaiting payment" };

export default function MyTickets() {
  const [tab, setTab] = useState("upcoming");
  const [tickets, setTickets] = useState(null);

  useEffect(() => {
    api.myTickets().then(setTickets);
  }, []);

  // Each ticket carries its own event details, so tickets for past or
  // unlisted events show up too (the public event list leaves those out).
  const withEvents = useMemo(() => tickets?.map((t) => ({
    ...t,
    event: {
      id: t.event_id, title: t.event_title, venue: t.venue, event_date: t.event_date,
      category: t.category, image_url: t.image_url, image_data_url: t.image_data_url,
    },
  })).filter((t) => t.event.event_date) || null, [tickets]);

  const grouped = useMemo(() => {
    if (!withEvents) return null;
    const now = Date.now();
    return {
      upcoming: withEvents.filter((t) => t.status === "active" && new Date(t.event.event_date).getTime() >= now),
      past: withEvents.filter((t) => t.status === "used" || t.status === "cancelled" || (t.status === "active" && new Date(t.event.event_date).getTime() < now)),
      resale: withEvents.filter((t) => t.status === "resale"),
    };
  }, [withEvents]);

  const rows = grouped?.[tab] || [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 flex flex-col gap-4">
      <h1 className="text-h1 text-ink-primary">My tickets</h1>

      <Tabs
        items={[
          { value: "upcoming", label: "Upcoming", count: grouped?.upcoming.length },
          { value: "past", label: "Past", count: grouped?.past.length },
          { value: "resale", label: "Listed for resale", count: grouped?.resale.length },
        ]}
        value={tab}
        onChange={setTab}
        className="max-w-md"
      />

      {tickets === null && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-md" />
          ))}
        </div>
      )}

      {tickets && rows.length === 0 && (
        <EmptyState
          title={tab === "upcoming" ? "No upcoming tickets" : tab === "past" ? "No past tickets" : "Nothing listed for resale"}
          description={tab === "upcoming" ? "Browse events and grab your next ticket." : undefined}
        />
      )}

      <div className="flex flex-col gap-3">
        {rows.map((t) => {
          const inner = (
            <div className="flex items-center gap-3 rounded-md border border-line-subtle bg-surface p-3 hover:border-line-strong transition-colors duration-150">
              <EventCover event={t.event} className="h-16 w-16 rounded-sm flex-none" />
              <div className="min-w-0 flex-1">
                <p className="text-body font-semibold text-ink-primary truncate">{t.event.title}</p>
                <p className="text-caption text-ink-tertiary truncate">{t.event.venue}</p>
                <p className="text-caption text-ink-tertiary tabular-nums">{formatEventDate(t.event.event_date)}</p>
                <p className="text-caption text-ink-tertiary inline-flex items-center gap-1">
                  {t.tier_name || "General"} ·
                  {t.nft_token_id
                    ? <span className="inline-flex items-center gap-0.5 text-chain-verified"><ShieldCheck size={12} aria-hidden="true" /> On-chain #{t.nft_token_id}</span>
                    : <span>Securing on-chain…</span>}
                </p>
              </div>
              <Badge tone={STATUS_TONE[t.status] || "neutral"}>{STATUS_LABEL[t.status] || t.status}</Badge>
            </div>
          );
          return <Link key={t.id} to={`/tickets/${t.id}`}>{inner}</Link>;
        })}
      </div>
    </div>
  );
}
