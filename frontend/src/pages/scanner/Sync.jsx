import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ScanLine, HardDrive, Clock, CalendarRange, KeyRound, Smartphone } from "lucide-react";
import { api, ApiError } from "../../api";
import { useToast } from "../../components/ui/Toast";
import { Input, Button, ProgressBar, ErrorState, Skeleton } from "../../components/ui";
import {
  getMeta, setMeta, getOrCreateDeviceId, countCredentials,
  replaceCredentials, wipeAll, maybeAutoWipe,
} from "../../scanner/credentialStore";
import { getDeviceInfo, setDeviceInfo, clearDeviceInfo } from "../../scanner/deviceAuth";

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
  const [device, setDevice] = useState(() => getDeviceInfo());
  const [enrollCode, setEnrollCode] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [enrollError, setEnrollError] = useState(null);
  const [progress, setProgress] = useState(0);
  const [meta, setMetaState] = useState(null);
  const [credentialCount, setCredentialCount] = useState(0);
  // loading: checking device-enrolment + cached-credential state on mount.
  // enroll: no device token yet — this device must redeem an enrolment
  //   code (Work Order 04 C3) before anything else is reachable.
  // resume: an existing session was found on load | ready: enrolled, no
  //   credentials cached yet | syncing | synced.
  const [phase, setPhase] = useState("loading");
  const timerRef = useRef(null);

  useEffect(() => {
    (async () => {
      const wiped = await maybeAutoWipe();
      const existing = wiped ? null : getMeta();
      const count = wiped ? 0 : await countCredentials();
      setMetaState(existing);
      setCredentialCount(count);

      if (!device) {
        setPhase("enroll");
      } else if (existing && count > 0) {
        setPhase("resume");
      } else {
        setPhase("ready");
      }
    })();
    return () => clearInterval(timerRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- device read once on mount, re-read explicitly after enrol

  async function submitEnrollCode(e) {
    e.preventDefault();
    if (!enrollCode.trim()) return;
    setEnrolling(true);
    setEnrollError(null);
    try {
      const deviceId = getOrCreateDeviceId();
      const res = await api.enrollScanner({ enrollmentCode: enrollCode.trim().toUpperCase(), deviceId });
      const info = setDeviceInfo({
        deviceToken: res.device_token,
        scannerId: res.scanner_id,
        eventId: res.event_id,
        eventTitle: res.event_title,
        gateName: res.gate_name,
      });
      setDevice(info);
      setPhase("ready");
    } catch (err) {
      setEnrollError(err instanceof ApiError ? err.message : "Enrolment failed. Check the code and try again.");
    } finally {
      setEnrolling(false);
    }
  }

  async function startSync() {
    setPhase("syncing");
    setProgress(0);

    const syncPromise = api.syncGateData({ eventId: device.eventId });
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
      setPhase("ready");
    }
  }

  async function startNewSession() {
    await wipeAll();
    setMetaState(null);
    setCredentialCount(0);
    setProgress(0);
    setPhase("ready");
  }

  function unenrollDevice() {
    if (!window.confirm("Remove this device's enrolment? You'll need a new enrolment code to sync again.")) return;
    clearDeviceInfo();
    setDevice(null);
    setPhase("enroll");
  }

  return (
    <div className="min-h-screen flex flex-col px-5 py-8 max-w-md mx-auto">
      <div className="flex items-center gap-2.5 mb-1">
        <span className="h-9 w-9 rounded-md bg-brand-accent flex items-center justify-center text-brand-accent-ink font-black flex-none">C</span>
        <h1 className="text-h2 text-ink-primary font-bold">Scanner</h1>
      </div>
      <p className="text-body-sm text-ink-tertiary mb-8">
        {phase === "enroll" ? "Enter this device's one-time enrolment code." : "Sync this device's gate before doors open."}
      </p>

      {phase === "loading" && (
        <div className="flex flex-col gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      )}

      {phase === "enroll" && (
        <form onSubmit={submitEnrollCode} className="flex flex-col gap-4">
          <div className="rounded-md border border-line-default bg-surface p-4 flex items-center gap-3">
            <Smartphone size={18} className="text-ink-tertiary flex-none" />
            <p className="text-body-sm text-ink-secondary">
              An organiser registers this device for one event and gate, then gives you a code to enter here.
            </p>
          </div>
          <Input
            leadingIcon={<KeyRound size={15} />}
            placeholder="Enrolment code"
            value={enrollCode}
            onChange={(e) => setEnrollCode(e.target.value)}
            error={enrollError}
            disabled={enrolling}
          />
          <Button type="submit" size="lg" disabled={!enrollCode.trim() || enrolling}>
            {enrolling ? "Enrolling…" : "Enrol this device"}
          </Button>
        </form>
      )}

      {phase === "resume" && meta && device && (
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

      {(phase === "ready" || phase === "syncing") && device && (
        <div className="flex flex-col gap-6">
          <div className="rounded-md border border-line-default bg-surface p-4 flex flex-col gap-2.5">
            <p className="text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium">This device is enrolled for</p>
            <p className="text-body font-semibold text-ink-primary">{device.eventTitle}</p>
            <p className="text-caption text-ink-tertiary">{device.gateName}</p>
          </div>

          {phase === "ready" && (
            <Button size="lg" iconLeft={<ScanLine size={18} />} onClick={startSync}>Sync tickets to this device</Button>
          )}

          {phase === "syncing" && (
            <div className="rounded-md border border-line-default bg-surface p-4 flex flex-col gap-3">
              <ProgressBar value={progress} max={100} showPercent tone="brand" ariaLabel="Sync progress" />
              <p className="text-body-sm text-ink-secondary tabular-nums">Pulling cached credentials to this device…</p>
            </div>
          )}

          {phase === "ready" && (
            <button onClick={unenrollDevice} className="text-caption text-ink-tertiary underline text-center">
              Not this device's gate? Remove enrolment
            </button>
          )}
        </div>
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
