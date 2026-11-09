import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ShieldCheck, CheckCircle2 } from "lucide-react";
import { api, ApiError } from "../../api";
import { TimelineStepper, Card, Button, MoneyText, Checkbox, EmptyState, ErrorState, Skeleton } from "../../components/ui";
import { formatEventDate } from "../../format";
import EventCover from "../../components/EventCover";

const STEPS = [{ label: "Choose ticket" }, { label: "Set price" }, { label: "Review" }, { label: "Listed" }];

export default function SellWizard() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const preselectedTicketId = params.get("ticket");
  const [step, setStep] = useState(0);
  const [tickets, setTickets] = useState(null);
  const [selected, setSelected] = useState(null);
  const [price, setPrice] = useState(0);
  const [shake, setShake] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [listingId, setListingId] = useState(null);
  const [loadError, setLoadError] = useState(null);

  function loadTickets() {
    setLoadError(null);
    api
      .getEligibleTickets()
      .then((rows) => {
        setTickets(rows);
        const preselected = preselectedTicketId && rows.find((t) => t.ticket_id === preselectedTicketId && t.eligible);
        if (preselected) chooseTicket(preselected);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Something went wrong. Please try again."));
  }

  useEffect(() => {
    loadTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function chooseTicket(t) {
    setSelected(t);
    setPrice(t.floor);
    setStep(1);
  }

  function updatePrice(raw) {
    const value = Number(raw);
    if (value > selected.ceiling) {
      setPrice(selected.ceiling);
      setShake(true);
      setTimeout(() => setShake(false), 400);
      return;
    }
    setPrice(value);
  }

  async function handleList(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.sellTicket(selected.ticket_id, { price });
      setListingId(res.listing_id);
      setStep(3);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't list this ticket.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep(0);
    setSelected(null);
    setAgreed(false);
    setListingId(null);
    loadTickets();
  }

  const royaltyPct = selected?.royalty_percent ?? 0;
  const platformPct = 5;
  const royaltyKes = Math.round(price * (royaltyPct / 100));
  const platformKes = Math.round(price * (platformPct / 100));
  const youReceive = price - royaltyKes - platformKes;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 flex flex-col gap-6">
      <h1 className="text-h1 text-ink-primary">Sell a ticket</h1>
      <TimelineStepper steps={STEPS} activeIndex={step} />

      {step === 0 && (
        <div className="flex flex-col gap-3">
          {loadError && <ErrorState description={loadError} onRetry={loadTickets} />}

          {!loadError && tickets === null && (
            <div className="grid sm:grid-cols-2 gap-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-md" />)}
            </div>
          )}
          {tickets?.length === 0 && (
            <EmptyState title="No tickets to sell" description="You don't have any tickets yet." actionLabel="Browse events" onAction={() => navigate("/events")} />
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            {tickets?.map((t) => (
              <button
                key={t.ticket_id}
                disabled={!t.eligible}
                onClick={() => chooseTicket(t)}
                className={`text-left rounded-md border overflow-hidden transition-colors duration-150 ${
                  t.eligible ? "border-line hover:border-brand-primary bg-surface" : "border-line-subtle bg-surface-inset opacity-50 cursor-not-allowed"
                }`}
              >
                <EventCover event={t} className="h-16" />
                <div className="p-3 flex flex-col gap-0.5">
                  <p className="text-body-sm font-semibold text-ink-primary truncate">{t.event_title}</p>
                  <p className="text-caption text-ink-tertiary">{t.tier_name} · {formatEventDate(t.event_date)}</p>
                  {!t.eligible && <p className="text-caption text-warning mt-1">{t.ineligible_reason}</p>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 1 && selected && (
        <div className="flex flex-col gap-5">
          <Card className="flex justify-between items-center">
            <div>
              <p className="text-body-sm text-ink-tertiary">Face value</p>
              <p className="text-body font-semibold text-ink-primary">{selected.event_title} · {selected.tier_name}</p>
            </div>
            <MoneyText value={selected.face_value ?? selected.floor} size="h3" />
          </Card>

          <div className="rounded-md bg-info-bg px-4 py-3 flex flex-col gap-0.5">
            <span className="text-body-sm font-semibold text-info-on-tint">
              Maximum resale price: <MoneyText value={selected.ceiling} size="body" className="text-info-on-tint" /> ({Math.round((selected.ceiling / (selected.face_value ?? selected.floor)) * 100)}% of face value)
            </span>
            <span className="flex items-center gap-1.5 text-caption text-info-on-tint/80">
              <ShieldCheck size={12} /> Fixed in this ticket's smart contract when it was bought
            </span>
          </div>

          <div className={`flex flex-col gap-3 ${shake ? "animate-[shake_400ms]" : ""}`}>
            <input
              type="range"
              aria-label="Listing price"
              min={selected.floor}
              max={selected.ceiling}
              step={10}
              value={price}
              onChange={(e) => updatePrice(e.target.value)}
              className="accent-brand-primary"
            />
            <div className="flex items-center gap-2">
              <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary">KES</span>
              <input
                type="number"
                min={selected.floor}
                max={selected.ceiling}
                value={price}
                onChange={(e) => updatePrice(e.target.value)}
                className="flex-1 h-11 rounded-sm bg-surface-inset border border-line-strong px-3 text-h3 text-ink-primary tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-primary"
              />
            </div>
            {shake && <span className="text-caption text-danger">Above the maximum allowed for this ticket</span>}
          </div>

          <Card className="flex flex-col gap-1.5">
            <div className="flex justify-between text-body-sm text-ink-secondary">
              <span>Listing price</span>
              <MoneyText value={price} size="body" />
            </div>
            <div className="flex justify-between text-body-sm text-ink-secondary">
              <span>Organiser royalty {royaltyPct}%</span>
              <MoneyText value={royaltyKes} size="body" variant="negative" />
            </div>
            <div className="flex justify-between text-body-sm text-ink-secondary">
              <span>Platform fee {platformPct}%</span>
              <MoneyText value={platformKes} size="body" variant="negative" />
            </div>
            <div className="flex justify-between pt-2 border-t border-line-subtle text-ink-primary font-semibold">
              <span>You receive</span>
              <MoneyText value={youReceive} size="h3" variant="positive" />
            </div>
          </Card>
          <p className="text-caption text-ink-tertiary">Funds are held in escrow and released 2 days after the event ends.</p>

          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep(0)} className="flex-1">Back</Button>
            <Button variant="primary" onClick={() => setStep(2)} className="flex-1">Continue</Button>
          </div>
        </div>
      )}

      {step === 2 && selected && (
        <form onSubmit={handleList} className="flex flex-col gap-5">
          <Card className="flex flex-col gap-2">
            <h3 className="text-h3 text-ink-primary">{selected.event_title}</h3>
            <p className="text-body-sm text-ink-secondary">{selected.venue} · {formatEventDate(selected.event_date)}</p>
            <div className="flex justify-between pt-2 border-t border-line-subtle">
              <span className="text-body-sm text-ink-tertiary">{selected.tier_name} · Listing price</span>
              <MoneyText value={price} size="h3" />
            </div>
            <div className="flex justify-between text-body-sm text-ink-secondary">
              <span>You'll receive</span>
              <MoneyText value={youReceive} size="body" variant="positive" />
            </div>
          </Card>
          <Checkbox
            checked={agreed}
            onChange={setAgreed}
            label="I understand this ticket will be listed for resale, subject to the organiser's price cap and royalty, with proceeds held in escrow until 2 days after the event ends."
          />
          {error && <p className="text-body-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep(1)} className="flex-1">Back</Button>
            <Button type="submit" variant="primary" disabled={!agreed} loading={busy} className="flex-1">List ticket</Button>
          </div>
        </form>
      )}

      {step === 3 && (
        <div className="flex flex-col items-center text-center gap-3 py-6">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success-bg">
            <CheckCircle2 size={28} className="text-success" />
          </span>
          <h2 className="text-h1 text-ink-primary">Ticket listed!</h2>
          <p className="text-caption text-ink-tertiary tabular-nums">Listing #{listingId?.slice(0, 8).toUpperCase()}</p>
          <div className="flex gap-2 w-full max-w-xs mt-2">
            <Button variant="secondary" onClick={reset} className="flex-1">List another</Button>
            <Button variant="primary" onClick={() => navigate("/seller/listings")} className="flex-1">View listing</Button>
          </div>
        </div>
      )}

      <style>{`@keyframes shake { 0%,100% { transform: translateX(0) } 20%,60% { transform: translateX(-6px) } 40%,80% { transform: translateX(6px) } }`}</style>
    </div>
  );
}
