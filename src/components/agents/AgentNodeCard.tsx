import { memo } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Lock,
  ShieldAlert,
  Sparkles,
  XCircle,
} from "lucide-react";
import type {
  DynamicAgentBlueprint,
  DynamicTaskAssignment,
  WorkflowRun,
} from "../../shared/contracts";
import {
  AGENT_GUIDES,
  dynamicStatusStyles,
  stateBadgeStyle,
  type AgentNodeId,
  type VisualNodeState,
} from "./agentFlowCatalog";

export function StateIcon({ state }: { state: VisualNodeState }) {
  switch (state) {
    case "COMPLETED":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 shrink-0" />;
    case "ACTIVE":
      return <Clock className="h-3.5 w-3.5 text-blue-700 shrink-0" />;
    case "WAITING":
      return <Lock className="h-3.5 w-3.5 text-amber-700 shrink-0" />;
    case "ABORTED":
      return <ShieldAlert className="h-3.5 w-3.5 text-red-700 shrink-0" />;
    case "FAILED":
      return <XCircle className="h-3.5 w-3.5 text-red-700 shrink-0" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />;
  }
}

export interface CoreAgentNodeCardProps {
  id: AgentNodeId;
  state: VisualNodeState;
  isSelected: boolean;
  trace?: WorkflowRun["agentTraces"][number];
  onSelect: (id: AgentNodeId) => void;
  nodeRef: (el: HTMLElement | null) => void;
}

export const CoreAgentNodeCard = memo(function CoreAgentNodeCard({
  id,
  state,
  isSelected,
  trace,
  onSelect,
  nodeRef,
}: CoreAgentNodeCardProps) {
  const meta = AGENT_GUIDES[id];
  const styles = stateBadgeStyle(state);
  const Icon = meta.icon;

  return (
    <button
      ref={nodeRef}
      type="button"
      onClick={() => onSelect(id)}
      aria-pressed={isSelected}
      className={`relative z-10 w-full text-left rounded-lg border p-3.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
        styles.card
      } ${
        isSelected
          ? "ring-2 ring-blue-700 border-blue-700 shadow-sm"
          : "hover:border-slate-400"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-7 w-7 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
            <Icon className={`h-3.5 w-3.5 ${styles.iconColor}`} />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-mono text-slate-500">
              Step {meta.stepNumber}
            </div>
            <div className="text-xs font-semibold text-slate-900 truncate">
              {meta.title}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <StateIcon state={state} />
        </div>
      </div>

      <p className="text-xs text-slate-600 mt-2 leading-snug">{meta.shortRole}</p>

      <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-[11px]">
        <span className={`font-medium ${styles.labelClass}`}>{styles.labelText}</span>
        <span className="font-mono tabular-nums text-slate-500 truncate">
          {trace?.durationMs ? `${trace.durationMs}ms` : meta.permissionLabel.split(" ")[0]}
        </span>
      </div>
    </button>
  );
});

export interface DynamicTaskNodeCardProps {
  assignment: DynamicTaskAssignment;
  blueprint?: DynamicAgentBlueprint;
  onInspect: (agentName: string) => void;
  nodeRef: (el: HTMLElement | null) => void;
}

export const DynamicTaskNodeCard = memo(function DynamicTaskNodeCard({
  assignment,
  blueprint,
  onInspect,
  nodeRef,
}: DynamicTaskNodeCardProps) {
  const dStyles = dynamicStatusStyles(assignment.status);
  const vetoed =
    Boolean(assignment.structuredOutput?.vetoTriggered) || assignment.status === "VETOED";

  return (
    <button
      ref={nodeRef}
      type="button"
      onClick={() => onInspect(assignment.agentName)}
      className={`relative z-10 w-full text-left rounded-lg border p-3 transition-all hover:border-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${dStyles.card}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-mono text-slate-500 flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-blue-700 shrink-0" />
            <span>
              {blueprint?.spawnedBy ?? "DYNAMIC"} · {assignment.hookStage}
            </span>
          </div>
          <div className="text-xs font-semibold font-mono text-slate-900 truncate mt-0.5">
            {assignment.agentName}
          </div>
        </div>
        {vetoed ? (
          <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0" />
        ) : assignment.status === "COMPLETED" ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
        ) : assignment.status === "SKIPPED_UPSTREAM_FAILED" ? (
          <ShieldAlert className="h-3.5 w-3.5 text-red-700 shrink-0" />
        ) : (
          <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        )}
      </div>

      {assignment.dependsOn.length > 0 && (
        <div className="text-[10px] font-mono text-slate-500 mt-1 truncate">
          ← {assignment.dependsOn.join(", ")}
        </div>
      )}

      <p className="text-[11px] text-slate-600 mt-1.5 line-clamp-2 leading-snug">
        {assignment.structuredOutput?.summary ??
          assignment.resolvedTaskPrompt ??
          blueprint?.role ??
          "Queued in dynamic DAG"}
      </p>

      <div className="mt-2 pt-1.5 border-t border-slate-200/70 flex items-center justify-between text-[10px]">
        <span className={`font-medium ${dStyles.labelClass}`}>
          {vetoed ? "Veto Triggered" : dStyles.labelText}
        </span>
        <span className="font-mono text-blue-700">Inspect Handoff →</span>
      </div>
    </button>
  );
});
