import { useId } from "react";
import { cn } from "../../lib/cn";

/** options: [{ value, label, hint, disabled }] */
export default function RadioGroup({ label, options, value, onChange, name, className }) {
  const groupId = useId();
  const groupName = name || groupId;
  return (
    <div className={cn("flex flex-col gap-2", className)} role="radiogroup" aria-label={label}>
      {label && <span className="text-label uppercase tracking-[0.06em] font-medium text-ink-tertiary">{label}</span>}
      {options.map((opt) => (
        <label
          key={opt.value}
          className={cn(
            "flex items-start gap-2.5 cursor-pointer select-none rounded-sm",
            opt.disabled && "opacity-40 cursor-not-allowed"
          )}
        >
          <span className="relative flex-none mt-0.5">
            <input
              type="radio"
              name={groupName}
              value={opt.value}
              checked={value === opt.value}
              disabled={opt.disabled}
              onChange={() => onChange(opt.value)}
              className="peer sr-only"
            />
            <span
              className={cn(
                "flex h-[18px] w-[18px] items-center justify-center rounded-full border transition-colors duration-150",
                "border-line-strong bg-surface-inset peer-checked:border-brand-accent",
                "peer-focus-visible:ring-2 peer-focus-visible:ring-brand-primary peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface-base"
              )}
            >
              {value === opt.value && <span className="h-2.5 w-2.5 rounded-full bg-brand-accent" />}
            </span>
          </span>
          <span className="flex flex-col">
            <span className="text-body-sm text-ink-primary font-medium">{opt.label}</span>
            {opt.hint && <span className="text-caption text-ink-tertiary">{opt.hint}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}
