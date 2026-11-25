import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowRight } from "lucide-react";
import { formatTimeHMS, shortHash } from "../lib/format";
import type { WorkflowRun } from "../shared/contracts";
import { BlastRadiusText } from "./StatusLabel";
import { DataTable } from "./ui/DataTable";
import { EtagLockIndicator } from "./ui/EtagLockIndicator";
import { StatusBadge } from "./ui/StatusBadge";

const wfFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns,
});

const columnHelper = createColumnHelper<typeof wfFeatures, WorkflowRun>();

export interface WorkflowsTableProps {
  workflows: WorkflowRun[];
  liveStateEtag?: string;
  isLoading?: boolean;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
}

export function WorkflowsTable({
  workflows,
  liveStateEtag,
  isLoading = false,
  hasActiveFilters = false,
  onClearFilters,
}: WorkflowsTableProps) {
  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor((row) => row.ingressRequest.requestId, {
          id: "requestId",
          header: "Request",
          cell: (info) => {
            const row = info.row.original;
            const requestId = info.getValue();
            return (
              <div className="space-y-0.5">
                <div
                  title={requestId}
                  className="font-mono text-xs tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap"
                >
                  {shortHash(requestId, 8)}
                </div>
                {row.ticketRef && (
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    {row.ticketRef}
                  </div>
                )}
              </div>
            );
          },
        }),
        columnHelper.accessor("appName", {
          header: "Application",
          cell: (info) => {
            const row = info.row.original;
            return (
              <div>
                <Link
                  to="/workflows/$workflowId"
                  params={{ workflowId: row.workflowId }}
                  className="font-semibold text-slate-900 dark:text-slate-100 hover:text-blue-700 dark:hover:text-sky-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
                >
                  {info.getValue()}
                </Link>
                <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  {row.ingressRequest.hostname}
                  {row.ingressRequest.pathPrefix}
                </div>
              </div>
            );
          },
        }),
        columnHelper.accessor("environment", {
          header: "Environment",
          cell: (info) => (
            <span className="font-mono text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
              {info.getValue()} · {info.row.original.ingressRequest.exposure}
            </span>
          ),
        }),
        columnHelper.accessor("status", {
          header: "Status",
          cell: (info) => <StatusBadge status={info.getValue()} />,
        }),
        columnHelper.display({
          id: "versionLock",
          header: "Version Lock",
          cell: (info) => {
            const row = info.row.original;
            return (
              <EtagLockIndicator
                variant="compact"
                targetEtag={row.changePlan?.targetStateEtag ?? row.currentStateEtag}
                liveStateEtag={liveStateEtag}
                workflowStatus={row.status}
              />
            );
          },
        }),
        columnHelper.accessor("blastRadius", {
          header: "Blast Radius",
          cell: (info) => <BlastRadiusText score={info.getValue()} />,
        }),
        columnHelper.accessor("requesterId", {
          header: "Requester",
          cell: (info) => (
            <span className="text-xs text-slate-600 dark:text-slate-400 truncate max-w-[180px] block">
              {info.getValue()}
            </span>
          ),
        }),
        columnHelper.accessor("updatedAt", {
          header: "Updated",
          cell: (info) => (
            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
              {formatTimeHMS(info.getValue())}
            </span>
          ),
        }),
        columnHelper.display({
          id: "action",
          header: "",
          cell: (info) => (
            <div className="text-right">
              <Link
                to="/workflows/$workflowId"
                params={{ workflowId: info.row.original.workflowId }}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-sky-400 hover:text-blue-800 hover:underline whitespace-nowrap"
              >
                Inspect
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          ),
        }),
      ]),
    [liveStateEtag]
  );

  const table = useTable({
    features: wfFeatures,
    data: workflows,
    columns,
  });

  return (
    <DataTable
      table={table}
      isLoading={isLoading}
      skeletonRows={4}
      emptyTitle="No workflows match your filter"
      emptyDescription={
        hasActiveFilters
          ? "Reset active filters or adjust your search query to view all workflows."
          : "Submit a new ingress change request to start an automated governance workflow."
      }
      emptyActionLabel={hasActiveFilters ? "Reset filters" : undefined}
      onEmptyAction={onClearFilters}
    />
  );
}
