import { AlertTriangle, Lock, ShieldCheck } from "lucide-react";
import { shortHash } from "../../lib/format";
import type { WorkflowRun } from "../../shared/contracts";
import { BlastRadiusText } from "../StatusLabel";

export interface WorkflowSummaryStripProps {
  workflow: WorkflowRun;
  liveStateEtag: string;
  etagVerificationStatus: string;
  etagMatches: boolean;
  targetEtag: string;
  isSelfApprovalBlocked: boolean;
  activeOperatorId: string;
}

export function WorkflowSummaryStrip({
  workflow,
  liveStateEtag,
  etagVerificationStatus,
  etagMatches,
  targetEtag,
  isSelfApprovalBlocked,
  activeOperatorId,
}: WorkflowSummaryStripProps) {
  return (
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
          Live ETag: {liveStateEtag}
        </div>
      </div>

      <div className="p-5 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-500">Blast Radius Score</span>
          <span className="text-xs font-mono font-semibold text-slate-800 tabular-nums">
            {workflow.blastRadius}
          </span>
        </div>
        <div className="pt-0.5">
          <BlastRadiusText score={workflow.blastRadius} />
        </div>
        <div className="text-xs font-mono text-slate-700 pt-1 tabular-nums">
          {workflow.ingressRequest.backendService}:{workflow.ingressRequest.backendPort} ·{" "}
          {workflow.ingressRequest.tlsProfile}
        </div>
        <div className="text-[11px] font-mono text-slate-500 truncate">
          {workflow.changePlan
            ? `Plan Digest: ${shortHash(workflow.changePlan.planDigestSha256, 24)}`
            : `Request ID: ${workflow.ingressRequest.requestId}`}
        </div>
      </div>

      <div className="p-5 space-y-1.5">
        <div className="text-xs font-medium text-slate-500">Approval & RBAC Gate</div>
        {workflow.approvalDecision ? (
          <>
            <div className="text-sm font-semibold text-slate-900">
              {workflow.approvalDecision.decision} by {workflow.approvalDecision.reviewerId}
            </div>
            <div className="text-xs text-slate-600 line-clamp-2">
              “{workflow.approvalDecision.rationale}”
            </div>
            <div className="text-[11px] font-mono text-slate-500 truncate">
              HMAC: {shortHash(workflow.approvalDecision.signature, 24)}
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
                ? `Active operator (${activeOperatorId}) is the requester and cannot self-approve.`
                : "Signed HMAC token required before ExecutionAgent unlocks write tools."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
