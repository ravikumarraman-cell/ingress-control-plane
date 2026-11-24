import {
  AgentStructuredOutputSchema,
  CORE_AGENT_STAGE_MAP,
  ReadOnlyToolIdSchema,
  WORKFLOW_STAGE_ORDER,
  type AgentStructuredOutput,
  type DynamicAgentBlueprint,
  type OutputFieldDefinition,
  type OutputFieldType,
  type WorkflowHookStage,
} from "../src/shared/contracts.ts";

export class DagValidationError extends Error {
  statusCode = 400;
  code: string;
  cyclePath?: string[];

  constructor(message: string, code = "DAG_VALIDATION_ERROR", cyclePath?: string[]) {
    super(message);
    this.name = "DagValidationError";
    this.code = code;
    this.cyclePath = cyclePath;
  }
}

export class MissingUpstreamFieldError extends Error {
  statusCode = 422;
  agentName: string;
  fieldPath: string;
  token: string;

  constructor(agentName: string, fieldPath: string, token: string) {
    super(
      `Missing upstream dependency output for token ${token}: "${fieldPath}" was not produced by "${agentName}".`
    );
    this.name = "MissingUpstreamFieldError";
    this.agentName = agentName;
    this.fieldPath = fieldPath;
    this.token = token;
  }
}

export class StructuredOutputValidationError extends Error {
  statusCode = 422;
  fieldKey?: string;

  constructor(message: string, fieldKey?: string) {
    super(message);
    this.name = "StructuredOutputValidationError";
    this.fieldKey = fieldKey;
  }
}

const CORE_AGENT_ALIASES: Record<string, string[]> = {
  DiscoveryAgent: ["DiscoveryInventoryAgent"],
  DiscoveryInventoryAgent: ["DiscoveryAgent"],
  PolicyAgent: ["PolicyComplianceAgent"],
  PolicyComplianceAgent: ["PolicyAgent"],
  ImpactAgent: ["ImpactAnalysisAgent"],
  ImpactAnalysisAgent: ["ImpactAgent"],
  ChangePlanAgent: ["ChangePlanningAgent"],
  ChangePlanningAgent: ["ChangePlanAgent"],
  VerifyAgent: ["ValidationRollbackAgent", "ExecutionAgent"],
  ValidationRollbackAgent: ["VerifyAgent"],
};

export const FORBIDDEN_SERVICE_ACCOUNTS = new Set<string>([
  "sa-ingress-executor",
  "cluster-admin",
  "root",
  "admin",
]);

export const FORBIDDEN_WRITE_TOOLS = new Set<string>([
  "kubectl_apply",
  "kubectl_delete",
  "kubectl_patch",
  "terraform_apply",
  "apply_patch",
  "write_manifest",
  "execute_rollout",
]);

const DISALLOWED_WRITE_PATTERNS = [
  /executor/i,
  /sa-ingress-executor/i,
  /write_/i,
  /apply_/i,
  /delete_/i,
  /patch_/i,
  /kubectl_/i,
];

export function assertReadOnlyBlueprintSecurity(
  bp: Pick<DynamicAgentBlueprint, "name" | "allowedTools"> & { serviceAccount?: string }
): void {
  if (
    bp.serviceAccount &&
    (bp.serviceAccount !== "sa-ingress-readonly" || FORBIDDEN_SERVICE_ACCOUNTS.has(bp.serviceAccount))
  ) {
    throw new DagValidationError(
      `Security Isolation Violation: Agent "${bp.name}" cannot bind service account "${bp.serviceAccount}". Dynamic agents are strictly locked to sa-ingress-readonly.`,
      "READONLY_ISOLATION_VIOLATION"
    );
  }

  for (const tool of bp.allowedTools ?? []) {
    if (
      FORBIDDEN_WRITE_TOOLS.has(tool) ||
      !ReadOnlyToolIdSchema.safeParse(tool).success ||
      DISALLOWED_WRITE_PATTERNS.some((p) => p.test(tool))
    ) {
      throw new DagValidationError(
        `Security Isolation Violation: Tool "${tool}" on agent "${bp.name}" is prohibited. Only verified read-only tools under sa-ingress-readonly are allowed.`,
        "WRITE_TOOL_PROHIBITED"
      );
    }
  }
}

