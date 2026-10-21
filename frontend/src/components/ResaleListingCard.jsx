import { useNavigate } from "react-router-dom";
import { Repeat } from "lucide-react";
import EventCover from "./EventCover";
import { Badge, Button, MoneyText } from "./ui";
import { formatEventDate } from "../format";

// Price relative to face value, in words a buyer understands. Resale can
// only ever be at or below the organiser's cap (enforced server-side), so
// this is information, not a warning.
function priceNote(listing) {
  if (!listing.face_value_kes) return null;
  const pct = Math.round((listing.price / listing.face_value_kes) * 100);
  if (pct === 100) return "Face value";
  return pct < 100 ? `${100 - pct}% below face value` : `${pct}% of face value`;
}

/**
 * One resale listing. compact: a row for Event Detail (the event is already
 * on screen); otherwise a card with the event's cover for the marketplace.
 */
export default function ResaleListingCard({ listing, compact = false }) {
  const navigate = useNavigate();
  const go = () => navigate(`/resale/${listing.id}`);
  const note = priceNote(listing);

  if (compact) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-line-subtle bg-surface px-4 py-3">
        <div className="min-w-0">
          <p className="text-body-sm font-semibold text-ink-primary truncate">{listing.tier_name}</p>
          {note && <p className="text-caption text-ink-tertiary">{note}</p>}
        </div>
        <div className="flex items-center gap-3 flex-none">
          <MoneyText value={listing.price} size="body" className="font-semibold" />
          <Button size="sm" onClick={go}>Buy</Button>
        </div>
      </div>
    );
  }

  return (
    <button type="button" onClick={go} className="text-left rounded-md border border-line-subtle bg-surface hover:border-line-strong transition-colors duration-150 overflow-hidden flex flex-col">
      <EventCover event={listing} className="aspect-[16/9]">
        <Badge icon={<Repeat size={11} />} className="absolute top-2 left-2 bg-black/55 text-white backdrop-blur-sm">Resale</Badge>
      </EventCover>
      <div className="p-3 flex flex-col gap-1 flex-1">
        <h2 className="text-h3 text-ink-primary truncate">{listing.event_title}</h2>
        <p className="text-caption text-ink-tertiary truncate">{listing.venue} · {formatEventDate(listing.event_date)}</p>
        <p className="text-caption text-ink-secondary">{listing.tier_name}</p>
        <div className="flex items-end justify-between pt-2 mt-auto">
          <div>
            <MoneyText value={listing.price} size="h3" />
            {note && <p className="text-caption text-ink-tertiary">{note}</p>}
          </div>
          <span className="text-body-sm font-semibold text-brand-primary-on-tint">Buy →</span>
        </div>
      </div>
    </button>
  );
}
