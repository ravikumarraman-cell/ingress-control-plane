import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  FileJson,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import { LiveAgentFlowDiagram } from "../components/LiveAgentFlowDiagram";
import { ApprovalModal } from "../components/ui/ApprovalModal";
import { CodeViewer } from "../components/ui/CodeViewer";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { SegmentedTabs } from "../components/ui/SegmentedTabs";
import { StatusBadge } from "../components/ui/StatusBadge";
import { CanaryRolloutPanel } from "../components/workflows/CanaryRolloutPanel";
import { DiffHunkCard } from "../components/workflows/DiffHunkCard";
import { SupervisorRevisePanel } from "../components/workflows/SupervisorRevisePanel";
import { WorkflowSummaryStrip } from "../components/workflows/WorkflowSummaryStrip";
import {
  fetchWorkflowById,
  getCurrentOperator,
  promoteCanary,
  replanWorkflow,
  reviseWorkflow,
  submitWorkflowDecision,
  triggerManualRollback,
} from "../lib/api";
import { downloadTextFile } from "../lib/format";
import { mockWorkflows } from "../lib/mockData";

export function WorkflowDetailRouteView() {
  const { workflowId } = useParams({ from: "/workflows/$workflowId" });
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [inspectorTab, setInspectorTab] = useState<
    "config" | "diffs" | "rollback" | "policy" | "traces"
  >("config");
  const [jsonScope, setJsonScope] = useState<"config" | "full">("config");
  const [decisionModal, setDecisionModal] = useState<"APPROVE" | "REJECT" | null>(null);
  const [showRevisePanel, setShowRevisePanel] = useState(false);

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

  const invalidateRelated = (includeRoutes = false) => {
    queryClient.invalidateQueries({ queryKey: ["workflow", workflowId] });
    queryClient.invalidateQueries({ queryKey: ["workflows"] });
    queryClient.invalidateQueries({ queryKey: ["audit-log"] });
    if (includeRoutes) {
      queryClient.invalidateQueries({ queryKey: ["routes"] });
    }
  };

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
      invalidateRelated(false);
    },
    onSuccess: () => {
      setDecisionModal(null);
      invalidateRelated(true);
    },
  });

  const replanMutation = useMutation({
    mutationFn: () => replanWorkflow(workflowId),
    onSuccess: (data) => {
      invalidateRelated(false);
      navigate({
        to: "/workflows/$workflowId",
        params: { workflowId: data.workflow.workflowId },
      });
    },
  });

  const reviseMutation = useMutation({
    mutationFn: (payload: { instruction: string; backendPort?: number }) =>
      reviseWorkflow({
        workflowId,
        feedbackInstruction: payload.instruction,
        patchRequest: payload.backendPort ? { backendPort: payload.backendPort } : undefined,
      }),
    onSuccess: () => {
      setShowRevisePanel(false);
      invalidateRelated(false);
    },
  });

  const promoteCanaryMutation = useMutation({
    mutationFn: (simulateProbeFailure: boolean) =>
      promoteCanary({
        workflowId,
        simulateProbeFailure,
      }),
    onSuccess: () => invalidateRelated(true),
  });

  const rollbackMutation = useMutation({
    mutationFn: () =>
      triggerManualRollback({
        workflowId,
        reason: "Operator triggered instant deterministic rollback from control plane.",
      }),
    onSuccess: () => invalidateRelated(true),
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
      <EmptyState
        className="bg-white border border-slate-200 rounded-lg"
        title="Workflow not found"
        description={workflowId}
        action={
          <Link
            to="/workflows"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Workflows
          </Link>
        }
      />
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

  const policyChecks = wf.changePlan?.policyChecks ?? [];
  const passedChecksCount = policyChecks.filter((c) => c.passed).length;
  const totalChecksCount = policyChecks.length;
  const diffCount = wf.changePlan?.diffs.length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        backLink={
          <Link
            to="/workflows"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All Workflows
          </Link>
        }
        title={`${wf.appName} — ${wf.ingressRequest.hostname}${wf.ingressRequest.pathPrefix}`}
        badge={<StatusBadge status={wf.status} />}
        subtitle={
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
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
        }
        actions={
          <>
            {wf.changePlan && (
              <button
                type="button"
                onClick={() => {
                  const bundle = Object.entries(wf.changePlan!.artifacts)
                    .map(([file, content]) => `# === ${file} ===\n${content}`)
                    .join("\n\n");
                  downloadTextFile(
                    `${wf.appName}-${wf.environment}-advisory.yaml`,
                    bundle,
                    "text/yaml;charset=utf-8"
                  );
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
          </>
        }
      />

      {showRevisePanel && (
        <SupervisorRevisePanel
          iteration={wf.supervisorIteration ?? 1}
          maxIterations={wf.pipelineConfig?.maxSupervisorIterations ?? 5}
          currentPort={wf.ingressRequest.backendPort}
          isPending={reviseMutation.isPending}
          errorMessage={reviseMutation.isError ? (reviseMutation.error as Error).message : null}
          onCancel={() => setShowRevisePanel(false)}
          onSubmit={(payload) => reviseMutation.mutate(payload)}
        />
      )}

      <CanaryRolloutPanel
        workflow={wf}
        isPromotePending={promoteCanaryMutation.isPending}
        isRollbackPending={rollbackMutation.isPending}
        onPromote={(simFail) => promoteCanaryMutation.mutate(simFail)}
        onRollback={() => rollbackMutation.mutate()}
      />

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

      {wf.status === "AWAITING_APPROVAL" && (
        <div className="bg-amber-50/70 border border-amber-200 rounded-lg px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-0.5">
            <div className="text-xs font-semibold text-amber-900">
              Action Needed — ExecutionAgent Locked at HITL Gate
            </div>
            <p className="text-xs text-amber-800 tabular-nums">
              {totalChecksCount > 0
                ? `${passedChecksCount}/${totalChecksCount} policy checks passed`
                : "Policy evaluation pending"}
              {" · "}
              {etagMatches ? "Live ETag verified" : "ETag mismatch detected"}
              {" · "}
              {isSelfApprovalBlocked
                ? `Switch operator role in sidebar (${activeOperator.operatorId} cannot self-approve)`
                : "Ready for signed four-eyes decision"}
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              decisionMutation.reset();
              setDecisionModal("APPROVE");
            }}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0"
          >
            Review & Sign
          </button>
        </div>
      )}

      <WorkflowSummaryStrip
        workflow={wf}
        liveStateEtag={liveEtag}
        etagVerificationStatus={etagVerificationStatus}
        etagMatches={etagMatches}
        targetEtag={targetEtag}
        isSelfApprovalBlocked={isSelfApprovalBlocked}
        activeOperatorId={activeOperator.operatorId}
      />

      <div className="space-y-4">
        <SegmentedTabs
          ariaLabel="Workflow inspector tabs"
          value={inspectorTab}
          onChange={setInspectorTab}
          items={[
            { id: "config", label: "Configuration JSON" },
            { id: "diffs", label: "YAML / HCL Diffs", count: diffCount },
            { id: "rollback", label: "Deterministic RollbackPlan" },
            {
              id: "policy",
              label: "Policy Matrix",
              count: totalChecksCount > 0 ? `${passedChecksCount}/${totalChecksCount}` : undefined,
            },
            { id: "traces", label: "ADK Agent Pipeline", count: wf.agentTraces.length },
          ]}
        />

        {inspectorTab === "config" && (
          <CodeViewer
            title={
              <>
                <FileJson className="h-4 w-4 text-slate-600 shrink-0" />
                <span>Full Ingress Configuration JSON</span>
                <span className="text-slate-400">·</span>
                <span className="font-mono font-normal text-slate-600">
                  {wf.ingressRequest.hostname}
                  {wf.ingressRequest.pathPrefix}
                </span>
              </>
            }
            headerActions={
              <SegmentedTabs
                size="sm"
                ariaLabel="Configuration JSON scope"
                value={jsonScope}
                onChange={setJsonScope}
                items={[
                  { id: "config", label: "Ingress & Pipeline Config" },
                  { id: "full", label: "Full Workflow Record" },
                ]}
              />
            }
            code={configurationJson}
            copyLabel="Copy JSON"
            maxHeightClass="max-h-[540px]"
          />
        )}

        {inspectorTab === "diffs" && (
          <div className="space-y-4">
            {wf.changePlan ? (
              wf.changePlan.diffs.map((hunk) => <DiffHunkCard key={hunk.filePath} hunk={hunk} />)
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
                    <CodeViewer
                      key={filePath}
                      title={<span className="font-mono">Restore Target: {filePath}</span>}
                      code={content}
                      copyLabel="Copy Artifact"
                      maxHeightClass="max-h-[360px]"
                    />
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
