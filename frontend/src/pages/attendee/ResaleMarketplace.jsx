import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { api } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { Select, Skeleton, EmptyState, ErrorState } from "../../components/ui";
import ResaleListingCard from "../../components/ResaleListingCard";

const SORTS = [
  { value: "price", label: "Price: low to high" },
  { value: "date", label: "Event date" },
  { value: "newest", label: "Newest listings" },
];

/** Every resale ticket a buyer can buy right now, across all events. */
export default function ResaleMarketplace() {
  const [params, setParams] = useSearchParams();
  const eventId = params.get("event") || "";
  const sort = params.get("sort") || "price";

  const { data: listings, error, retry } = useApiData(() => api.getResaleListings({ sort }), [sort]);

  // Event filter options come from what's actually listed.
  const events = useMemo(() => {
    const seen = new Map();
    for (const l of listings || []) if (!seen.has(l.event_id)) seen.set(l.event_id, l.event_title);
    return [...seen.entries()];
  }, [listings]);
  const shown = eventId ? listings?.filter((l) => l.event_id === eventId) : listings;

  function setParam(key, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  return (
    <div className="mx-auto max-w-6xl px-4 lg:px-6 py-6 flex flex-col gap-5">
      <div>
        <h1 className="text-h1 text-ink-primary">Resale tickets</h1>
        <p className="text-body-sm text-ink-tertiary mt-1 flex items-center gap-1.5">
          <ShieldCheck size={15} className="text-chain-verified flex-none" />
          Genuine tickets from other fans. Prices can't go above the organiser's limit, and the seller's QR code is cancelled when the ticket transfers to you.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Select aria-label="Event" value={eventId} onChange={(e) => setParam("event", e.target.value)} className="w-64">
          <option value="">All events</option>
          {events.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
        </Select>
        <Select aria-label="Sort" value={sort} onChange={(e) => setParam("sort", e.target.value === "price" ? "" : e.target.value)} className="w-56">
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
      </div>

      {error && <ErrorState description={error} onRetry={retry} />}

      {!error && !listings && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="aspect-[4/3] rounded-md" />)}
        </div>
      )}

      {shown?.length === 0 && (
        <EmptyState
          title={eventId ? "No resale tickets for this event right now" : "No resale tickets right now"}
          description="Fans list tickets here when they can't make it. Check back closer to the event."
          actionLabel={eventId ? "Show all events" : undefined}
          onAction={eventId ? () => setParam("event", "") : undefined}
        />
      )}

      {shown?.length > 0 && (
        <>
          <p className="text-caption text-ink-tertiary">{shown.length} ticket{shown.length === 1 ? "" : "s"} available</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {shown.map((l) => <ResaleListingCard key={l.id} listing={l} />)}
          </div>
        </>
      )}
    </div>
  );
}
