import { Check } from "lucide-react";
import { cn } from "../../lib/cn";

/** steps: [{ label }] · activeIndex: 0-based current step. */
export default function TimelineStepper({ steps, activeIndex }) {
  return (
    <ol className="flex items-center w-full">
      {steps.map((step, i) => {
        const done = i < activeIndex;
        const current = i === activeIndex;
        return (
          <li key={step.label} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-caption font-bold tabular-nums transition-colors duration-150",
                  done && "bg-brand-accent text-brand-accent-ink",
                  current && "bg-brand-primary-solid text-white",
                  !done && !current && "bg-surface-elevated text-ink-tertiary border border-line-strong"
                )}
              >
                {done ? <Check size={14} /> : i + 1}
              </span>
              <span className={cn("text-caption whitespace-nowrap", current ? "text-ink-primary font-semibold" : "text-ink-tertiary")}>
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span className={cn("h-px flex-1 mx-2 mb-5", done ? "bg-brand-accent" : "bg-line")} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
