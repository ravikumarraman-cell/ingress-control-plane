import { AlertTriangle, CheckCircle2, Clock, Lock, RefreshCw, ShieldAlert, Unlock } from "lucide-react";
import { shortHash } from "../../lib/format";

export interface EtagLockIndicatorProps {
  targetEtag?: string | null;
  liveStateEtag?: string | null;
  planDigest?: string | null;
  workflowStatus?: string;
  variant?: "banner" | "compact";
  onReplan?: () => void;
  isReplanning?: boolean;
}

export function EtagLockIndicator({
  targetEtag,
  liveStateEtag,
  planDigest,
  workflowStatus,
  variant = "banner",
  onReplan,
  isReplanning = false,
}: EtagLockIndicatorProps) {
  const hasBoth = Boolean(targetEtag && liveStateEtag);
  const isDriftAborted = workflowStatus === "DRIFT_ABORTED";
  const isSynced = hasBoth && targetEtag === liveStateEtag && !isDriftAborted;
  const isStale = (hasBoth && targetEtag !== liveStateEtag) || isDriftAborted;

  if (variant === "compact") {
    if (!targetEtag) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-slate-500 whitespace-nowrap">
          <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <span>Unsealed</span>
        </span>
      );
    }

    if (isSynced) {
      return (
        <span
          title={`Version lock valid\nPlan ETag: ${targetEtag}\nLive ETag: ${liveStateEtag}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap tabular-nums"
        >
          <Lock className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
          <span>Locked · {shortHash(targetEtag, 10)}</span>
        </span>
      );
    }

    if (isStale) {
      return (
        <span
          title={`Version lock broken (cluster drift)\nPlan ETag: ${targetEtag}\nLive ETag: ${liveStateEtag ?? "unknown"}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap tabular-nums"
        >
          <Unlock className="h-3.5 w-3.5 text-red-600 shrink-0" />
          <span>{isDriftAborted ? "Drift Aborted" : "Stale Lock"}</span>
        </span>
      );
    }

    return (
      <span
        title={`Sealed ETag: ${targetEtag}`}
        className="inline-flex items-center gap-1 text-xs text-slate-600 font-mono whitespace-nowrap tabular-nums"
      >
        <Lock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        <span>{shortHash(targetEtag, 10)}</span>
      </span>
    );
  }

  // Banner variant for pre-approval version lock inspection
  const containerClass = isSynced
    ? "bg-emerald-50/70 border border-emerald-200 text-emerald-950"
    : isStale
      ? "bg-red-50/80 border border-red-200 text-red-950"
      : "bg-slate-50 border border-slate-200 text-slate-800";

  return (
    <div
      role="status"
      aria-label={
        isSynced
          ? "ETag version lock verified"
          : isStale
            ? "ETag version lock stale due to infrastructure drift"
            : "ETag version lock pending"
      }
      className={`rounded-md px-3.5 py-2.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${containerClass}`}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        {isSynced ? (
          <Lock className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
        ) : isStale ? (
          <ShieldAlert className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
        ) : (
          <Clock className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
        )}

        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold">
              {isSynced
                ? "Version Lock Active — ETag Matches Live Cluster State"
                : isStale
                  ? "Version Lock Broken — Out-of-Band Drift Detected"
                  : "Awaiting Live Cluster ETag Verification"}
            </span>
            <span aria-hidden="true" className="opacity-40">
              ·
            </span>
            {isSynced ? (
              <span className="inline-flex items-center gap-1 font-medium text-emerald-800">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                TOCTOU Safe to Approve
              </span>
            ) : isStale ? (
              <span className="inline-flex items-center gap-1 font-medium text-red-700">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Approval Blocked (HTTP 409 on Execute)
              </span>
            ) : (
              <span className="text-slate-600">Checking live cluster hash...</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono tabular-nums">
            <span title={targetEtag ?? "None"}>
              <span className="opacity-70">Plan ETag:</span>{" "}
              <span className="font-semibold">
                {targetEtag ? shortHash(targetEtag, 20) : "unsealed"}
              </span>
            </span>

            <span
              aria-hidden="true"
              className={`font-bold ${isSynced ? "text-emerald-700" : isStale ? "text-red-700" : "text-slate-400"}`}
            >
              {isSynced ? "===" : isStale ? "!==" : "·"}
            </span>

            <span title={liveStateEtag ?? "Unavailable"}>
              <span className="opacity-70">Live Cluster ETag:</span>{" "}
              <span className="font-semibold">
                {liveStateEtag ? shortHash(liveStateEtag, 20) : "loading..."}
              </span>
            </span>

            {planDigest && (
              <>
                <span aria-hidden="true" className="opacity-40">
                  ·
                </span>
                <span title={planDigest} className="opacity-80">
                  Digest: {shortHash(planDigest, 14)}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {isStale && onReplan && (
        <button
          type="button"
          onClick={onReplan}
          disabled={isReplanning}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-700 rounded-md hover:bg-red-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 self-start lg:self-center"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isReplanning ? "animate-spin" : ""}`} />
          {isReplanning ? "Re-Planning..." : "Re-Plan Against Live ETag"}
        </button>
      )}
    </div>
  );
}
