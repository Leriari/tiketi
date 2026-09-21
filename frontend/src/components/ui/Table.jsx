import { ArrowUp, ArrowDown, ArrowUpDown, MoreHorizontal } from "lucide-react";
import { cn } from "../../lib/cn";
import Checkbox from "./Checkbox";
import DropdownMenu from "./DropdownMenu";
import { SkeletonTableRows } from "./Skeleton";
import EmptyState from "./EmptyState";

/**
 * columns: [{ key, header, sortable, render(row), className }]
 * Below `md` this becomes stacked label/value cards — spec §8.5.
 */
export default function Table({
  columns,
  data,
  getRowId = (row) => row.id,
  selectable = false,
  selectedIds = [],
  onSelectedChange,
  sort,
  onSortChange,
  rowActions,
  onRowClick,
  loading = false,
  empty,
}) {
  const allSelected = data.length > 0 && selectedIds.length === data.length;

  function toggleAll() {
    onSelectedChange(allSelected ? [] : data.map(getRowId));
  }
  function toggleOne(id) {
    onSelectedChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }
  function handleSort(key) {
    if (!onSortChange) return;
    const direction = sort?.key === key && sort.direction === "asc" ? "desc" : "asc";
    onSortChange({ key, direction });
  }

  if (!loading && data.length === 0) {
    return empty || <EmptyState title="Nothing here yet" description="No rows to show." />;
  }

  return (
    <>
      {/* Desktop / tablet: real table, sticky header */}
      <div className="hidden md:block overflow-x-auto rounded-md border border-line-subtle">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="sticky top-0 z-[1] bg-surface-elevated">
              {selectable && (
                <th className="w-10 px-4 py-3">
                  <Checkbox checked={allSelected} onChange={toggleAll} aria-label="Select all rows" />
                </th>
              )}
              {columns.map((col) => (
                <th key={col.key} className={cn("px-4 py-3 text-label uppercase tracking-[0.06em] text-ink-tertiary font-medium", col.className)}>
                  {col.sortable ? (
                    <button
                      onClick={() => handleSort(col.key)}
                      className="inline-flex items-center gap-1 hover:text-ink-primary"
                    >
                      {col.header}
                      {sort?.key === col.key ? (
                        sort.direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                      ) : (
                        <ArrowUpDown size={12} className="opacity-40" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              ))}
              {rowActions && <th className="w-10 px-4 py-3"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonTableRows columns={columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)} />
            ) : (
              data.map((row) => {
                const id = getRowId(row);
                return (
                  <tr
                    key={id}
                    onClick={() => onRowClick?.(row)}
                    className={cn(
                      "border-t border-line-subtle transition-colors duration-150 hover:bg-surface-elevated",
                      onRowClick && "cursor-pointer"
                    )}
                  >
                    {selectable && (
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selectedIds.includes(id)} onChange={() => toggleOne(id)} aria-label={`Select row ${id}`} />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td key={col.key} className={cn("px-4 py-3 text-body-sm text-ink-primary", col.className)}>
                        {col.render ? col.render(row) : row[col.key]}
                      </td>
                    ))}
                    {rowActions && (
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu
                          trigger={
                            <button className="text-ink-tertiary hover:text-ink-primary" aria-label="Row actions">
                              <MoreHorizontal size={16} />
                            </button>
                          }
                          items={rowActions(row)}
                        />
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked label/value cards — spec §8.5 */}
      <div className="md:hidden flex flex-col gap-3">
        {data.map((row) => {
          const id = getRowId(row);
          return (
            <div
              key={id}
              onClick={() => onRowClick?.(row)}
              className={cn("rounded-md border border-line-subtle bg-surface p-4 flex flex-col gap-2", onRowClick && "cursor-pointer")}
            >
              {selectable && (
                <div onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={selectedIds.includes(id)} onChange={() => toggleOne(id)} label="Select" />
                </div>
              )}
              {columns.map((col) => (
                <div key={col.key} className="flex items-center justify-between gap-3">
                  <span className="text-caption text-ink-tertiary">{col.header}</span>
                  <span className="text-body-sm text-ink-primary text-right">{col.render ? col.render(row) : row[col.key]}</span>
                </div>
              ))}
              {rowActions && (
                <div className="flex justify-end pt-1" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu
                    trigger={
                      <button className="text-ink-tertiary hover:text-ink-primary" aria-label="Row actions">
                        <MoreHorizontal size={16} />
                      </button>
                    }
                    items={rowActions(row)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
