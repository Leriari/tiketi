import { Inbox } from "lucide-react";
import Button from "./Button";
import { cn } from "../../lib/cn";

/** Spec §2.5: icon, heading, one sentence, a primary action. Never an empty table. */
export default function EmptyState({ icon, title, description, actionLabel, onAction, className }) {
  return (
    <div className={cn("flex flex-col items-center text-center gap-3 py-16 px-6", className)}>
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-elevated text-ink-tertiary">
        {icon || <Inbox size={20} />}
      </span>
      {/* Styled like a heading but deliberately not one — this can land
       * anywhere in a page's heading outline (right after an h1, nested
       * under an h2 section, ...), and a hardcoded level broke that outline
       * wherever it didn't happen to be exactly one level down. */}
      <p className="text-h3 text-ink-primary">{title}</p>
      {description && <p className="text-body-sm text-ink-secondary max-w-sm">{description}</p>}
      {actionLabel && (
        <Button size="sm" onClick={onAction} className="mt-1">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
