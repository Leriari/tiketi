import { ArrowRight } from "lucide-react";

/** value: { from, to } (ISO date strings) · onChange({ from, to }) */
export default function DateRangePicker({ value, onChange, label }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className="text-label uppercase tracking-[0.06em] font-medium text-ink-tertiary">{label}</span>}
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={value?.from || ""}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
          className="h-10 rounded-sm bg-surface-inset border border-line px-3 text-body text-ink-primary focus:outline-none focus:ring-2 focus:ring-brand-primary"
        />
        <ArrowRight size={14} className="text-ink-tertiary flex-none" />
        <input
          type="date"
          value={value?.to || ""}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
          className="h-10 rounded-sm bg-surface-inset border border-line px-3 text-body text-ink-primary focus:outline-none focus:ring-2 focus:ring-brand-primary"
        />
      </div>
    </div>
  );
}
