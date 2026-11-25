import { AlertTriangle } from "lucide-react";
import type { BlastRadiusScore, WorkflowStatus } from "../shared/contracts";
import { WorkflowStatusIndicator } from "./WorkflowStatusIndicator";

export function WorkflowStatusText({ status }: { status: WorkflowStatus }) {
  return <WorkflowStatusIndicator status={status} />;
}

export function BlastRadiusText({ score }: { score: BlastRadiusScore }) {
  if (score === "HIGH") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 dark:text-rose-400 tabular-nums whitespace-nowrap">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        High Blast Radius
      </span>
    );
  }
  if (score === "MEDIUM") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 tabular-nums whitespace-nowrap">
        Medium Blast Radius
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-400 tabular-nums whitespace-nowrap">
      Low Blast Radius
    </span>
  );
}
