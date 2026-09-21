import { clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge doesn't know our custom fontSize scale (tailwind.config.js
// — display/h1/h2/h3/body/body-sm/label/metric/caption). Without this, it
// guesses "text-body", "text-h3" etc. belong to the *text-color* group (since
// it only recognizes stock size keywords like sm/lg/xl), so whichever of a
// color class or a size class comes last silently deletes the other —
// e.g. cn("text-white", "text-body") was dropping text-white outright,
// which is how Button's variant text color was disappearing app-wide
// whenever a size class was merged in after it.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": ["display", "h1", "h2", "h3", "body", "body-sm", "label", "metric", "caption"].map((v) => `text-${v}`),
    },
  },
});

/** Combine conditional class names and resolve Tailwind conflicts (last wins). */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
