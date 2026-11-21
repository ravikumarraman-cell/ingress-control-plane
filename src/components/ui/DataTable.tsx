import { Fragment, type ReactNode } from "react";
import {
  flexRender,
  type ReactTable,
  type Row,
  type RowData,
  type TableFeatures,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { EmptyState } from "./EmptyState";

export interface DataTableProps<
  TFeatures extends TableFeatures,
  TData extends RowData,
  TSelected = unknown,
> {
  table: ReactTable<TFeatures, TData, TSelected>;
  isLoading?: boolean;
  skeletonRows?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  isRowExpanded?: (row: Row<TFeatures, TData>) => boolean;
  renderExpandedRow?: (row: Row<TFeatures, TData>) => ReactNode;
}

export function DataTable<
  TFeatures extends TableFeatures,
  TData extends RowData,
  TSelected = unknown,
>({
  table,
  isLoading = false,
  skeletonRows = 4,
  emptyTitle = "No records found",
  emptyDescription,
  emptyActionLabel,
  onEmptyAction,
  isRowExpanded,
  renderExpandedRow,
}: DataTableProps<TFeatures, TData, TSelected>) {
  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        {Array.from({ length: skeletonRows }).map((_, idx) => (
          <div key={idx} className="h-10 bg-slate-100 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  const rows = table.getRowModel().rows;
  if (rows.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        actionLabel={emptyActionLabel}
        onAction={onEmptyAction}
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-slate-200 bg-slate-50/85">
              {hg.headers.map((header) => {
                const col = header.column as unknown as {
                  getCanSort?: () => boolean;
                  getIsSorted?: () => false | "asc" | "desc";
                  getToggleSortingHandler?: () => ((event: unknown) => void) | undefined;
                };
                const canSort = Boolean(col.getCanSort?.());
                const sorted = col.getIsSorted?.() ?? false;
                const toggleSort = col.getToggleSortingHandler?.();

                return (
                  <th
                    key={header.id}
                    className="px-4 py-2.5 text-xs font-semibold text-slate-600 whitespace-nowrap"
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        onClick={toggleSort}
                        className="inline-flex items-center gap-1 hover:text-slate-950 transition-colors"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sorted === "asc" ? (
                          <ArrowUp className="h-3 w-3 text-blue-700" />
                        ) : sorted === "desc" ? (
                          <ArrowDown className="h-3 w-3 text-blue-700" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 text-slate-400" />
                        )}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-slate-200/80 text-sm">
          {rows.map((row) => {
            const expanded = Boolean(isRowExpanded?.(row));
            return (
              <Fragment key={row.id}>
                <tr className="hover:bg-slate-50/90 transition-colors">
                  {row.getAllCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
                {expanded && renderExpandedRow && (
                  <tr className="bg-slate-50/75">
                    <td colSpan={row.getAllCells().length} className="px-6 py-4">
                      {renderExpandedRow(row)}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
