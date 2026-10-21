import { useEffect, useState } from "react";
import { AlertOctagon, Wifi, WifiOff } from "lucide-react";
import { api, ApiError } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { useToast } from "../../components/ui/Toast";
import { Select, Card, ProgressBar, Badge, Input, Textarea, Button, Modal, EmptyState, ErrorState, Skeleton } from "../../components/ui";

export default function CrowdControl() {
  const toast = useToast();
  const { data: events, error: eventsError, retry: retryEvents } = useApiData(() => api.getOrganiserEvents());
  const [eventId, setEventId] = useState("");
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideTicket, setOverrideTicket] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (events?.[0] && !eventId) setEventId(events[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  function load() {
    if (!eventId) return;
    api
      .getCrowdControl(eventId)
      .then((res) => {
        setData(res);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Something went wrong. Please try again."));
  }
  useEffect(load, [eventId]);
  useEffect(() => {
    if (!eventId) return;
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function submitOverride(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.submitManualOverride({ eventId, ticketId: overrideTicket, reason: overrideReason });
      toast.push("Ticket admitted via manual override.", { tone: "success" });
      setOverrideOpen(false);
      setOverrideTicket("");
      setOverrideReason("");
      load();
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Override failed.", { tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  if (eventsError) {
    return <div className="mx-auto max-w-4xl px-4 py-10"><ErrorState description={eventsError} onRetry={retryEvents} /></div>;
  }

  if (events === null) {
    return <div className="mx-auto max-w-4xl px-4 lg:px-6 py-6"><Skeleton className="h-20 w-full" /></div>;
  }

  if (events.length === 0) {
    return <div className="mx-auto max-w-4xl px-4 py-10"><EmptyState title="No events yet" description="Create an event to see live crowd control here." /></div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-h1 text-ink-primary">Crowd Control</h1>
        <Select value={eventId} onChange={(e) => setEventId(e.target.value)} className="w-56" aria-label="Event">
          {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </Select>
      </div>

      {loadError && !data && <ErrorState description={loadError} onRetry={load} />}

      {data && (
        <>
          {loadError && (
            <div className="rounded-md bg-warning-bg text-warning-on-tint px-4 py-2.5 text-caption">Live updates paused — {loadError}</div>
          )}
          <Card className="flex flex-col gap-2">
            <div className="flex justify-between text-body-sm text-ink-secondary">
              <span>Admitted</span>
              <span className="tabular-nums text-ink-primary font-semibold">{data.admitted} / {data.capacity}</span>
            </div>
            <ProgressBar value={data.admitted} max={data.capacity} showPercent ariaLabel="Admitted" />
            <p className="text-caption text-ink-tertiary">{data.admissionRate}% admission rate · {data.queueEstimate} ticket holders not yet admitted</p>
          </Card>

          <div className="flex flex-col gap-2">
            <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">Per-gate throughput</span>
            {data.throughputByGate.length === 0 ? (
              <p className="text-body-sm text-ink-tertiary">No scans recorded yet.</p>
            ) : (
              <Card className="flex flex-col gap-2">
                {data.throughputByGate.map((g) => (
                  <div key={g.gate} className="flex items-center gap-3">
                    <span className="w-24 text-body-sm text-ink-primary flex-none">{g.gate}</span>
                    <div className="flex-1 h-2 rounded-full bg-surface-elevated overflow-hidden flex">
                      <div className="h-full bg-success" style={{ width: `${(g.admitted / (g.admitted + g.denied || 1)) * 100}%` }} />
                      <div className="h-full bg-danger" style={{ width: `${(g.denied / (g.admitted + g.denied || 1)) * 100}%` }} />
                    </div>
                    <span className="text-caption text-ink-tertiary tabular-nums w-20 text-right">{g.admitted} / {g.denied}</span>
                  </div>
                ))}
              </Card>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">Gates</span>
            <Card padding="p-0">
              {data.gates.map((g, i) => (
                <div key={g.gate_id} className={`flex items-center justify-between px-4 py-3 ${i > 0 ? "border-t border-line-subtle" : ""}`}>
                  <span className="flex items-center gap-2 text-body-sm text-ink-primary">
                    {g.online ? <Wifi size={14} className="text-success" /> : <WifiOff size={14} className="text-ink-tertiary" />}
                    {g.gate_name}
                  </span>
                  <span className="text-caption text-ink-tertiary tabular-nums">
                    {g.online ? `Synced ${g.last_sync_at ? new Date(g.last_sync_at).toLocaleTimeString("en-KE") : "—"}` : "Offline"} · {g.cached_tickets} cached
                  </span>
                </div>
              ))}
            </Card>
          </div>

          <Button variant="secondary" iconLeft={<AlertOctagon size={15} />} onClick={() => setOverrideOpen(true)} className="w-auto self-start px-5">
            Manual override
          </Button>
        </>
      )}

      <Modal open={overrideOpen} onClose={() => setOverrideOpen(false)} title="Manual admission override">
        <form onSubmit={submitOverride} className="flex flex-col gap-4">
          <p className="text-body-sm text-ink-secondary">This admits a ticket without a scan and writes to the audit log — use only when the scanner genuinely can't validate it.</p>
          <Input label="Ticket ID" value={overrideTicket} onChange={(e) => setOverrideTicket(e.target.value)} required />
          <Textarea label="Reason" required value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="e.g. device offline, credential wouldn't scan" />
          <Button type="submit" variant="danger" loading={busy}>Admit ticket</Button>
        </form>
      </Modal>
    </div>
  );
}
