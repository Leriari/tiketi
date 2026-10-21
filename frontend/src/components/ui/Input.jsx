import { forwardRef } from "react";
import { cn } from "../../lib/cn";
import Field from "./Field";

const baseInput =
  "w-full h-10 rounded-md bg-surface-inset border border-line px-3 text-body text-ink-primary placeholder:text-ink-tertiary " +
  "hover:border-line-strong focus:outline-none focus:border-brand-primary focus:shadow-glow-focus " +
  "disabled:opacity-50 disabled:cursor-not-allowed transition-[border-color,box-shadow] duration-150";

const Input = forwardRef(function Input({ label, hint, error, required, className, leadingIcon, trailingIcon, ...props }, ref) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {(fieldProps) => (
        <div className="relative">
          {leadingIcon && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary pointer-events-none">{leadingIcon}</span>
          )}
          <input
            ref={ref}
            {...fieldProps}
            className={cn(baseInput, leadingIcon && "pl-9", trailingIcon && "pr-9", error && "border-danger", className)}
            {...props}
          />
          {trailingIcon && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-tertiary">{trailingIcon}</span>}
        </div>
      )}
    </Field>
  );
});

export default Input;
