import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  createColumnHelper,
  flexRender,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { BlastRadiusText } from "../components/StatusLabel";
import { WorkflowStatusIndicator } from "../components/WorkflowStatusIndicator";
import { fetchWorkflows } from "../lib/api";
import type { WorkflowRun } from "../shared/contracts";

const features = tableFeatures({});
const columnHelper = createColumnHelper<typeof features, WorkflowRun>();

const BLAST_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export function ApprovalsPage() {
  const wfQuery = useQuery({
    queryKey: ["workflows"],
    queryFn: fetchWorkflows,
  });

  const pendingApprovals = useMemo(() => {
    const items = wfQuery.data?.workflows ?? [];
    return items
      .filter((w) => w.status === "AWAITING_APPROVAL")
      .sort((a, b) => (BLAST_ORDER[a.blastRadius] ?? 3) - (BLAST_ORDER[b.blastRadius] ?? 3));
  }, [wfQuery.data]);

  const liveEtag = wfQuery.data?.liveStateEtag ?? "";

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("appName", {
          header: "Application & Route",
          cell: (info) => {
            const row = info.row.original;
            return (
              <div>
                <Link
                  to="/workflows/$workflowId"
                  params={{ workflowId: row.workflowId }}
                  className="font-semibold text-slate-900 hover:text-blue-700 hover:underline"
                >
                  {row.appName}
                </Link>
                <div className="text-xs font-mono text-slate-500">
                  {row.ingressRequest.hostname}
                  {row.ingressRequest.pathPrefix}
                </div>
              </div>
            );
          },
        }),
        columnHelper.accessor("blastRadius", {
          header: "Blast Radius",
          cell: (info) => <BlastRadiusText score={info.getValue()} />,
        }),
        columnHelper.accessor("environment", {
          header: "Target Env",
          cell: (info) => (
            <span className="font-mono text-xs text-slate-700">
              {info.getValue()} · {info.row.original.executionMode}
            </span>
          ),
        }),
        columnHelper.display({
          id: "etagFreshness",
          header: "ETag Lock State",
          cell: (info) => {
            const target = info.row.original.changePlan?.targetStateEtag;
            const matches = target && target === liveEtag;
            return matches ? (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Synced
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-red-700 font-medium">
                <ShieldAlert className="h-3.5 w-3.5" />
                Drift Detected
              </span>
            );
          },
        }),
        columnHelper.accessor("status", {
          header: "Gate Status",
          cell: (info) => <WorkflowStatusIndicator status={info.getValue()} />,
        }),
        columnHelper.accessor("requesterId", {
          header: "Requester",
          cell: (info) => <span className="text-xs text-slate-600">{info.getValue()}</span>,
        }),
        columnHelper.display({
          id: "review",
          header: "",
          cell: (info) => (
            <Link
              to="/workflows/$workflowId"
              params={{ workflowId: info.row.original.workflowId }}
              className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 whitespace-nowrap"
            >
              Review & Sign
            </Link>
          ),
        }),
      ]),
    [liveEtag]
  );

  const table = useTable({
    features: features,
    data: pendingApprovals,
    columns,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          Human-in-the-Loop Approval Inbox
        </h1>
        <p className="text-sm text-slate-600 mt-0.5">
          Workflows halted at the ADK state interrupt requiring signed four-eyes RBAC approval prior to ExecutionAgent unlock.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {wfQuery.isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : pendingApprovals.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-medium text-slate-900">Approval queue is clear</p>
            <p className="text-xs text-slate-500 mt-1">
              No workflows are currently paused at the HITL approval gate.
            </p>
          </div>
        ) : (
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
                        {flexRender(header.column.columnDef.header, header.getContext())}
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
        )}
      </div>
    </div>
  );
}
