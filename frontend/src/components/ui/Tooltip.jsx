import { useState } from "react";
import {
  useFloating, useHover, useFocus, useDismiss, useRole, useInteractions,
  offset, flip, shift, FloatingPortal, arrow,
} from "@floating-ui/react";
import { useRef } from "react";

export default function Tooltip({ content, children, side = "top" }) {
  const [open, setOpen] = useState(false);
  const arrowRef = useRef(null);

  const { refs, floatingStyles, context, middlewareData, placement } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: side,
    middleware: [offset(8), flip(), shift({ padding: 8 }), arrow({ element: arrowRef })],
  });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { move: false }),
    useFocus(context),
    useDismiss(context),
    useRole(context, { role: "tooltip" }),
  ]);

  const side_ = placement.split("-")[0];
  const staticSide = { top: "bottom", right: "left", bottom: "top", left: "right" }[side_];

  return (
    <>
      <span ref={refs.setReference} {...getReferenceProps()} className="inline-flex">
        {children}
      </span>
      {open && content && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 rounded-sm bg-surface-elevated border border-line px-2.5 py-1.5 text-caption text-ink-primary shadow-modal max-w-xs"
          >
            {content}
            <div
              ref={arrowRef}
              className="absolute h-2 w-2 rotate-45 bg-surface-elevated border-line"
              style={{
                left: middlewareData.arrow?.x,
                top: middlewareData.arrow?.y,
                [staticSide]: "-4px",
              }}
            />
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
