import { ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "../../lib/cn";
import Card from "./Card";

/**
 * label / value / icon / delta ({ value, direction: 'up'|'down' }) / hint.
 * `emphasised`: use for the single most important metric on a page, never more than one.
 */
export default function StatCard({ label, value, icon, delta, hint, emphasised = false, className }) {
  return (
    <Card emphasised={emphasised} className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-start justify-between">
        <span className="text-label uppercase tracking-[0.06em] font-medium text-ink-tertiary">{label}</span>
        {icon && <span className="text-ink-tertiary">{icon}</span>}
      </div>
      <span className="text-metric font-bold tabular-nums text-ink-primary">{value}</span>
      {delta && (
        <span className={cn("inline-flex items-center gap-1 text-body-sm font-medium", delta.direction === "up" ? "text-success" : "text-danger")}>
          {delta.direction === "up" ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
          {delta.value}
        </span>
      )}
      {hint && <span className="text-caption text-ink-tertiary">{hint}</span>}
    </Card>
  );
}
