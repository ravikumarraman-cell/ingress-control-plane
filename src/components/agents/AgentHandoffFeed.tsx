import type { WorkflowRun } from "../../shared/contracts";

export interface AgentHandoffFeedProps {
  workflow: WorkflowRun;
  onInspectAgent: (agentName: string) => void;
}

export function AgentHandoffFeed({ workflow, onInspectAgent }: AgentHandoffFeedProps) {
  if (workflow.agentTraces.length === 0) return null;

  return (
    <div className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Real-Time Agent Handoff Feed ({workflow.appName})
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Updates automatically over Server-Sent Events as each agent completes its step.
          </p>
        </div>
        <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
          {workflow.agentTraces.length} steps recorded
        </span>
      </div>

      <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
        {workflow.agentTraces.map((tr, idx) => {
          const hasStructured = Boolean(
            workflow.sharedContextBus?.[tr.agentName] ||
              workflow.dynamicTaskAssignments?.some((a) => a.agentName === tr.agentName)
          );
          return (
            <div
              key={`${tr.agentName}-${idx}`}
              className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-mono tabular-nums text-slate-400 w-5 shrink-0">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                {hasStructured ? (
                  <button
                    type="button"
                    onClick={() => onInspectAgent(tr.agentName)}
                    className="font-semibold text-blue-700 dark:text-sky-400 hover:underline whitespace-nowrap"
                  >
                    {tr.agentName}
                  </button>
                ) : (
                  <span className="font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                    {tr.agentName}
                  </span>
                )}
                <span className="text-slate-400" aria-hidden="true">
                  ·
                </span>
                <span className="text-slate-600 dark:text-slate-400 truncate">{tr.summary}</span>
              </div>
              <div className="flex items-center gap-3 font-mono text-[11px] text-slate-500 dark:text-slate-400 shrink-0 tabular-nums">
                <span>{tr.accessMode}</span>
                <span aria-hidden="true">·</span>
                <span>{tr.status}</span>
                <span aria-hidden="true">·</span>
                <span>{tr.durationMs ? `${tr.durationMs}ms` : "waiting"}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
