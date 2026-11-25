import { useState } from "react";
import { ArrowUpRight, RotateCcw } from "lucide-react";
import type { WorkflowRun } from "../../shared/contracts";

export interface CanaryRolloutPanelProps {
  workflow: WorkflowRun;
  isPromotePending: boolean;
  isRollbackPending: boolean;
  onPromote: (simulateProbeFailure: boolean) => void;
  onRollback: () => void;
}

export function CanaryRolloutPanel({
  workflow,
  isPromotePending,
  isRollbackPending,
  onPromote,
  onRollback,
}: CanaryRolloutPanelProps) {
  const [canarySimFail, setCanarySimFail] = useState(false);

  if (
    workflow.executionMode !== "direct_canary_v3" ||
    !workflow.canaryState ||
    (workflow.status !== "EXECUTING" && workflow.status !== "COMPLETED")
  ) {
    return null;
  }

  const nextWeight =
    workflow.canaryState.steps[
      Math.min(workflow.canaryState.stageIndex + 1, workflow.canaryState.steps.length - 1)
    ];

  return (
    <div className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Progressive Canary Rollout Controller (Current Traffic:{" "}
            <span className="tabular-nums">{workflow.canaryState.currentWeight}%</span>)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
            Stages: {workflow.canaryState.steps.map((s) => `${s}%`).join(" -> ")} · Stage{" "}
            {workflow.canaryState.stageIndex + 1}/{workflow.canaryState.steps.length}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {workflow.status === "EXECUTING" && (
            <>
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={canarySimFail}
                  onChange={(e) => setCanarySimFail(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-700 text-blue-700 dark:text-sky-400"
                />
                <span>Inject HTTP 503 on Promote</span>
              </label>
              <button
                type="button"
                disabled={isPromotePending}
                onClick={() => {
                  onPromote(canarySimFail);
                  setCanarySimFail(false);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-60 whitespace-nowrap"
              >
                <ArrowUpRight className="h-3.5 w-3.5" />
                Promote to {nextWeight}%
              </button>
            </>
          )}

          <button
            type="button"
            disabled={isRollbackPending}
            onClick={onRollback}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-red-700 dark:text-rose-400 bg-white dark:bg-[#0F172A] border border-red-200 dark:border-rose-500/30 rounded-md hover:bg-red-50 dark:bg-rose-500/10 whitespace-nowrap"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Instant Deterministic Rollback
          </button>
        </div>
      </div>

      <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-700 transition-all"
          style={{ width: `${workflow.canaryState.currentWeight}%` }}
        />
      </div>
    </div>
  );
}
