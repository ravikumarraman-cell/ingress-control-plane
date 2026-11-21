import { Trash2 } from "lucide-react";
import type { DynamicAgentBlueprint } from "../../shared/contracts";

export interface BlueprintRosterListProps {
  blueprints: DynamicAgentBlueprint[];
  canAssign: boolean;
  isAssignPending: boolean;
  onToggle: (blueprint: DynamicAgentBlueprint) => void;
  onDelete: (agentId: string) => void;
  onAssign: (blueprintId: string) => void;
  onLoadTemplate: (blueprint: DynamicAgentBlueprint) => void;
}

export function BlueprintRosterList({
  blueprints,
  canAssign,
  isAssignPending,
  onToggle,
  onDelete,
  onAssign,
  onLoadTemplate,
}: BlueprintRosterListProps) {
  return (
    <div className="xl:col-span-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-900">
          Reusable Dynamic Agent Roster
        </h3>
        <span className="text-[11px] text-slate-500">
          Ordered topologically at runtime
        </span>
      </div>

      <div className="space-y-2.5">
        {blueprints.map((bp) => (
          <div
            key={bp.agentId}
            className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/50 space-y-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold font-mono text-slate-900 truncate">
                  {bp.name}
                </div>
                <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                  {bp.hookStage} · {bp.spawnedBy}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => onToggle(bp)}
                  className={`px-2 py-0.5 text-[11px] font-medium rounded border transition-colors ${
                    bp.enabled
                      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                      : "bg-white border-slate-200 text-slate-600"
                  }`}
                >
                  {bp.enabled ? "Enabled" : "Disabled"}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(bp.agentId)}
                  aria-label={`Delete ${bp.name}`}
                  className="p-1 text-slate-400 hover:text-red-600 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-snug">{bp.role}</p>

            <div className="text-[11px] font-mono text-slate-600 space-y-0.5">
              <div>
                <span className="text-slate-400">dependsOn:</span>{" "}
                {bp.dependsOn.length > 0 ? bp.dependsOn.join(", ") : "none (root)"}
              </div>
              <div>
                <span className="text-slate-400">outputs:</span>{" "}
                {bp.outputSchema.map((f) => f.key).join(", ") || "summary only"}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200/70 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!canAssign || isAssignPending}
                onClick={() => onAssign(bp.agentId)}
                className="px-2.5 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded transition-colors disabled:opacity-50"
              >
                Hook into Active Workflow
              </button>
              <button
                type="button"
                onClick={() => onLoadTemplate(bp)}
                className="px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded transition-colors"
              >
                Load Template
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
