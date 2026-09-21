import { X } from "lucide-react";
import { cn } from "../../lib/cn";
import Button from "./Button";

/** Lays out filter controls (Select/SearchField/DateRangePicker/Chip) in a responsive row. */
export default function FilterBar({ children, onClear, active = false, className }) {
  return (
    <div className={cn("flex flex-wrap items-end gap-3", className)}>
      {children}
      {active && onClear && (
        <Button variant="ghost" size="sm" iconLeft={<X size={14} />} onClick={onClear}>
          Clear filters
        </Button>
      )}
    </div>
  );
}
