import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import jsQR from "jsqr";
import { Wifi, WifiOff, CheckCircle2, XCircle, ChevronUp, Trash2, UploadCloud, KeyRound } from "lucide-react";
import { api } from "../../api";
import { useToast } from "../../components/ui/Toast";
import { Button, Input, Drawer, Badge } from "../../components/ui";
import { loadSession, saveSession, scanOffline, markUploaded, clearSession } from "../../scanner/offlineStore";

const CHECKS = ["Signature verified", "Credential current", "Not previously used", "Correct gate"];

export default function Scan() {
  const navigate = useNavigate();
  const toast = useToast();
  const videoRef = useRef(null);
  const canvasRef = useRef(document.createElement("canvas"));
  const rafRef = useRef(null);
  const resultRef = useRef(null);
  const sessionRef = useRef(null);
  const uploadingRef = useRef(false);

  const [session, setSession] = useState(() => loadSession());
  const [cameraState, setCameraState] = useState("requesting"); // requesting | active | denied | unavailable
  const [manualCode, setManualCode] = useState("");
  const [result, setResult] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [uploadBanner, setUploadBanner] = useState(null); // { phase: 'uploading'|'done', count }

  useEffect(() => { resultRef.current = result; }, [result]);
  useEffect(() => { sessionRef.current = session; }, [session]);

  useEffect(() => {
    if (!session) navigate("/scanner", { replace: true });
  }, [session, navigate]);

  const applyScan = useCallback((rawPayload) => {
    if (resultRef.current || !sessionRef.current) return;
    const { session: next, entry, granted, reason, tierName } = scanOffline(sessionRef.current, rawPayload);
    saveSession(next);
    setSession({ ...next });
    setResult({ granted, reason, ticketId: entry.ticket_id, tierName, gateName: next.gateName, at: entry.scanned_at });
    if (navigator.vibrate) navigator.vibrate(granted ? 200 : [200, 100, 200]);
  }, []);

  // Camera viewfinder — spec §6.2. Falls back to manual entry if unavailable;
  // scanning runs entirely against the local cache (applyScan), no network.
  useEffect(() => {
    let stream;
    let cancelled = false;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraState("active");
        tick();
      } catch {
        if (!cancelled) setCameraState(navigator.mediaDevices ? "denied" : "unavailable");
      }
    }

    function tick() {
      rafRef.current = requestAnimationFrame(tick);
      const video = videoRef.current;
      if (!video || video.readyState !== video.HAVE_ENOUGH_DATA || resultRef.current) return;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(frame.data, frame.width, frame.height);
      if (code?.data) applyScan(code.data);
    }

    start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [applyScan]);

  // Auto-dismiss a grant after 2.5s; a denial requires an explicit tap (never auto-dismiss).
  useEffect(() => {
    if (result?.granted) {
      const t = setTimeout(() => setResult(null), 2500);
      return () => clearTimeout(t);
    }
  }, [result]);

  const uploadPending = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || current.pending.length === 0 || !navigator.onLine || uploadingRef.current) return;
    uploadingRef.current = true;
    const count = current.pending.length;
    setUploadBanner({ phase: "uploading", count });
    try {
      await api.reportScanBatch({ eventId: current.eventId, gateId: current.gateId, scannerId: current.scannerId, scans: current.pending });
      const next = markUploaded({ ...current, pending: [...current.pending] });
      saveSession(next);
      setSession(next);
      setUploadBanner({ phase: "done", count });
      setTimeout(() => setUploadBanner(null), 2000);
    } catch {
      setUploadBanner(null);
    } finally {
      uploadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    function goOnline() { setOnline(true); uploadPending(); }
    function goOffline() { setOnline(false); }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [uploadPending]);

  // A gate stays connected to WiFi/LTE for the whole event in the common
  // case — reconcile periodically whenever online, not only on the
  // offline→online transition edge (that alone would strand pending scans
  // for a device that was never actually disconnected).
  useEffect(() => {
    uploadPending();
    const id = setInterval(uploadPending, 5000);
    return () => clearInterval(id);
  }, [uploadPending]);

  function manualSubmit(e) {
    e.preventDefault();
    if (!manualCode.trim()) return;
    applyScan(manualCode.trim());
    setManualCode("");
  }

  function endSession() {
    if (!window.confirm("Clear cached credentials from this device? You'll need to sync again before scanning.")) return;
    clearSession();
    navigate("/scanner", { replace: true });
  }

  if (!session) return null;

  return (
    <div className="min-h-screen flex flex-col bg-surface-base">
      <h1 className="sr-only">Live QR Scanner — {session.gateName}</h1>
      {/* Persistent header — spec §6.2 */}
      <div className="flex-none flex items-center justify-between px-4 h-16 border-b border-line-subtle">
        <div>
          <p className="text-body font-semibold text-ink-primary">{session.gateName}</p>
          <p className="text-caption text-ink-tertiary tabular-nums">{session.admittedTotal} admitted</p>
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

      {/* Viewfinder — upper half */}
      <div className="relative flex-none h-[52vh] bg-black overflow-hidden">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        {cameraState === "active" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="h-56 w-56 rounded-lg border-4 border-white/80" />
            <p className="mt-4 text-body-sm font-medium text-white/90 bg-black/40 px-3 py-1 rounded-full">Align QR code within frame</p>
          </div>
        )}
        {cameraState === "requesting" && (
          <div className="absolute inset-0 flex items-center justify-center text-body-sm text-white/70">Requesting camera…</div>
        )}
        {(cameraState === "denied" || cameraState === "unavailable") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-6 text-center">
            <p className="text-body font-semibold text-white">Camera unavailable</p>
            <p className="text-body-sm text-white/70">Enter the ticket code manually below.</p>
          </div>
        )}
      </div>

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
          <ChevronUp size={16} /> Session — {session.scannedTotal} scanned, {session.pending.length} pending upload
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
              <Button variant="secondary" size="lg" className="mt-4 w-auto px-8 border-white text-white" onClick={(e) => { e.stopPropagation(); setResult(null); }}>
                Dismiss
              </Button>
            </>
          )}
        </div>
      )}

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} side="bottom" title="Session">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-metric font-bold text-ink-primary tabular-nums">{session.scannedTotal}</p>
              <p className="text-caption text-ink-tertiary">Scanned</p>
            </div>
            <div>
              <p className="text-metric font-bold text-success tabular-nums">{session.admittedTotal}</p>
              <p className="text-caption text-ink-tertiary">Admitted</p>
            </div>
            <div>
              <p className="text-metric font-bold text-danger tabular-nums">{session.deniedTotal}</p>
              <p className="text-caption text-ink-tertiary">Denied</p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-line-default px-3 py-2.5">
            <span className="text-body-sm text-ink-secondary">{session.pending.length} pending upload{session.pending.length === 1 ? "" : "s"} · {session.uploadedCount} uploaded</span>
            <Badge tone={online ? "info" : "warning"}>{online ? "Online" : "Offline"}</Badge>
          </div>

          {session.pending.length > 0 && (
            <Button variant="secondary" iconLeft={<UploadCloud size={15} />} onClick={uploadPending} disabled={!online}>
              {online ? "Upload now" : "Upload unavailable offline"}
            </Button>
          )}

          {session.log.length > 0 && (
            <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
              {session.log.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-body-sm">
                  <span className={r.result === "granted" ? "text-success font-medium" : "text-danger font-medium"}>{r.result === "granted" ? "Granted" : "Denied"}</span>
                  <span className="text-caption text-ink-tertiary tabular-nums">{new Date(r.scanned_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</span>
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
