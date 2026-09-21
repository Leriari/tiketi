import { cn } from "../../lib/cn";

export default function Skeleton({ className, style, rounded = "rounded-sm" }) {
  return <div className={cn("animate-pulse bg-surface-elevated", rounded, className)} style={style} aria-hidden="true" />;
}

/** 5 skeleton rows matching a table layout — spec §2.5. */
export function SkeletonTableRows({ columns = 4, rows = 5 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-t border-line-subtle">
          {Array.from({ length: columns }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <Skeleton className="h-4 w-full max-w-[160px]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Shimmer block sized like a StatCard — spec §2.5. */
export function SkeletonCard({ className }) {
  return (
    <div className={cn("rounded-md border border-line-subtle bg-surface p-5 flex flex-col gap-3", className)}>
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-7 w-28" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}
