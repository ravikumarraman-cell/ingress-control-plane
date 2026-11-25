import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatTimeHMS, shortHash } from "../lib/format";
import type { AuditEvent } from "../shared/contracts";
import { CodeViewer } from "./ui/CodeViewer";
import { DataTable } from "./ui/DataTable";

const auditFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns,
});

const columnHelper = createColumnHelper<typeof auditFeatures, AuditEvent>();

export interface AuditLogTableProps {
  events: AuditEvent[];
  isLoading?: boolean;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
}

export function AuditLogTable({
  events,
  isLoading = false,
  hasActiveFilters = false,
  onClearFilters,
}: AuditLogTableProps) {
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
                className="p-1 text-slate-400 hover:text-slate-700 dark:text-slate-300 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
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
            <span className="font-mono text-xs tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
              #{info.getValue()}
            </span>
          ),
        }),
        columnHelper.accessor("eventType", {
          header: "Event Type",
          cell: (info) => (
            <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
              {info.getValue()}
            </span>
          ),
        }),
        columnHelper.accessor("actorId", {
          header: "Actor",
          cell: (info) => (
            <div className="text-xs whitespace-nowrap">
              <span className="text-slate-900 dark:text-slate-100 font-medium">{info.getValue()}</span>
              <span className="text-slate-400 mx-1.5" aria-hidden="true">
                ·
              </span>
              <span className="font-mono text-slate-500 dark:text-slate-400">{info.row.original.actorType}</span>
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
              className="font-mono text-xs text-blue-700 dark:text-sky-400 hover:underline whitespace-nowrap"
            >
              {shortHash(info.getValue(), 8)}
            </Link>
          ),
        }),
        columnHelper.accessor("payload", {
          header: "Payload",
          enableSorting: false,
          cell: (info) => (
            <code className="text-[11px] font-mono text-slate-600 dark:text-slate-400 block max-w-[320px] truncate">
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
              className="font-mono text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap tabular-nums"
            >
              {shortHash(info.getValue(), 14)}
            </span>
          ),
        }),
        columnHelper.accessor("occurredAt", {
          header: "Timestamp",
          cell: (info) => (
            <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
              {formatTimeHMS(info.getValue())}
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

  return (
    <DataTable
      table={table}
      isLoading={isLoading}
      skeletonRows={4}
      emptyTitle="No audit events match your filter"
      emptyDescription="Adjust actor filters or search terms to inspect hash-chained audit records."
      emptyActionLabel={hasActiveFilters ? "Reset filters" : undefined}
      onEmptyAction={onClearFilters}
      isRowExpanded={(row) => expandedSeq === row.original.seqNo}
      renderExpandedRow={(row) => {
        const ev = row.original;
        return (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-[11px] text-slate-600 dark:text-slate-400">
              <div className="truncate">
                <span className="font-semibold text-slate-800 dark:text-slate-200">Event ID: </span>
                {ev.eventId}
              </div>
              <div className="truncate">
                <span className="font-semibold text-slate-800 dark:text-slate-200">Occurred: </span>
                {ev.occurredAt}
              </div>
              <div className="truncate">
                <span className="font-semibold text-slate-800 dark:text-slate-200">Prev Hash: </span>
                {ev.prevEventHash}
              </div>
              <div className="truncate">
                <span className="font-semibold text-slate-800 dark:text-slate-200">Event Hash: </span>
                {ev.eventHash}
              </div>
            </div>
            <CodeViewer
              title={`Event #${ev.seqNo} · ${ev.eventType}`}
              code={JSON.stringify(ev.payload, null, 2)}
              copyLabel="Copy JSON"
              maxHeightClass="max-h-72"
            />
          </div>
        );
      }}
    />
  );
}
