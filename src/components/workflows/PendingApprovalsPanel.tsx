import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileCode2,
  Lock,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { getCurrentOperator, replanWorkflow, submitWorkflowDecision } from "../../lib/api";
import { formatTimeHMS, shortHash } from "../../lib/format";
import type { ActiveIngressRoute, WorkflowRun } from "../../shared/contracts";
import { BlastRadiusText } from "../StatusLabel";
import { ApprovalModal } from "../ui/ApprovalModal";
import { EmptyState } from "../ui/EmptyState";
import { EtagLockIndicator } from "../ui/EtagLockIndicator";
import { DiffHunkCard } from "./DiffHunkCard";

const BLAST_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const MIN_RATIONALE_LEN = 12;

export interface PendingApprovalsPanelProps {
  workflows: WorkflowRun[];
  routes: ActiveIngressRoute[];
  liveStateEtag: string;
  isLoading?: boolean;
  showInboxLink?: boolean;
}

export function PendingApprovalsPanel({
  workflows,
  routes,
  liveStateEtag,
  isLoading = false,
  showInboxLink = true,
}: PendingApprovalsPanelProps) {
  const queryClient = useQueryClient();
  const activeOperator = getCurrentOperator();

  const [rationales, setRationales] = useState<Record<string, string>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [expandedDiffIds, setExpandedDiffIds] = useState<Record<string, boolean>>({});
  const [submittingWorkflowId, setSubmittingWorkflowId] = useState<string | null>(null);
  const [submittingAction, setSubmittingAction] = useState<"APPROVE" | "REJECT" | null>(null);
  const [replanningWorkflowId, setReplanningWorkflowId] = useState<string | null>(null);
  const [recentOutcome, setRecentOutcome] = useState<string | null>(null);

  const [modalState, setModalState] = useState<{
    workflow: WorkflowRun;
    initialAction: "APPROVE" | "REJECT" | null;
  } | null>(null);

  const rationaleRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const pendingWorkflows = useMemo(() => {
    return workflows
      .filter((w) => w.status === "AWAITING_APPROVAL")
      .sort((a, b) => {
        const blastDiff = (BLAST_ORDER[a.blastRadius] ?? 9) - (BLAST_ORDER[b.blastRadius] ?? 9);
        if (blastDiff !== 0) return blastDiff;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
  }, [workflows]);

  const routeByMatch = useMemo(() => {
    const map = new Map<string, ActiveIngressRoute>();
    for (const r of routes) {
      map.set(`${r.environment}|${r.hostname}|${r.pathPrefix}`, r);
      map.set(`${r.environment}|${r.appName}`, r);
    }
    return map;
  }, [routes]);

  const decisionMutation = useMutation({
    mutationFn: (vars: {
      workflowId: string;
      decision: "APPROVE" | "REJECT";
      rationale: string;
      simulateProbeFailure: boolean;
    }) => submitWorkflowDecision(vars),
    onMutate: (vars) => {
      setSubmittingWorkflowId(vars.workflowId);
      setSubmittingAction(vars.decision);
      setActionErrors((prev) => {
        const next = { ...prev };
        delete next[vars.workflowId];
        return next;
      });
    },
    onSuccess: (data, vars) => {
      setModalState(null);
      setRationales((prev) => {
        const next = { ...prev };
        delete next[vars.workflowId];
        return next;
      });
      setValidationErrors((prev) => {
        const next = { ...prev };
        delete next[vars.workflowId];
        return next;
      });
      const verb = vars.decision === "APPROVE" ? "Authorized & executed" : "Rejected";
      setRecentOutcome(
        `${verb} ${data.workflow.appName} (${data.workflow.environment}) — workflow status is now ${data.workflow.status}.`
      );
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      queryClient.invalidateQueries({ queryKey: ["routes"] });
      queryClient.invalidateQueries({ queryKey: ["audit-log"] });
      queryClient.invalidateQueries({ queryKey: ["workflow", vars.workflowId] });
    },
    onError: (err, vars) => {
      setActionErrors((prev) => ({
        ...prev,
        [vars.workflowId]: (err as Error).message,
      }));
    },
    onSettled: () => {
      setSubmittingWorkflowId(null);
      setSubmittingAction(null);
    },
  });

  const replanMutation = useMutation({
    mutationFn: (workflowId: string) => replanWorkflow(workflowId),
    onMutate: (workflowId) => {
      setReplanningWorkflowId(workflowId);
      setActionErrors((prev) => {
        const next = { ...prev };
        delete next[workflowId];
        return next;
      });
    },
    onSuccess: (data) => {
      setRecentOutcome(
        `Re-planned ${data.workflow.appName} against Live ETag ${shortHash(data.liveStateEtag, 16)}. Fresh ChangePlan is ready for HITL review.`
      );
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      queryClient.invalidateQueries({ queryKey: ["routes"] });
      queryClient.invalidateQueries({ queryKey: ["audit-log"] });
    },
    onError: (err, workflowId) => {
      setActionErrors((prev) => ({
        ...prev,
        [workflowId]: (err as Error).message,
      }));
    },
    onSettled: () => {
      setReplanningWorkflowId(null);
    },
  });

  const handleQuickDecision = (wf: WorkflowRun, decision: "APPROVE" | "REJECT") => {
    const text = (rationales[wf.workflowId] ?? "").trim();
    if (text.length < MIN_RATIONALE_LEN) {
      setValidationErrors((prev) => ({
        ...prev,
        [wf.workflowId]: `Enter at least ${MIN_RATIONALE_LEN} characters of authorization rationale before submitting (or click Review Diff & Sign).`,
      }));
      rationaleRefs.current[wf.workflowId]?.focus();
      return;
    }

    setValidationErrors((prev) => {
      const next = { ...prev };
      delete next[wf.workflowId];
      return next;
    });

    decisionMutation.mutate({
      workflowId: wf.workflowId,
      decision,
      rationale: text,
      simulateProbeFailure: false,
    });
  };

  if (isLoading) {
    return (
      <section
        aria-label="Pending Approvals"
        className="bg-white border border-slate-200 rounded-lg overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="h-5 w-44 bg-slate-100 rounded animate-pulse" />
          <div className="h-4 w-32 bg-slate-100 rounded animate-pulse" />
        </div>
        <div className="p-5 space-y-4">
          <div className="h-32 bg-slate-50 border border-slate-200 rounded-md animate-pulse" />
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Pending Approvals"
      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <ShieldAlert
              className={`h-4 w-4 shrink-0 ${
                pendingWorkflows.length > 0 ? "text-amber-600" : "text-slate-400"
              }`}
            />
            <h2 className="text-base font-semibold text-slate-900">Pending Approvals</h2>
            <span
              className={`text-xs font-mono font-semibold tabular-nums ${
                pendingWorkflows.length > 0 ? "text-amber-700" : "text-slate-500"
              }`}
            >
              {pendingWorkflows.length} awaiting HITL release
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Inspect requested ingress configuration diffs, verify cluster ETag lock, and sign
            four-eyes Human-in-the-Loop authorization.
          </p>
        </div>

        <div className="flex items-center gap-4 shrink-0 flex-wrap">
          <div className="text-xs text-slate-500 font-mono truncate max-w-[260px]">
            Signer: <span className="text-slate-800 font-medium">{activeOperator.operatorId}</span>
          </div>
          {showInboxLink && (
            <Link
              to="/approvals"
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
            >
              Approval Inbox
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>

      {recentOutcome && (
        <div className="px-5 py-2.5 bg-emerald-50 border-b border-emerald-200 flex items-center justify-between gap-3 text-xs text-emerald-900">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>{recentOutcome}</span>
          </div>
          <button
            type="button"
            onClick={() => setRecentOutcome(null)}
            className="text-emerald-700 hover:underline font-medium whitespace-nowrap"
          >
            Dismiss
          </button>
        </div>
      )}

      {pendingWorkflows.length === 0 ? (
        <EmptyState
          title="No pending ingress approvals"
          description="All sealed ChangePlans have been decided. New production or high-blast-radius ingress requests will pause here for HITL sign-off."
        />
      ) : (
        <div className="divide-y divide-slate-200">
          {pendingWorkflows.map((wf) => {
            const req = wf.ingressRequest;
            const liveRoute =
              routeByMatch.get(`${wf.environment}|${req.hostname}|${req.pathPrefix}`) ??
              routeByMatch.get(`${wf.environment}|${wf.appName}`);

            const plan = wf.changePlan;
            const diffs = plan?.diffs ?? [];
            const totalAdded = diffs.reduce((sum, d) => sum + d.linesAdded, 0);
            const totalRemoved = diffs.reduce((sum, d) => sum + d.linesRemoved, 0);
            const policyChecks = plan?.policyChecks ?? [];
            const passedChecks = policyChecks.filter((c) => c.passed).length;
            const targetEtag = plan?.targetStateEtag ?? wf.currentStateEtag;

            const isSelfApprovalBlocked =
              (wf.environment === "prod" || wf.blastRadius === "HIGH") &&
              activeOperator.operatorId === wf.requesterId;

            const isExpanded = Boolean(expandedDiffIds[wf.workflowId]);
            const rationaleVal = rationales[wf.workflowId] ?? "";
            const trimmedLen = rationaleVal.trim().length;
            const isRowSubmitting =
              decisionMutation.isPending && submittingWorkflowId === wf.workflowId;

            const backendChanged =
              !liveRoute ||
              liveRoute.backendService !== req.backendService ||
              liveRoute.backendPort !== req.backendPort;
            const tlsChanged = !liveRoute || liveRoute.tlsProfile !== req.tlsProfile;
            const exposureChanged = !liveRoute || liveRoute.exposure !== req.exposure;
            const canaryPreview =
              wf.executionMode === "direct_canary_v3"
                ? `${wf.pipelineConfig?.canarySteps?.[0] ?? 25}% canary`
                : wf.executionMode === "gitops_pr_v2"
                  ? "GitOps PR"
                  : "Advisory";

            return (
              <div key={wf.workflowId} className="p-5 space-y-4">
                {/* Row 1: Request Identity & Status Summary */}
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <Link
                        to="/workflows/$workflowId"
                        params={{ workflowId: wf.workflowId }}
                        className="text-sm font-semibold text-slate-900 hover:text-blue-700 hover:underline"
                      >
                        {wf.appName}
                      </Link>
                      <span className="text-xs font-mono text-slate-600">
                        {req.hostname}
                        {req.pathPrefix}
                      </span>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <BlastRadiusText score={wf.blastRadius} />
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <EtagLockIndicator
                        variant="compact"
                        targetEtag={targetEtag}
                        liveStateEtag={liveStateEtag}
                        workflowStatus={wf.status}
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 tabular-nums">
                      <span>
                        Env: <span className="font-mono text-slate-700">{wf.environment}</span>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Mode: <span className="font-mono text-slate-700">{wf.executionMode}</span>
                      </span>
                      {wf.ticketRef && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>
                            Ticket: <span className="font-mono text-slate-700">{wf.ticketRef}</span>
                          </span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span>
                        Requester: <span className="font-mono text-slate-700">{wf.requesterId}</span>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{formatTimeHMS(wf.createdAt)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {diffs.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedDiffIds((prev) => ({
                            ...prev,
                            [wf.workflowId]: !prev[wf.workflowId],
                          }))
                        }
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
                      >
                        <FileCode2 className="h-3.5 w-3.5 text-slate-500" />
                        <span>
                          Config Diff ({diffs.length})
                        </span>
                        <span className="font-mono text-emerald-700 tabular-nums">+{totalAdded}</span>
                        <span className="font-mono text-red-700 tabular-nums">-{totalRemoved}</span>
                        {isExpanded ? (
                          <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                        )}
                      </button>
                    )}

                    <Link
                      to="/workflows/$workflowId"
                      params={{ workflowId: wf.workflowId }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
                    >
                      Inspect Workflow
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>

                {/* Row 2: Requested Ingress Configuration Changes Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-slate-200 rounded-md divide-y sm:divide-y-0 sm:divide-x divide-slate-200 bg-slate-50/50">
                  <div className="p-3 space-y-1 min-w-0">
                    <div className="text-[11px] font-medium text-slate-500">
                      {liveRoute ? "Backend Target (Current → Requested)" : "New Backend Target"}
                    </div>
                    <div className="text-xs font-mono text-slate-900 break-all tabular-nums">
                      {liveRoute ? (
                        backendChanged ? (
                          <>
                            <span className="text-slate-500 line-through">
                              {liveRoute.backendService}:{liveRoute.backendPort}
                            </span>{" "}
                            <span aria-hidden="true" className="text-slate-400">
                              →
                            </span>{" "}
                            <span className="font-semibold text-blue-800">
                              {req.backendService}:{req.backendPort}
                            </span>
                          </>
                        ) : (
                          <span>
                            {req.backendService}:{req.backendPort} (unchanged)
                          </span>
                        )
                      ) : (
                        <span className="font-semibold text-blue-800">
                          + {req.backendService}:{req.backendPort}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="p-3 space-y-1 min-w-0">
                    <div className="text-[11px] font-medium text-slate-500">
                      TLS Profile & Exposure
                    </div>
                    <div className="text-xs font-mono text-slate-900 break-words">
                      {liveRoute && tlsChanged ? (
                        <>
                          <span className="text-slate-500 line-through">{liveRoute.tlsProfile}</span>
                          {" → "}
                          <span className="font-semibold text-blue-800">{req.tlsProfile}</span>
                        </>
                      ) : (
                        <span>{req.tlsProfile}</span>
                      )}
                      {" · "}
                      {liveRoute && exposureChanged ? (
                        <span className="font-semibold text-blue-800">
                          {liveRoute.exposure} → {req.exposure}
                        </span>
                      ) : (
                        <span>{req.exposure}</span>
                      )}
                    </div>
                  </div>

                  <div className="p-3 space-y-1 min-w-0">
                    <div className="text-[11px] font-medium text-slate-500">
                      Rollout & Rollback Plan
                    </div>
                    <div className="text-xs font-mono text-slate-900 tabular-nums">
                      {liveRoute ? `${liveRoute.canaryWeight}% → ` : ""}
                      <span className="font-semibold text-slate-900">{canaryPreview}</span>
                      {plan?.rollbackPlan && (
                        <span className="text-slate-500">
                          {" · "}
                          {plan.rollbackPlan.strategy} (≤{plan.rollbackPlan.maxRollbackSeconds}s)
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="p-3 space-y-1 min-w-0">
                    <div className="text-[11px] font-medium text-slate-500">
                      Policy Checks & Plan Lock
                    </div>
                    <div className="text-xs font-mono text-slate-900 tabular-nums">
                      <span
                        className={
                          passedChecks === policyChecks.length && policyChecks.length > 0
                            ? "text-emerald-700 font-semibold"
                            : "text-amber-700 font-semibold"
                        }
                      >
                        {passedChecks}/{policyChecks.length} checks passed
                      </span>
                      {" · "}
                      <span title={targetEtag} className="text-slate-500">
                        {shortHash(targetEtag, 12)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Requester Change Summary */}
                <div className="text-xs text-slate-600 leading-relaxed">
                  <span className="font-medium text-slate-800">Change Justification: </span>
                  {req.rawJustification}
                </div>

                {/* Expandable Config Diff Preview */}
                {isExpanded && diffs.length > 0 && (
                  <div className="space-y-3 pt-1">
                    {diffs.map((hunk) => (
                      <DiffHunkCard key={hunk.filePath} hunk={hunk} />
                    ))}
                  </div>
                )}

                {/* Visual ETag Version Lock Indicator */}
                <EtagLockIndicator
                  variant="banner"
                  targetEtag={targetEtag}
                  liveStateEtag={liveStateEtag}
                  planDigest={plan?.planDigestSha256}
                  workflowStatus={wf.status}
                  onReplan={() => replanMutation.mutate(wf.workflowId)}
                  isReplanning={replanMutation.isPending && replanningWorkflowId === wf.workflowId}
                />

                {/* Four-Eyes Separation Warning */}
                {isSelfApprovalBlocked && (
                  <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-900">
                    <Lock className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                    <span>
                      <span className="font-semibold">Four-Eyes Separation Enforced: </span>
                      Active operator{" "}
                      <span className="font-mono">{activeOperator.operatorId}</span> submitted this{" "}
                      <span className="font-mono">{wf.environment}</span> /{" "}
                      <span className="font-mono">{wf.blastRadius}</span> change. Switch to another
                      approver persona in the sidebar to authorize.
                    </span>
                  </div>
                )}

                {/* Row 3: HITL Authorization Action Bar */}
                <div className="flex flex-col md:flex-row md:items-center gap-3 pt-1">
                  <div className="flex-1 min-w-0">
                    <label
                      htmlFor={`rationale-${wf.workflowId}`}
                      className="sr-only"
                    >
                      Human-in-the-loop authorization rationale for {wf.appName}
                    </label>
                    <div className="relative">
                      <input
                        ref={(el) => {
                          rationaleRefs.current[wf.workflowId] = el;
                        }}
                        id={`rationale-${wf.workflowId}`}
                        type="text"
                        value={rationaleVal}
                        onChange={(e) => {
                          const val = e.target.value;
                          setRationales((prev) => ({ ...prev, [wf.workflowId]: val }));
                          if (val.trim().length >= MIN_RATIONALE_LEN) {
                            setValidationErrors((prev) => {
                              const next = { ...prev };
                              delete next[wf.workflowId];
                              return next;
                            });
                          }
                        }}
                        placeholder="Enter HITL decision rationale (min 12 chars) to authorize or reject directly..."
                        disabled={isRowSubmitting}
                        className="w-full px-3 py-2 pr-20 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50"
                      />
                      <span
                        className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-mono tabular-nums pointer-events-none ${
                          trimmedLen >= MIN_RATIONALE_LEN ? "text-emerald-700" : "text-slate-400"
                        }`}
                      >
                        {trimmedLen}/{MIN_RATIONALE_LEN}+
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <button
                      type="button"
                      disabled={isRowSubmitting}
                      onClick={() => handleQuickDecision(wf, "REJECT")}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-md hover:bg-red-50 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                    >
                      <XCircle className="h-3.5 w-3.5 shrink-0" />
                      {isRowSubmitting && submittingAction === "REJECT" ? "Rejecting..." : "Reject"}
                    </button>

                    <button
                      type="button"
                      disabled={isRowSubmitting}
                      onClick={() => handleQuickDecision(wf, "APPROVE")}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      {isRowSubmitting && submittingAction === "APPROVE"
                        ? "Authorizing..."
                        : "Approve & Execute"}
                    </button>

                    <button
                      type="button"
                      disabled={isRowSubmitting}
                      onClick={() => {
                        decisionMutation.reset();
                        setActionErrors((prev) => {
                          const next = { ...prev };
                          delete next[wf.workflowId];
                          return next;
                        });
                        setModalState({ workflow: wf, initialAction: "APPROVE" });
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                    >
                      Review Diff & Sign
                    </button>
                  </div>
                </div>

                {validationErrors[wf.workflowId] && (
                  <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-900">
                    <AlertCircle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                    <span>{validationErrors[wf.workflowId]}</span>
                  </div>
                )}

                {actionErrors[wf.workflowId] && (
                  <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-md text-xs text-red-800">
                    <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                    <span>{actionErrors[wf.workflowId]}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {modalState && (
        <ApprovalModal
          open={Boolean(modalState)}
          onClose={() => setModalState(null)}
          changePlan={modalState.workflow.changePlan}
          blastRadius={modalState.workflow.blastRadius}
          appName={modalState.workflow.appName}
          hostname={modalState.workflow.ingressRequest.hostname}
          pathPrefix={modalState.workflow.ingressRequest.pathPrefix}
          environment={modalState.workflow.environment}
          executionMode={modalState.workflow.executionMode}
          requesterId={modalState.workflow.requesterId}
          liveStateEtag={liveStateEtag}
          initialAction={modalState.initialAction}
          isSubmitting={decisionMutation.isPending}
          errorMessage={actionErrors[modalState.workflow.workflowId] ?? null}
          onSubmitDecision={(payload) =>
            decisionMutation.mutate({
              workflowId: modalState.workflow.workflowId,
              ...payload,
            })
          }
        />
      )}
    </section>
  );
}
