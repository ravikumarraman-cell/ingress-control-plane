import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  GitBranch,
  Lock,
  Plus,
  Sparkles,
  Trash2,
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
  type OutputFieldType,
  type ReadOnlyToolId,
  type WorkflowHookStage,
  type WorkflowRun,
} from "../../shared/contracts";

interface AgentStudioBuilderProps {
  activeWorkflow: WorkflowRun | null;
  onWorkflowUpdated?: (workflow: WorkflowRun) => void;
}

const STAGE_OPTIONS: Array<{ value: WorkflowHookStage; label: string }> = [
  { value: "PRE_INTAKE", label: "PRE_INTAKE · Stage 1" },
  { value: "PHASE_A_PARALLEL", label: "PHASE_A_PARALLEL · Stage 2 (Parallel Read)" },
  { value: "PHASE_B_SEQUENTIAL", label: "PHASE_B_SEQUENTIAL · Stage 3 (Planning Chain)" },
  { value: "POST_VERIFY", label: "POST_VERIFY · Stage 4 (Post-Verify)" },
];

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

  const [name, setName] = useState("RateLimitCheckerAgent");
  const [role, setRole] = useState(
    "Verifies gateway rate-limiting & burst quotas for external routes"
  );
  const [hookStage, setHookStage] = useState<WorkflowHookStage>("PHASE_B_SEQUENTIAL");
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a read-only Kubernetes gateway rate-limit specialist. Return structured JSON recommendations."
  );
  const [taskTemplate, setTaskTemplate] = useState(
    "Evaluate {{appName}} ({{environment}}) given Impact risk={{upstream.ImpactAgent.blastRadius}}. Recommend max RPS and burst limits."
  );
  const [dependsOn, setDependsOn] = useState<string[]>(["ImpactAgent"]);
  const [allowedTools, setAllowedTools] = useState<ReadOnlyToolId[]>([
    "get_lb_config",
    "list_k8s_routes",
  ]);
  const [canForceApproval, setCanForceApproval] = useState(false);
  const [alwaysActive, setAlwaysActive] = useState(true);
  const [envTrigger, setEnvTrigger] = useState<"" | "dev" | "staging" | "prod">("");
  const [exposureTrigger, setExposureTrigger] = useState<"" | "internal" | "external">("");
  const [outputSchema, setOutputSchema] = useState<OutputFieldDefinition[]>([
    {
      key: "recommendedRpsLimit",
      type: "number",
      description: "Suggested steady-state requests per second limit",
      required: true,
    },
    {
      key: "burstCap",
      type: "number",
      description: "Suggested token-bucket burst limit",
      required: true,
    },
    {
      key: "enforcedPolicy",
      type: "boolean",
      description: "Whether rate-limiting policy is required for this route",
      required: true,
    },
  ]);

  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);

  // Eligible upstream dependencies must live in same or earlier workflow stage
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

  // Clickable upstream output tokens derived from selected dependencies
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

  const addOutputRow = () => {
    setOutputSchema((prev) => [
      ...prev,
      {
        key: `field_${prev.length + 1}`,
        type: "string",
        description: "Structured output field",
        required: true,
      },
    ]);
  };

  const updateOutputRow = (idx: number, patch: Partial<OutputFieldDefinition>) => {
    setOutputSchema((prev) => prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const removeOutputRow = (idx: number) => {
    setOutputSchema((prev) => prev.filter((_, i) => i !== idx));
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
    onError: (err: Error) => {
      setFeedbackError(err.message);
    },
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
    onError: (err: Error) => {
      setFeedbackError(err.message);
    },
  });

  const toggleBlueprintMutation = useMutation({
    mutationFn: (bp: DynamicAgentBlueprint) =>
      updateAgentBlueprint(bp.agentId, { enabled: !bp.enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-blueprints"] });
    },
    onError: (err: Error) => setFeedbackError(err.message),
  });

  const deleteBlueprintMutation = useMutation({
    mutationFn: (agentId: string) => deleteAgentBlueprint(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-blueprints"] });
    },
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
    <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Cpu className="h-4 w-4 text-blue-700" />
            On-the-Fly Agent Studio & Structured Output Chaining
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Define read-only custom agents (<span className="font-mono">sa-ingress-readonly</span>), hook them into any workflow stage, and wire{" "}
            <span className="font-mono">{"{{upstream.<agent>.<field>}}"}</span> structured data dependencies.
          </p>
        </div>
        <div className="text-xs font-mono text-slate-500 tabular-nums shrink-0">
          {blueprints.filter((b) => b.enabled).length} / {blueprints.length} blueprints enabled
        </div>
      </div>

      {feedbackError && (
        <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-900 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <span>{feedbackError}</span>
        </div>
      )}

      {feedbackSuccess && (
        <div className="p-3 rounded-md bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
          <span>{feedbackSuccess}</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Builder Form */}
        <div className="xl:col-span-7 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="studio-agent-name"
                className="block text-[11px] font-medium text-slate-700 mb-1"
              >
                Agent Name (PascalCase / Slug)
              </label>
              <input
                id="studio-agent-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. RateLimitCheckerAgent"
                className="w-full px-3 py-1.5 text-xs font-mono border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="studio-hook-stage"
                className="block text-[11px] font-medium text-slate-700 mb-1"
              >
                Hook Stage
              </label>
              <select
                id="studio-hook-stage"
                value={hookStage}
                onChange={(e) => handleHookStageChange(e.target.value as WorkflowHookStage)}
                className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
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
              className="block text-[11px] font-medium text-slate-700 mb-1"
            >
              Responsibility / Role Summary
            </label>
            <input
              id="studio-agent-role"
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          {/* Upstream Dependencies Selector */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-700 flex items-center gap-1.5">
                <GitBranch className="h-3.5 w-3.5 text-slate-500" />
                Upstream Dependencies (<span className="font-mono">dependsOn</span>)
              </span>
              <span className="text-[11px] text-slate-500">
                Filtered to same or earlier stage
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 p-2.5 bg-slate-50 border border-slate-200 rounded-md">
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
                        : "bg-white border-slate-200 text-slate-700 hover:border-slate-400"
                    }`}
                  >
                    {selected ? "✓ " : "+ "}
                    {item.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Clickable Upstream Token Chips */}
          {availableUpstreamChips.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-slate-700 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-blue-700" />
                Click an Upstream Output Field to Insert Token into Task Template
              </div>
              <div className="flex flex-wrap gap-1.5">
                {availableUpstreamChips.map((chip) => (
                  <button
                    key={chip.token}
                    type="button"
                    onClick={() => insertTokenIntoTemplate(chip.token)}
                    className="px-2 py-1 text-[11px] font-mono bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 rounded transition-colors"
                    title={`Insert ${chip.token} (${chip.fieldType})`}
                  >
                    {chip.agentName}.{chip.fieldKey}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Task Template & System Prompt */}
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label
                htmlFor="studio-task-template"
                className="block text-[11px] font-medium text-slate-700 mb-1"
              >
                Task Template (Supports <span className="font-mono">{"{{upstream.<agent>.<field>}}"}</span>)
              </label>
              <textarea
                id="studio-task-template"
                ref={taskTemplateRef}
                rows={3}
                value={taskTemplate}
                onChange={(e) => setTaskTemplate(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="studio-system-prompt"
                className="block text-[11px] font-medium text-slate-700 mb-1"
              >
                System Prompt
              </label>
              <textarea
                id="studio-system-prompt"
                rows={2}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          {/* Read-Only Tool Whitelist */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-700 flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-slate-500" />
                Allowed Read-Only Tools (sa-ingress-readonly)
              </span>
              <span className="text-[11px] text-slate-500">
                Write tools blocked by RBAC
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {READ_ONLY_TOOL_CATALOG.map((tool) => {
                const checked = allowedTools.includes(tool.id);
                return (
                  <label
                    key={tool.id}
                    className={`flex items-start gap-2 p-2.5 rounded-md border text-xs cursor-pointer transition-colors ${
                      checked
                        ? "bg-slate-50 border-slate-400"
                        : "bg-white border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTool(tool.id)}
                      className="mt-0.5 rounded border-slate-300 text-blue-700"
                    />
                    <div className="min-w-0">
                      <div className="font-mono font-medium text-slate-900 text-[11px]">
                        {tool.id}
                      </div>
                      <div className="text-[11px] text-slate-500 leading-snug">
                        {tool.description}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Structured Output Schema Builder */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-700">
                Structured Output Schema (<span className="font-mono">outputSchema</span>)
              </span>
              <button
                type="button"
                onClick={addOutputRow}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-50 rounded"
              >
                <Plus className="h-3 w-3" />
                Add Field
              </button>
            </div>
            <div className="space-y-2">
              {outputSchema.map((field, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-12 gap-2 items-center bg-slate-50 border border-slate-200 rounded-md p-2"
                >
                  <input
                    type="text"
                    value={field.key}
                    onChange={(e) => updateOutputRow(idx, { key: e.target.value })}
                    placeholder="fieldKey"
                    aria-label="Output field key"
                    className="col-span-4 px-2 py-1 text-[11px] font-mono bg-white border border-slate-200 rounded"
                  />
                  <select
                    value={field.type}
                    onChange={(e) =>
                      updateOutputRow(idx, { type: e.target.value as OutputFieldType })
                    }
                    aria-label="Output field type"
                    className="col-span-3 px-2 py-1 text-[11px] bg-white border border-slate-200 rounded"
                  >
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                    <option value="string[]">string[]</option>
                    <option value="object">object</option>
                  </select>
                  <input
                    type="text"
                    value={field.description}
                    onChange={(e) => updateOutputRow(idx, { description: e.target.value })}
                    placeholder="Field description"
                    aria-label="Output field description"
                    className="col-span-4 px-2 py-1 text-[11px] bg-white border border-slate-200 rounded"
                  />
                  <button
                    type="button"
                    onClick={() => removeOutputRow(idx)}
                    aria-label={`Remove ${field.key}`}
                    className="col-span-1 flex justify-center text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Trigger & Safety Flags */}
          <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-slate-700">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={alwaysActive}
                onChange={(e) => setAlwaysActive(e.target.checked)}
                className="rounded border-slate-300 text-blue-700"
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
                  className="px-2 py-1 text-xs border border-slate-200 rounded bg-white"
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
                  className="px-2 py-1 text-xs border border-slate-200 rounded bg-white"
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
                className="rounded border-slate-300 text-blue-700"
              />
              <span>Can Force Human Approval Gate</span>
            </label>
          </div>

          {/* Submit Actions */}
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

        {/* Reusable Roster Column */}
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
                      onClick={() => toggleBlueprintMutation.mutate(bp)}
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
                      onClick={() => deleteBlueprintMutation.mutate(bp.agentId)}
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
                    disabled={!activeWorkflow || assignMutation.isPending}
                    onClick={() => assignMutation.mutate({ blueprintId: bp.agentId })}
                    className="px-2.5 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded transition-colors disabled:opacity-50"
                  >
                    Hook into Active Workflow
                  </button>
                  <button
                    type="button"
                    onClick={() => loadBlueprintIntoEditor(bp)}
                    className="px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded transition-colors"
                  >
                    Load Template
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
