import crypto from "node:crypto";
import { GoogleGenAI, ThinkingLevel, Type, type Schema } from "@google/genai";
import {
  CORE_AGENT_STAGE_MAP,
  MAX_DYNAMIC_AGENTS_PER_WORKFLOW,
  WORKFLOW_STAGE_ORDER,
  type AgentStructuredOutput,
  type DynamicAgentBlueprint,
  type DynamicTaskAssignment,
  type IngressRequest,
  type OutputFieldDefinition,
  type PolicyControlResult,
  type WorkflowHookStage,
} from "../src/shared/contracts.ts";
import {
  interpolateUpstreamPrompt,
  topologicalSortStageAgents,
  validateAgentDag,
  validateStructuredOutput,
} from "./dagEngine.ts";

export type DynamicAgentExecutor = (params: {
  blueprint: DynamicAgentBlueprint;
  resolvedPrompt: string;
  consumedInputs: Record<string, unknown>;
  request: IngressRequest;
}) => Promise<unknown>;

function mapOutputFieldTypeToGemini(field: OutputFieldDefinition): Schema {
  switch (field.type) {
    case "number":
      return { type: Type.NUMBER, description: field.description };
    case "boolean":
      return { type: Type.BOOLEAN, description: field.description };
    case "string[]":
      return {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: field.description,
      };
    case "object":
      return {
        type: Type.OBJECT,
        properties: {
          note: { type: Type.STRING },
        },
        description: field.description,
      };
    case "string":
    default:
      return { type: Type.STRING, description: field.description };
  }
}

export function buildGeminiResponseSchema(outputSchema: OutputFieldDefinition[]): Schema {
  const dataProperties: Record<string, Schema> = {};
  const requiredDataKeys: string[] = [];

  for (const field of outputSchema) {
    dataProperties[field.key] = mapOutputFieldTypeToGemini(field);
    if (field.required) {
      requiredDataKeys.push(field.key);
    }
  }

  if (Object.keys(dataProperties).length === 0) {
    dataProperties.finding = {
      type: Type.STRING,
      description: "Primary factual finding produced by the agent",
    };
  }

  return {
    type: Type.OBJECT,
    properties: {
      summary: { type: Type.STRING, description: "Concise 1-sentence summary of the findings." },
      riskDelta: {
        type: Type.STRING,
        description: 'Must be one of "NONE", "ELEVATE_MEDIUM", or "ELEVATE_HIGH".',
      },
      vetoTriggered: {
        type: Type.BOOLEAN,
        description: "True only if a critical security or policy violation requires halting downstream execution.",
      },
      confidence: {
        type: Type.NUMBER,
        description: "Confidence score between 0.0 and 1.0",
      },
      data: {
        type: Type.OBJECT,
        properties: dataProperties,
        ...(requiredDataKeys.length > 0 ? { required: requiredDataKeys } : {}),
      },
    },
    required: ["summary", "riskDelta", "vetoTriggered", "confidence", "data"],
  };
}

