import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { cn } from "../../lib/cn";
import Skeleton from "./Skeleton";

/** Generates a QR client-side from `value`. Spec: minimum 240px. */
export default function QRDisplay({ value, size = 240, className }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!value) return;
    QRCode.toDataURL(value, { margin: 1, width: size * 2, color: { dark: "#0a0a0f", light: "#ffffff" } }).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  return (
    <div
      className={cn("flex items-center justify-center rounded-lg bg-white p-3", className)}
      style={{ width: size + 24, height: size + 24 }}
    >
      {url ? (
        <img src={url} alt="Ticket QR code" width={size} height={size} style={{ width: size, height: size }} />
      ) : (
        <Skeleton style={{ width: size, height: size }} />
      )}
    </div>
  );
}
