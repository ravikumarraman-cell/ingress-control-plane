import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { BlastRadiusText } from "../components/StatusLabel";
import { ApprovalModal } from "../components/ui/ApprovalModal";
import { DataTable } from "../components/ui/DataTable";
import { PageHeader } from "../components/ui/PageHeader";
import { WorkflowStatusIndicator } from "../components/WorkflowStatusIndicator";
import { fetchWorkflows, submitWorkflowDecision } from "../lib/api";
import type { WorkflowRun } from "../shared/contracts";

const features = tableFeatures({});
const columnHelper = createColumnHelper<typeof features, WorkflowRun>();

const BLAST_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export function ApprovalsPage() {
  const queryClient = useQueryClient();
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowRun | null>(null);

  const wfQuery = useQuery({
    queryKey: ["workflows"],
    queryFn: fetchWorkflows,
  });

  const decisionMutation = useMutation({
    mutationFn: (vars: {
      workflowId: string;
      decision: "APPROVE" | "REJECT";
      rationale: string;
      simulateProbeFailure: boolean;
    }) => submitWorkflowDecision(vars),
    onSuccess: () => {
      setSelectedWorkflow(null);
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      queryClient.invalidateQueries({ queryKey: ["routes"] });
      queryClient.invalidateQueries({ queryKey: ["audit-log"] });
    },
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
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  decisionMutation.reset();
                  setSelectedWorkflow(info.row.original);
                }}
                className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 whitespace-nowrap transition-colors"
              >
                Review & Sign
              </button>
              <Link
                to="/workflows/$workflowId"
                params={{ workflowId: info.row.original.workflowId }}
                className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap transition-colors"
              >
                Details
              </Link>
            </div>
          ),
        }),
      ]),
    [liveEtag, decisionMutation]
  );

  const table = useTable({
    features,
    data: pendingApprovals,
    columns,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Human-in-the-Loop Approval Inbox"
        subtitle="Workflows halted at the ADK state interrupt requiring signed four-eyes RBAC approval prior to ExecutionAgent unlock."
      />

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <DataTable
          table={table}
          isLoading={wfQuery.isLoading}
          skeletonRows={2}
          emptyTitle="Approval queue is clear"
          emptyDescription="No workflows are currently paused at the HITL approval gate."
        />
      </div>

      {selectedWorkflow && (
        <ApprovalModal
          open={Boolean(selectedWorkflow)}
          onClose={() => setSelectedWorkflow(null)}
          changePlan={selectedWorkflow.changePlan}
          blastRadius={selectedWorkflow.blastRadius}
          appName={selectedWorkflow.appName}
          hostname={selectedWorkflow.ingressRequest.hostname}
          pathPrefix={selectedWorkflow.ingressRequest.pathPrefix}
          environment={selectedWorkflow.environment}
          executionMode={selectedWorkflow.executionMode}
          requesterId={selectedWorkflow.requesterId}
          liveStateEtag={liveEtag}
          isSubmitting={decisionMutation.isPending}
          errorMessage={
            decisionMutation.isError ? (decisionMutation.error as Error).message : null
          }
          onSubmitDecision={(payload) =>
            decisionMutation.mutate({
              workflowId: selectedWorkflow.workflowId,
              ...payload,
            })
          }
        />
      )}
    </div>
  );
}