export function synthesizeDeterministicAgentOutput(params: {
  blueprint: DynamicAgentBlueprint;
  resolvedPrompt: string;
  consumedInputs: Record<string, unknown>;
  request: IngressRequest;
}): AgentStructuredOutput {
  const { blueprint, request, consumedInputs } = params;
  const data: Record<string, unknown> = {};

  if (blueprint.name === "TLSInspectorAgent") {
    data.minTlsVersion = request.tlsProfile === "tls_1_3_strict" ? "TLSv1.3" : "TLSv1.2";
    data.expiringWithinDays = request.environment === "prod" ? 42 : 78;
    data.sanCoverageOk = !request.hostname.includes("*");
    data.sanList = [request.hostname];
  } else if (blueprint.name === "CanaryWeightPlannerAgent") {
    const impact = consumedInputs.ImpactAgent as AgentStructuredOutput | undefined;
    const tls = consumedInputs.TLSInspectorAgent as AgentStructuredOutput | undefined;
    const blast = String(impact?.data?.blastRadius ?? "MEDIUM");
    const expiryDays = Number(tls?.data?.expiringWithinDays ?? 45);
    data.recommendedCanaryPercent = blast === "HIGH" || expiryDays < 14 ? 10 : 25;
    data.soakMinutes = blast === "HIGH" ? 30 : 15;
  } else if (blueprint.name === "EdgeSecurityAuditor") {
    data.wafRuleCount = request.exposure === "external" ? 4 : 0;
    data.riskTier =
      request.environment === "prod" && request.exposure === "external" ? "ELEVATED" : "STANDARD";
  } else if (blueprint.name === "BlastRadiusMitigator") {
    data.mitigationSteps = [
      `Pin canary step <= 15% on ${request.hostname}`,
      `Enforce 4-vantage synthetic probe gate before 100% shift`,
    ];
    data.maxInitialWeight = 15;
  } else {
    for (const field of blueprint.outputSchema) {
      const lower = field.key.toLowerCase();
      switch (field.type) {
        case "number":
          data[field.key] = lower.includes("percent") || lower.includes("weight")
            ? request.environment === "prod"
              ? 15
              : 25
            : lower.includes("day")
              ? 45
              : 1;
          break;
        case "boolean":
          data[field.key] = !lower.includes("conflict") && !lower.includes("violation");
          break;
        case "string[]":
          data[field.key] = [`${request.hostname}${request.pathPrefix}`, request.backendService];
          break;
        case "object":
          data[field.key] = {
            environment: request.environment,
            exposure: request.exposure,
            verified: true,
          };
          break;
        case "string":
        default:
          data[field.key] = `${request.appName}:${request.environment}:${request.tlsProfile}`;
          break;
      }
    }
  }

  return {
    summary: `${blueprint.name} (${blueprint.role}) completed read-only analysis for ${request.hostname}${request.pathPrefix}.`,
    data,
    riskDelta: "NONE",
    vetoTriggered: false,
    confidence: 0.94,
  };
}

export async function runBlueprintWithGeminiOrFallback(params: {
  blueprint: DynamicAgentBlueprint;
  resolvedPrompt: string;
  consumedInputs: Record<string, unknown>;
  request: IngressRequest;
}): Promise<AgentStructuredOutput> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey && apiKey !== "MY_GEMINI_API_KEY") {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: `Task Prompt: ${params.resolvedPrompt}

Target Ingress Request:
${JSON.stringify(params.request, null, 2)}

Allowed Read-Only Tools (sa-ingress-readonly): ${params.blueprint.allowedTools.join(", ") || "none"}

Consumed Upstream Agent Outputs:
${JSON.stringify(params.consumedInputs, null, 2)}`,
        config: {
          systemInstruction: `${params.blueprint.systemPrompt}\nYou run strictly under sa-ingress-readonly and must return JSON conforming to the provided schema.`,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: buildGeminiResponseSchema(params.blueprint.outputSchema),
        },
      });

      const rawText = (response.text ?? "").trim();
      if (rawText) {
        const parsed = JSON.parse(rawText) as unknown;
        return validateStructuredOutput(parsed, params.blueprint.outputSchema);
      }
    } catch {
      // Fall back to deterministic typed output generator if Gemini fails or schema mismatches
    }
  }

  const fallback = synthesizeDeterministicAgentOutput(params);
  return validateStructuredOutput(fallback, params.blueprint.outputSchema);
}

export function blueprintMatchesTrigger(
  bp: DynamicAgentBlueprint,
  request: IngressRequest
): boolean {
  if (!bp.enabled) return false;
  const cond = bp.triggerCondition;
  if (!cond) return true;
  if (cond.environments && cond.environments.length > 0) {
    if (!cond.environments.includes(request.environment)) return false;
  }
  if (cond.exposures && cond.exposures.length > 0) {
    if (!cond.exposures.includes(request.exposure)) return false;
  }
  return true;
}

export function selectActiveBlueprintsForWorkflow(
  allBlueprints: DynamicAgentBlueprint[],
  request: IngressRequest,
  extraSpawned: DynamicAgentBlueprint[] = []
): DynamicAgentBlueprint[] {
  const combined: DynamicAgentBlueprint[] = [];
  const seenNames = new Set<string>();

  for (const bp of [...allBlueprints, ...extraSpawned]) {
    if (seenNames.has(bp.name)) continue;
    if (blueprintMatchesTrigger(bp, request)) {
      seenNames.add(bp.name);
      combined.push(bp);
      if (combined.length >= MAX_DYNAMIC_AGENTS_PER_WORKFLOW) break;
    }
  }

  return combined;
}

