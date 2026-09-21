import { forwardRef } from "react";
import { Calendar } from "lucide-react";
import { cn } from "../../lib/cn";
import Field from "./Field";

// Native date/datetime-local input, styled to match the system. Gives correct
// mobile keyboards, locale formatting and a11y for free — a fully custom
// calendar widget buys nothing the spec asks for over this.
const DatePicker = forwardRef(function DatePicker({ label, hint, error, required, className, withTime = false, ...props }, ref) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {(fieldProps) => (
        <div className="relative">
          <input
            ref={ref}
            type={withTime ? "datetime-local" : "date"}
            {...fieldProps}
            className={cn(
              // color-scheme is inherited from <html data-theme> (set in tokens.css),
              // which is what actually themes the native calendar-picker icon.
              "w-full h-10 rounded-sm bg-surface-inset border border-line pl-9 pr-3 text-body text-ink-primary",
              "focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-brand-primary disabled:opacity-50",
              error && "border-danger",
              className
            )}
            {...props}
          />
          <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary pointer-events-none" />
        </div>
      )}
    </Field>
  );
});

export default DatePicker;
