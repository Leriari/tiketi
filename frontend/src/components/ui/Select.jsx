import { forwardRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/cn";
import Field from "./Field";

// A styled native <select> — full keyboard/screen-reader support for free,
// far less code than a custom listbox, and the spec never asks for anything
// a native select can't do (no multi-select, no search-within-list).
const Select = forwardRef(function Select({ label, hint, error, required, className, children, ...props }, ref) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {(fieldProps) => (
        <div className="relative">
          <select
            ref={ref}
            {...fieldProps}
            className={cn(
              "w-full h-10 rounded-sm bg-surface-inset border border-line pl-3 pr-9 text-body text-ink-primary appearance-none",
              "focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-brand-primary disabled:opacity-50",
              error && "border-danger",
              className
            )}
            {...props}
          >
            {children}
          </select>
          <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-tertiary pointer-events-none" />
        </div>
      )}
    </Field>
  );
});

export default Select;
