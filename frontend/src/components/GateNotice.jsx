import { DoorOpen } from "lucide-react";
import { cn } from "../lib/cn";

/** The gate a ticket enters by (fixed when it was bought: app/services/gates.py).
 * Shown prominently, since the gate phone at any other gate will turn the
 * holder away. */
export default function GateNotice({ gate, className }) {
  if (!gate) return null;
  return (
    <div className={cn("flex items-center gap-3 rounded-md border border-brand-primary/30 bg-brand-primary/10 px-4 py-3", className)}>
      <DoorOpen size={22} className="flex-none text-brand-primary-on-tint" aria-hidden="true" />
      <div className="min-w-0 text-left">
        <p className="text-label uppercase tracking-[0.06em] font-medium text-ink-tertiary">Enter by</p>
        <p className="text-h3 font-semibold text-ink-primary truncate">{gate}</p>
      </div>
    </div>
  );
}
