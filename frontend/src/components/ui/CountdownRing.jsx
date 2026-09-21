import { cn } from "../../lib/cn";

/**
 * secondsLeft/totalSeconds drive a thin progress arc. Used for the STK-push
 * 60s wait and the 30s ticket-credential refresh. `children` renders centered
 * inside the ring (a number, a QR code, whatever the caller needs).
 */
export default function CountdownRing({ secondsLeft, totalSeconds, size = 64, strokeWidth = 3, tone = "brand", children, className }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(1, secondsLeft / totalSeconds));
  const offset = circumference * (1 - progress);
  const strokeColor = tone === "brand" ? "var(--brand-accent)" : "var(--success)";

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="var(--border-subtle)" strokeWidth={strokeWidth} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-[220ms] ease-panel"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}
