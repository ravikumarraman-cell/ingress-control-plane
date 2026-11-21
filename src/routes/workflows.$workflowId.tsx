import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileJson,
  Lock,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import { LiveAgentFlowDiagram } from "../components/LiveAgentFlowDiagram";
import { BlastRadiusText } from "../components/StatusLabel";
import { ApprovalModal } from "../components/ui/ApprovalModal";
import { StatusBadge } from "../components/ui/StatusBadge";
import {
  fetchWorkflowById,
  getCurrentOperator,
  promoteCanary,
  replanWorkflow,
  reviseWorkflow,
  submitWorkflowDecision,
  triggerManualRollback,
} from "../lib/api";
import { mockWorkflows } from "../lib/mockData";

export function WorkflowDetailRouteView() {
  const { workflowId } = useParams({ from: "/workflows/$workflowId" });
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [inspectorTab, setInspectorTab] = useState<
    "config" | "diffs" | "rollback" | "policy" | "traces"
  >("config");
  const [jsonScope, setJsonScope] = useState<"config" | "full">("config");
  const [copiedJson, setCopiedJson] = useState(false);
  const [decisionModal, setDecisionModal] = useState<"APPROVE" | "REJECT" | null>(null);

  const [showRevisePanel, setShowRevisePanel] = useState(false);
  const [reviseInstruction, setReviseInstruction] = useState("");
  const [revisePort, setRevisePort] = useState("");
  const [canarySimFail, setCanarySimFail] = useState(false);

  const wfQuery = useQuery({
    queryKey: ["workflow", workflowId],
    queryFn: async () => {
      try {
        return await fetchWorkflowById(workflowId);
      } catch (err) {
        const mockMatch = mockWorkflows.find((m) => m.workflowId === workflowId);
        if (mockMatch) {
          return {
            liveStateEtag: mockMatch.currentStateEtag,
            workflow: mockMatch,
          };
        }
        throw err;
      }
    },
  });

  const decisionMutation = useMutation({
    mutationFn: (vars: {
      decision: "APPROVE" | "REJECT";
      rationale: string;
      simulateProbeFailure: boolean;
    }) =>
      submitWorkflowDecision({
        workflowId,
        decision: vars.decision,
        rationale: vars.rationale,
        simulateProbeFailure: vars.simulateProbeFailure,
      }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ["workflow", workflowId] });
      const prev = queryClient.getQueryData(["workflow", workflowId]);
      queryClient.setQueryData(["workflow", workflowId], (old: typeof wfQuery.data) => {
        if (!old) return old;
        return {
          ...old,
          workflow: {
            ...old.workflow,
            status: vars.decision === "APPROVE" ? "EXECUTING" : "REJECTED",
          },
        };
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(["workflow", workflowId], ctx.prev);
      }
      queryClient.invalidateQueries({ queryKey: ["workflow", workflowId] });
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      queryClient.invalidateQueries({ queryKey: ["audit-log"] });
    },
    onSuccess: () => {
      setDecisionModal(null);
      queryClient.invalidateQueries({ queryKey: ["workflow", workflowId] });
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      queryClient.invalidateQueries({ queryKey: ["routes"] });
      queryClient.invalidateQueries({ queryKey: ["audit-log"] });
    },
  });

  const replanMutation = useMutation({
    mutationFn: () => replanWorkflow(workflowId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      queryClient.invalidateQueries({ queryKey: ["audit-log"] });
      navigate({
        to: "/workflows/$workflowId",
        params: { workflowId: data.workflow.workflowId },
      });
    },
  });

  const reviseMutation = useMutation({
    mutationFn: () => {
      const portNum = Number(revisePort);
      return reviseWorkflow({
        workflowId,
        feedbackInstruction: reviseInstruction.trim(),
        patchRequest:
          revisePort.trim() && Number.isFinite(portNum) && portNum > 0
            ? { backendPort: portNum }
            : undefined,
      });
    },
    onSuccess: () => {
      setShowRevisePanel(false);
      setReviseInstruction("");
      setRevisePort("");
      queryClient.invalidateQueries({ queryKey: ["workflow", workflowId] });
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      queryClient.invalidateQueries({ queryKey: ["audit-log"] });
    },
  });

  const promoteCanaryMutation = useMutation({
    mutationFn: () =>
      promoteCanary({
        workflowId,
        simulateProbeFailure: canarySimFail,
      }),
    onSuccess: () => {
      setCanarySimFail(false);
      queryClient.invalidateQueries({ queryKey: ["workflow", workflowId] });
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      queryClient.invalidateQueries({ queryKey: ["routes"] });
      queryClient.invalidateQueries({ queryKey: ["audit-log"] });
    },
  });

  const rollbackMutation = useMutation({
    mutationFn: () =>
      triggerManualRollback({
        workflowId,
        reason: "Operator triggered instant deterministic rollback from control plane.",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow", workflowId] });
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      queryClient.invalidateQueries({ queryKey: ["routes"] });
      queryClient.invalidateQueries({ queryKey: ["audit-log"] });
    },
  });

  const wf = wfQuery.data?.workflow;
  const liveEtag = wfQuery.data?.liveStateEtag ?? "";

  const configurationJson = useMemo(() => {
    if (!wf) return "";
    if (jsonScope === "full") {
      return JSON.stringify(wf, null, 2);
    }
    return JSON.stringify(
      {
        workflowId: wf.workflowId,
        adkSessionId: wf.adkSessionId,
        executionMode: wf.executionMode,
        blastRadius: wf.blastRadius,
        etagVerification: {
          liveStateEtag: liveEtag,
          currentStateEtag: wf.currentStateEtag,
          targetStateEtag: wf.changePlan?.targetStateEtag ?? wf.currentStateEtag,
          verified: liveEtag === (wf.changePlan?.targetStateEtag ?? wf.currentStateEtag),
        },
        ingressRequest: wf.ingressRequest,
        pipelineConfig: wf.pipelineConfig ?? null,
        canaryState: wf.canaryState ?? null,
      },
      null,
      2
    );
  }, [wf, liveEtag, jsonScope]);

  if (wfQuery.isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-20 bg-white border border-slate-200 rounded-lg animate-pulse" />
        <div className="h-96 bg-white border border-slate-200 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (wfQuery.isError || !wf) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
        <p className="text-sm font-medium text-slate-900">Workflow not found</p>
        <p className="text-xs text-slate-500 mt-1 font-mono">{workflowId}</p>
        <Link
          to="/workflows"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:underline mt-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Workflows
        </Link>
      </div>
    );
  }

  const targetEtag = wf.changePlan?.targetStateEtag ?? wf.currentStateEtag;
  const etagMatches = liveEtag === targetEtag;
  const etagVerificationStatus =
    wf.status === "DRIFT_ABORTED"
      ? "DRIFT_ABORTED"
      : etagMatches
        ? "VERIFIED"
        : "MISMATCH";

  const activeOperator = getCurrentOperator();
  const isSelfApprovalBlocked =
    (wf.environment === "prod" || wf.blastRadius === "HIGH") &&
    activeOperator.operatorId === wf.requesterId;

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(configurationJson);
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 1800);
    } catch {
      setCopiedJson(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Governance Action Controls */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <Link
            to="/workflows"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 mb-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All Workflows
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold text-slate-900">
              {wf.appName} — {wf.ingressRequest.hostname}
              {wf.ingressRequest.pathPrefix}
            </h1>
            <StatusBadge status={wf.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1.5">
            <span className="font-mono">{wf.workflowId}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{wf.environment}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{wf.ingressRequest.exposure}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{wf.executionMode}</span>
            <span aria-hidden="true">·</span>
            <span>Requester: {wf.requesterId}</span>
            {wf.ticketRef && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{wf.ticketRef}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {wf.changePlan && (
            <button
              type="button"
              onClick={() => {
                const bundle = Object.entries(wf.changePlan!.artifacts)
                  .map(([file, content]) => `# === ${file} ===\n${content}`)
                  .join("\n\n");
                const blob = new Blob([bundle], { type: "text/yaml;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${wf.appName}-${wf.environment}-advisory.yaml`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              Export Artifacts
            </button>
          )}

          {["AWAITING_APPROVAL", "FAILED", "REJECTED", "DRIFT_ABORTED"].includes(wf.status) && (
            <button
              type="button"
              onClick={() => setShowRevisePanel((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Revise with Supervisor
            </button>
          )}

          {wf.status === "AWAITING_APPROVAL" && (
            <>
              <button
                type="button"
                onClick={() => {
                  decisionMutation.reset();
                  setDecisionModal("REJECT");
                }}
                className="px-4 py-2 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-md hover:bg-red-50 transition-colors whitespace-nowrap"
              >
                Reject Plan
              </button>
              <button
                type="button"
                onClick={() => {
                  decisionMutation.reset();
                  setDecisionModal("APPROVE");
                }}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 transition-colors whitespace-nowrap"
              >
                Approve & Execute
              </button>
            </>
          )}

          {(wf.status === "DRIFT_ABORTED" || wf.status === "REJECTED") && (
            <button
              type="button"
              onClick={() => replanMutation.mutate()}
              disabled={replanMutation.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 transition-colors whitespace-nowrap"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${replanMutation.isPending ? "animate-spin" : ""}`}
              />
              Re-Plan Against Live ETag
            </button>
          )}
        </div>
      </div>

      {/* Supervisor Feedback Revision Panel */}
      {showRevisePanel && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Supervisor Agent Feedback Loop (Iteration {wf.supervisorIteration ?? 1}/
                {wf.pipelineConfig?.maxSupervisorIterations ?? 5})
              </h2>
              <p className="text-xs text-slate-500">
                Steer the agents with new instructions or parameter tweaks—re-runs Phase A & B and
                seals a fresh ChangePlan & RollbackPlan.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input
              type="text"
              value={reviseInstruction}
              onChange={(e) => setReviseInstruction(e.target.value)}
              placeholder="e.g., Switch backend port to 9443 and verify strict TLS posture"
              className="md:col-span-3 px-3 py-2 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <input
              type="number"
              min={1}
              max={65535}
              value={revisePort}
              onChange={(e) => setRevisePort(e.target.value)}
              placeholder={`Port override (now ${wf.ingressRequest.backendPort})`}
              className="px-3 py-2 text-xs font-mono border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 tabular-nums"
            />
          </div>
          {reviseMutation.isError && (
            <p className="text-xs text-red-700">{(reviseMutation.error as Error).message}</p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowRevisePanel(false)}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={reviseInstruction.trim().length < 4 || reviseMutation.isPending}
              onClick={() => reviseMutation.mutate()}
              className="px-4 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50"
            >
              {reviseMutation.isPending ? "Re-Planning..." : "Re-Run Agents"}
            </button>
          </div>
        </div>
      )}

      {/* Staged Canary Progressive Traffic Controller */}
      {wf.executionMode === "direct_canary_v3" &&
        wf.canaryState &&
        (wf.status === "EXECUTING" || wf.status === "COMPLETED") && (
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Progressive Canary Rollout Controller (Current Traffic:{" "}
                  <span className="tabular-nums">{wf.canaryState.currentWeight}%</span>)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                  Stages: {wf.canaryState.steps.map((s) => `${s}%`).join(" -> ")} · Stage{" "}
                  {wf.canaryState.stageIndex + 1}/{wf.canaryState.steps.length}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {wf.status === "EXECUTING" && (
                  <>
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={canarySimFail}
                        onChange={(e) => setCanarySimFail(e.target.checked)}
                        className="rounded border-slate-300 text-blue-700"
                      />
                      <span>Inject HTTP 503 on Promote</span>
                    </label>
                    <button
                      type="button"
                      disabled={promoteCanaryMutation.isPending}
                      onClick={() => promoteCanaryMutation.mutate()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-60 whitespace-nowrap"
                    >
                      <ArrowUpRight className="h-3.5 w-3.5" />
                      Promote to{" "}
                      {wf.canaryState.steps[
                        Math.min(wf.canaryState.stageIndex + 1, wf.canaryState.steps.length - 1)
                      ]}
                      %
                    </button>
                  </>
                )}

                <button
                  type="button"
                  disabled={rollbackMutation.isPending}
                  onClick={() => rollbackMutation.mutate()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-md hover:bg-red-50 whitespace-nowrap"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Instant Deterministic Rollback
                </button>
              </div>
            </div>

            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-700 transition-all"
                style={{ width: `${wf.canaryState.currentWeight}%` }}
              />
            </div>
          </div>
        )}

      {/* Error / Probe Alerts */}
      {wf.errorMessage && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg text-xs text-red-900">
          <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Execution Halted</div>
            <p className="mt-0.5">{wf.errorMessage}</p>
          </div>
        </div>
      )}

      {wf.probeResult && (
        <div
          className={`flex items-start gap-3 p-4 border rounded-lg text-xs ${
            wf.probeResult.passed
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-amber-50 border-amber-200 text-amber-900"
          }`}
        >
          {wf.probeResult.passed ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
          ) : (
            <RotateCcw className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <div className="font-semibold">
              {wf.probeResult.passed
                ? "Post-Apply Synthetic Probe Passed"
                : "Synthetic Probe Failed — Deterministic Rollback Executed"}
            </div>
            <p className="mt-0.5">{wf.probeResult.detail}</p>
            <div className="mt-1.5 font-mono text-[11px] opacity-85 flex flex-wrap gap-3 tabular-nums">
              <span>HTTP {wf.probeResult.httpStatus}</span>
              <span>Latency: {wf.probeResult.latencyMs}ms</span>
              <span>DNS: {wf.probeResult.dnsResolved ? "OK" : "FAIL"}</span>
              <span>TLS 1.3: {wf.probeResult.tlsVerified ? "OK" : "FAIL"}</span>
              {wf.probeResult.probes && <span>WAF: {wf.probeResult.probes.wafEnforcement}</span>}
              {wf.gitopsPrUrl && (
                <span className="inline-flex items-center gap-1">
                  <ExternalLink className="h-3 w-3" />
                  {wf.gitopsPrUrl}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Primary Summary Strip: ETag Verification, Blast Radius Score & Approval Gate */}
      <div className="grid grid-cols-1 lg:grid-cols-3 bg-white border border-slate-200 rounded-lg divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
        <div className="p-5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">ETag Verification Status</span>
            <span className="text-xs font-mono font-semibold text-slate-700">
              {etagVerificationStatus}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {etagMatches ? (
              <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
            )}
            <span
              className={`text-sm font-semibold ${
                etagMatches ? "text-emerald-700" : "text-red-700"
              }`}
            >
              {etagMatches
                ? "Verified — Live State Matches Plan ETag"
                : "Mismatch — Infrastructure Drift Detected"}
            </span>
          </div>
          <div className="text-[11px] font-mono text-slate-500 truncate tabular-nums">
            Target ETag: {targetEtag}
          </div>
          <div className="text-[11px] font-mono text-slate-500 truncate tabular-nums">
            Live ETag: {liveEtag}
          </div>
        </div>

        <div className="p-5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Blast Radius Score</span>
            <span className="text-xs font-mono font-semibold text-slate-800 tabular-nums">
              {wf.blastRadius}
            </span>
          </div>
          <div className="pt-0.5">
            <BlastRadiusText score={wf.blastRadius} />
          </div>
          <div className="text-xs font-mono text-slate-700 pt-1 tabular-nums">
            {wf.ingressRequest.backendService}:{wf.ingressRequest.backendPort} ·{" "}
            {wf.ingressRequest.tlsProfile}
          </div>
          <div className="text-[11px] font-mono text-slate-500 truncate">
            {wf.changePlan
              ? `Plan Digest: ${wf.changePlan.planDigestSha256.slice(0, 24)}...`
              : `Request ID: ${wf.ingressRequest.requestId}`}
          </div>
        </div>

        <div className="p-5 space-y-1.5">
          <div className="text-xs font-medium text-slate-500">Approval & RBAC Gate</div>
          {wf.approvalDecision ? (
            <>
              <div className="text-sm font-semibold text-slate-900">
                {wf.approvalDecision.decision} by {wf.approvalDecision.reviewerId}
              </div>
              <div className="text-xs text-slate-600 line-clamp-2">
                “{wf.approvalDecision.rationale}”
              </div>
              <div className="text-[11px] font-mono text-slate-500 truncate">
                HMAC: {wf.approvalDecision.signature.slice(0, 24)}...
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                <Lock className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                <span>Four-Eyes Enforcement Active</span>
              </div>
              <p className="text-xs text-slate-500">
                {isSelfApprovalBlocked
                  ? `Active operator (${activeOperator.operatorId}) is the requester and cannot self-approve.`
                  : "Signed HMAC token required before ExecutionAgent unlocks write tools."}
              </p>
            </>
          )}
        </div>
      </div>

      {/* Inspector Tabs (Configuration JSON first-class + Diffs / Rollback / Policy / Agent Pipeline) */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
          {(
            [
              ["config", "Configuration JSON"],
              ["diffs", "YAML / HCL Diffs"],
              ["rollback", "Deterministic RollbackPlan"],
              ["policy", "Policy Matrix"],
              ["traces", "ADK Agent Pipeline"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setInspectorTab(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                inspectorTab === key
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {inspectorTab === "config" && (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileJson className="h-4 w-4 text-slate-600 shrink-0" />
                <span className="text-xs font-semibold text-slate-900">
                  Full Ingress Configuration JSON
                </span>
                <span className="text-xs text-slate-500">·</span>
                <span className="text-xs font-mono text-slate-600">
                  {wf.ingressRequest.hostname}
                  {wf.ingressRequest.pathPrefix}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 p-0.5 bg-slate-200/70 rounded-md">
                  <button
                    type="button"
                    onClick={() => setJsonScope("config")}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      jsonScope === "config"
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Ingress & Pipeline Config
                  </button>
                  <button
                    type="button"
                    onClick={() => setJsonScope("full")}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      jsonScope === "full"
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Full Workflow Record
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleCopyJson}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
                >
                  {copiedJson ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Copy JSON
                    </>
                  )}
                </button>
              </div>
            </div>

            <pre className="p-4 text-xs font-mono leading-relaxed bg-slate-950 text-slate-100 overflow-x-auto max-h-[540px] tabular-nums">
              {configurationJson}
            </pre>
          </div>
        )}

        {inspectorTab === "diffs" && (
          <div className="space-y-4">
            {wf.changePlan ? (
              wf.changePlan.diffs.map((hunk) => (
                <div
                  key={hunk.filePath}
                  className="bg-white border border-slate-200 rounded-lg overflow-hidden"
                >
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-4">
                    <div className="text-xs font-mono font-medium text-slate-900">
                      {hunk.filePath} · {hunk.resourceKind}
                    </div>
                    <div className="text-xs font-mono tabular-nums flex items-center gap-3">
                      <span className="text-emerald-700">+{hunk.linesAdded}</span>
                      <span className="text-red-700">-{hunk.linesRemoved}</span>
                    </div>
                  </div>
                  <pre className="p-4 text-xs font-mono overflow-x-auto leading-relaxed bg-slate-950 text-slate-100">
                    {hunk.unifiedDiff.split("\n").map((line, i) => {
                      const cls =
                        line.startsWith("+") && !line.startsWith("+++")
                          ? "text-emerald-400 bg-emerald-950/40 block px-2 -mx-2"
                          : line.startsWith("-") && !line.startsWith("---")
                            ? "text-red-400 bg-red-950/40 block px-2 -mx-2"
                            : "text-slate-300 block";
                      return (
                        <span key={i} className={cls}>
                          {line}
                        </span>
                      );
                    })}
                  </pre>
                </div>
              ))
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg p-6 text-xs text-slate-500">
                No synthesized ChangePlan artifacts are sealed for this workflow yet.
              </div>
            )}
          </div>
        )}

        {inspectorTab === "rollback" && (
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            {wf.changePlan ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      Pre-Computed Deterministic RollbackPlan
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Sealed before human approval; executed directly without LLM inference if
                      synthetic probes fail.
                    </p>
                  </div>
                  <div className="text-xs font-mono text-slate-700 tabular-nums">
                    Strategy: {wf.changePlan.rollbackPlan.strategy} · SLA ≤{" "}
                    {wf.changePlan.rollbackPlan.maxRollbackSeconds}s
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-slate-700 mb-2">
                    Post-Apply Verification Probes
                  </h3>
                  <ul className="space-y-1 text-xs font-mono text-slate-700">
                    {wf.changePlan.rollbackPlan.verificationProbes.map((p) => (
                      <li key={p}>• {p}</li>
                    ))}
                  </ul>
                </div>

                {Object.entries(wf.changePlan.rollbackPlan.precomputedArtifacts).map(
                  ([filePath, content]) => (
                    <div
                      key={filePath}
                      className="border border-slate-200 rounded-md overflow-hidden"
                    >
                      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-mono text-slate-800">
                        Restore Target: {filePath}
                      </div>
                      <pre className="p-4 text-xs font-mono bg-slate-950 text-slate-100 overflow-x-auto">
                        {content}
                      </pre>
                    </div>
                  )
                )}
              </>
            ) : (
              <p className="text-xs text-slate-500">
                No RollbackPlan has been synthesized for this workflow yet.
              </p>
            )}
          </div>
        )}

        {inspectorTab === "policy" && (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            {wf.changePlan ? (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Control ID</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">
                      Policy Rule
                    </th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Result</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {wf.changePlan.policyChecks.map((chk) => (
                    <tr key={chk.controlId}>
                      <td className="px-4 py-3 font-mono text-slate-800 whitespace-nowrap">
                        {chk.controlId}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">{chk.controlName}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {chk.passed ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Pass
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-700 font-medium">
                            <XCircle className="h-3.5 w-3.5" />
                            Block
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{chk.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-6 text-xs text-slate-500">
                Policy checks are not yet available for this workflow.
              </div>
            )}
          </div>
        )}

        {inspectorTab === "traces" && (
          <div className="space-y-5">
            <LiveAgentFlowDiagram workflow={wf} liveEtag={liveEtag} compact />
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Agent</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Phase</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">
                      Credential Scope
                    </th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">State</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Summary</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-slate-600 text-right">
                      Latency
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {wf.agentTraces.map((tr, idx) => (
                    <tr key={`${tr.agentName}-${idx}`}>
                      <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">
                        {tr.agentName}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-600 whitespace-nowrap">
                        {tr.phase}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-700 whitespace-nowrap">
                        {tr.accessMode}
                      </td>
                      <td className="px-4 py-3 font-medium whitespace-nowrap text-slate-800">
                        {tr.status}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{tr.summary}</td>
                      <td className="px-4 py-3 font-mono tabular-nums text-slate-500 text-right whitespace-nowrap">
                        {tr.durationMs ? `${tr.durationMs}ms` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Reusable RBAC ApprovalModal */}
      <ApprovalModal
        open={Boolean(decisionModal)}
        onClose={() => setDecisionModal(null)}
        changePlan={wf.changePlan}
        blastRadius={wf.blastRadius}
        appName={wf.appName}
        hostname={wf.ingressRequest.hostname}
        pathPrefix={wf.ingressRequest.pathPrefix}
        environment={wf.environment}
        executionMode={wf.executionMode}
        requesterId={wf.requesterId}
        liveStateEtag={liveEtag}
        initialAction={decisionModal}
        isSubmitting={decisionMutation.isPending}
        errorMessage={
          decisionMutation.isError ? (decisionMutation.error as Error).message : null
        }
        onSubmitDecision={(payload) => decisionMutation.mutate(payload)}
      />
    </div>
  );
}

export default WorkflowDetailRouteView;
