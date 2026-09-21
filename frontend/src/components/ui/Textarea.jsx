import { forwardRef } from "react";
import { cn } from "../../lib/cn";
import Field from "./Field";

const Textarea = forwardRef(function Textarea({ label, hint, error, required, className, rows = 4, ...props }, ref) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {(fieldProps) => (
        <textarea
          ref={ref}
          rows={rows}
          {...fieldProps}
          className={cn(
            "w-full rounded-sm bg-surface-inset border border-line px-3 py-2.5 text-body text-ink-primary placeholder:text-ink-tertiary resize-y",
            "focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-brand-primary disabled:opacity-50",
            error && "border-danger",
            className
          )}
          {...props}
        />
      )}
    </Field>
  );
});

export default Textarea;
