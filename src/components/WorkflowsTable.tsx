import { useMemo } from "react";
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
import { ArrowUpDown } from "lucide-react";
import type { WorkflowRun } from "../shared/contracts";
import { BlastRadiusText } from "./StatusLabel";
import { StatusBadge } from "./ui/StatusBadge";

const wfFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns,
});

const columnHelper = createColumnHelper<typeof wfFeatures, WorkflowRun>();

export interface WorkflowsTableProps {
  workflows: WorkflowRun[];
}

export function WorkflowsTable({ workflows }: WorkflowsTableProps) {
  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor((row) => row.ingressRequest.requestId, {
          id: "requestId",
          header: "Request ID",
          cell: (info) => {
            const row = info.row.original;
            const requestId = info.getValue();
            return (
              <div className="space-y-0.5">
                <Link
                  to="/workflows/$workflowId"
                  params={{ workflowId: row.workflowId }}
                  title={requestId}
                  className="font-mono text-xs tabular-nums text-slate-800 hover:text-blue-700 hover:underline whitespace-nowrap"
                >
                  {requestId.slice(0, 8)}...
                </Link>
                {row.ticketRef && (
                  <div className="text-[11px] font-mono text-slate-500">
                    {row.ticketRef}
                  </div>
                )}
              </div>
            );
          },
        }),
        columnHelper.accessor("appName", {
          header: "App Name",
          cell: (info) => {
            const row = info.row.original;
            return (
              <div>
                <Link
                  to="/workflows/$workflowId"
                  params={{ workflowId: row.workflowId }}
                  className="font-semibold text-slate-900 hover:text-blue-700 hover:underline"
                >
                  {info.getValue()}
                </Link>
                <div className="text-xs font-mono text-slate-500">
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
            <span className="font-mono text-xs text-slate-700 whitespace-nowrap">
              {info.getValue()} · {info.row.original.ingressRequest.exposure}
            </span>
          ),
        }),
        columnHelper.accessor("status", {
          header: "Status",
          cell: (info) => <StatusBadge status={info.getValue()} />,
        }),
        columnHelper.accessor("blastRadius", {
          header: "Blast Radius",
          cell: (info) => <BlastRadiusText score={info.getValue()} />,
        }),
        columnHelper.accessor("requesterId", {
          header: "Requester",
          cell: (info) => (
            <span className="text-xs text-slate-600 truncate max-w-[180px] block">
              {info.getValue()}
            </span>
          ),
        }),
        columnHelper.accessor("updatedAt", {
          header: "Updated",
          cell: (info) => (
            <span className="text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap">
              {new Date(info.getValue()).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          ),
        }),
        columnHelper.display({
          id: "action",
          header: "",
          cell: (info) => (
            <Link
              to="/workflows/$workflowId"
              params={{ workflowId: info.row.original.workflowId }}
              className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
            >
              Inspect
            </Link>
          ),
        }),
      ]),
    []
  );

  const table = useTable({
    features: wfFeatures,
    data: workflows,
    columns,
  });

  if (workflows.length === 0) {
    return (
      <div className="p-12 text-center">
        <p className="text-sm font-medium text-slate-900">
          No workflows match your filter
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Adjust environment filters or submit a new ingress change request.
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
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="hover:bg-slate-50 transition-colors">
              {row.getAllCells().map((cell) => (
                <td key={cell.id} className="px-4 py-3 align-middle">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
