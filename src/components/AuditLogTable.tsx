import { Fragment, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  createColumnHelper,
  createSortedRowModel,
  flexRender,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowUpDown, ChevronDown, ChevronRight } from "lucide-react";
import type { AuditEvent } from "../shared/contracts";

const auditFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns,
});

const columnHelper = createColumnHelper<typeof auditFeatures, AuditEvent>();

export interface AuditLogTableProps {
  events: AuditEvent[];
}

export function AuditLogTable({ events }: AuditLogTableProps) {
  const [expandedSeq, setExpandedSeq] = useState<number | null>(null);

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.display({
          id: "expand",
          header: "",
          cell: (info) => {
            const seqNo = info.row.original.seqNo;
            const isExpanded = expandedSeq === seqNo;
            return (
              <button
                type="button"
                aria-label={isExpanded ? `Collapse event #${seqNo}` : `Expand event #${seqNo}`}
                onClick={() => setExpandedSeq(isExpanded ? null : seqNo)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100 transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
            );
          },
        }),
        columnHelper.accessor("seqNo", {
          header: "Seq",
          cell: (info) => (
            <span className="font-mono text-xs tabular-nums text-slate-600 whitespace-nowrap">
              #{info.getValue()}
            </span>
          ),
        }),
        columnHelper.accessor("eventType", {
          header: "Event Type",
          cell: (info) => (
            <span className="font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
              {info.getValue()}
            </span>
          ),
        }),
        columnHelper.accessor("actorId", {
          header: "Actor",
          cell: (info) => (
            <div className="text-xs whitespace-nowrap">
              <span className="text-slate-900 font-medium">{info.getValue()}</span>
              <span className="text-slate-400 mx-1.5" aria-hidden="true">
                ·
              </span>
              <span className="font-mono text-slate-500">{info.row.original.actorType}</span>
            </div>
          ),
        }),
        columnHelper.accessor("workflowId", {
          header: "Workflow",
          cell: (info) => (
            <Link
              to="/workflows/$workflowId"
              params={{ workflowId: info.getValue() }}
              title={info.getValue()}
              className="font-mono text-xs text-blue-700 hover:underline whitespace-nowrap"
            >
              {info.getValue().slice(0, 8)}...
            </Link>
          ),
        }),
        columnHelper.accessor("payload", {
          header: "Payload",
          enableSorting: false,
          cell: (info) => (
            <code className="text-[11px] font-mono text-slate-600 block max-w-[320px] truncate">
              {JSON.stringify(info.getValue())}
            </code>
          ),
        }),
        columnHelper.accessor("eventHash", {
          header: "SHA-256 Chain Hash",
          enableSorting: false,
          cell: (info) => (
            <span
              title={info.getValue()}
              className="font-mono text-[11px] text-slate-500 whitespace-nowrap tabular-nums"
            >
              {info.getValue().slice(0, 14)}...
            </span>
          ),
        }),
        columnHelper.accessor("occurredAt", {
          header: "Timestamp",
          cell: (info) => (
            <span className="font-mono text-xs tabular-nums text-slate-500 whitespace-nowrap">
              {new Date(info.getValue()).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          ),
        }),
      ]),
    [expandedSeq]
  );

  const table = useTable({
    features: auditFeatures,
    data: events,
    columns,
  });

  if (events.length === 0) {
    return (
      <div className="p-12 text-center">
        <p className="text-sm font-medium text-slate-900">
          No audit events match your filter
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Adjust actor filters or search terms to inspect hash-chained audit records.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-slate-200 bg-slate-50">
              {hg.headers.map((header) => (
                <th
                  key={header.id}
                  className="px-4 py-2.5 text-xs font-semibold text-slate-600 whitespace-nowrap"
                >
                  {header.isPlaceholder ? null : header.column.getCanSort() ? (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <ArrowUpDown className="h-3 w-3 text-slate-400" />
                    </button>
                  ) : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-slate-200 text-sm">
          {table.getRowModel().rows.map((row) => {
            const ev = row.original;
            const isExpanded = expandedSeq === ev.seqNo;
            return (
              <Fragment key={row.id}>
                <tr className="hover:bg-slate-50 transition-colors">
                  {row.getAllCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
                {isExpanded && (
                  <tr className="bg-slate-50/70">
                    <td colSpan={row.getAllCells().length} className="px-6 py-4">
                      <div className="space-y-3 text-xs">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-[11px] text-slate-600">
                          <div className="truncate">
                            <span className="font-semibold text-slate-800">Event ID: </span>
                            {ev.eventId}
                          </div>
                          <div className="truncate">
                            <span className="font-semibold text-slate-800">Occurred: </span>
                            {ev.occurredAt}
                          </div>
                          <div className="truncate">
                            <span className="font-semibold text-slate-800">Prev Hash: </span>
                            {ev.prevEventHash}
                          </div>
                          <div className="truncate">
                            <span className="font-semibold text-slate-800">Event Hash: </span>
                            {ev.eventHash}
                          </div>
                        </div>
                        <pre className="p-3 bg-slate-950 text-slate-100 rounded-md text-[11px] font-mono overflow-x-auto leading-relaxed">
                          {JSON.stringify(ev.payload, null, 2)}
                        </pre>
                      </div>
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
