import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { WorkflowRun } from "../../shared/contracts";
import {
  AGENT_GUIDES,
  stateBadgeStyle,
  type AgentGuideMeta,
  type AgentNodeId,
  type VisualNodeState,
} from "./agentFlowCatalog";
import { StateIcon } from "./AgentNodeCard";

export interface AgentInspectorPanelProps {
  guide: AgentGuideMeta;
  nodeState: VisualNodeState;
  workflow?: WorkflowRun | null;
  matchingTrace?: WorkflowRun["agentTraces"][number] | null;
  compact?: boolean;
  onSelectAgent: (id: AgentNodeId) => void;
  onOpenContextDrawer: (agentName: string) => void;
}

export function AgentInspectorPanel({
  guide,
  nodeState,
  workflow,
  matchingTrace,
  compact = false,
  onSelectAgent,
  onOpenContextDrawer,
}: AgentInspectorPanelProps) {
  return (
    <aside className="xl:col-span-4 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <div className="text-xs font-mono text-slate-500">{guide.stageLabel}</div>
          <h3 className="text-base font-semibold text-slate-900 mt-0.5">{guide.title}</h3>
        </div>
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 shrink-0">
          <StateIcon state={nodeState} />
          <span>{stateBadgeStyle(nodeState).labelText}</span>
        </div>
      </div>

      <div className="space-y-3 text-xs">
        <div>
          <div className="font-semibold text-slate-800 mb-1">What It Does</div>
          <p className="text-slate-600 leading-relaxed">{guide.plainEnglish}</p>
        </div>

        <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-1">
          <div className="font-semibold text-slate-800">
            Security Boundary · {guide.permissionLabel}
          </div>
          <p className="text-slate-600 leading-relaxed">{guide.permissionDetail}</p>
        </div>

        <div className="grid grid-cols-1 gap-2.5 pt-1">
          <div>
            <div className="font-semibold text-slate-800">Receives (Input)</div>
            <p className="text-slate-600 mt-0.5 leading-snug">{guide.receives}</p>
          </div>
          <div>
            <div className="font-semibold text-slate-800">Produces (Output)</div>
            <p className="text-slate-600 mt-0.5 leading-snug">{guide.produces}</p>
          </div>
        </div>

        {(guide.receivesFrom.length > 0 || guide.talksTo.length > 0) && (
          <div className="pt-2 border-t border-slate-100 space-y-2">
            {guide.receivesFrom.length > 0 && (
              <div>
                <div className="text-[11px] font-medium text-slate-500 mb-1">
                  Triggered By
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {guide.receivesFrom.map((prevId) => (
                    <button
                      key={prevId}
                      type="button"
                      onClick={() => onSelectAgent(prevId)}
                      className="px-2.5 py-1 text-[11px] font-mono bg-slate-100 hover:bg-slate-200 text-slate-800 rounded transition-colors"
                    >
                      ← {AGENT_GUIDES[prevId].title}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {guide.talksTo.length > 0 && (
              <div>
                <div className="text-[11px] font-medium text-slate-500 mb-1">
                  Hands Off To
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {guide.talksTo.map((nextId) => (
                    <button
                      key={nextId}
                      type="button"
                      onClick={() => onSelectAgent(nextId)}
                      className="px-2.5 py-1 text-[11px] font-mono bg-blue-50 hover:bg-blue-100 text-blue-800 rounded transition-colors"
                    >
                      {AGENT_GUIDES[nextId].title} →
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {workflow && (
          <div className="pt-3 border-t border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-900">
                Live Execution Trace ({workflow.appName})
              </span>
              {matchingTrace?.durationMs && (
                <span className="font-mono tabular-nums text-slate-500">
                  {matchingTrace.durationMs}ms
                </span>
              )}
            </div>
            <div className="p-3 bg-slate-950 text-slate-100 rounded-md font-mono text-[11px] leading-relaxed">
              {matchingTrace
                ? matchingTrace.summary
                : `Current workflow status is ${workflow.status}. Select an active or completed step to view recorded trace output.`}
            </div>

            {workflow.sharedContextBus?.[guide.title] && (
              <button
                type="button"
                onClick={() => onOpenContextDrawer(guide.title)}
                className="text-xs font-mono text-blue-700 hover:underline"
              >
                View Structured Context Output →
              </button>
            )}

            {!compact && (
              <div className="pt-1 flex items-center justify-between gap-2">
                <Link
                  to="/workflows/$workflowId"
                  params={{ workflowId: workflow.workflowId }}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:underline"
                >
                  Open Diffs & Approval Gate
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
