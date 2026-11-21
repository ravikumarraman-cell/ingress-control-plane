import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock, ShieldCheck } from "lucide-react";
import { updateRolloutStep } from "../../lib/api";
import type { RolloutMilestone, WorkflowRun } from "../../shared/contracts";

export interface RolloutCompanionPanelProps {
  workflow: WorkflowRun;
}

export function RolloutCompanionPanel({ workflow }: RolloutCompanionPanelProps) {
  const queryClient = useQueryClient();
  const companion = workflow.rolloutCompanion;

  const stepMutation = useMutation({
    mutationFn: (vars: { stepId: RolloutMilestone["stepId"]; status: "ACTIVE" | "COMPLETED" }) =>
      updateRolloutStep({
        workflowId: workflow.workflowId,
        stepId: vars.stepId,
        status: vars.status,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow", workflow.workflowId] });
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      queryClient.invalidateQueries({ queryKey: ["audit-log"] });
    },
  });

  if (!companion) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-6 text-xs text-slate-500">
        Rollout Companion milestones will initialize once the workflow plan is synthesized.
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <ShieldCheck className="h-4 w-4 text-blue-700 shrink-0" />
            <span>Rollout Companion — Cutover & 7–21 Day WAF Tuning Lifecycle</span>
          </div>
          <p className="text-xs text-slate-500">{companion.blockModeGuardrail}</p>
        </div>
        <div className="text-xs font-mono text-slate-700 tabular-nums shrink-0">
          WAF State: {companion.wafMode} · DNS Window: {companion.dnsCutoverMinutes}
        </div>
      </div>

      {stepMutation.isError && (
        <div className="mx-5 mt-4 p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-800 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{(stepMutation.error as Error).message}</span>
        </div>
      )}

      <div className="divide-y divide-slate-200">
        {companion.milestones.map((m, idx) => {
          const isCompleted = m.status === "COMPLETED";
          const isExempt = m.status === "EXEMPT";
          const isActive = m.status === "ACTIVE";
          return (
            <div
              key={m.stepId}
              className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
            >
              <div className="flex items-start gap-3 min-w-0">
                {isCompleted ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : isActive ? (
                  <Clock className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                ) : (
                  <Clock className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
                )}
                <div className="space-y-0.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-slate-500 tabular-nums">
                      0{idx + 1}
                    </span>
                    <span className="font-semibold text-slate-900">{m.title}</span>
                    <span className="font-mono text-[11px] text-slate-500">
                      ({m.windowLabel})
                    </span>
                  </div>
                  <p className="text-slate-600 leading-relaxed">{m.guidance}</p>
                  {m.completedBy && (
                    <div className="text-[11px] font-mono text-emerald-700">
                      Completed by {m.completedBy}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`text-[11px] font-mono font-semibold ${
                    isCompleted
                      ? "text-emerald-700"
                      : isActive
                        ? "text-blue-700"
                        : isExempt
                          ? "text-slate-400"
                          : "text-slate-600"
                  }`}
                >
                  {m.status}
                </span>
                {!isCompleted && !isExempt && (
                  <button
                    type="button"
                    disabled={stepMutation.isPending}
                    onClick={() =>
                      stepMutation.mutate({ stepId: m.stepId, status: "COMPLETED" })
                    }
                    className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-60 transition-colors whitespace-nowrap"
                  >
                    Mark Complete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
