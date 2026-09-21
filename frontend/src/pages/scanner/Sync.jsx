import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ScanLine, HardDrive, Clock, CalendarRange } from "lucide-react";
import { api, ApiError } from "../../api";
import { useToast } from "../../components/ui/Toast";
import { Chip, Button, ProgressBar, EmptyState, ErrorState, Skeleton } from "../../components/ui";
import { loadSession, saveSession, newSessionFromSync, estimatedStorageKb, clearSession } from "../../scanner/offlineStore";

function formatWindow(startsAt, endsAt) {
  const start = new Date(startsAt).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  if (!endsAt) return start;
  const end = new Date(endsAt).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  return `${start} — ${end}`;
}

export default function Sync() {
  const navigate = useNavigate();
  const toast = useToast();
  const [events, setEvents] = useState(null);
  const [eventsError, setEventsError] = useState(null);
  const [eventId, setEventId] = useState("");
  const [gateId, setGateId] = useState("");
  const [progress, setProgress] = useState(0);
  const [session, setSession] = useState(() => loadSession());
  // resume: an existing device session was found on load | select: choosing
  // event+gate | syncing | synced: just finished, ready to start scanning.
  const [phase, setPhase] = useState(() => (loadSession() ? "resume" : "select"));
  const timerRef = useRef(null);

  function loadEvents() {
    setEventsError(null);
    api.listEvents().then(setEvents).catch((err) => setEventsError(err instanceof ApiError ? err.message : "Something went wrong. Please try again."));
  }

  useEffect(() => {
    loadEvents();
    return () => clearInterval(timerRef.current);
  }, []);

  const event = events?.find((e) => e.id === eventId);
  const eventTicketCount = event?.tiers?.reduce((s, t) => s + t.tickets_sold, 0) || 0;

  async function startSync() {
    setPhase("syncing");
    setProgress(0);

    const syncPromise = api.syncGateData({ eventId, gateId });
    // Visual progress independent of the (near-instant) mock request — a real
    // device syncing thousands of credentials genuinely takes a few seconds.
    timerRef.current = setInterval(() => {
      setProgress((p) => Math.min(p + Math.random() * 18, 92));
    }, 140);

    try {
      const sync = await syncPromise;
      clearInterval(timerRef.current);
      setProgress(100);

      const next = newSessionFromSync(eventId, gateId, sync);
      saveSession(next);
      setSession(next);
      setPhase("synced");
    } catch (err) {
      clearInterval(timerRef.current);
      toast.push(err instanceof ApiError ? err.message : "Sync failed. Please try again.", { tone: "danger" });
      setPhase("select");
    }
  }

  function startNewSession() {
    clearSession();
    setSession(null);
    setEventId("");
    setGateId("");
    setProgress(0);
    setPhase("select");
  }

  return (
    <div className="min-h-screen flex flex-col px-5 py-8 max-w-md mx-auto">
      <div className="flex items-center gap-2.5 mb-1">
        <span className="h-9 w-9 rounded-md bg-brand-accent flex items-center justify-center text-brand-accent-ink font-black flex-none">C</span>
        <h1 className="text-h2 text-ink-primary font-bold">Scanner</h1>
      </div>
      <p className="text-body-sm text-ink-tertiary mb-8">Sync an event to this device before gates open.</p>

      {phase === "resume" && session && (
        <div className="rounded-md border border-line-default bg-surface p-4 flex flex-col gap-3">
          <p className="text-body-sm text-ink-primary">
            <span className="font-semibold">{session.eventTitle}</span> · {session.gateName} is already synced to this device.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => navigate("/scanner/scan")} className="flex-1">Resume Scanning</Button>
            <Button variant="secondary" onClick={startNewSession} className="flex-1">Start New</Button>
          </div>
        </div>
      )}

      {(phase === "select" || phase === "syncing") && (
        <>
          {eventsError ? (
            <ErrorState description={eventsError} onRetry={loadEvents} />
          ) : events === null ? (
            <div className="flex flex-col gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : events.length === 0 ? (
            <EmptyState title="No live events" description="Nothing is available to scan right now." />
          ) : (
            <div className="flex flex-col gap-6">
              <div>
                <p className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium mb-2">Event</p>
                <div className="flex flex-col gap-2">
                  {events.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      disabled={phase === "syncing"}
                      onClick={() => { setEventId(e.id); setGateId(""); }}
                      className={`text-left rounded-md border px-4 py-3 min-h-[48px] transition-colors ${eventId === e.id ? "border-brand-primary bg-brand-primary/10" : "border-line-default bg-surface"}`}
                    >
                      <p className="text-body font-semibold text-ink-primary">{e.title}</p>
                      <p className="text-caption text-ink-tertiary">{e.venue}</p>
                    </button>
                  ))}
                </div>
              </div>

              {event && (
                <div>
                  <p className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium mb-2">Gate</p>
                  <div className="flex flex-wrap gap-2">
                    {(event.gates || []).map((g) => (
                      <Chip key={g.id} selected={gateId === g.id} onClick={() => phase !== "syncing" && setGateId(g.id)}>{g.name}</Chip>
                    ))}
                    {(!event.gates || event.gates.length === 0) && <p className="text-body-sm text-ink-tertiary">This event has no gates configured yet.</p>}
                  </div>
                </div>
              )}

              {gateId && phase === "select" && (
                <Button size="lg" iconLeft={<ScanLine size={18} />} onClick={startSync}>Sync tickets to this device</Button>
              )}

              {phase === "syncing" && (
                <div className="rounded-md border border-line-default bg-surface p-4 flex flex-col gap-3">
                  <ProgressBar value={progress} max={100} showPercent tone="brand" ariaLabel="Sync progress" />
                  <p className="text-body-sm text-ink-secondary tabular-nums">
                    {Math.round((progress / 100) * eventTicketCount)} of {eventTicketCount} tickets cached to this device
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {phase === "synced" && session && (
        <div className="flex flex-col gap-3">
          <div className="rounded-md border border-line-default bg-surface p-4 flex flex-col gap-2.5">
            <div className="flex items-center gap-2 text-body-sm text-ink-secondary">
              <Clock size={14} className="text-ink-tertiary flex-none" /> Last sync: just now
            </div>
            <div className="flex items-center gap-2 text-body-sm text-ink-secondary">
              <HardDrive size={14} className="text-ink-tertiary flex-none" /> Storage used: ~{estimatedStorageKb(session)} KB · {session.totalCached} tickets
            </div>
            <div className="flex items-center gap-2 text-body-sm text-ink-secondary">
              <CalendarRange size={14} className="text-ink-tertiary flex-none" /> Access window: {formatWindow(session.eventDate, session.endsAt)}
            </div>
          </div>

          <Button size="lg" onClick={() => navigate("/scanner/scan")}>Start Scanning</Button>
          <p className="text-caption text-ink-tertiary text-center">Once synced, this device validates tickets without an internet connection.</p>
        </div>
      )}
    </div>
  );
}
