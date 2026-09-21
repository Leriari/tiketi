import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, MapPin, Flame, Smartphone, ShieldCheck } from "lucide-react";
import { api } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { Select, Badge, Skeleton, ErrorState, MoneyText } from "../../components/ui";
import { formatShortDate } from "../../format";
import { CATEGORIES } from "../../constants";
import { categoryGradient } from "../../lib/categoryGradient";

function EventPoster({ event, className }) {
  return (
    <div
      className={`relative flex-none rounded-md overflow-hidden aspect-[16/9] flex items-end p-3 ${className || ""}`}
      style={{ background: categoryGradient(event.category) }}
    >
      {event.availability === "selling_fast" && (
        <Badge tone="danger" icon={<Flame size={11} />} className="absolute top-2 left-2">
          Selling fast
        </Badge>
      )}
      <div className="relative text-white">
        <p className="text-body-sm font-semibold leading-tight drop-shadow">{event.title}</p>
        <p className="text-caption opacity-90">{formatShortDate(event.event_date)}</p>
      </div>
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const { data: events, error, retry } = useApiData(() => api.listEvents());
  const [query, setQuery] = useState("");

  const thisWeekend = useMemo(() => {
    if (!events) return [];
    const now = Date.now();
    const in7d = now + 7 * 24 * 60 * 60 * 1000;
    return events.filter((e) => {
      const t = new Date(e.event_date).getTime();
      return t >= now && t <= in7d;
    });
  }, [events]);

  const sellingFast = useMemo(() => events?.filter((e) => e.availability === "selling_fast") || [], [events]);

  function submitSearch(e) {
    e.preventDefault();
    navigate(`/events${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  }

  return (
    <div className="flex flex-col gap-10 pb-10">
      {/* Hero */}
      <section className="bg-gradient-to-b from-brand-primary/15 to-transparent">
        <div className="mx-auto max-w-6xl px-4 lg:px-6 pt-10 pb-8 flex flex-col gap-5">
          <div>
            <span className="text-label uppercase tracking-[0.06em] text-brand-primary-on-tint font-semibold">Event tickets, secured</span>
            <h1 className="text-display font-bold text-ink-primary mt-1">Find your next night out.</h1>
          </div>

          <form onSubmit={submitSearch} className="flex flex-col sm:flex-row gap-2 max-w-xl">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search events, artists, venues"
                className="w-full h-12 rounded-sm bg-surface-inset border border-line pl-9 pr-3 text-body text-ink-primary placeholder:text-ink-tertiary focus:outline-none focus:ring-2 focus:ring-brand-primary"
              />
            </div>
            <div className="relative">
              <MapPin size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary pointer-events-none" />
              <Select defaultValue="nairobi" className="pl-9 h-12 sm:w-40" aria-label="City">
                <option value="nairobi">Nairobi</option>
              </Select>
            </div>
          </form>

          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => navigate(`/events?category=${encodeURIComponent(c)}`)}
                className="rounded-full border border-line bg-surface-inset px-3.5 py-1.5 text-body-sm text-ink-secondary hover:border-brand-primary hover:text-ink-primary transition-colors duration-150"
              >
                {c}
              </button>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-4 pt-2">
            <div className="flex items-center gap-2 text-body-sm text-ink-secondary">
              <Smartphone size={16} className="text-brand-primary flex-none" /> Pay with M-Pesa — no card, no crypto wallet.
            </div>
            <div className="flex items-center gap-2 text-body-sm text-ink-secondary">
              <ShieldCheck size={16} className="text-chain-verified flex-none" /> Every ticket is cryptographically verified.
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 lg:px-6 flex flex-col gap-10 w-full">
        {error && <ErrorState description={error} onRetry={retry} />}

        {!error && sellingFast.length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-h2 text-ink-primary flex items-center gap-2">
                <Flame size={18} className="text-danger" /> Selling fast
              </h2>
              <button onClick={() => navigate("/events")} className="text-body-sm font-semibold text-brand-primary-on-tint">
                See all
              </button>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
              {sellingFast.map((ev) => (
                <button key={ev.id} onClick={() => navigate(`/events/${ev.id}`)} className="w-64 text-left">
                  <EventPoster event={ev} className="w-64" />
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="text-h2 text-ink-primary">This weekend</h2>
          {!error && events === null && (
            <div className="flex gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="w-64 aspect-[16/9] flex-none rounded-md" />
              ))}
            </div>
          )}
          {events && thisWeekend.length === 0 && <p className="text-body-sm text-ink-tertiary">Nothing this weekend yet — check the full listing.</p>}
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
            {thisWeekend.map((ev) => (
              <button key={ev.id} onClick={() => navigate(`/events/${ev.id}`)} className="w-64 text-left">
                <EventPoster event={ev} className="w-64" />
              </button>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-h2 text-ink-primary">All upcoming events</h2>
            <button onClick={() => navigate("/events")} className="text-body-sm font-semibold text-brand-primary-on-tint">
              Browse all
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {!error && events === null &&
              Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="aspect-[16/9] rounded-md" />)}
            {events?.slice(0, 6).map((ev) => (
              <button key={ev.id} onClick={() => navigate(`/events/${ev.id}`)} className="text-left">
                <EventPoster event={ev} />
                <p className="mt-1.5 text-caption text-ink-tertiary">
                  From <MoneyText value={ev.ticket_price_kes} size="body" className="text-caption" />
                </p>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