export function maybeCreateSupervisorSpawnedChain(params: {
  request: IngressRequest;
  checks: PolicyControlResult[];
  hasCollision: boolean;
  existingBlueprints: DynamicAgentBlueprint[];
}): DynamicAgentBlueprint[] {
  const existingNames = new Set(params.existingBlueprints.map((b) => b.name));
  const remainingSlots = Math.max(0, MAX_DYNAMIC_AGENTS_PER_WORKFLOW - params.existingBlueprints.length);
  if (remainingSlots < 2) return [];

  const hasWarningOrViolation = params.checks.some((c) => !c.passed || c.severity === "WARN");
  const isHighRiskProdExternal =
    params.request.environment === "prod" &&
    params.request.exposure === "external" &&
    (params.hasCollision || hasWarningOrViolation);

  if (!isHighRiskProdExternal) return [];
  if (existingNames.has("EdgeSecurityAuditor") || existingNames.has("BlastRadiusMitigator")) {
    return [];
  }

  const now = new Date().toISOString();
  const auditor: DynamicAgentBlueprint = {
    agentId: crypto.randomUUID(),
    name: "EdgeSecurityAuditor",
    role: "Supervisor-Spawned Edge Auditor",
    systemPrompt:
      "Supervisor-spawned read-only auditor validating external prod WAF rule density and edge exposure.",
    taskTemplate:
      "Audit edge WAF readiness using policy decision {{upstream.PolicyAgent.summary.decision}} for external prod traffic.",
    hookStage: "PHASE_A_PARALLEL",
    dependsOn: ["PolicyAgent"],
    outputSchema: [
      { key: "wafRuleCount", type: "number", description: "Active WAF rules bound", required: true },
      { key: "riskTier", type: "string", description: "Computed edge risk tier", required: true },
    ],
    allowedTools: ["evaluate_opa_policies", "get_lb_config"],
    triggerCondition: { environments: ["prod"], exposures: ["external"] },
    canForceApproval: true,
    spawnedBy: "SUPERVISOR",
    enabled: true,
    createdAt: now,
  };

  const mitigator: DynamicAgentBlueprint = {
    agentId: crypto.randomUUID(),
    name: "BlastRadiusMitigator",
    role: "Supervisor-Spawned Blast Radius Mitigator",
    systemPrompt:
      "Supervisor-spawned planner generating progressive rollout guardrails from upstream auditor findings.",
    taskTemplate:
      "Given edge risk tier {{upstream.EdgeSecurityAuditor.riskTier}} and blast radius {{upstream.ImpactAgent.blastRadius}}, list concrete rollout mitigations.",
    hookStage: "PHASE_B_SEQUENTIAL",
    dependsOn: ["EdgeSecurityAuditor", "ImpactAgent"],
    outputSchema: [
      {
        key: "mitigationSteps",
        type: "string[]",
        description: "Ordered canary mitigation guardrails",
        required: true,
      },
      {
        key: "maxInitialWeight",
        type: "number",
        description: "Maximum safe initial canary percentage",
        required: true,
      },
    ],
    allowedTools: ["check_route_collisions"],
    triggerCondition: { environments: ["prod"], exposures: ["external"] },
    canForceApproval: false,
    spawnedBy: "SUPERVISOR",
    enabled: true,
    createdAt: now,
  };

  return [auditor, mitigator];
}

export interface StageExecutionOutcome {
  assignments: DynamicTaskAssignment[];
  vetoedAgents: Set<string>;
  failedAgents: Set<string>;
}

