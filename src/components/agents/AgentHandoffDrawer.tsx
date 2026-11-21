import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, Lock, ShieldAlert, X } from "lucide-react";
import type {
  AgentStructuredOutput,
  DynamicAgentBlueprint,
  DynamicTaskAssignment,
  WorkflowHookStage,
} from "../../shared/contracts";
import { CodeViewer } from "../ui/CodeViewer";

export interface AgentHandoffInspectorTarget {
  agentName: string;
  hookStage?: WorkflowHookStage;
  blueprint?: DynamicAgentBlueprint | null;
  assignment?: DynamicTaskAssignment | null;
  contextOutput?: AgentStructuredOutput | null;
}

interface AgentHandoffDrawerProps {
  target: AgentHandoffInspectorTarget | null;
  onClose: () => void;
  onSelectUpstreamAgent?: (agentName: string) => void;
}

export function AgentHandoffDrawer({
  target,
  onClose,
  onSelectUpstreamAgent,
}: AgentHandoffDrawerProps) {
  useEffect(() => {
    if (!target) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [target, onClose]);

  if (!target) return null;

  const { agentName, blueprint, assignment, contextOutput } = target;
  const output = assignment?.structuredOutput ?? contextOutput ?? null;
  const status = assignment?.status ?? (output ? "COMPLETED" : "QUEUED");
  const hookStage =
    assignment?.hookStage ?? blueprint?.hookStage ?? target.hookStage ?? "PHASE_A_PARALLEL";
  const dependsOn = assignment?.dependsOn ?? blueprint?.dependsOn ?? [];
  const consumedInputs = assignment?.consumedInputs ?? {};

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="handoff-drawer-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl bg-white h-full border-l border-slate-200 flex flex-col shadow-xl">
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-500">
              <span>{hookStage}</span>
              <span aria-hidden="true">·</span>
              <span>{blueprint?.spawnedBy ?? "CORE"}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 text-slate-700">
                <Lock className="h-3 w-3" />
                sa-ingress-readonly
              </span>
            </div>
            <h2
              id="handoff-drawer-title"
              className="text-lg font-semibold text-slate-900 mt-1 truncate"
            >
              {agentName}
            </h2>
            {blueprint?.role && (
              <p className="text-xs text-slate-600 mt-0.5">{blueprint.role}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close handoff inspector"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
          {/* Status & Telemetry Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3.5">
            <div>
              <div className="text-[11px] text-slate-500">Execution Status</div>
              <div className="font-semibold text-slate-900 mt-0.5 flex items-center gap-1">
                {status === "COMPLETED" && (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
                )}
                {(status === "VETOED" || status === "SKIPPED_UPSTREAM_FAILED") && (
                  <ShieldAlert className="h-3.5 w-3.5 text-red-700 shrink-0" />
                )}
                <span>{status}</span>
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">Risk Delta</div>
              <div className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                {output?.riskDelta ?? "NONE"}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">Confidence</div>
              <div className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                {output ? `${Math.round(output.confidence * 100)}%` : "N/A"}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">Duration</div>
              <div className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                {assignment?.durationMs !== undefined ? `${assignment.durationMs}ms` : "—"}
              </div>
            </div>
          </div>

          {/* Veto / Skip Callout */}
          {(output?.vetoTriggered || status === "SKIPPED_UPSTREAM_FAILED") && (
            <div className="p-3.5 rounded-lg border border-red-200 bg-red-50 text-red-900 flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-semibold">
                  {output?.vetoTriggered
                    ? "Veto Triggered — Downstream Agents Blocked"
                    : "Execution Skipped (Upstream Veto)"}
                </div>
                <p className="leading-snug">
                  {output?.summary ??
                    assignment?.resolvedTaskPrompt ??
                    "Safety threshold violated."}
                </p>
              </div>
            </div>
          )}

          {/* Summary & Audit Digest */}
          <div className="space-y-2">
            <div className="font-semibold text-slate-900">Handoff Summary</div>
            <p className="text-slate-700 bg-white border border-slate-200 rounded-md p-3 leading-relaxed">
              {output?.summary ??
                assignment?.resolvedTaskPrompt ??
                "No structured output recorded yet for this node."}
            </p>
            {assignment?.auditEventHash && (
              <div className="text-[11px] font-mono text-slate-500 tabular-nums break-all">
                Audit Event SHA-256:{" "}
                <span className="text-slate-800">{assignment.auditEventHash}</span>
              </div>
            )}
          </div>

          {/* Upstream Dependencies */}
          <div className="space-y-2">
            <div className="font-semibold text-slate-900">
              Upstream Dependencies ({dependsOn.length})
            </div>
            {dependsOn.length === 0 ? (
              <p className="text-slate-500">
                Root stage task — receives workflow Intake parameters directly without waiting on
                upstream dependencies.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {dependsOn.map((dep) => (
                  <button
                    key={dep}
                    type="button"
                    onClick={() => onSelectUpstreamAgent?.(dep)}
                    className="px-2.5 py-1 text-xs font-mono bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-md transition-colors"
                  >
                    ← {dep}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Consumed Upstream Inputs */}
          <CodeViewer
            title="Consumed Upstream Inputs"
            code={
              Object.keys(consumedInputs).length > 0
                ? JSON.stringify(consumedInputs, null, 2)
                : "// No upstream fields injected into prompt"
            }
            copyLabel="Copy Inputs"
            maxHeightClass="max-h-56"
          />

          {/* Resolved Prompt */}
          {assignment?.resolvedTaskPrompt && (
            <div className="space-y-1.5">
              <div className="font-semibold text-slate-900">
                Resolved Prompt (Post-Interpolation)
              </div>
              <pre className="p-3.5 bg-slate-50 border border-slate-200 text-slate-800 rounded-lg font-mono text-[11px] whitespace-pre-wrap leading-relaxed">
                {assignment.resolvedTaskPrompt}
              </pre>
            </div>
          )}

          {/* Produced Structured Output */}
          <CodeViewer
            title="Produced Structured Output"
            code={
              output
                ? JSON.stringify(output, null, 2)
                : "// Structured output pending or skipped"
            }
            copyLabel="Copy Output"
            accentTextClass="text-emerald-300"
            maxHeightClass="max-h-64"
          />
        </div>
      </div>
    </div>
  );
}
