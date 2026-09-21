import { cn } from "../../lib/cn";

/**
 * value/max -> determinate bar. Used for sync progress, capacity-sold bars, etc.
 * ariaLabel: required when there's no visible `label` and no other on-screen
 * text a caller has already tied to this bar via aria-labelledby — a
 * progressbar role with no accessible name is an axe violation.
 */
export default function ProgressBar({ value, max = 100, tone = "brand", label, ariaLabel, showPercent = false, className }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const fill = { brand: "bg-brand-accent", success: "bg-success", danger: "bg-danger" }[tone];

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {(label || showPercent) && (
        <div className="flex items-center justify-between text-caption text-ink-secondary tabular-nums">
          <span>{label}</span>
          {showPercent && <span>{Math.round(pct)}%</span>}
        </div>
      )}
      <div
        className="h-1.5 w-full rounded-full bg-surface-elevated overflow-hidden"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={ariaLabel || label}
      >
        <div className={cn("h-full rounded-full transition-[width] duration-220 ease-panel", fill)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
