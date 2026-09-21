import { useId } from "react";
import { cn } from "../../lib/cn";

/**
 * Shared label/hint/error chrome for Input, Select, Textarea, DatePicker —
 * spec §8.6: "Form inputs have associated labels, not placeholders as labels."
 * Renders its children as a function so the wrapped control gets a real,
 * connected id/aria-describedby without every input re-implementing this.
 */
export default function Field({ label, hint, error, required, className, children }) {
  const autoId = useId();
  const hintId = hint ? `${autoId}-hint` : undefined;
  const errorId = error ? `${autoId}-error` : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={autoId} className="text-label uppercase tracking-[0.06em] font-medium text-ink-tertiary">
          {label}
          {required && <span className="text-danger"> *</span>}
        </label>
      )}
      {children({ id: autoId, "aria-describedby": errorId || hintId, "aria-invalid": Boolean(error) })}
      {hint && !error && (
        <span id={hintId} className="text-caption text-ink-tertiary">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} role="alert" aria-live="polite" className="text-caption text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
