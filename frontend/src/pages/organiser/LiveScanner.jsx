import { useEffect, useState } from "react";
import { api, ApiError } from "../../api";
import { Select, Card, Input, Button, EmptyState } from "../../components/ui";

export default function LiveScanner() {
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState("");
  const [gateId, setGateId] = useState("");
  const [payload, setPayload] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [log, setLog] = useState([]);

  useEffect(() => {
    api.getOrganiserEvents().then((rows) => {
      setEvents(rows);
      if (rows[0]) {
        setEventId(rows[0].id);
        setGateId(rows[0].gates?.[0]?.id || "");
      }
    });
  }, []);

  const event = events.find((e) => e.id === eventId);

  async function scan(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.scanTicket({ qr_payload: payload.trim(), scanner_id: "organiser-console", gate_id: gateId, event_id: eventId });
      setResult(res);
      setLog((rows) => [{ ...res, at: new Date() }, ...rows].slice(0, 8));
      setPayload("");
    } catch (err) {
      setResult({ valid: false, reason: err instanceof ApiError ? err.message : "Scan failed." });
    } finally {
      setBusy(false);
    }
  }

  if (events.length === 0) {
    return <div className="mx-auto max-w-lg px-4 py-10"><EmptyState title="No events yet" description="Create an event before testing scans." /></div>;
  }

  return (
    <div className="mx-auto max-w-lg px-4 lg:px-6 py-6 flex flex-col gap-4">
      <div>
        <h1 className="text-h1 text-ink-primary">Live QR Scanner</h1>
        <p className="text-body-sm text-ink-tertiary">Test gate validation directly from the console. The full offline Scanner PWA is a separate surface, built later.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Select label="Event" value={eventId} onChange={(e) => { setEventId(e.target.value); setGateId(events.find((ev) => ev.id === e.target.value)?.gates?.[0]?.id || ""); }}>
          {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </Select>
        <Select label="Gate" value={gateId} onChange={(e) => setGateId(e.target.value)}>
          {event?.gates.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </Select>
      </div>

      <form onSubmit={scan} className="card flex flex-col gap-3">
        <Input label="Ticket code" required autoFocus value={payload} onChange={(e) => setPayload(e.target.value)} placeholder="TIKETI:xxxxxxxx:123456" />
        <Button type="submit" loading={busy} disabled={!payload.trim()}>Scan</Button>
      </form>

      {result && (
        <Card className="flex flex-col items-center text-center gap-2" style={{ background: result.valid ? "var(--success-bg)" : "var(--danger-bg)" }}>
          <h2 className={result.valid ? "text-h2 text-success" : "text-h2 text-danger"}>{result.valid ? "ACCESS GRANTED" : "ACCESS DENIED"}</h2>
          {result.valid ? <p className="text-body-sm text-ink-secondary">{result.event_title} · {result.owner_phone} · {result.scanned_at}</p> : <p className="text-body-sm text-ink-secondary">{result.reason}</p>}
        </Card>
      )}

      {log.length > 0 && (
        <Card padding="p-0">
          {log.map((r, i) => (
            <div key={i} className={`flex items-center justify-between px-4 py-2.5 ${i > 0 ? "border-t border-line-subtle" : ""}`}>
              <span className={r.valid ? "text-success text-body-sm font-semibold" : "text-danger text-body-sm font-semibold"}>{r.valid ? "Granted" : "Denied"}</span>
              <span className="text-caption text-ink-tertiary tabular-nums">{r.at.toLocaleTimeString("en-KE")}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
