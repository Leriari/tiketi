import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useFocusTrap } from "../../lib/useFocusTrap";
import { cn } from "../../lib/cn";

/** dismissible: false → clicking the backdrop / Escape does nothing (STK-push wait uses this). */
export default function Modal({ open, onClose, title, children, footer, dismissible = true, size = "md" }) {
  const ref = useFocusTrap(open, dismissible ? onClose : undefined);
  if (!open) return null;

  const widths = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg" };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-[2px] animate-[fadeIn_150ms_ease-out]"
        onClick={dismissible ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative w-full rounded-lg bg-surface-elevated border border-line shadow-modal p-6 flex flex-col gap-4",
          "animate-[modalIn_220ms_cubic-bezier(0.32,0.72,0,1)]",
          widths[size]
        )}
      >
        {(title || dismissible) && (
          <div className="flex items-center justify-between">
            {title && <h2 className="text-h2 text-ink-primary">{title}</h2>}
            {dismissible && (
              <button onClick={onClose} aria-label="Close" className="text-ink-tertiary hover:text-ink-primary ml-auto">
                <X size={18} />
              </button>
            )}
          </div>
        )}
        <div className="text-body text-ink-secondary">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 pt-2">{footer}</div>}
      </div>
      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes modalIn { from { opacity: 0; transform: translateY(8px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }
      `}</style>
    </div>,
    document.body
  );
}
