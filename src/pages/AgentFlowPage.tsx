import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, PlayCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { LiveAgentFlowDiagram } from "../components/LiveAgentFlowDiagram";
import { StatusBadge } from "../components/ui/StatusBadge";
import {
  createWorkflow,
  fetchWorkflows,
  simulateInfraDrift,
} from "../lib/api";
import { useWorkflowStream } from "../lib/useWorkflowStream";

export function AgentFlowPage() {
  const queryClient = useQueryClient();
  const { streamConnected } = useWorkflowStream();
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>("");

  const workflowsQuery = useQuery({
    queryKey: ["workflows"],
    queryFn: fetchWorkflows,
  });

  const workflows = workflowsQuery.data?.workflows ?? [];

  // Default to the newest workflow or keep current selection valid
  useEffect(() => {
    if (workflows.length === 0) return;
    if (!selectedWorkflowId || !workflows.some((w) => w.workflowId === selectedWorkflowId)) {
      setSelectedWorkflowId(workflows[0].workflowId);
    }
  }, [workflows, selectedWorkflowId]);

  const activeWorkflow = useMemo(
    () => workflows.find((w) => w.workflowId === selectedWorkflowId) ?? workflows[0] ?? null,
    [workflows, selectedWorkflowId]
  );

  const runLiveDemoMutation = useMutation({
    mutationFn: () => {
      const suffix = Math.floor(100 + Math.random() * 900);
      return createWorkflow({
        intakeMode: "structured",
        executionMode: "direct_canary_v3",
        request: {
          ticketRef: `DEMO-${suffix}`,
          appName: `catalog-api-${suffix}`,
          environment: "staging",
          hostname: `catalog-${suffix}.staging.example.com`,
          pathPrefix: "/v1/catalog",
          backendService: "catalog-core-svc",
          backendPort: 8080,
          exposure: "external",
          tlsProfile: "tls_1_3_strict",
          rawJustification:
            "Interactive staging walkthrough request to demonstrate parallel Phase A analysis, Phase B rollback sealing, and HITL gating.",
        },
      });
    },
    onSuccess: (data) => {
      setSelectedWorkflowId(data.workflow.workflowId);
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      queryClient.invalidateQueries({ queryKey: ["audit-log"] });
    },
  });

  const driftMutation = useMutation({
    mutationFn: simulateInfraDrift,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      queryClient.invalidateQueries({ queryKey: ["routes"] });
      queryClient.invalidateQueries({ queryKey: ["audit-log"] });
    },
  });

  return (
    <div className="space-y-6">
      {/* Header & Live Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Live Multi-Agent Interaction Diagram
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            See how each AI and deterministic safety agent works, shares data, and pauses for human approval in real time.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => runLiveDemoMutation.mutate()}
            disabled={runLiveDemoMutation.isPending}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-60 transition-colors whitespace-nowrap"
          >
            <PlayCircle className="h-3.5 w-3.5 shrink-0" />
            {runLiveDemoMutation.isPending ? "Dispatching Agents..." : "Run Live Staging Demo"}
          </button>

          <button
            type="button"
            onClick={() => driftMutation.mutate()}
            disabled={driftMutation.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${driftMutation.isPending ? "animate-spin" : ""}`} />
            Simulate Infra Drift
          </button>
        </div>
      </div>

      {/* Live Workflow Selector Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 min-w-0 flex-1">
          <label
            htmlFor="agent-flow-workflow-select"
            className="text-xs font-medium text-slate-700 whitespace-nowrap"
          >
            Inspect Live Workflow:
          </label>
          <select
            id="agent-flow-workflow-select"
            value={activeWorkflow?.workflowId ?? ""}
            onChange={(e) => setSelectedWorkflowId(e.target.value)}
            className="w-full sm:max-w-md px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {workflows.map((wf) => (
              <option key={wf.workflowId} value={wf.workflowId}>
                {wf.appName} ({wf.environment}) — {wf.status} · {wf.ticketRef ?? wf.workflowId.slice(0, 8)}
              </option>
            ))}
          </select>

          {activeWorkflow && <StatusBadge status={activeWorkflow.status} />}
        </div>

        <div className="flex flex-wrap items-center gap-4 shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <ShieldCheck className="h-3.5 w-3.5 text-slate-500" />
            <span>Live ETag:</span>
            <code className="font-mono text-slate-900 tabular-nums">
              {workflowsQuery.data?.liveStateEtag
                ? `${workflowsQuery.data.liveStateEtag.slice(0, 16)}...`
                : "loading..."}
            </code>
          </div>

          {activeWorkflow && (
            <Link
              to="/workflows/$workflowId"
              params={{ workflowId: activeWorkflow.workflowId }}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
            >
              Inspect Diffs & Approve
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>

      {/* Main Live Diagram */}
      {workflowsQuery.isLoading ? (
        <div className="h-96 bg-white border border-slate-200 rounded-lg animate-pulse" />
      ) : (
        <LiveAgentFlowDiagram
          workflow={activeWorkflow}
          liveEtag={workflowsQuery.data?.liveStateEtag}
          streamConnected={streamConnected}
        />
      )}
    </div>
  );
}
