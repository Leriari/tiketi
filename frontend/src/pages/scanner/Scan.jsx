import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wifi, WifiOff, CheckCircle2, XCircle, ChevronUp, Trash2, UploadCloud, KeyRound } from "lucide-react";
import { api, ApiError } from "../../api";
import { Button, Input, Drawer, Badge } from "../../components/ui";
import QrCamera from "../../components/QrCamera";
import { validate } from "../../scanner/validate";
import {
  getMeta, countCredentials, countPendingUpload, getAllAdmissions,
  markAdmissionsUploaded, wipeAll,
} from "../../scanner/credentialStore";

const CHECKS = ["Signature verified", "Credential current", "Not previously used", "Correct gate"];
const LOG_LIMIT = 12;

export default function Scan() {
  const navigate = useNavigate();
  const resultRef = useRef(null);
  const processingRef = useRef(false);
  const uploadingRef = useRef(false);

  const [meta, setMeta] = useState(() => getMeta());
  const [credentialCount, setCredentialCount] = useState(0);
  const [pendingUpload, setPendingUpload] = useState(0);
  const [manualCode, setManualCode] = useState("");
  const [result, setResult] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [uploadBanner, setUploadBanner] = useState(null); // { phase: 'uploading'|'done', count }
  const [stats, setStats] = useState({ scannedTotal: 0, admittedTotal: 0, deniedTotal: 0 });
  const [log, setLog] = useState([]);

  useEffect(() => { resultRef.current = result; }, [result]);

  useEffect(() => {
    if (!meta) {
      navigate("/scanner", { replace: true });
      return;
    }
    (async () => {
      setCredentialCount(await countCredentials());
      setPendingUpload(await countPendingUpload());
      // Admissions persist across reloads (IndexedDB) — admittedTotal picks
      // up where this device left off. scanned/denied aren't persisted
      // (no store for them; see credentialStore.js's module comment on
      // scope), so they start at 0 each session.
      const admittedSoFar = (await getAllAdmissions()).length;
      setStats((s) => ({ ...s, admittedTotal: admittedSoFar }));
    })();
  }, [meta, navigate]);

  const applyScan = useCallback(async (rawPayload) => {
    if (resultRef.current || processingRef.current || !meta) return;
    processingRef.current = true;
    try {
      const verdict = await validate(rawPayload, { gateName: meta.gateName });
      const entry = {
        ticketId: verdict.ticketId || null,
        tierName: verdict.tierName || null,
        granted: verdict.granted,
        reason: verdict.reason || null,
        at: verdict.scannedAt || new Date().toISOString(),
      };
      setResult({ granted: verdict.granted, reason: verdict.reason, ticketId: entry.ticketId, tierName: entry.tierName, gateName: meta.gateName, at: entry.at });
      setLog((l) => [entry, ...l].slice(0, LOG_LIMIT));
      setStats((s) => ({
        scannedTotal: s.scannedTotal + 1,
        admittedTotal: s.admittedTotal + (verdict.granted ? 1 : 0),
        deniedTotal: s.deniedTotal + (verdict.granted ? 0 : 1),
      }));
      if (verdict.granted) setPendingUpload((p) => p + 1);
      if (navigator.vibrate) navigator.vibrate(verdict.granted ? 200 : [200, 100, 200]);
    } finally {
      processingRef.current = false;
    }
  }, [meta]);

  // Auto-dismiss a grant after 2.5s; a denial requires an explicit tap (never auto-dismiss).
  useEffect(() => {
    if (result?.granted) {
      const t = setTimeout(() => setResult(null), 2500);
      return () => clearTimeout(t);
    }
  }, [result]);

  const uploadPending = useCallback(async () => {
    if (!meta || !navigator.onLine || uploadingRef.current) return;
    const admissions = (await getAllAdmissions()).filter((a) => !a.uploaded);
    if (admissions.length === 0) return;
    uploadingRef.current = true;
    setUploadBanner({ phase: "uploading", count: admissions.length });
    try {
      await api.reportScanBatch({
        eventId: meta.eventId,
        gateId: meta.scannerId,
        scannerId: meta.deviceId,
        scans: admissions.map((a) => ({ ticket_id: a.ticket_id, scanned_at: a.scanned_at })),
      });
      await markAdmissionsUploaded(admissions.map((a) => a.ticket_id));
      setPendingUpload(await countPendingUpload());
      setUploadBanner({ phase: "done", count: admissions.length });
      setTimeout(() => setUploadBanner(null), 2000);
    } catch (err) {
      // Nothing is lost: the admissions stay queued (uploaded: false) and
      // go up with the next attempt.
      setUploadBanner(null);
      console.error("Scan batch upload failed:", err instanceof ApiError ? err.message : err);
    } finally {
      uploadingRef.current = false;
    }
  }, [meta]);

  // Admissions go up by themselves whenever there's a connection: when
  // it comes back, and when the scanner opens online with some queued.
  useEffect(() => {
    if (online) uploadPending();
  }, [online, uploadPending]);

  useEffect(() => {
    function goOnline() { setOnline(true); }
    function goOffline() { setOnline(false); }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  function manualSubmit(e) {
    e.preventDefault();
    if (!manualCode.trim()) return;
    applyScan(manualCode.trim());
    setManualCode("");
  }

  async function endSession() {
    if (!window.confirm("Clear cached credentials from this device? You'll need to sync again before scanning.")) return;
    await wipeAll();
    navigate("/scanner", { replace: true });
  }

  if (!meta) return null;

  return (
    <div className="min-h-screen flex flex-col bg-surface-base">
      <h1 className="sr-only">Live QR Scanner — {meta.gateName}</h1>
      {/* Persistent header — spec §6.2 */}
      <div className="flex-none flex items-center justify-between px-4 h-16 border-b border-line-subtle">
        <div>
          <p className="text-body font-semibold text-ink-primary">{meta.gateName}</p>
          <p className="text-caption text-ink-tertiary tabular-nums">{stats.admittedTotal} admitted</p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-caption font-semibold ${online ? "bg-info-bg text-info-on-tint" : "bg-success-bg text-success-on-tint"}`}
        >
          {online ? <Wifi size={13} /> : <WifiOff size={13} />}
          {online ? "Online" : "Offline — validation active"}
        </span>
      </div>

      {uploadBanner && (
        <div className="flex-none flex items-center justify-center gap-2 bg-info-bg text-info-on-tint text-caption font-semibold py-2">
          <UploadCloud size={13} />
          {uploadBanner.phase === "uploading" ? `Uploading ${uploadBanner.count} scan${uploadBanner.count === 1 ? "" : "s"}…` : "Upload complete ✓"}
        </div>
      )}

      {/* Viewfinder — upper half (spec §6.2). Scanning runs entirely against
          the local cache (applyScan -> validate.js -> credentialStore.js), no network. */}
      <QrCamera onDecode={applyScan} paused={Boolean(result)} className="flex-none h-[52vh]" />

      {/* Manual entry — always available, primary fallback when the camera can't be used */}
      <div className="flex-1 flex flex-col justify-between px-4 py-4">
        <form onSubmit={manualSubmit} className="flex gap-2">
          <Input aria-label="Ticket code" leadingIcon={<KeyRound size={15} />} value={manualCode} onChange={(e) => setManualCode(e.target.value)} placeholder="Enter code manually" className="flex-1" />
          <Button type="submit" disabled={!manualCode.trim()} className="w-auto px-5">Check</Button>
        </form>

        <button
          onClick={() => setDrawerOpen(true)}
          className="mt-4 flex items-center justify-center gap-1.5 text-body-sm font-semibold text-ink-secondary min-h-[48px]"
        >
          <ChevronUp size={16} /> Session — {stats.scannedTotal} scanned, {pendingUpload} pending upload
        </button>
      </div>

      {/* Result takeover — spec §6.3 */}
      {result && (
        <div
          role="alert"
          aria-live="assertive"
          className={`fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 px-8 text-center ${result.granted ? "bg-success" : "bg-danger"}`}
          onClick={() => { if (!result.granted) setResult(null); }}
        >
          {result.granted ? <CheckCircle2 size={88} className="text-white" /> : <XCircle size={88} className="text-white" />}
          <h1 className="text-display text-white font-bold">{result.granted ? "ACCESS GRANTED" : "ACCESS DENIED"}</h1>

          {result.granted ? (
            <>
              <p className="text-h3 text-white/90">{result.tierName || "General"} · {result.gateName} · {new Date(result.at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</p>
              <div className="flex flex-col gap-1.5 mt-2">
                {CHECKS.map((c) => (
                  <p key={c} className="text-body text-white/90">{c} ✓</p>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="text-h2 text-white font-semibold">{result.reason}</p>
              <button type="button" className="mt-4 min-h-[48px] rounded-md border-2 border-white px-8 text-body font-semibold text-white hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" onClick={(e) => { e.stopPropagation(); setResult(null); }}>
                Dismiss
              </button>
            </>
          )}
        </div>
      )}

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} side="bottom" title="Session">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-metric font-bold text-ink-primary tabular-nums">{stats.scannedTotal}</p>
              <p className="text-caption text-ink-tertiary">Scanned</p>
            </div>
            <div>
              <p className="text-metric font-bold text-success tabular-nums">{stats.admittedTotal}</p>
              <p className="text-caption text-ink-tertiary">Admitted</p>
            </div>
            <div>
              <p className="text-metric font-bold text-danger tabular-nums">{stats.deniedTotal}</p>
              <p className="text-caption text-ink-tertiary">Denied</p>
            </div>
          </div>

          <p className="text-caption text-ink-tertiary text-center">{credentialCount} credentials cached on this device</p>

          <div className="flex items-center justify-between rounded-md border border-line-default px-3 py-2.5">
            <span className="text-body-sm text-ink-secondary">{pendingUpload} pending upload{pendingUpload === 1 ? "" : "s"}</span>
            <Badge tone={online ? "info" : "warning"}>{online ? "Online" : "Offline"}</Badge>
          </div>

          {pendingUpload > 0 && (
            <Button variant="secondary" iconLeft={<UploadCloud size={15} />} onClick={uploadPending} disabled={!online}>
              {online ? "Upload now" : "Upload unavailable offline"}
            </Button>
          )}

          {log.length > 0 && (
            <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
              {log.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-body-sm">
                  <span className={r.granted ? "text-success font-medium" : "text-danger font-medium"}>{r.granted ? "Granted" : "Denied"}</span>
                  <span className="text-caption text-ink-tertiary tabular-nums">{new Date(r.at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              ))}
            </div>
          )}

          <Button variant="danger" iconLeft={<Trash2 size={15} />} onClick={endSession}>End session &amp; clear device</Button>
        </div>
      </Drawer>
    </div>
  );
}