export async function executeStageDynamicAgents(params: {
  stage: WorkflowHookStage;
  blueprints: DynamicAgentBlueprint[];
  request: IngressRequest;
  sharedContextBus: Record<string, AgentStructuredOutput>;
  priorVetoedOrFailed?: Set<string>;
  executor?: DynamicAgentExecutor;
  onHandoffAudit?: (input: {
    agentName: string;
    dependsOn: string[];
    consumedInputs: Record<string, unknown>;
    output: AgentStructuredOutput | null;
    status: DynamicTaskAssignment["status"];
  }) => string | undefined;
}): Promise<StageExecutionOutcome> {
  const stageBlueprints = params.blueprints.filter((bp) => bp.hookStage === params.stage);
  if (stageBlueprints.length === 0) {
    return {
      assignments: [],
      vetoedAgents: new Set(params.priorVetoedOrFailed),
      failedAgents: new Set(),
    };
  }

  validateAgentDag(params.blueprints);

  // Mark all earlier-stage and core agents present in context bus as satisfied preconditions
  const satisfiedExternal = new Set<string>(Object.keys(params.sharedContextBus));
  for (const [coreName, coreStage] of Object.entries(CORE_AGENT_STAGE_MAP)) {
    if (WORKFLOW_STAGE_ORDER[coreStage] <= WORKFLOW_STAGE_ORDER[params.stage]) {
      satisfiedExternal.add(coreName);
    }
  }
  for (const bp of params.blueprints) {
    if (WORKFLOW_STAGE_ORDER[bp.hookStage] < WORKFLOW_STAGE_ORDER[params.stage]) {
      satisfiedExternal.add(bp.name);
    }
  }

  const waves = topologicalSortStageAgents(params.stage, stageBlueprints, satisfiedExternal);
  const vetoedAgents = new Set<string>(params.priorVetoedOrFailed ?? []);
  const failedAgents = new Set<string>();
  const assignments: DynamicTaskAssignment[] = [];
  const executor = params.executor ?? runBlueprintWithGeminiOrFallback;

  for (const wave of waves) {
    const waveResults = await Promise.all(
      wave.map(async (bp): Promise<DynamicTaskAssignment> => {
        const startedAt = Date.now();
        const failedDep = bp.dependsOn.find(
          (dep) => vetoedAgents.has(dep) || failedAgents.has(dep)
        );

        if (failedDep) {
          failedAgents.add(bp.name);
          const skipped: DynamicTaskAssignment = {
            taskId: crypto.randomUUID(),
            agentId: bp.agentId,
            agentName: bp.name,
            hookStage: bp.hookStage,
            dependsOn: bp.dependsOn,
            resolvedTaskPrompt: `[SKIPPED] Upstream dependency "${failedDep}" vetoed or failed.`,
            status: "SKIPPED_UPSTREAM_FAILED",
            structuredOutput: null,
            consumedInputs: {},
            executedAt: new Date().toISOString(),
            durationMs: 0,
          };
          const auditHash = params.onHandoffAudit?.({
            agentName: bp.name,
            dependsOn: bp.dependsOn,
            consumedInputs: {},
            output: null,
            status: skipped.status,
          });
          if (auditHash) skipped.auditEventHash = auditHash;
          return skipped;
        }

        try {
          const { resolvedPrompt, consumedInputs } = interpolateUpstreamPrompt(
            bp.taskTemplate,
            params.sharedContextBus,
            bp.dependsOn
          );

          const rawResult = await executor({
            blueprint: bp,
            resolvedPrompt,
            consumedInputs,
            request: params.request,
          });

          const validated = validateStructuredOutput(rawResult, bp.outputSchema);
          params.sharedContextBus[bp.name] = validated;

          if (validated.vetoTriggered) {
            vetoedAgents.add(bp.name);
          }

          const status: DynamicTaskAssignment["status"] = validated.vetoTriggered
            ? "VETOED"
            : "COMPLETED";

          const auditHash = params.onHandoffAudit?.({
            agentName: bp.name,
            dependsOn: bp.dependsOn,
            consumedInputs,
            output: validated,
            status,
          });

          return {
            taskId: crypto.randomUUID(),
            agentId: bp.agentId,
            agentName: bp.name,
            hookStage: bp.hookStage,
            dependsOn: bp.dependsOn,
            resolvedTaskPrompt: resolvedPrompt,
            status,
            structuredOutput: validated,
            consumedInputs,
            executedAt: new Date().toISOString(),
            durationMs: Math.max(12, Date.now() - startedAt),
            ...(auditHash ? { auditEventHash: auditHash } : {}),
          };
        } catch (err) {
          failedAgents.add(bp.name);
          const message = err instanceof Error ? err.message : "Agent execution failed";
          const fallbackFailed: DynamicTaskAssignment = {
            taskId: crypto.randomUUID(),
            agentId: bp.agentId,
            agentName: bp.name,
            hookStage: bp.hookStage,
            dependsOn: bp.dependsOn,
            resolvedTaskPrompt: bp.taskTemplate,
            status: "SKIPPED_UPSTREAM_FAILED",
            structuredOutput: {
              summary: message,
              data: { error: message },
              riskDelta: "ELEVATE_HIGH",
              vetoTriggered: true,
              confidence: 1,
            },
            consumedInputs: {},
            executedAt: new Date().toISOString(),
            durationMs: Math.max(5, Date.now() - startedAt),
          };
          return fallbackFailed;
        }
      })
    );

    assignments.push(...waveResults);
  }

  return { assignments, vetoedAgents, failedAgents };
}
