import { useState } from "react";
import { Check, X, CheckCircle2, XCircle } from "lucide-react";
import { api, ApiError } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { useToast } from "../../components/ui/Toast";
import { Card, Badge, Button, Modal, Textarea, MoneyText, EmptyState, ErrorState, Skeleton } from "../../components/ui";
import EventCover from "../../components/EventCover";

function RejectModal({ event, onClose, onDone }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.rejectEvent({ eventId: event.id, reason });
      toast.push("Event sent back to the organiser as draft.", { tone: "danger" });
      onDone();
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Couldn't reject this event.", { tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Reject event">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-body-sm text-ink-secondary">{event.title} stays a draft — the organiser can revise and resubmit.</p>
        <Textarea label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What needs to change before this can go live?" />
        <Button type="submit" variant="danger" loading={busy}>Reject</Button>
      </form>
    </Modal>
  );
}

export default function EventApprovals() {
  const toast = useToast();
  const { data: queue, error, retry } = useApiData(() => api.getEventApprovalQueue());
  const [rejecting, setRejecting] = useState(null);

  async function approve(event) {
    if (!event.allPassed && !window.confirm("This event doesn't pass every policy check. Approve and publish it anyway?")) return;
    try {
      await api.approveEvent(event.id);
      toast.push(`${event.title} is now live.`, { tone: "success" });
      retry();
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Couldn't approve this event.", { tone: "danger" });
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <div>
        <h1 className="text-h1 text-ink-primary">Event Approvals</h1>
        <p className="text-body-sm text-ink-tertiary">Draft events submitted by organisers, awaiting a policy review before they go live.</p>
      </div>

      {error ? (
        <ErrorState description={error} onRetry={retry} />
      ) : queue === null ? (
        <div className="flex flex-col gap-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}</div>
      ) : queue.length === 0 ? (
        <EmptyState title="Nothing awaiting review" description="Draft events an organiser saves show up here before they can go live." />
      ) : (
        queue.map((event) => (
          <Card key={event.id} className="flex flex-col lg:flex-row gap-4">
            <EventCover event={event} className="h-40 lg:h-auto lg:w-48 flex-none rounded-md flex items-end p-3">
              <span className="relative text-caption text-white/90 uppercase tracking-wide bg-black/30 rounded-sm px-1.5 py-0.5">{event.category}</span>
            </EventCover>

            <div className="flex-1 flex flex-col gap-3">
              <div>
                <p className="text-h3 text-ink-primary">{event.title}</p>
                <p className="text-body-sm text-ink-tertiary">{event.venue} · submitted {new Date(event.submitted_at).toLocaleDateString("en-KE", { day: "2-digit", month: "short" })}</p>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                {event.checks.map((c) => (
                  <span key={c.label} className={`inline-flex items-center gap-1.5 text-caption ${c.pass ? "text-success" : "text-danger"}`}>
                    {c.pass ? <Check size={13} /> : <X size={13} />} {c.label}
                  </span>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                {event.tiers.map((t) => (
                  <span key={t.name} className="text-caption text-ink-secondary bg-surface-inset rounded-full px-2.5 py-1">
                    {t.name} · <MoneyText value={t.price} size="body" className="!text-caption" /> · {t.capacity} cap
                  </span>
                ))}
              </div>

              <div className="flex gap-2 mt-auto">
                <Button iconLeft={<CheckCircle2 size={15} />} onClick={() => approve(event)} className="flex-1">Approve &amp; publish</Button>
                <Button variant="danger" iconLeft={<XCircle size={15} />} onClick={() => setRejecting(event)} className="flex-1">Reject</Button>
              </div>
            </div>
          </Card>
        ))
      )}

      {rejecting && <RejectModal event={rejecting} onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); retry(); }} />}
    </div>
  );
}
