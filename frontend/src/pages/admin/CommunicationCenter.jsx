import { useState } from "react";
import { Send } from "lucide-react";
import { api, ApiError } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { useToast } from "../../components/ui/Toast";
import { Card, Textarea, Checkbox, Select, DatePicker, Toggle, Button, Badge, EmptyState, ErrorState, Skeleton } from "../../components/ui";
import { localInputToUtc } from "../../format";

const CHANNELS = [
  { value: "sms", label: "SMS" },
  { value: "push", label: "Push notification" },
  { value: "in_app", label: "In-app" },
];

const AUDIENCES = [
  { value: "all", label: "Everyone" },
  { value: "attendees", label: "Attendees" },
  { value: "organisers", label: "Organisers" },
  { value: "gate_staff", label: "Gate staff (scanner devices)" },
];

const STATUS_TONE = { sent: "success", scheduled: "warning" };

export default function CommunicationCenter() {
  const toast = useToast();
  const { data: broadcasts, error, retry } = useApiData(() => api.getBroadcasts());
  // Which channels this server can actually deliver on, and why not.
  const { data: available } = useApiData(() => api.getBroadcastChannels());
  const [message, setMessage] = useState("");
  const [channels, setChannels] = useState(["in_app"]);
  const [audience, setAudience] = useState("all");
  const [scheduleLater, setScheduleLater] = useState(false);
  const [scheduledFor, setScheduledFor] = useState("");
  const [busy, setBusy] = useState(false);

  function toggleChannel(value, checked) {
    setChannels((cur) => (checked ? [...cur, value] : cur.filter((c) => c !== value)));
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.sendBroadcast({ message, channels, audience, scheduledFor: scheduleLater ? localInputToUtc(scheduledFor) : null });
      toast.push(scheduleLater ? "Broadcast scheduled." : "Broadcast sent.", { tone: "success" });
      setMessage("");
      retry();
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Couldn't send that.", { tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 lg:px-6 py-6 flex flex-col gap-6">
      <h1 className="text-h1 text-ink-primary">Communication Center</h1>

      <form onSubmit={submit} className="card flex flex-col gap-4">
        <Textarea label="Message" required value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What do you want to tell them?" />

        <div>
          <p className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium mb-2">Channels</p>
          <div className="flex gap-5">
            {CHANNELS.map((c) => {
              const off = available && available[c.value]?.available === false;
              return (
                <Checkbox
                  key={c.value}
                  label={off ? `${c.label} (not set up)` : c.label}
                  title={off ? available[c.value].reason : undefined}
                  disabled={off}
                  className={off ? "opacity-60 cursor-not-allowed" : undefined}
                  checked={!off && channels.includes(c.value)}
                  onChange={(checked) => toggleChannel(c.value, checked)}
                />
              );
            })}
          </div>
          {available && CHANNELS.some((c) => available[c.value]?.available === false) && (
            <p className="text-caption text-ink-tertiary mt-2">
              {CHANNELS.filter((c) => available[c.value]?.available === false).map((c) => available[c.value].reason).join(" ")}{" "}
              In-app messages appear as a banner for the chosen audience.
            </p>
          )}
        </div>

        <Select label="Audience" value={audience} onChange={(e) => setAudience(e.target.value)}>
          {AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
        </Select>

        <Toggle label="Schedule for later" checked={scheduleLater} onChange={setScheduleLater} />
        {scheduleLater && (
          <DatePicker label="Send at" withTime required value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
        )}

        {message && (
          <div className="rounded-md border border-line-default bg-surface-inset px-3 py-2.5">
            <p className="text-caption text-ink-tertiary mb-1">Preview</p>
            <p className="text-body-sm text-ink-primary">{message}</p>
          </div>
        )}

        <Button type="submit" iconLeft={<Send size={15} />} loading={busy} disabled={!channels.length}>
          {scheduleLater ? "Schedule broadcast" : "Send now"}
        </Button>
      </form>

      <div className="flex flex-col gap-2">
        <span className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">Past broadcasts</span>
        {error ? (
          <ErrorState description={error} onRetry={retry} />
        ) : broadcasts === null ? (
          <div className="flex flex-col gap-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
        ) : broadcasts.length === 0 ? (
          <EmptyState title="No broadcasts yet" description="Sent and scheduled messages will appear here." />
        ) : (
          broadcasts.map((b) => (
            <Card key={b.id} className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <p className="text-body-sm text-ink-primary flex-1">{b.message}</p>
                <Badge tone={STATUS_TONE[b.status]}>{b.status}</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-caption text-ink-tertiary">
                <span>{AUDIENCES.find((a) => a.value === b.audience)?.label} · {b.audience_size} recipients</span>
                <span>{new Date(b.sent_at || b.scheduled_for).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              {b.status === "sent" && (
                <div className="flex flex-wrap gap-3 text-caption">
                  {Object.entries(b.delivery).map(([ch, d]) => (
                    <span key={ch} className="text-ink-secondary">
                      {CHANNELS.find((c) => c.value === ch)?.label}: {ch === "in_app" ? `shown to ${d.sent} people` : `${d.delivered}/${d.sent} delivered`}
                    </span>
                  ))}
                </div>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
