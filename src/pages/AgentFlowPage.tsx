import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, PlayCircle, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { LiveAgentFlowDiagram } from "../components/LiveAgentFlowDiagram";
import { StatusBadge } from "../components/ui/StatusBadge";
import {
  createPolicy,
  createWorkflow,
  deletePolicy,
  fetchPolicies,
  fetchWorkflows,
  simulateInfraDrift,
  togglePolicy,
} from "../lib/api";
import { useWorkflowStream } from "../lib/useWorkflowStream";
import type { CustomPolicyRule } from "../shared/contracts";

export function AgentFlowPage() {
  const queryClient = useQueryClient();
  const { streamConnected } = useWorkflowStream();
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>("");

  const workflowsQuery = useQuery({
    queryKey: ["workflows"],
    queryFn: fetchWorkflows,
  });

  const policiesQuery = useQuery({
    queryKey: ["policies"],
    queryFn: fetchPolicies,
  });

  const [ruleName, setRuleName] = useState("");
  const [ruleType, setRuleType] = useState<CustomPolicyRule["conditionType"]>("max_port");
  const [ruleValue, setRuleValue] = useState("9443");
  const [ruleSeverity, setRuleSeverity] = useState<"WARN" | "BLOCK">("WARN");

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
          customInstructions: "Staged 10% -> 50% -> 100% canary rollout with Cost & Security posture checks",
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

  const addPolicyMutation = useMutation({
    mutationFn: () =>
      createPolicy({
        name: ruleName.trim(),
        description: `Dynamic ${ruleType} rule (${ruleValue.trim() || "default"})`,
        conditionType: ruleType,
        value: ruleValue.trim(),
        severity: ruleSeverity,
      }),
    onSuccess: () => {
      setRuleName("");
      queryClient.invalidateQueries({ queryKey: ["policies"] });
    },
  });

  const togglePolicyMutation = useMutation({
    mutationFn: (v: { ruleId: string; enabled: boolean }) => togglePolicy(v.ruleId, v.enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["policies"] }),
  });

  const deletePolicyMutation = useMutation({
    mutationFn: (ruleId: string) => deletePolicy(ruleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["policies"] }),
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

      {/* Dynamic Policy Rules Studio */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Dynamic Policy Rules (Evaluated by PolicyComplianceAgent)
            </h2>
            <p className="text-xs text-slate-500">
              Toggle or add custom governance rules without restarting the server. Active rules apply immediately to every new or revised workflow.
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            {(policiesQuery.data?.rules ?? []).filter((r) => r.enabled).length} active rules
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(policiesQuery.data?.rules ?? []).map((rule) => (
            <div
              key={rule.ruleId}
              className="flex items-start justify-between gap-3 p-3.5 border border-slate-200 rounded-md bg-slate-50/50"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold text-slate-900 truncate">{rule.name}</span>
                  <span className="font-mono text-[11px] text-slate-500">
                    {rule.severity}
                  </span>
                </div>
                <p className="text-xs text-slate-600">{rule.description}</p>
                <div className="text-[11px] font-mono text-slate-500">
                  {rule.ruleId} · {rule.conditionType} = {rule.value || "any"}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    togglePolicyMutation.mutate({
                      ruleId: rule.ruleId,
                      enabled: !rule.enabled,
                    })
                  }
                  className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors ${
                    rule.enabled
                      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {rule.enabled ? "Enabled" : "Disabled"}
                </button>
                <button
                  type="button"
                  onClick={() => deletePolicyMutation.mutate(rule.ruleId)}
                  className="p-1.5 text-slate-400 hover:text-red-600 transition-colors"
                  aria-label={`Delete ${rule.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-6 gap-2.5 items-end">
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              New Rule Name
            </label>
            <input
              type="text"
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              placeholder="e.g. Max Service Port 9443"
              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-md"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Rule Type
            </label>
            <select
              value={ruleType}
              onChange={(e) =>
                setRuleType(e.target.value as CustomPolicyRule["conditionType"])
              }
              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-md bg-white"
            >
              <option value="max_port">Max Backend Port</option>
              <option value="allowed_domain_suffix">Domain Suffix</option>
              <option value="require_ticket">Require Ticket</option>
              <option value="enforce_waf_staging">Staging WAF TLS 1.3</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Target Value
            </label>
            <input
              type="text"
              value={ruleValue}
              onChange={(e) => setRuleValue(e.target.value)}
              placeholder="9443 or .example.com"
              className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-md"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Action
            </label>
            <select
              value={ruleSeverity}
              onChange={(e) => setRuleSeverity(e.target.value as "WARN" | "BLOCK")}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-md bg-white"
            >
              <option value="WARN">WARN</option>
              <option value="BLOCK">BLOCK</option>
            </select>
          </div>
          <button
            type="button"
            disabled={ruleName.trim().length < 3 || addPolicyMutation.isPending}
            onClick={() => addPolicyMutation.mutate()}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Rule
          </button>
        </div>
      </div>
    </div>
  );
}
