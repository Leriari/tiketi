import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MapPin, Share2, CalendarPlus, ShieldCheck, Bell } from "lucide-react";
import { api } from "../../api";
import { useToast } from "../../components/ui/Toast";
import { Badge, Button, Card, MoneyText, Skeleton, ErrorState } from "../../components/ui";
import { formatEventDate } from "../../format";
import { categoryGradient } from "../../lib/categoryGradient";

function TierRow({ tier, selected, onSelect }) {
  const soldOut = tier.tickets_remaining <= 0;
  const toast = useToast();

  return (
    <button
      type="button"
      disabled={soldOut}
      onClick={() => onSelect(tier.id)}
      className={`w-full flex items-center justify-between gap-3 rounded-md border px-4 py-3 text-left transition-colors duration-150 ${
        soldOut
          ? "border-line-subtle bg-surface-inset opacity-50 cursor-not-allowed"
          : selected
            ? "border-brand-primary bg-brand-primary/10"
            : "border-line hover:border-line-strong"
      }`}
    >
      <span>
        <span className="block text-body font-semibold text-ink-primary">{tier.name}</span>
        <span className="block text-caption text-ink-tertiary tabular-nums">
          {soldOut ? "Sold out" : `${tier.tickets_remaining} left`}
        </span>
      </span>
      <span className="flex items-center gap-3 flex-none">
        <MoneyText value={tier.price} size="h3" />
        {soldOut && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              toast.push(`We'll notify you if ${tier.name} becomes available.`, { tone: "info" });
            }}
            className="inline-flex items-center gap-1 text-caption font-semibold text-brand-primary-on-tint"
          >
            <Bell size={12} /> Notify me
          </span>
        )}
      </span>
    </button>
  );
}

export default function EventDetail() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [event, setEvent] = useState(null);
  const [error, setError] = useState(null);
  const [tierId, setTierId] = useState(null);

  function load() {
    setError(null);
    api
      .getEvent(eventId)
      .then((ev) => {
        setEvent(ev);
        setTierId(ev.tiers.find((t) => t.tickets_remaining > 0)?.id ?? ev.tiers[0]?.id ?? null);
      })
      .catch((err) => setError(err.message));
  }

  useEffect(load, [eventId]);

  if (error) return <ErrorState className="mt-10" description={error} onRetry={load} />;
  if (!event) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6 flex flex-col gap-4">
        <Skeleton className="aspect-[21/9] rounded-md" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const selectedTier = event.tiers.find((t) => t.id === tierId);

  return (
    <div className="pb-28 lg:pb-10">
      <div className="aspect-[21/9] sm:aspect-[3/1] relative" style={{ background: categoryGradient(event.category) }}>
        <div className="absolute inset-0 bg-gradient-to-t from-surface-base/90 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 mx-auto max-w-4xl px-4 lg:px-6 pb-5">
          <Badge tone="brand" className="mb-2">{event.category}</Badge>
          <h1 className="text-display font-bold text-white drop-shadow">{event.title}</h1>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 lg:px-6 mt-6 grid lg:grid-cols-[1fr_320px] gap-8">
        <div className="flex flex-col gap-6 min-w-0">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-body-sm text-ink-secondary">
            <span className="flex items-center gap-1.5">{formatEventDate(event.event_date)}</span>
            <a href={event.map_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-brand-primary-on-tint hover:underline">
              <MapPin size={14} /> {event.venue}
            </a>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<Share2 size={14} />}
              onClick={async () => {
                if (navigator.share) await navigator.share({ title: event.title, url: location.href });
                else {
                  await navigator.clipboard.writeText(location.href);
                  toast.push("Link copied.", { tone: "success" });
                }
              }}
            >
              Share
            </Button>
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<CalendarPlus size={14} />}
              onClick={() => toast.push("Added to your calendar.", { tone: "success" })}
            >
              Add to calendar
            </Button>
          </div>

          {/* Mobile purchase panel lives inline here; desktop gets the sticky sidebar instead */}
          <div className="lg:hidden flex flex-col gap-2">
            <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">Tickets</span>
            {event.tiers.map((t) => (
              <TierRow key={t.id} tier={t} selected={tierId === t.id} onSelect={setTierId} />
            ))}
          </div>

          {event.description && (
            <section className="flex flex-col gap-2">
              <h2 className="text-h2 text-ink-primary">About this event</h2>
              <p className="text-body text-ink-secondary whitespace-pre-line">{event.description}</p>
            </section>
          )}

          {event.artists?.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-h2 text-ink-primary">Lineup</h2>
              <div className="flex flex-wrap gap-2">
                {event.artists.map((a) => (
                  <span key={a} className="rounded-full bg-surface-elevated border border-line px-3 py-1.5 text-body-sm text-ink-primary">
                    {a}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="flex flex-col gap-2">
            <h2 className="text-h2 text-ink-primary">Venue</h2>
            <p className="text-body-sm text-ink-secondary">{event.venue}</p>
            <a href={event.map_url} target="_blank" rel="noreferrer" className="text-body-sm text-brand-primary-on-tint hover:underline w-fit">
              Open in Maps
            </a>
          </section>

          <Card className="flex flex-col gap-2 border-chain-verified/30 bg-chain-verified/5">
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-chain-verified" />
              <h3 className="text-h3 text-ink-primary">Resale policy</h3>
            </div>
            <p className="text-body-sm text-ink-secondary">
              Tickets for this event may be resold at a maximum of{" "}
              <strong className="text-ink-primary">{Math.round(event.resale_ceiling_multiplier * 100)}% of face value</strong>. A{" "}
              <strong className="text-ink-primary">{event.resale_royalty_percent}% royalty</strong> returns to the organiser on every
              resale. These limits are enforced by smart contract and cannot be overridden.
            </p>
          </Card>
        </div>

        {/* Desktop sticky purchase panel */}
        <div className="hidden lg:block">
          <Card className="sticky top-24 flex flex-col gap-3">
            <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">Tickets</span>
            {event.tiers.map((t) => (
              <TierRow key={t.id} tier={t} selected={tierId === t.id} onSelect={setTierId} />
            ))}
            <Button
              variant="primary"
              disabled={!selectedTier || selectedTier.tickets_remaining <= 0}
              onClick={() => navigate(`/checkout/${event.id}?tier=${tierId}`)}
            >
              {selectedTier?.tickets_remaining > 0 ? `Get tickets — ${selectedTier.name}` : "Select a ticket"}
            </Button>
          </Card>
        </div>
      </div>

      {/* Mobile sticky CTA bar */}
      <div className="lg:hidden fixed bottom-16 inset-x-0 z-10 border-t border-line-subtle bg-surface p-3">
        <Button
          variant="primary"
          disabled={!selectedTier || selectedTier.tickets_remaining <= 0}
          onClick={() => navigate(`/checkout/${event.id}?tier=${tierId}`)}
        >
          {selectedTier ? (
            <>
              Get tickets · <MoneyText value={selectedTier.price} size="body" className="text-brand-accent-ink" />
            </>
          ) : (
            "Select a ticket"
          )}
        </Button>
      </div>
    </div>
  );
}
