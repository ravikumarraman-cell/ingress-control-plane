import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, PlayCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { LiveAgentFlowDiagram } from "../components/LiveAgentFlowDiagram";
import { AgentStudioBuilder } from "../components/agents/AgentStudioBuilder";
import { PolicyRulesPanel } from "../components/agents/PolicyRulesPanel";
import { StrandsExecutionMetricsDashboard } from "../components/dashboard/StrandsExecutionMetricsDashboard";
import { PageHeader } from "../components/ui/PageHeader";
import { SegmentedTabs } from "../components/ui/SegmentedTabs";
import { StatusBadge } from "../components/ui/StatusBadge";
import {
  createWorkflow,
  fetchAgentBlueprints,
  fetchPolicies,
  fetchWorkflows,
  simulateInfraDrift,
} from "../lib/api";
import { shortHash } from "../lib/format";
import { useWorkflowStream } from "../lib/useWorkflowStream";

export function AgentFlowPage() {
  const queryClient = useQueryClient();
  const { streamConnected } = useWorkflowStream();
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>("");
  const [workspaceTab, setWorkspaceTab] = useState<"topology" | "metrics" | "studio" | "policies">(
    "topology"
  );

  const workflowsQuery = useQuery({
    queryKey: ["workflows"],
    queryFn: () => fetchWorkflows(),
  });

  const policiesQuery = useQuery({
    queryKey: ["policies"],
    queryFn: fetchPolicies,
  });

  const blueprintsQuery = useQuery({
    queryKey: ["agent-blueprints"],
    queryFn: fetchAgentBlueprints,
  });

  const workflows = workflowsQuery.data?.workflows ?? [];

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
        pipelineConfig: {
          hitlPolicy: "always",
          enabledAgents: [
            "DiscoveryInventoryAgent",
            "PolicyComplianceAgent",
            "ImpactAnalysisAgent",
            "CostEstimationAgent",
            "SecurityPostureAgent",
            "ChangePlanningAgent",
            "ValidationRollbackAgent",
          ],
          canarySteps: [10, 50, 100],
          maxSupervisorIterations: 5,
          customInstructions:
            "Staged 10% -> 50% -> 100% canary rollout with Cost & Security posture checks",
        },
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
            "Interactive staging walkthrough request to demonstrate flexible agents, progressive canary shifting, and HITL gating.",
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

  const policyRules = policiesQuery.data?.rules ?? [];
  const enabledPoliciesCount = policyRules.filter((r) => r.enabled).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live Multi-Agent Interaction Diagram"
        subtitle="See how each AI and deterministic safety agent collaborates, shares structured outputs, and pauses for human approval in real time."
        actions={
          <>
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
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors whitespace-nowrap"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${driftMutation.isPending ? "animate-spin" : ""}`} />
              Simulate Infra Drift
            </button>
          </>
        }
      />

      <div className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 min-w-0 flex-1">
          <label
            htmlFor="agent-flow-workflow-select"
            className="text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap"
          >
            Inspect Live Workflow:
          </label>
          <select
            id="agent-flow-workflow-select"
            value={activeWorkflow?.workflowId ?? ""}
            onChange={(e) => setSelectedWorkflowId(e.target.value)}
            className="w-full sm:max-w-md px-3 py-1.5 text-xs bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {workflows.map((wf) => (
              <option key={wf.workflowId} value={wf.workflowId}>
                {wf.appName} ({wf.environment}) — {wf.status} ·{" "}
                {wf.ticketRef ?? wf.workflowId.slice(0, 8)}
              </option>
            ))}
          </select>

          {activeWorkflow && <StatusBadge status={activeWorkflow.status} />}
        </div>

        <div className="flex flex-wrap items-center gap-4 shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
            <span>Live ETag:</span>
            <code className="font-mono text-slate-900 dark:text-slate-100 tabular-nums">
              {workflowsQuery.data?.liveStateEtag
                ? shortHash(workflowsQuery.data.liveStateEtag, 16)
                : "loading..."}
            </code>
          </div>

          {activeWorkflow && (
            <Link
              to="/workflows/$workflowId"
              params={{ workflowId: activeWorkflow.workflowId }}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-sky-400 hover:underline whitespace-nowrap"
            >
              Inspect Diffs & Approve
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          ariaLabel="Agent workspace views"
          value={workspaceTab}
          onChange={setWorkspaceTab}
          items={[
            { id: "topology", label: "Live Topology & Handoffs" },
            { id: "metrics", label: "Execution Metrics" },
            {
              id: "studio",
              label: "Agent Studio & Chaining",
              count: blueprintsQuery.data?.blueprints.length ?? 0,
            },
            { id: "policies", label: "Policy Rules", count: enabledPoliciesCount },
          ]}
        />

        {activeWorkflow && (
          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {activeWorkflow.dynamicTaskAssignments?.length
              ? `${activeWorkflow.dynamicTaskAssignments.length} dynamic DAG task(s) hooked`
              : "Standard 9-agent governed pipeline"}
          </div>
        )}
      </div>

      {workspaceTab === "topology" &&
        (workflowsQuery.isLoading ? (
          <div className="h-96 bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-lg animate-pulse" />
        ) : (
          <LiveAgentFlowDiagram
            workflow={activeWorkflow}
            liveEtag={workflowsQuery.data?.liveStateEtag}
            streamConnected={streamConnected}
          />
        ))}

      {workspaceTab === "metrics" && <StrandsExecutionMetricsDashboard />}

      {workspaceTab === "studio" && (
        <AgentStudioBuilder
          activeWorkflow={activeWorkflow}
          onWorkflowUpdated={(wf) => {
            setSelectedWorkflowId(wf.workflowId);
            setWorkspaceTab("topology");
          }}
        />
      )}

      {workspaceTab === "policies" && <PolicyRulesPanel rules={policyRules} />}
    </div>
  );
}
