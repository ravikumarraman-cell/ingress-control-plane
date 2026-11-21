import { useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FileCode2,
  Lock,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react";
import { BlastRadiusText } from "../StatusLabel";
import { getCurrentOperator } from "../../lib/api";
import type {
  BlastRadiusScore,
  ChangePlan,
  Environment,
  ExecutionMode,
} from "../../shared/contracts";

export interface ApprovalModalProps {
  open: boolean;
  onClose: () => void;
  changePlan: ChangePlan | null;
  blastRadius: BlastRadiusScore;
  appName?: string;
  hostname?: string;
  pathPrefix?: string;
  environment?: Environment;
  executionMode?: ExecutionMode;
  requesterId?: string;
  liveStateEtag?: string;
  initialAction?: "APPROVE" | "REJECT" | null;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  minRationaleLength?: number;
  onSubmitDecision: (payload: {
    decision: "APPROVE" | "REJECT";
    rationale: string;
    simulateProbeFailure: boolean;
  }) => void | Promise<void>;
}

export function ApprovalModal({
  open,
  onClose,
  changePlan,
  blastRadius,
  appName,
  hostname,
  pathPrefix,
  environment,
  executionMode,
  requesterId,
  liveStateEtag,
  initialAction = null,
  isSubmitting = false,
  errorMessage = null,
  minRationaleLength = 12,
  onSubmitDecision,
}: ApprovalModalProps) {
  const [rationale, setRationale] = useState("");
  const [simulateProbeFailure, setSimulateProbeFailure] = useState(false);

  useEffect(() => {
    if (!open) {
      setRationale("");
      setSimulateProbeFailure(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, isSubmitting, onClose]);

  if (!open) {
    return null;
  }

  const activeOperator = getCurrentOperator();
  const isSelfApprovalBlocked =
    Boolean(requesterId) &&
    (environment === "prod" || blastRadius === "HIGH") &&
    activeOperator.operatorId === requesterId;

  const trimmedRationale = rationale.trim();
  const isRationaleValid = trimmedRationale.length >= minRationaleLength;
  const targetEtag = changePlan?.targetStateEtag ?? "";
  const hasLiveComparison = Boolean(liveStateEtag && targetEtag);
  const etagMatches = !hasLiveComparison || liveStateEtag === targetEtag;

  const passedChecks = changePlan?.policyChecks.filter((c) => c.passed).length ?? 0;
  const totalChecks = changePlan?.policyChecks.length ?? 0;
  const blockedChecks = totalChecks - passedChecks;

  const placeholderText =
    initialAction === "REJECT"
      ? "Blocking rollout due to maintenance window freeze or missing change ticket verification."
      : "Verified TLS 1.3 strict posture, ChangePlan diff hunks, and deterministic rollback readiness.";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-modal-title"
      onClick={() => {
        if (!isSubmitting) onClose();
      }}
    >
      <div
        className="bg-white border border-slate-200 rounded-lg w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h2 id="approval-modal-title" className="text-base font-semibold text-slate-900">
              {initialAction === "REJECT"
                ? "Reject Ingress ChangePlan"
                : initialAction === "APPROVE"
                  ? "Review ChangePlan & Sign Approval"
                  : "Human-in-the-Loop ChangePlan Review"}
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1">
              {appName && <span className="font-semibold text-slate-700">{appName}</span>}
              {hostname && (
                <>
                  {appName && <span aria-hidden="true">·</span>}
                  <span className="font-mono">
                    {hostname}
                    {pathPrefix ?? ""}
                  </span>
                </>
              )}
              {environment && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{environment}</span>
                </>
              )}
              {executionMode && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{executionMode}</span>
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close approval modal"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md hover:bg-slate-100 transition-colors shrink-0 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* BlastRadiusScore & Reviewer Identity Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 border border-slate-200 rounded-lg divide-y md:divide-y-0 md:divide-x divide-slate-200">
            <div className="p-4 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-500">Blast Radius Score</span>
                <span className="text-xs font-mono font-semibold text-slate-800 tabular-nums">
                  {blastRadius}
                </span>
              </div>
              <BlastRadiusText score={blastRadius} />
            </div>

            <div className="p-4 space-y-1">
              <div className="text-xs font-medium text-slate-500">ETag Lock Verification</div>
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                {etagMatches ? (
                  <>
                    <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span className="text-emerald-700">
                      {hasLiveComparison ? "Synced with Live State" : "Sealed Plan ETag"}
                    </span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
                    <span className="text-red-700">Live ETag Mismatch</span>
                  </>
                )}
              </div>
              <div className="text-[11px] font-mono text-slate-500 truncate tabular-nums">
                {targetEtag || "No ETag sealed"}
              </div>
            </div>

            <div className="p-4 space-y-1">
              <div className="text-xs font-medium text-slate-500">Signing Reviewer</div>
              <div className="text-xs font-mono font-semibold text-slate-900 truncate">
                {activeOperator.operatorId}
              </div>
              <div className="text-[11px] font-mono text-slate-500 truncate">
                Roles: {activeOperator.roles.join(", ")}
              </div>
            </div>
          </div>

          {isSelfApprovalBlocked && (
            <div className="flex items-start gap-2.5 p-3.5 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-900">
              <Lock className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Four-Eyes RBAC Separation Warning: </span>
                Active operator <span className="font-mono">{activeOperator.operatorId}</span>{" "}
                submitted this request. Self-approval is blocked for{" "}
                <span className="font-mono">prod</span> or{" "}
                <span className="font-mono">HIGH</span> blast-radius changes.
              </div>
            </div>
          )}

          {/* ChangePlan Inspector */}
          {changePlan ? (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <FileCode2 className="h-4 w-4 text-slate-600 shrink-0" />
                  <span className="text-xs font-semibold text-slate-900">
                    Sealed ChangePlan ({changePlan.planId})
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-slate-600 tabular-nums">
                  <span className="inline-flex items-center gap-1">
                    {blockedChecks === 0 ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-red-600" />
                    )}
                    Policy: {passedChecks}/{totalChecks} passed
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Dry-run: {changePlan.dryRunPassed ? "PASS" : "FAIL"}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Rollback: {changePlan.rollbackPlan.strategy} (≤
                    {changePlan.rollbackPlan.maxRollbackSeconds}s)
                  </span>
                </div>
              </div>

              <div className="px-4 py-2.5 border-b border-slate-200 bg-white text-[11px] font-mono text-slate-600 flex flex-wrap items-center justify-between gap-2 tabular-nums">
                <span className="truncate">Digest: {changePlan.planDigestSha256}</span>
                {changePlan.policyViolations.length > 0 && (
                  <span className="text-red-700 font-semibold">
                    {changePlan.policyViolations.length} policy violation(s)
                  </span>
                )}
              </div>

              <div className="divide-y divide-slate-200 max-h-56 overflow-y-auto bg-slate-950">
                {changePlan.diffs.map((hunk) => (
                  <div key={hunk.filePath}>
                    <div className="px-4 py-1.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-4 text-[11px] font-mono">
                      <span className="text-slate-200">
                        {hunk.filePath} · {hunk.resourceKind}
                      </span>
                      <span className="tabular-nums flex items-center gap-2">
                        <span className="text-emerald-400">+{hunk.linesAdded}</span>
                        <span className="text-red-400">-{hunk.linesRemoved}</span>
                      </span>
                    </div>
                    <pre className="p-3 text-[11px] font-mono leading-relaxed text-slate-200 overflow-x-auto">
                      {hunk.unifiedDiff}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-4 border border-slate-200 rounded-lg bg-slate-50 text-xs text-slate-600">
              No ChangePlan is attached to this workflow yet. You may still record a rejection rationale below.
            </div>
          )}

          {/* Reviewer Rationale Input */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label
                htmlFor="approval-modal-rationale"
                className="block text-xs font-semibold text-slate-800"
              >
                Reviewer Rationale (Required for audit ledger)
              </label>
              <span
                className={`text-[11px] font-mono tabular-nums ${
                  isRationaleValid ? "text-emerald-700" : "text-slate-500"
                }`}
              >
                {trimmedRationale.length} / {minRationaleLength} min chars
              </span>
            </div>
            <textarea
              id="approval-modal-rationale"
              rows={3}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder={placeholderText}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          {executionMode === "direct_canary_v3" && (
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={simulateProbeFailure}
                onChange={(e) => setSimulateProbeFailure(e.target.checked)}
                className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
              />
              <span>
                Simulate synthetic probe failure (HTTP 503) on approve to test deterministic rollback
              </span>
            </label>
          )}

          {errorMessage && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-800">
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={!isRationaleValid || isSubmitting}
              onClick={() =>
                onSubmitDecision({
                  decision: "REJECT",
                  rationale: trimmedRationale,
                  simulateProbeFailure: false,
                })
              }
              className={`px-4 py-2 text-xs font-medium rounded-md transition-colors disabled:opacity-50 whitespace-nowrap ${
                initialAction === "REJECT"
                  ? "text-white bg-red-700 hover:bg-red-800"
                  : "text-red-700 bg-white border border-red-200 hover:bg-red-50"
              }`}
            >
              {isSubmitting && initialAction === "REJECT" ? "Submitting..." : "Reject Plan"}
            </button>

            <button
              type="button"
              disabled={!isRationaleValid || isSubmitting || !changePlan}
              onClick={() =>
                onSubmitDecision({
                  decision: "APPROVE",
                  rationale: trimmedRationale,
                  simulateProbeFailure,
                })
              }
              className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {isSubmitting ? "Verifying & Signing..." : "Approve & Execute"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
