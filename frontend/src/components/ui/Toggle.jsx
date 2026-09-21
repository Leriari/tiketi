import { useId } from "react";
import { cn } from "../../lib/cn";

/** Lime when on, per spec (e.g. "Enable Resale toggle — lime when on"). */
export default function Toggle({ checked, onChange, label, hint, disabled, className }) {
  const id = useId();
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      {(label || hint) && (
        <div className="flex flex-col">
          {label && (
            <label htmlFor={id} className="text-body font-medium text-ink-primary cursor-pointer">
              {label}
            </label>
          )}
          {hint && <span className="text-body-sm text-ink-secondary">{hint}</span>}
        </div>
      )}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 flex-none items-center rounded-full transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed",
          checked ? "bg-brand-accent" : "bg-surface-elevated border border-line-strong"
        )}
      >
        <span
          className={cn(
            "inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow transition-transform duration-150",
            checked ? "translate-x-6" : "translate-x-1"
          )}
          style={{ height: 18, width: 18 }}
        />
      </button>
    </div>
  );
}