export function validateAgentDag(
  blueprints: Array<
    Pick<DynamicAgentBlueprint, "name" | "hookStage" | "dependsOn" | "allowedTools"> & {
      serviceAccount?: string;
    }
  >,
  options?: {
    coreAgents?: Record<string, WorkflowHookStage>;
  }
): { valid: true } {
  const coreAgents = options?.coreAgents ?? CORE_AGENT_STAGE_MAP;
  const byName = new Map<
    string,
    Pick<DynamicAgentBlueprint, "name" | "hookStage" | "dependsOn" | "allowedTools"> & {
      serviceAccount?: string;
    }
  >();

  for (const bp of blueprints) {
    assertReadOnlyBlueprintSecurity(bp);
    if (byName.has(bp.name)) {
      throw new DagValidationError(
        `Duplicate agent name "${bp.name}" in blueprint roster.`,
        "DUPLICATE_AGENT_NAME"
      );
    }
    byName.set(bp.name, bp);
  }

  // 1. Validate self-loops and cross-stage ordering
  for (const bp of blueprints) {
    const bpRank = WORKFLOW_STAGE_ORDER[bp.hookStage];
    for (const dep of bp.dependsOn ?? []) {
      if (dep === bp.name) {
        throw new DagValidationError(
          `Cycle detected in agent dependency graph: ${bp.name} -> ${bp.name} (self-dependency is prohibited).`,
          "CYCLE_DETECTED",
          [bp.name, bp.name]
        );
      }

      const depBlueprint = byName.get(dep);
      const depStage = depBlueprint?.hookStage ?? coreAgents[dep];
      if (depStage) {
        const depRank = WORKFLOW_STAGE_ORDER[depStage];
        if (depRank > bpRank) {
          throw new DagValidationError(
            `Invalid cross-stage dependency: "${bp.name}" (${bp.hookStage}) cannot depend on later-stage agent "${dep}" (${depStage}).`,
            "INVALID_STAGE_ORDER"
          );
        }
      }
    }
  }

  // 2. DFS cycle detection across dependsOn edges (dep -> bp execution order)
  const visitState = new Map<string, 0 | 1 | 2>(); // 0=unvisited, 1=visiting, 2=visited
  const stack: string[] = [];

  const dfs = (nodeName: string): void => {
    const state = visitState.get(nodeName) ?? 0;
    if (state === 2) return;
    if (state === 1) {
      const idx = stack.indexOf(nodeName);
      const cycle = idx >= 0 ? [...stack.slice(idx), nodeName] : [nodeName, nodeName];
      throw new DagValidationError(
        `Cycle detected in agent dependency graph: ${cycle.join(" -> ")}`,
        "CYCLE_DETECTED",
        cycle
      );
    }

    visitState.set(nodeName, 1);
    stack.push(nodeName);

    const bp = byName.get(nodeName);
    if (bp) {
      for (const dep of bp.dependsOn ?? []) {
        if (byName.has(dep)) {
          dfs(dep);
        }
      }
    }

    stack.pop();
    visitState.set(nodeName, 2);
  };

  for (const bp of blueprints) {
    if ((visitState.get(bp.name) ?? 0) === 0) {
      dfs(bp.name);
    }
  }

  return { valid: true };
}

export function topologicalSortStageAgents(
  stage: WorkflowHookStage,
  blueprints: DynamicAgentBlueprint[],
  satisfiedExternalAgents: Set<string> = new Set()
): DynamicAgentBlueprint[][] {
  const stageAgents = blueprints.filter((bp) => bp.hookStage === stage);
  if (stageAgents.length === 0) return [];

  validateAgentDag(stageAgents);

  const stageNames = new Set(stageAgents.map((bp) => bp.name));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const bp of stageAgents) {
    inDegree.set(bp.name, 0);
    dependents.set(bp.name, []);
  }

  for (const bp of stageAgents) {
    const seenDeps = new Set<string>();
    for (const dep of bp.dependsOn ?? []) {
      if (seenDeps.has(dep)) continue;
      seenDeps.add(dep);
      // Only intra-stage dependencies not already satisfied block waves within this stage
      if (stageNames.has(dep) && !satisfiedExternalAgents.has(dep)) {
        inDegree.set(bp.name, (inDegree.get(bp.name) ?? 0) + 1);
        dependents.get(dep)!.push(bp.name);
      }
    }
  }

  const waves: DynamicAgentBlueprint[][] = [];
  const byName = new Map(stageAgents.map((bp) => [bp.name, bp]));
  let currentWaveNames = stageAgents
    .filter((bp) => (inDegree.get(bp.name) ?? 0) === 0)
    .map((bp) => bp.name);

  let processedCount = 0;

  while (currentWaveNames.length > 0) {
    const waveBlueprints = currentWaveNames.map((name) => byName.get(name)!);
    waves.push(waveBlueprints);
    processedCount += waveBlueprints.length;

    const nextWaveNames: string[] = [];
    for (const name of currentWaveNames) {
      for (const downstreamName of dependents.get(name) ?? []) {
        const nextDeg = (inDegree.get(downstreamName) ?? 0) - 1;
        inDegree.set(downstreamName, nextDeg);
        if (nextDeg === 0) {
          nextWaveNames.push(downstreamName);
        }
      }
    }
    currentWaveNames = nextWaveNames;
  }

  if (processedCount !== stageAgents.length) {
    throw new DagValidationError(
      `Topological sort failed for stage ${stage}: cyclic dependencies remain.`,
      "CYCLE_DETECTED"
    );
  }

  return waves;
}

