import { useState } from "react";
import { useFloating, useClick, useDismiss, useRole, useInteractions, offset, flip, shift, FloatingPortal, FloatingFocusManager } from "@floating-ui/react";

/** Click-triggered panel that can hold interactive content (filters, mini-forms). */
export default function Popover({ trigger, children, placement = "bottom-start", open: controlledOpen, onOpenChange }) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    middleware: [offset(6), flip(), shift({ padding: 8 })],
  });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context),
  ]);

  return (
    <>
      <span ref={refs.setReference} {...getReferenceProps()} className="inline-flex">
        {trigger}
      </span>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              {...getFloatingProps()}
              className="z-50 min-w-[220px] rounded-md bg-surface-elevated border border-line-subtle shadow-modal p-3"
            >
              {children}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
