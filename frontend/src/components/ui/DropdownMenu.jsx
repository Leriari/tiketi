import { cloneElement, useRef, useState } from "react";
import {
  useFloating, useClick, useDismiss, useRole, useInteractions, useListNavigation,
  offset, flip, shift, FloatingPortal, FloatingFocusManager,
} from "@floating-ui/react";
import { cn } from "../../lib/cn";

/** items: [{ label, icon, onClick, danger, disabled }] — used for row action menus, user menu, etc. */
export default function DropdownMenu({ trigger, items, placement = "bottom-end" }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(null);
  const listRef = useRef([]);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    middleware: [offset(6), flip(), shift({ padding: 8 })],
  });

  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: "menu" }),
    useListNavigation(context, { listRef, activeIndex, onNavigate: setActiveIndex }),
  ]);

  return (
    <>
      {/* aria-expanded/aria-haspopup must land on the actual interactive
       * element (the trigger button), not a wrapping <span> — a span has no
       * role that allows those attributes, which axe flags as a violation. */}
      {cloneElement(trigger, { ref: refs.setReference, ...getReferenceProps(trigger.props) })}
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              {...getFloatingProps()}
              className="z-50 min-w-[180px] rounded-md bg-surface-elevated border border-line-subtle shadow-modal p-1"
            >
              {items.map((item, i) => (
                <button
                  key={item.label}
                  ref={(node) => (listRef.current[i] = node)}
                  type="button"
                  disabled={item.disabled}
                  {...getItemProps({
                    onClick() {
                      item.onClick?.();
                      setOpen(false);
                    },
                  })}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-body-sm text-left transition-colors duration-150",
                    "hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed",
                    item.danger ? "text-danger" : "text-ink-primary"
                  )}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
