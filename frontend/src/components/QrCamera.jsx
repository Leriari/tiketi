import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { cn } from "../lib/cn";

const SCAN_INTERVAL_MS = 120; // ~8 decodes a second is plenty, and spares older phones
const MAX_DECODE_WIDTH = 640; // decoding a downscaled frame is several times faster

/**
 * Rear-camera QR viewfinder. Calls onDecode(text) for each QR it reads
 * while `paused` is false. Uses the browser's own BarcodeDetector where it
 * exists (Chrome on Android), jsQR everywhere else (Safari).
 *
 * The camera needs HTTPS (or localhost) and the person's permission;
 * onStateChange reports requesting | active | denied | unavailable so the
 * page can offer typed entry instead.
 */
export default function QrCamera({ onDecode, paused = false, onStateChange, className, children }) {
  const videoRef = useRef(null);
  const onDecodeRef = useRef(onDecode);
  const pausedRef = useRef(paused);
  const [state, setState] = useState("requesting");

  useEffect(() => { onDecodeRef.current = onDecode; }, [onDecode]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { onStateChange?.(state); }, [state, onStateChange]);

  useEffect(() => {
    let stream;
    let timer;
    let cancelled = false;
    const canvas = document.createElement("canvas");
    const detector = "BarcodeDetector" in window ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;

    async function decode(video) {
      if (detector) {
        try {
          const codes = await detector.detect(video);
          return codes[0]?.rawValue || null;
        } catch {
          // Fall through to jsQR for this frame.
        }
      }
      const scale = Math.min(1, MAX_DECODE_WIDTH / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "dontInvert" })?.data || null;
    }

    async function loop() {
      const video = videoRef.current;
      if (!cancelled && video && !pausedRef.current && video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth) {
        const text = await decode(video);
        if (text && !cancelled && !pausedRef.current) onDecodeRef.current?.(text);
      }
      if (!cancelled) timer = setTimeout(loop, SCAN_INTERVAL_MS);
    }

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState("unavailable");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setState("active");
        loop();
      } catch (err) {
        if (!cancelled) setState(err?.name === "NotFoundError" || err?.name === "OverconstrainedError" ? "unavailable" : "denied");
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className={cn("relative bg-black overflow-hidden", className)}>
      <video ref={videoRef} className="h-full w-full object-cover" muted playsInline aria-hidden="true" />
      {state === "active" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="h-56 w-56 max-h-[70%] max-w-[70%] aspect-square rounded-lg border-4 border-white/80" />
          <p className="mt-4 text-body-sm font-medium text-white/90 bg-black/40 px-3 py-1 rounded-full">Align QR code within frame</p>
        </div>
      )}
      {state === "requesting" && (
        <div className="absolute inset-0 flex items-center justify-center text-body-sm text-white/70">Requesting camera…</div>
      )}
      {(state === "denied" || state === "unavailable") && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-6 text-center">
          <p className="text-body font-semibold text-white">{state === "denied" ? "Camera access is blocked" : "No camera found"}</p>
          <p className="text-body-sm text-white/70">
            {state === "denied"
              ? "Allow camera access for this site in your browser settings, then reload. Or type the ticket code below."
              : "Type the ticket code below instead."}
          </p>
        </div>
      )}
      {children}
    </div>
  );
}
