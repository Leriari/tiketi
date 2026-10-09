import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ScanLine, HardDrive, Clock, CalendarRange } from "lucide-react";
import { api, ApiError } from "../../api";
import { useToast } from "../../components/ui/Toast";
import { Input, Button, ProgressBar, EmptyState, ErrorState, Skeleton } from "../../components/ui";
import {
  getMeta, setMeta, getOrCreateDeviceId, countCredentials,
  replaceCredentials, wipeAll, maybeAutoWipe,
} from "../../scanner/credentialStore";

function formatWhen(iso) {
  return new Date(iso).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Rough display estimate only (bytes per cached credential record) — not a
// precision measurement, just enough for a steward to see "this used some
// real storage," matching what the old localStorage version showed.
const BYTES_PER_CREDENTIAL_ESTIMATE = 160;

export default function Sync() {
  const navigate = useNavigate();
  const toast = useToast();
  const [events, setEvents] = useState(null);
  const [eventsError, setEventsError] = useState(null);
  const [eventId, setEventId] = useState("");
  const [gateName, setGateName] = useState("");
  const [progress, setProgress] = useState(0);
  const [meta, setMetaState] = useState(null);
  const [credentialCount, setCredentialCount] = useState(0);
  // resume: an existing device session was found on load | select: choosing
  // event+gate | syncing | synced: just finished, ready to start scanning.
  const [phase, setPhase] = useState("loading");
  const timerRef = useRef(null);

  function loadEvents() {
    setEventsError(null);
    api.listEvents().then(setEvents).catch((err) => setEventsError(err instanceof ApiError ? err.message : "Something went wrong. Please try again."));
  }

  useEffect(() => {
    loadEvents();
    (async () => {
      const wiped = await maybeAutoWipe();
      if (wiped) {
        setPhase("select");
        return;
      }
      const existing = getMeta();
      const count = await countCredentials();
      setMetaState(existing);
      setCredentialCount(count);
      setPhase(existing && count > 0 ? "resume" : "select");
    })();
    return () => clearInterval(timerRef.current);
  }, []);

  const event = events?.find((e) => e.id === eventId);
  const eventTicketCount = event?.tiers?.reduce((s, t) => s + t.tickets_sold, 0) || 0;

  async function startSync() {
    setPhase("syncing");
    setProgress(0);

    const deviceId = getOrCreateDeviceId();
    const syncPromise = api.syncGateData({ eventId, deviceId, gateName });
    // Visual progress independent of the request itself — a real device
    // syncing thousands of credentials genuinely takes a few seconds.
    timerRef.current = setInterval(() => {
      setProgress((p) => Math.min(p + Math.random() * 18, 92));
    }, 140);

    try {
      const sync = await syncPromise;
      clearInterval(timerRef.current);
      setProgress(100);

      await replaceCredentials(sync.tickets);
      const nextMeta = setMeta({
        eventId: sync.event_id,
        eventTitle: sync.event_title,
        eventDate: sync.event_date,
        gateName: sync.gate_name,
        scannerId: sync.scanner_id,
        deviceId: sync.device_id,
        syncedAt: sync.synced_at,
        totalCached: sync.ticket_count,
      });
      setMetaState(nextMeta);
      setCredentialCount(sync.ticket_count);
      setPhase("synced");
    } catch (err) {
      clearInterval(timerRef.current);
      toast.push(err instanceof ApiError ? err.message : "Sync failed. Please try again.", { tone: "danger" });
      setPhase("select");
    }
  }

  async function startNewSession() {
    await wipeAll();
    setMetaState(null);
    setCredentialCount(0);
    setEventId("");
    setGateName("");
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

      {phase === "loading" && (
        <div className="flex flex-col gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      )}

      {phase === "resume" && meta && (
        <div className="rounded-md border border-line-default bg-surface p-4 flex flex-col gap-3">
          <p className="text-body-sm text-ink-primary">
            <span className="font-semibold">{meta.eventTitle}</span> · {meta.gateName} is already synced to this device.
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
                      onClick={() => setEventId(e.id)}
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
                  <p className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium mb-2">Gate name</p>
                  <Input
                    placeholder="e.g. Main Gate"
                    value={gateName}
                    onChange={(e2) => setGateName(e2.target.value)}
                    disabled={phase === "syncing"}
                  />
                  <p className="text-caption text-ink-tertiary mt-1.5">
                    This device will be registered under that name for this event.
                  </p>
                </div>
              )}

              {event && gateName.trim() && phase === "select" && (
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

      {phase === "synced" && meta && (
        <div className="flex flex-col gap-3">
          <div className="rounded-md border border-line-default bg-surface p-4 flex flex-col gap-2.5">
            <div className="flex items-center gap-2 text-body-sm text-ink-secondary">
              <Clock size={14} className="text-ink-tertiary flex-none" /> Last sync: just now
            </div>
            <div className="flex items-center gap-2 text-body-sm text-ink-secondary">
              <HardDrive size={14} className="text-ink-tertiary flex-none" />
              Storage used: ~{Math.max(1, Math.round((credentialCount * BYTES_PER_CREDENTIAL_ESTIMATE) / 1024))} KB · {credentialCount} tickets
            </div>
            <div className="flex items-center gap-2 text-body-sm text-ink-secondary">
              <CalendarRange size={14} className="text-ink-tertiary flex-none" /> Event date: {formatWhen(meta.eventDate)}
            </div>
          </div>

          <Button size="lg" onClick={() => navigate("/scanner/scan")}>Start Scanning</Button>
          <p className="text-caption text-ink-tertiary text-center">Once synced, this device validates tickets without an internet connection.</p>
        </div>
      )}
    </div>
  );
}
