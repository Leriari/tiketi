import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";
import { cn } from "../../lib/cn";

const ToastContext = createContext(null);

const ICONS = { success: CheckCircle2, danger: XCircle, info: Info };
const TONE = { success: "text-success", danger: "text-danger", info: "text-info" };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback(
    (message, { tone = "info", duration = 4000 } = {}) => {
      const id = crypto.randomUUID();
      setToasts((t) => [...t, { id, message, tone }]);
      if (duration) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss]
  );

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-full max-w-sm" aria-live="polite">
          {toasts.map((t) => {
            const Icon = ICONS[t.tone];
            return (
              <div
                key={t.id}
                className="flex items-start gap-2.5 rounded-md border border-line-subtle bg-surface-elevated shadow-modal px-4 py-3 animate-[toastIn_150ms_ease-out]"
              >
                <Icon size={18} className={cn("flex-none mt-0.5", TONE[t.tone])} />
                <span className="text-body-sm text-ink-primary flex-1">{t.message}</span>
                <button onClick={() => dismiss(t.id)} className="text-ink-tertiary hover:text-ink-primary" aria-label="Dismiss">
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>,
        document.body
      )}
      <style>{`@keyframes toastIn { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: translateY(0) } }`}</style>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
