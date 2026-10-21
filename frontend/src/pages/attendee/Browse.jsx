import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Flame } from "lucide-react";
import { api } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { Select, Badge, Skeleton, EmptyState, ErrorState, Button, MoneyText } from "../../components/ui";
import { formatEventDate } from "../../format";
import { CATEGORIES } from "../../constants";
import EventCover from "../../components/EventCover";

const PAGE_SIZE = 6;
const SORTS = [
  { value: "date", label: "Date" },
  { value: "price_low", label: "Price: low to high" },
  { value: "price_high", label: "Price: high to low" },
  { value: "popularity", label: "Popularity" },
];

function AvailabilityBadge({ availability }) {
  if (availability === "sold_out") return <Badge tone="neutral">Sold out</Badge>;
  if (availability === "selling_fast")
    return (
      <Badge tone="danger" icon={<Flame size={11} />}>
        Selling fast
      </Badge>
    );
  return <Badge tone="success">Available</Badge>;
}

export default function Browse() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: events, error, retry } = useApiData(() => api.listEvents());
  const [visible, setVisible] = useState(PAGE_SIZE);
  const sentinelRef = useRef(null);

  const category = params.get("category") || "All";
  const query = params.get("q") || "";
  const sort = params.get("sort") || "date";
  const maxPrice = Number(params.get("maxPrice") || 15000);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setVisible((v) => v + PAGE_SIZE);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [events]);

  const filtered = useMemo(() => {
    if (!events) return null;
    let rows = events.filter((e) => {
      const matchesCategory = category === "All" || e.category === category;
      const q = query.trim().toLowerCase();
      const matchesQuery = !q || e.title.toLowerCase().includes(q) || e.venue.toLowerCase().includes(q);
      const matchesPrice = e.ticket_price_kes <= maxPrice;
      return matchesCategory && matchesQuery && matchesPrice;
    });
    if (sort === "price_low") rows = [...rows].sort((a, b) => a.ticket_price_kes - b.ticket_price_kes);
    else if (sort === "price_high") rows = [...rows].sort((a, b) => b.ticket_price_kes - a.ticket_price_kes);
    else if (sort === "popularity") rows = [...rows].sort((a, b) => b.tickets_sold - a.tickets_sold);
    else rows = [...rows].sort((a, b) => new Date(a.event_date) - new Date(b.event_date));
    return rows;
  }, [events, category, query, sort, maxPrice]);

  function setParam(key, value) {
    const next = new URLSearchParams(params);
    if (value === "All" || !value) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
    setVisible(PAGE_SIZE);
  }

  const filterRail = (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">Category</span>
        <div className="flex flex-wrap gap-1.5">
          {["All", ...CATEGORIES].map((c) => (
            <button
              key={c}
              onClick={() => setParam("category", c)}
              className={`rounded-full px-3 py-1 text-caption font-semibold border transition-colors duration-150 ${
                category === c ? "bg-brand-primary-solid text-white border-brand-primary-solid" : "border-line text-ink-secondary hover:border-line-strong"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">Max price</span>
        <input
          type="range"
          aria-label="Max price"
          min={500}
          max={15000}
          step={500}
          value={maxPrice}
          onChange={(e) => setParam("maxPrice", e.target.value)}
          className="accent-brand-primary"
        />
        <span className="text-caption text-ink-secondary tabular-nums">
          Up to <MoneyText value={maxPrice} size="body" className="text-caption" />
        </span>
      </div>
      {(category !== "All" || query || maxPrice < 15000) && (
        <Button variant="ghost" size="sm" onClick={() => setParams({}, { replace: true })} className="self-start px-0">
          Clear filters
        </Button>
      )}
    </div>
  );

  const shown = filtered?.slice(0, visible);
  const hasMore = filtered && visible < filtered.length;

  return (
    <div className="mx-auto max-w-6xl px-4 lg:px-6 py-6 flex flex-col lg:flex-row gap-8">
      <aside className="hidden lg:block w-56 flex-none">{filterRail}</aside>

      <div className="flex-1 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-h1 text-ink-primary">Browse events</h1>
            {filtered && <p className="text-body-sm text-ink-tertiary tabular-nums">{filtered.length} events</p>}
          </div>
          <Select value={sort} onChange={(e) => setParam("sort", e.target.value)} className="w-52" aria-label="Sort by">
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                Sort: {s.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="lg:hidden flex gap-1.5 overflow-x-auto pb-1">
          {["All", ...CATEGORIES].map((c) => (
            <button
              key={c}
              onClick={() => setParam("category", c)}
              className={`flex-none rounded-full px-3 py-1.5 text-caption font-semibold border ${
                category === c ? "bg-brand-primary-solid text-white border-brand-primary-solid" : "border-line text-ink-secondary"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {error && <ErrorState description={error} onRetry={retry} />}

        {!error && events === null && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[4/5] rounded-md" />
            ))}
          </div>
        )}

        {filtered?.length === 0 && (
          <EmptyState
            title="No events match your filters"
            description="Try a different category, price range, or search term."
            actionLabel="Clear filters"
            onAction={() => setParams({}, { replace: true })}
          />
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {shown?.map((ev) => (
            <button key={ev.id} onClick={() => navigate(`/events/${ev.id}`)} className="text-left rounded-md border border-line-subtle bg-surface hover:border-line-strong transition-colors duration-150 overflow-hidden">
              <EventCover event={ev} className="aspect-[16/9]">
                <div className="absolute top-2 left-2">
                  <AvailabilityBadge availability={ev.availability} />
                </div>
              </EventCover>
              <div className="p-3 flex flex-col gap-1">
                <h2 className="text-h3 text-ink-primary truncate">{ev.title}</h2>
                <p className="text-caption text-ink-tertiary truncate">{ev.venue}</p>
                <p className="text-caption text-ink-tertiary">{formatEventDate(ev.event_date)}</p>
                <p className="text-body-sm font-semibold text-ink-primary pt-1">
                  From <MoneyText value={ev.ticket_price_kes} size="body" />
                </p>
              </div>
            </button>
          ))}
        </div>

        {hasMore && (
          <div ref={sentinelRef} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[4/5] rounded-md" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
