import { forwardRef, useId } from "react";
import { Check } from "lucide-react";
import { cn } from "../../lib/cn";

const Checkbox = forwardRef(function Checkbox({ label, checked, onChange, className, ...props }, ref) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("flex items-start gap-2.5 cursor-pointer select-none", className)}>
      <span className="relative flex-none mt-0.5">
        <input
          ref={ref}
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange?.(e.target.checked)}
          className="peer sr-only"
          {...props}
        />
        <span
          className={cn(
            "flex h-[18px] w-[18px] items-center justify-center rounded-[4px] border transition-colors duration-150",
            "border-line-strong bg-surface-inset peer-checked:bg-brand-accent peer-checked:border-brand-accent",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-brand-primary peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface-base"
          )}
        >
          {checked && <Check size={13} strokeWidth={3} className="text-brand-accent-ink" />}
        </span>
      </span>
      {label && <span className="text-body-sm text-ink-secondary">{label}</span>}
    </label>
  );
});

export default Checkbox;
