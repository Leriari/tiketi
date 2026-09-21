import { useEffect, useRef } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/** Traps Tab focus inside `ref` while `active`, restores focus to whatever was
 * focused beforehand on close — spec §8.6: "Modals trap focus and restore it
 * on close." Also closes on Escape via `onClose`. */
export function useFocusTrap(active, onClose) {
  const ref = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!active) return;
    previouslyFocused.current = document.activeElement;
    const node = ref.current;
    const focusables = node?.querySelectorAll(FOCUSABLE);
    focusables?.[0]?.focus();

    function handleKeyDown(e) {
      if (e.key === "Escape") {
        onClose?.();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused.current?.focus?.();
    };
  }, [active, onClose]);

  return ref;
}
