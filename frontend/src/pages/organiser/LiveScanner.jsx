import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, CheckCircle2, XCircle, KeyRound } from "lucide-react";
import { api, ApiError } from "../../api";
import { Select, Card, Input, Button, EmptyState } from "../../components/ui";
import QrCamera from "../../components/QrCamera";

const REPEAT_WINDOW_MS = 4000; // the camera reads the same code many times a second
const LOG_LIMIT = 10;

function time(iso) {
  return iso ? new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }) : "";
}

/**
 * Door scanning from a signed-in organiser's own phone: point the camera at
 * an attendee's ticket QR (or type its code). Each scan is checked online
 * against the chosen event and recorded as attendance. For gates without
 * signal, enrol a device in the offline Scanner app instead (QR Scanner Hub).
 */
export default function LiveScanner() {
  const [events, setEvents] = useState(null);
  const [eventId, setEventId] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [payload, setPayload] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [log, setLog] = useState([]);
  const [admitted, setAdmitted] = useState(0);
  const lastRef = useRef({ text: null, at: 0 });

  useEffect(() => {
    api.getOrganiserEvents().then((rows) => {
      const now = Date.now();
      // Soonest event that hasn't finished first: that's the one at the door.
      const sorted = [...rows].sort((a, b) => {
        const aDone = new Date(a.ends_at || a.event_date) < now;
        const bDone = new Date(b.ends_at || b.event_date) < now;
        return aDone - bDone || new Date(a.event_date) - new Date(b.event_date);
      });
      setEvents(sorted);
      if (sorted[0]) setEventId(sorted[0].id);
    }).catch(() => setEvents([]));
  }, []);

  const check = useCallback(async (text) => {
    const code = text.trim();
    if (!code || !eventId) return;
    setBusy(true);
    try {
      const res = await api.scanAtEvent(eventId, code);
      setResult(res);
      if (res.valid) setAdmitted((n) => n + 1);
      setLog((rows) => [{ ...res, at: res.scanned_at || new Date().toISOString() }, ...rows].slice(0, LOG_LIMIT));
      if (navigator.vibrate) navigator.vibrate(res.valid ? 200 : [200, 100, 200]);
    } catch (err) {
      setResult({ valid: false, reason: err instanceof ApiError ? err.message : "Couldn't check that ticket. Are you online?" });
    } finally {
      setBusy(false);
    }
  }, [eventId]);

  const onDecode = useCallback((text) => {
    const now = Date.now();
    if (text === lastRef.current.text && now - lastRef.current.at < REPEAT_WINDOW_MS) return;
    lastRef.current = { text, at: now };
    check(text);
  }, [check]);

  // A grant clears itself so the next person can step up; a denial waits for a tap.
  useEffect(() => {
    if (!result?.valid) return;
    const t = setTimeout(() => setResult(null), 2500);
    return () => clearTimeout(t);
  }, [result]);

  function submitTyped(e) {
    e.preventDefault();
    check(payload);
    setPayload("");
  }

  if (events === null) return null;
  if (events.length === 0) {
    return <div className="mx-auto max-w-lg px-4 py-10"><EmptyState title="No events yet" description="Create an event before scanning tickets." /></div>;
  }

  return (
    <div className="mx-auto max-w-lg px-4 lg:px-6 py-6 flex flex-col gap-4">
      <div>
        <h1 className="text-h1 text-ink-primary">Live QR Scanner</h1>
        <p className="text-body-sm text-ink-tertiary">
          Scan tickets at the door with this phone's camera. Each scan is checked online and counted in Attendance.
          No signal at the gate? Enrol a device for offline scanning in QR Scanner Hub.
        </p>
      </div>

      <Select label="Event" value={eventId} onChange={(e) => { setEventId(e.target.value); setResult(null); }}>
        {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
      </Select>

      {cameraOn ? (
        <div className="flex flex-col gap-2">
          <QrCamera onDecode={onDecode} paused={busy || Boolean(result)} className="h-[60vh] max-h-[480px] rounded-lg" />
          <div className="flex items-center justify-between">
            <span className="text-body-sm text-ink-secondary tabular-nums">{admitted} admitted this session</span>
            <Button variant="secondary" size="sm" iconLeft={<CameraOff size={15} />} onClick={() => setCameraOn(false)} className="w-auto px-4">
              Stop camera
            </Button>
          </div>
        </div>
      ) : (
        <Button size="lg" iconLeft={<Camera size={18} />} onClick={() => setCameraOn(true)}>Scan with camera</Button>
      )}

      <form onSubmit={submitTyped} className="flex gap-2">
        <Input
          aria-label="Ticket code"
          leadingIcon={<KeyRound size={15} />}
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          placeholder="Or type the code: TIKETI:…"
          className="flex-1"
        />
        <Button type="submit" loading={busy && !cameraOn} disabled={!payload.trim()} className="w-auto px-5">Check</Button>
      </form>

      {log.length > 0 && (
        <Card padding="p-0">
          {log.map((r, i) => (
            <div key={i} className={`flex items-center justify-between gap-3 px-4 py-2.5 ${i > 0 ? "border-t border-line-subtle" : ""}`}>
              <div className="min-w-0">
                <p className={r.valid ? "text-success text-body-sm font-semibold" : "text-danger text-body-sm font-semibold"}>
                  {r.valid ? `Admitted${r.tier_name ? ` · ${r.tier_name}` : ""}` : "Denied"}
                </p>
                {!r.valid && <p className="text-caption text-ink-tertiary truncate">{r.reason}</p>}
              </div>
              <span className="text-caption text-ink-tertiary tabular-nums flex-none">{time(r.at)}</span>
            </div>
          ))}
        </Card>
      )}

      {/* Full-screen verdict: readable at arm's length at a busy door. */}
      {result && (
        <div
          role="alert"
          aria-live="assertive"
          className={`fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 px-8 text-center ${result.valid ? "bg-success" : "bg-danger"}`}
          onClick={() => { if (!result.valid) setResult(null); }}
        >
          {result.valid ? <CheckCircle2 size={88} className="text-white" /> : <XCircle size={88} className="text-white" />}
          <h2 className="text-display text-white font-bold">{result.valid ? "ACCESS GRANTED" : "ACCESS DENIED"}</h2>
          {result.valid ? (
            <p className="text-h3 text-white/90">
              {result.tier_name || "General"}{result.complimentary ? " · complimentary" : ""} · {result.owner_phone}
            </p>
          ) : (
            <>
              <p className="text-h3 text-white font-semibold">
                {result.reason}{result.used_at ? ` (at ${time(result.used_at)})` : ""}
              </p>
              <button type="button" className="mt-4 min-h-[48px] rounded-md border-2 border-white px-8 text-body font-semibold text-white hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" onClick={(e) => { e.stopPropagation(); setResult(null); }}>
                Scan next
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
