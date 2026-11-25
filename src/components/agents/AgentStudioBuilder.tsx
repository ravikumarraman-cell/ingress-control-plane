import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  GitBranch,
  Lock,
  Plus,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  assignAgentToWorkflow,
  createAgentBlueprint,
  deleteAgentBlueprint,
  fetchAgentBlueprints,
  updateAgentBlueprint,
} from "../../lib/api";
import {
  CORE_AGENT_OUTPUT_FIELDS,
  CORE_AGENT_STAGE_MAP,
  READ_ONLY_TOOL_CATALOG,
  WORKFLOW_STAGE_ORDER,
  type CreateDynamicAgentBlueprintInput,
  type DynamicAgentBlueprint,
  type OutputFieldDefinition,
  type ReadOnlyToolId,
  type WorkflowHookStage,
  type WorkflowRun,
} from "../../shared/contracts";
import { BlueprintRosterList } from "./BlueprintRosterList";
import { OutputSchemaEditor } from "./OutputSchemaEditor";
import { STAGE_OPTIONS, STARTER_PRESETS } from "./agentStudioPresets";

interface AgentStudioBuilderProps {
  activeWorkflow: WorkflowRun | null;
  onWorkflowUpdated?: (workflow: WorkflowRun) => void;
}

export function AgentStudioBuilder({
  activeWorkflow,
  onWorkflowUpdated,
}: AgentStudioBuilderProps) {
  const queryClient = useQueryClient();
  const taskTemplateRef = useRef<HTMLTextAreaElement | null>(null);

  const blueprintsQuery = useQuery({
    queryKey: ["agent-blueprints"],
    queryFn: fetchAgentBlueprints,
  });

  const blueprints = blueprintsQuery.data?.blueprints ?? [];
  const defaultPreset = STARTER_PRESETS[0];

  const [name, setName] = useState(defaultPreset.name);
  const [role, setRole] = useState(defaultPreset.role);
  const [hookStage, setHookStage] = useState<WorkflowHookStage>(defaultPreset.hookStage);
  const [systemPrompt, setSystemPrompt] = useState(defaultPreset.systemPrompt);
  const [taskTemplate, setTaskTemplate] = useState(defaultPreset.taskTemplate);
  const [dependsOn, setDependsOn] = useState<string[]>(defaultPreset.dependsOn);
  const [allowedTools, setAllowedTools] = useState<ReadOnlyToolId[]>(defaultPreset.allowedTools);
  const [canForceApproval, setCanForceApproval] = useState(false);
  const [alwaysActive, setAlwaysActive] = useState(true);
  const [envTrigger, setEnvTrigger] = useState<"" | "dev" | "staging" | "prod">("");
  const [exposureTrigger, setExposureTrigger] = useState<"" | "internal" | "external">("");
  const [showAdvancedPrompt, setShowAdvancedPrompt] = useState(false);
  const [outputSchema, setOutputSchema] = useState<OutputFieldDefinition[]>(
    defaultPreset.outputSchema
  );

  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);

  const eligibleUpstreamAgents = useMemo(() => {
    const currentStageRank = WORKFLOW_STAGE_ORDER[hookStage];
    const items: Array<{ name: string; stage: WorkflowHookStage; kind: "CORE" | "DYNAMIC" }> = [];

    for (const [coreName, stage] of Object.entries(CORE_AGENT_STAGE_MAP)) {
      if (WORKFLOW_STAGE_ORDER[stage] <= currentStageRank) {
        items.push({ name: coreName, stage, kind: "CORE" });
      }
    }

    for (const bp of blueprints) {
      if (bp.name !== name.trim() && WORKFLOW_STAGE_ORDER[bp.hookStage] <= currentStageRank) {
        items.push({ name: bp.name, stage: bp.hookStage, kind: "DYNAMIC" });
      }
    }

    return items;
  }, [hookStage, blueprints, name]);

  const availableUpstreamChips = useMemo(() => {
    const chips: Array<{ agentName: string; fieldKey: string; fieldType: string; token: string }> =
      [];
    const aliasMap: Record<string, string> = {
      DiscoveryInventoryAgent: "DiscoveryAgent",
      PolicyComplianceAgent: "PolicyAgent",
      ImpactAnalysisAgent: "ImpactAgent",
      ChangePlanningAgent: "ChangePlanAgent",
    };

    for (const depName of dependsOn) {
      const normalized = aliasMap[depName] ?? depName;
      const coreEntry = CORE_AGENT_OUTPUT_FIELDS.find(
        (c) => c.agentName === depName || c.agentName === normalized
      );
      if (coreEntry) {
        for (const f of coreEntry.fields) {
          chips.push({
            agentName: coreEntry.agentName,
            fieldKey: f.key,
            fieldType: f.type,
            token: `{{upstream.${coreEntry.agentName}.${f.key}}}`,
          });
        }
        continue;
      }
      const dynBp = blueprints.find((b) => b.name === depName);
      if (dynBp) {
        for (const f of dynBp.outputSchema) {
          chips.push({
            agentName: depName,
            fieldKey: f.key,
            fieldType: f.type,
            token: `{{upstream.${depName}.${f.key}}}`,
          });
        }
      }
    }

    return chips;
  }, [dependsOn, blueprints]);

  const handleHookStageChange = (nextStage: WorkflowHookStage) => {
    setHookStage(nextStage);
    const nextRank = WORKFLOW_STAGE_ORDER[nextStage];
    setDependsOn((prev) =>
      prev.filter((dep) => {
        const coreStage = CORE_AGENT_STAGE_MAP[dep];
        if (coreStage) return WORKFLOW_STAGE_ORDER[coreStage] <= nextRank;
        const bp = blueprints.find((b) => b.name === dep);
        return bp ? WORKFLOW_STAGE_ORDER[bp.hookStage] <= nextRank : true;
      })
    );
  };

  const toggleDependency = (depName: string) => {
    setDependsOn((prev) =>
      prev.includes(depName) ? prev.filter((d) => d !== depName) : [...prev, depName]
    );
  };

  const toggleTool = (toolId: ReadOnlyToolId) => {
    setAllowedTools((prev) =>
      prev.includes(toolId) ? prev.filter((t) => t !== toolId) : [...prev, toolId]
    );
  };

  const insertTokenIntoTemplate = (token: string) => {
    const el = taskTemplateRef.current;
    if (!el) {
      setTaskTemplate((prev) => `${prev}${prev.endsWith(" ") ? "" : " "}${token}`);
      return;
    }
    const start = el.selectionStart ?? taskTemplate.length;
    const end = el.selectionEnd ?? taskTemplate.length;
    const nextValue = taskTemplate.slice(0, start) + token + taskTemplate.slice(end);
    setTaskTemplate(nextValue);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + token.length;
      el.setSelectionRange(cursor, cursor);
    });
  };

  const buildPayload = (): CreateDynamicAgentBlueprintInput => ({
    name: name.trim(),
    role: role.trim(),
    systemPrompt: systemPrompt.trim(),
    taskTemplate: taskTemplate.trim(),
    hookStage,
    dependsOn,
    outputSchema: outputSchema.filter((f) => f.key.trim().length > 0),
    allowedTools,
    triggerCondition: alwaysActive
      ? { alwaysActive: true }
      : {
          alwaysActive: false,
          ...(envTrigger ? { environments: [envTrigger] } : {}),
          ...(exposureTrigger ? { exposures: [exposureTrigger] } : {}),
        },
    canForceApproval,
    spawnedBy: "OPERATOR",
    enabled: true,
  });

  const saveRosterMutation = useMutation({
    mutationFn: () => createAgentBlueprint(buildPayload()),
    onMutate: () => {
      setFeedbackError(null);
      setFeedbackSuccess(null);
    },
    onSuccess: (data) => {
      setFeedbackSuccess(
        `Saved ${data.blueprint.name} to reusable Agent Roster (${data.blueprint.hookStage}).`
      );
      queryClient.invalidateQueries({ queryKey: ["agent-blueprints"] });
    },
    onError: (err: Error) => setFeedbackError(err.message),
  });

  const assignMutation = useMutation({
    mutationFn: (vars: { blueprintId?: string; adHocBlueprint?: CreateDynamicAgentBlueprintInput }) => {
      if (!activeWorkflow) {
        throw new Error("Select or create an active workflow first.");
      }
      return assignAgentToWorkflow({
        workflowId: activeWorkflow.workflowId,
        blueprintId: vars.blueprintId,
        adHocBlueprint: vars.adHocBlueprint,
      });
    },
    onMutate: () => {
      setFeedbackError(null);
      setFeedbackSuccess(null);
    },
    onSuccess: (data) => {
      setFeedbackSuccess(
        `Hooked agent into workflow ${data.workflow.appName} and recomputed downstream DAG.`
      );
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      queryClient.invalidateQueries({ queryKey: ["audit-log"] });
      onWorkflowUpdated?.(data.workflow);
    },
    onError: (err: Error) => setFeedbackError(err.message),
  });

  const toggleBlueprintMutation = useMutation({
    mutationFn: (bp: DynamicAgentBlueprint) =>
      updateAgentBlueprint(bp.agentId, { enabled: !bp.enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agent-blueprints"] }),
    onError: (err: Error) => setFeedbackError(err.message),
  });

  const deleteBlueprintMutation = useMutation({
    mutationFn: (agentId: string) => deleteAgentBlueprint(agentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agent-blueprints"] }),
    onError: (err: Error) => setFeedbackError(err.message),
  });

  const loadBlueprintIntoEditor = (bp: DynamicAgentBlueprint) => {
    setName(bp.name);
    setRole(bp.role);
    setHookStage(bp.hookStage);
    setSystemPrompt(bp.systemPrompt);
    setTaskTemplate(bp.taskTemplate);
    setDependsOn(bp.dependsOn);
    setAllowedTools(bp.allowedTools);
    setCanForceApproval(bp.canForceApproval);
    setOutputSchema(bp.outputSchema);
    setAlwaysActive(bp.triggerCondition?.alwaysActive ?? true);
    setFeedbackError(null);
    setFeedbackSuccess(`Loaded ${bp.name} into studio editor.`);
  };

  return (
    <div className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Cpu className="h-4 w-4 text-blue-700 dark:text-sky-400" />
            On-the-Fly Agent Studio & Structured Output Chaining
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Define read-only custom agents (<span className="font-mono">sa-ingress-readonly</span>),
            hook them into any workflow stage, and wire{" "}
            <span className="font-mono">{"{{upstream.<agent>.<field>}}"}</span> structured data
            dependencies.
          </p>
        </div>
        <div className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
          {blueprints.filter((b) => b.enabled).length} / {blueprints.length} blueprints enabled
        </div>
      </div>

      {feedbackError && (
        <div className="p-3 rounded-md bg-red-50 dark:bg-rose-500/10 border border-red-200 dark:border-rose-500/30 text-xs text-red-900 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <span>{feedbackError}</span>
        </div>
      )}

      {feedbackSuccess && (
        <div className="p-3 rounded-md bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-xs text-emerald-900 flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
          <span>{feedbackSuccess}</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-7 space-y-5">
          {/* 1-Click Starter Presets */}
          <div className="flex flex-wrap items-center gap-2 pb-1">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Quick Presets:</span>
            {STARTER_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => {
                  setName(preset.name);
                  setRole(preset.role);
                  setHookStage(preset.hookStage);
                  setDependsOn(preset.dependsOn);
                  setTaskTemplate(preset.taskTemplate);
                  setSystemPrompt(preset.systemPrompt);
                  setAllowedTools(preset.allowedTools);
                  setOutputSchema(preset.outputSchema);
                  setFeedbackError(null);
                  setFeedbackSuccess(`Loaded "${preset.label}" starter blueprint.`);
                }}
                className="px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-md transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">1. Identity & Hook Stage</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="studio-agent-name"
                className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Agent Name (PascalCase / Slug)
              </label>
              <input
                id="studio-agent-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. RateLimitCheckerAgent"
                className="w-full px-3 py-1.5 text-xs font-mono border border-slate-200 dark:border-slate-800 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="studio-hook-stage"
                className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Hook Stage
              </label>
              <select
                id="studio-hook-stage"
                value={hookStage}
                onChange={(e) => handleHookStageChange(e.target.value as WorkflowHookStage)}
                className="w-full px-3 py-1.5 text-xs border border-slate-200 dark:border-slate-800 rounded-md bg-white dark:bg-[#0F172A] focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {STAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="studio-agent-role"
              className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Responsibility / Role Summary
            </label>
            <input
              id="studio-agent-role"
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-200 dark:border-slate-800 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          {/* Upstream Dependencies Selector */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <GitBranch className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                Upstream Dependencies (<span className="font-mono">dependsOn</span>)
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">Filtered to same or earlier stage</span>
            </div>
            <div className="flex flex-wrap gap-1.5 p-2.5 bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md">
              {eligibleUpstreamAgents.map((item) => {
                const selected = dependsOn.includes(item.name);
                return (
                  <button
                    key={item.name}
                    type="button"
                    onClick={() => toggleDependency(item.name)}
                    aria-pressed={selected}
                    className={`px-2.5 py-1 text-[11px] font-mono rounded border transition-colors ${
                      selected
                        ? "bg-blue-700 border-blue-700 text-white"
                        : "bg-white dark:bg-[#0F172A] border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-400"
                    }`}
                  >
                    {selected ? "✓ " : "+ "}
                    {item.name}
                  </button>
                );
              })}
            </div>
          </div>

          {availableUpstreamChips.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-blue-700 dark:text-sky-400" />
                Click an Upstream Output Field to Insert Token into Task Template
              </div>
              <div className="flex flex-wrap gap-1.5">
                {availableUpstreamChips.map((chip) => (
                  <button
                    key={chip.token}
                    type="button"
                    onClick={() => insertTokenIntoTemplate(chip.token)}
                    className="px-2 py-1 text-[11px] font-mono bg-blue-50 dark:bg-sky-500/10 hover:bg-blue-100 text-blue-800 border border-blue-200 dark:border-sky-500/30 rounded transition-colors"
                    title={`Insert ${chip.token} (${chip.fieldType})`}
                  >
                    {chip.agentName}.{chip.fieldKey}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">2. Upstream Data & Prompt</div>
            <div>
              <label
                htmlFor="studio-task-template"
                className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Task Template (Supports{" "}
                <span className="font-mono">{"{{upstream.<agent>.<field>}}"}</span>)
              </label>
              <textarea
                id="studio-task-template"
                ref={taskTemplateRef}
                rows={3}
                value={taskTemplate}
                onChange={(e) => setTaskTemplate(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-200 dark:border-slate-800 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowAdvancedPrompt((v) => !v)}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                {showAdvancedPrompt ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                Advanced System Prompt & Trigger Filters
              </button>

              {showAdvancedPrompt && (
                <div className="mt-2.5 p-3.5 bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md space-y-3">
                  <div>
                    <label
                      htmlFor="studio-system-prompt"
                      className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1"
                    >
                      System Prompt
                    </label>
                    <textarea
                      id="studio-system-prompt"
                      rows={2}
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700 dark:text-slate-300">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={alwaysActive}
                        onChange={(e) => setAlwaysActive(e.target.checked)}
                        className="rounded border-slate-300 dark:border-slate-700 text-blue-700 dark:text-sky-400"
                      />
                      <span>Always Active</span>
                    </label>

                    {!alwaysActive && (
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={envTrigger}
                          onChange={(e) =>
                            setEnvTrigger(e.target.value as "" | "dev" | "staging" | "prod")
                          }
                          className="px-2 py-1 text-xs border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-[#0F172A]"
                        >
                          <option value="">Any environment</option>
                          <option value="dev">dev</option>
                          <option value="staging">staging</option>
                          <option value="prod">prod</option>
                        </select>
                        <select
                          value={exposureTrigger}
                          onChange={(e) =>
                            setExposureTrigger(e.target.value as "" | "internal" | "external")
                          }
                          className="px-2 py-1 text-xs border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-[#0F172A]"
                        >
                          <option value="">Any exposure</option>
                          <option value="internal">internal</option>
                          <option value="external">external</option>
                        </select>
                      </div>
                    )}

                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={canForceApproval}
                        onChange={(e) => setCanForceApproval(e.target.checked)}
                        className="rounded border-slate-300 dark:border-slate-700 text-blue-700 dark:text-sky-400"
                      />
                      <span>Can Force Human Approval Gate</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 pt-1">
            3. Read-Only Tools & Typed Output
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                Allowed Read-Only Tools (sa-ingress-readonly)
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">Write tools blocked by RBAC</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {READ_ONLY_TOOL_CATALOG.map((tool) => {
                const checked = allowedTools.includes(tool.id);
                return (
                  <label
                    key={tool.id}
                    className={`flex items-start gap-2 p-2.5 rounded-md border text-xs cursor-pointer transition-colors ${
                      checked
                        ? "bg-slate-50 dark:bg-[#090D16] border-slate-400"
                        : "bg-white dark:bg-[#0F172A] border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTool(tool.id)}
                      className="mt-0.5 rounded border-slate-300 dark:border-slate-700 text-blue-700 dark:text-sky-400"
                    />
                    <div className="min-w-0">
                      <div className="font-mono font-medium text-slate-900 dark:text-slate-100 text-[11px]">
                        {tool.id}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                        {tool.description}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          <OutputSchemaEditor
            fields={outputSchema}
            onAdd={() =>
              setOutputSchema((prev) => [
                ...prev,
                {
                  key: `field_${prev.length + 1}`,
                  type: "string",
                  description: "Structured output field",
                  required: true,
                },
              ])
            }
            onUpdate={(idx, patch) =>
              setOutputSchema((prev) =>
                prev.map((row, i) => (i === idx ? { ...row, ...patch } : row))
              )
            }
            onRemove={(idx) => setOutputSchema((prev) => prev.filter((_, i) => i !== idx))}
          />

          <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-100">
            <button
              type="button"
              disabled={saveRosterMutation.isPending || name.trim().length < 2}
              onClick={() => saveRosterMutation.mutate()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              {saveRosterMutation.isPending ? "Validating DAG..." : "Save to Reusable Roster"}
            </button>

            <button
              type="button"
              disabled={!activeWorkflow || assignMutation.isPending || name.trim().length < 2}
              onClick={() => assignMutation.mutate({ adHocBlueprint: buildPayload() })}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50 transition-colors"
            >
              <Zap className="h-3.5 w-3.5" />
              {assignMutation.isPending
                ? "Hooking & Running DAG..."
                : activeWorkflow
                  ? `Spawn & Hook into ${activeWorkflow.appName}`
                  : "Select Workflow to Hook"}
            </button>
          </div>
        </div>

        <BlueprintRosterList
          blueprints={blueprints}
          canAssign={Boolean(activeWorkflow)}
          isAssignPending={assignMutation.isPending}
          onToggle={(bp) => toggleBlueprintMutation.mutate(bp)}
          onDelete={(agentId) => deleteBlueprintMutation.mutate(agentId)}
          onAssign={(blueprintId) => assignMutation.mutate({ blueprintId })}
          onLoadTemplate={loadBlueprintIntoEditor}
        />
      </div>
    </div>
  );
}