function getByDotPath(root: unknown, pathSegments: string[]): unknown {
  let cursor: unknown = root;
  for (const segment of pathSegments) {
    if (cursor === null || cursor === undefined || typeof cursor !== "object") {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function resolveUpstreamAgentOutput(
  agentName: string,
  sharedContextBus: Record<string, AgentStructuredOutput>
): AgentStructuredOutput | undefined {
  if (sharedContextBus[agentName]) {
    return sharedContextBus[agentName];
  }
  for (const alias of CORE_AGENT_ALIASES[agentName] ?? []) {
    if (sharedContextBus[alias]) {
      return sharedContextBus[alias];
    }
  }
  return undefined;
}

export function formatInterpolatedValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export interface InterpolatedPromptResult {
  resolvedPrompt: string;
  consumedInputs: Record<string, unknown>;
  substitutedTokens: Array<{ token: string; agentName: string; fieldPath: string; value: unknown }>;
}

const UPSTREAM_TOKEN_REGEX = /\{\{\s*upstream\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_.-]+)\s*\}\}/g;

export function interpolateUpstreamPrompt(
  taskTemplate: string,
  sharedContextBus: Record<string, AgentStructuredOutput>,
  explicitDependsOn: string[] = []
): InterpolatedPromptResult {
  const consumedInputs: Record<string, unknown> = {};
  const substitutedTokens: Array<{
    token: string;
    agentName: string;
    fieldPath: string;
    value: unknown;
  }> = [];

  for (const depName of explicitDependsOn) {
    const depOut = resolveUpstreamAgentOutput(depName, sharedContextBus);
    if (depOut) {
      consumedInputs[depName] = depOut;
    }
  }

  const resolvedPrompt = taskTemplate.replace(
    UPSTREAM_TOKEN_REGEX,
    (fullMatch, agentName: string, fieldPath: string) => {
      const upstream = resolveUpstreamAgentOutput(agentName, sharedContextBus);
      if (!upstream) {
        throw new MissingUpstreamFieldError(agentName, fieldPath, fullMatch);
      }

      const segments = fieldPath.split(".");
      let val = getByDotPath(upstream.data, segments);
      if (val === undefined) {
        val = getByDotPath(upstream, segments);
      }
      if (val === undefined) {
        throw new MissingUpstreamFieldError(agentName, fieldPath, fullMatch);
      }

      consumedInputs[agentName] = upstream;
      substitutedTokens.push({ token: fullMatch, agentName, fieldPath, value: val });
      return formatInterpolatedValue(val);
    }
  );

  return { resolvedPrompt, consumedInputs, substitutedTokens };
}

function matchesFieldType(val: unknown, expectedType: OutputFieldType): boolean {
  switch (expectedType) {
    case "string":
      return typeof val === "string";
    case "number":
      return typeof val === "number" && Number.isFinite(val);
    case "boolean":
      return typeof val === "boolean";
    case "string[]":
      return Array.isArray(val) && val.every((item) => typeof item === "string");
    case "object":
      return typeof val === "object" && val !== null && !Array.isArray(val);
  }
}

export function validateStructuredOutput(
  rawOutput: unknown,
  outputSchema: OutputFieldDefinition[] = []
): AgentStructuredOutput {
  const parsed = AgentStructuredOutputSchema.safeParse(rawOutput);
  if (!parsed.success) {
    throw new StructuredOutputValidationError(
      `Invalid AgentStructuredOutput envelope: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`
    );
  }

  const output = parsed.data;
  for (const field of outputSchema) {
    const val = output.data[field.key];
    if (val === undefined || val === null) {
      if (field.required) {
        throw new StructuredOutputValidationError(
          `Missing required structured output field "${field.key}" (${field.type}).`,
          field.key
        );
      }
      continue;
    }

    if (!matchesFieldType(val, field.type)) {
      throw new StructuredOutputValidationError(
        `Structured output field "${field.key}" expected type "${field.type}" but received ${
          Array.isArray(val) ? "array" : typeof val
        }.`,
        field.key
      );
    }
  }

  return output;
}
