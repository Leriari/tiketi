import { AlertTriangle, WifiOff } from "lucide-react";
import Button from "./Button";
import { cn } from "../../lib/cn";

/** Spec §2.5: what failed, why if known, Try again. Network errors also offer Work offline. */
export default function ErrorState({ title = "Something went wrong", description, onRetry, onWorkOffline, className }) {
  return (
    <div className={cn("flex flex-col items-center text-center gap-3 py-16 px-6", className)}>
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-danger-bg text-danger-on-tint">
        <AlertTriangle size={20} />
      </span>
      {/* See EmptyState for why this is a styled <p>, not a real heading. */}
      <p className="text-h3 text-ink-primary">{title}</p>
      {description && <p className="text-body-sm text-ink-secondary max-w-sm">{description}</p>}
      <div className="flex items-center gap-2 mt-1">
        {onRetry && (
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
        {onWorkOffline && (
          <Button size="sm" variant="secondary" iconLeft={<WifiOff size={14} />} onClick={onWorkOffline}>
            Work offline
          </Button>
        )}
      </div>
    </div>
  );
}
