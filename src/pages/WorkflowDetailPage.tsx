import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Lock,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { LiveAgentFlowDiagram } from "../components/LiveAgentFlowDiagram";
import { BlastRadiusText, WorkflowStatusText } from "../components/StatusLabel";
import {
  fetchWorkflowById,
  getCurrentOperator,
  replanWorkflow,
  submitWorkflowDecision,
} from "../lib/api";

export function WorkflowDetailPage() {
  const { workflowId } = useParams({ from: "/workflows/$workflowId" });
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [inspectorTab, setInspectorTab] = useState<
    "diffs" | "rollback" | "policy" | "traces"
  >("diffs");
  const [decisionModal, setDecisionModal] = useState<"APPROVE" | "REJECT" | null>(null);
  const [rationale, setRationale] = useState("");
  const [simulateProbeFailure, setSimulateProbeFailure] = useState(false);

  const wfQuery = useQuery({
    queryKey: ["workflow", workflowId],
    queryFn: () => fetchWorkflowById(workflowId),
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
      setRationale("");
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

  if (wfQuery.isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-20 bg-white border border-slate-200 rounded-lg animate-pulse" />
        <div className="h-96 bg-white border border-slate-200 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (wfQuery.isError || !wfQuery.data?.workflow) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
        <p className="text-sm font-medium text-slate-900">Workflow not found</p>
        <Link
          to="/workflows"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:underline mt-3"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Workflows
        </Link>
      </div>
    );
  }

  const wf = wfQuery.data.workflow;
  const liveEtag = wfQuery.data.liveStateEtag;
  const targetEtag = wf.changePlan?.targetStateEtag ?? wf.currentStateEtag;
  const etagMatches = liveEtag === targetEtag;
  const activeOperator = getCurrentOperator();
  const isSelfApprovalBlocked =
    (wf.environment === "prod" || wf.blastRadius === "HIGH") &&
    activeOperator.operatorId === wf.requesterId;

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb Return & Primary Governance Actions */}
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
            <WorkflowStatusText status={wf.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1.5">
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

        <div className="flex items-center gap-2 shrink-0">
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
              <RefreshCw className={`h-3.5 w-3.5 ${replanMutation.isPending ? "animate-spin" : ""}`} />
              Re-Plan Against Live ETag
            </button>
          )}
        </div>
      </div>

      {/* Error / Drift / Rollback Alert Banner */}
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
            <div className="mt-1.5 font-mono text-[11px] opacity-85 flex flex-wrap gap-3">
              <span>HTTP {wf.probeResult.httpStatus}</span>
              <span>Latency: {wf.probeResult.latencyMs}ms</span>
              <span>DNS: {wf.probeResult.dnsResolved ? "OK" : "FAIL"}</span>
              <span>TLS 1.3: {wf.probeResult.tlsVerified ? "OK" : "FAIL"}</span>
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

      {/* TOCTOU State Lock & Governance Telemetry Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 bg-white border border-slate-200 rounded-lg divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
        <div className="p-4 space-y-1">
          <div className="text-xs font-medium text-slate-500">TOCTOU Anti-Drift ETag Lock</div>
          <div className="flex items-center gap-2">
            {etagMatches ? (
              <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
            )}
            <span
              className={`text-xs font-semibold ${
                etagMatches ? "text-emerald-700" : "text-red-700"
              }`}
            >
              {etagMatches ? "Live State Matches Plan ETag" : "Drift Detected (ETag Mismatch)"}
            </span>
          </div>
          <div className="text-[11px] font-mono text-slate-500 truncate">
            Plan: {targetEtag}
          </div>
          <div className="text-[11px] font-mono text-slate-500 truncate">
            Live: {liveEtag}
          </div>
        </div>

        <div className="p-4 space-y-1">
          <div className="text-xs font-medium text-slate-500">Impact & Backend Target</div>
          <BlastRadiusText score={wf.blastRadius} />
          <div className="text-xs font-mono text-slate-700 pt-1">
            {wf.ingressRequest.backendService}:{wf.ingressRequest.backendPort} ·{" "}
            {wf.ingressRequest.tlsProfile}
          </div>
          <div className="text-[11px] font-mono text-slate-500 truncate">
            Digest: {wf.changePlan?.planDigestSha256.slice(0, 24)}...
          </div>
        </div>

        <div className="p-4 space-y-1">
          <div className="text-xs font-medium text-slate-500">Approval & RBAC Gate</div>
          {wf.approvalDecision ? (
            <>
              <div className="text-xs font-semibold text-slate-900">
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
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                <Lock className="h-3.5 w-3.5 text-slate-500" />
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

      {/* Inspector Tabs */}
      <div className="space-y-4">
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
          {(
            [
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
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                inspectorTab === key
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {inspectorTab === "diffs" && wf.changePlan && (
          <div className="space-y-4">
            {wf.changePlan.diffs.map((hunk) => (
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
                    const cls = line.startsWith("+") && !line.startsWith("+++")
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
            ))}
          </div>
        )}

        {inspectorTab === "rollback" && wf.changePlan && (
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Pre-Computed Deterministic RollbackPlan
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Sealed before human approval; executed directly without LLM inference if synthetic probes fail.
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
                <div key={filePath} className="border border-slate-200 rounded-md overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-mono text-slate-800">
                    Restore Target: {filePath}
                  </div>
                  <pre className="p-4 text-xs font-mono bg-slate-950 text-slate-100 overflow-x-auto">
                    {content}
                  </pre>
                </div>
              )
            )}
          </div>
        )}

        {inspectorTab === "policy" && wf.changePlan && (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Control ID</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Policy Rule</th>
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

      {/* RBAC Approve / Reject Modal */}
      {decisionModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-lg p-6 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {decisionModal === "APPROVE"
                  ? "Sign Approval Token & Execute"
                  : "Reject Ingress Change Plan"}
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Reviewer: <span className="font-mono">{activeOperator.operatorId}</span> · Roles:{" "}
                <span className="font-mono">{activeOperator.roles.join(", ")}</span>
              </p>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-xs font-mono text-slate-700 space-y-1">
              <div className="truncate">Target ETag: {targetEtag}</div>
              <div className="truncate">
                Plan Digest: {wf.changePlan?.planDigestSha256}
              </div>
            </div>

            <div>
              <label
                htmlFor="reviewer-rationale"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Reviewer Rationale (Minimum 12 characters, recorded to immutable audit log)
              </label>
              <textarea
                id="reviewer-rationale"
                rows={3}
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder={
                  decisionModal === "APPROVE"
                    ? "Verified TLS 1.3 strict profile, WAF binding, and canary rollback readiness."
                    : "Blocking rollout due to maintenance window freeze."
                }
                className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {decisionModal === "APPROVE" && wf.executionMode === "direct_canary_v3" && (
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={simulateProbeFailure}
                  onChange={(e) => setSimulateProbeFailure(e.target.checked)}
                  className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                />
                <span>
                  Simulate synthetic probe failure (HTTP 503) to test deterministic auto-rollback
                </span>
              </label>
            )}

            {decisionMutation.isError && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-800">
                <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                <span>{(decisionMutation.error as Error).message}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDecisionModal(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={rationale.trim().length < 12 || decisionMutation.isPending}
                onClick={() =>
                  decisionMutation.mutate({
                    decision: decisionModal,
                    rationale: rationale.trim(),
                    simulateProbeFailure,
                  })
                }
                className={`px-4 py-2 text-xs font-medium text-white rounded-md disabled:opacity-50 transition-colors ${
                  decisionModal === "APPROVE"
                    ? "bg-blue-700 hover:bg-blue-800"
                    : "bg-red-700 hover:bg-red-800"
                }`}
              >
                {decisionMutation.isPending
                  ? "Verifying..."
                  : decisionModal === "APPROVE"
                    ? "Sign & Execute"
                    : "Confirm Rejection"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
