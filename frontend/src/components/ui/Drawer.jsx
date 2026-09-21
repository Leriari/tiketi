import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useFocusTrap } from "../../lib/useFocusTrap";
import { cn } from "../../lib/cn";

const AXIS = {
  left: { pos: "absolute top-0 bottom-0 left-0 border-r", dim: "width", from: "translateX(-100%)" },
  right: { pos: "absolute top-0 bottom-0 right-0 border-l", dim: "width", from: "translateX(100%)" },
  bottom: { pos: "absolute left-0 right-0 bottom-0 border-t rounded-t-lg", dim: "height", from: "translateY(100%)" },
};

/**
 * side: 'left' (off-canvas nav on mobile) | 'right' (filter/detail drawers)
 * | 'bottom' (mobile sheets — sticky purchase panel, explainer sheets, PWA install prompt).
 */
export default function Drawer({ open, onClose, side = "left", title, children, width = "300px", height = "auto" }) {
  const ref = useFocusTrap(open, onClose);
  if (!open) return null;

  const axis = AXIS[side];
  const sizeStyle = side === "bottom" ? { maxHeight: "85vh" } : { width, maxWidth: "88vw" };
  if (side === "bottom") sizeStyle.height = height;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn("bg-surface border-line-subtle flex flex-col", "animate-[drawerIn_220ms_cubic-bezier(0.32,0.72,0,1)]", axis.pos)}
        style={sizeStyle}
      >
        {side === "bottom" && <div className="mx-auto mt-2.5 h-1 w-9 flex-none rounded-full bg-line-strong" aria-hidden="true" />}
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-line-subtle">
            <h2 className="text-h3 text-ink-primary">{title}</h2>
            <button onClick={onClose} aria-label="Close" className="text-ink-tertiary hover:text-ink-primary">
              <X size={18} />
            </button>
          </div>
        )}
        <div className={cn("flex-1 overflow-y-auto", side === "bottom" ? "p-5 pb-6" : "p-5")}>{children}</div>
      </div>
      <style>{`@keyframes drawerIn { from { transform: ${axis.from} } to { transform: translate(0,0) } }`}</style>
    </div>,
    document.body
  );
}
