import {
  Agent,
  AgentResultEvent,
  Graph,
  type Tool,
} from "@strands-agents/sdk";
import type { MultiAgentResult } from "@strands-agents/sdk/multiagent";
import type {
  AgentStepTrace,
  AgentStructuredOutput,
  BlastRadiusScore,
  IngressRequest,
  PolicyControlResult,
  WorkflowPipelineConfig,
} from "../../src/shared/contracts.ts";
import {
  createHitlApprovalIntervention,
  IngressSteeringHandler,
  SecretAndTlsGuardrailIntervention,
} from "./guardrailsAndSteering.ts";
import { DeterministicControlPlaneModel } from "./modelProvider.ts";
import {
  createWorkflowSessionManager,
  DEFAULT_GRAPH_LIMITS,
  recordStrandsAgentResult,
} from "./sessionMemoryTelemetry.ts";
import {
  checkRouteCollisionsTool,
  evaluateOpaPoliciesTool,
  getDnsRecordsTool,
  getLbConfigTool,
  getTlsCertsTool,
  listK8sRoutesTool,
} from "./tools.ts";

export interface CorePipelineGraphInput {
  workflowId: string;
  sessionId: string;
  request: IngressRequest;
  pipelineConfig: WorkflowPipelineConfig;
  iteration: number;
  liveEtag: string;
  routeCount: number;
  customRuleCount: number;
  checks: PolicyControlResult[];
  violations: string[];
  blastRadius: BlastRadiusScore;
  collidingRouteId?: string;
  initialCanaryWeight: number;
  dynamicVetoed: boolean;
  dryRunPassed: boolean;
  planId: string;
}

export interface CorePipelineGraphOutput {
  multiAgentResult: MultiAgentResult;
  nodeDurations: Record<string, number>;
  nodeSummaries: Record<string, string>;
}

/**
 * Orchestrates the core Ingress Control Plane pipeline through a native Strands `Graph`
 * (`IngressIntakeAgent -> SupervisorAgent -> Phase A Parallel Fan-Out -> Phase B Sequential Planners`)
 * backed by `SessionManager`, `InterventionHandler`s, `SteeringHandler`, and `InvokeLimits`.
 */
export async function executeCorePipelineWithStrandsGraph(
  input: CorePipelineGraphInput
): Promise<CorePipelineGraphOutput> {
  const enabled = new Set(input.pipelineConfig.enabledAgents);
  const dryRunBaselinePass = input.violations.length === 0;
  const sessionManager = createWorkflowSessionManager(input.sessionId);

  const sharedInterventions = () => [
    new SecretAndTlsGuardrailIntervention(),
    new IngressSteeringHandler(),
    createHitlApprovalIntervention(),
  ];

  const makeCoreNodeAgent = (cfg: {
    id: string;
    name: string;
    systemPrompt: string;
    fallbackText: string;
    tools?: Tool[];
  }) => {
    const agent = new Agent({
      id: cfg.id,
      name: cfg.name,
      printer: false,
      model: new DeterministicControlPlaneModel({
        request: input.request,
        fallbackText: cfg.fallbackText,
      }),
      systemPrompt: cfg.systemPrompt,
      tools: cfg.tools ?? [],
      interventions: sharedInterventions(),
      retryStrategy: null,
    });
    agent.addHook(AgentResultEvent, (ev) => {
      const nodeSucceeded =
        cfg.name === "PolicyComplianceAgent"
          ? dryRunBaselinePass
          : cfg.name === "ValidationRollbackAgent"
            ? input.dryRunPassed
            : undefined;
      recordStrandsAgentResult({
        agentName: cfg.name,
        workflowId: input.workflowId,
        sessionId: input.sessionId,
        succeeded: nodeSucceeded,
        result: ev.result,
      });
    });
    return agent;
  };

  const nodes: Agent[] = [];
  const edges: Array<[string, string]> = [];

  const intakeAgent = makeCoreNodeAgent({
    id: "IngressIntakeAgent",
    name: "IngressIntakeAgent",
    systemPrompt: "Validate IngressRequest structure and enforce secret/TLS intake boundaries.",
    fallbackText: `Validated IngressRequest for ${input.request.appName} (${input.request.environment}).`,
  });

  const supervisorAgent = makeCoreNodeAgent({
    id: "SupervisorAgent",
    name: "SupervisorAgent",
    systemPrompt: "Coordinate Phase A parallel analysis fan-out and Phase B sequential planning.",
    fallbackText: `Dispatched Phase A parallel & dynamic DAG agents (iteration ${input.iteration}/${input.pipelineConfig.maxSupervisorIterations})${
      input.pipelineConfig.customInstructions
        ? ` · Guidance: "${input.pipelineConfig.customInstructions.slice(0, 60)}"`
        : ""
    }.`,
  });

  nodes.push(intakeAgent, supervisorAgent);
  edges.push(["IngressIntakeAgent", "SupervisorAgent"]);

  const phaseANodes: string[] = [];

  if (enabled.has("DiscoveryInventoryAgent")) {
    nodes.push(
      makeCoreNodeAgent({
        id: "DiscoveryInventoryAgent",
        name: "DiscoveryInventoryAgent",
        systemPrompt: "Read-only cluster HTTPRoute and ETag inventory discovery.",
        tools: [listK8sRoutesTool, getLbConfigTool],
        fallbackText: `Snapshotted ${input.routeCount} routes; pinned ETag ${input.liveEtag.slice(0, 18)}...`,
      })
    );
    edges.push(["SupervisorAgent", "DiscoveryInventoryAgent"]);
    phaseANodes.push("DiscoveryInventoryAgent");
  }

  if (enabled.has("PolicyComplianceAgent")) {
    nodes.push(
      makeCoreNodeAgent({
        id: "PolicyComplianceAgent",
        name: "PolicyComplianceAgent",
        systemPrompt: "Evaluate corporate OPA & dynamic CustomPolicyRules read-only.",
        tools: [evaluateOpaPoliciesTool, getDnsRecordsTool],
        fallbackText: `${input.checks.filter((c) => c.passed).length}/${input.checks.length} compliance controls passed (incl. ${input.customRuleCount} custom rules).`,
      })
    );
    edges.push(["SupervisorAgent", "PolicyComplianceAgent"]);
    phaseANodes.push("PolicyComplianceAgent");
  }

  if (enabled.has("ImpactAnalysisAgent")) {
    nodes.push(
      makeCoreNodeAgent({
        id: "ImpactAnalysisAgent",
        name: "ImpactAnalysisAgent",
        systemPrompt: "Compute BlastRadiusScore and detect hostname/path collisions.",
        tools: [checkRouteCollisionsTool],
        fallbackText: `Computed BlastRadiusScore: ${input.blastRadius}.`,
      })
    );
    edges.push(["SupervisorAgent", "ImpactAnalysisAgent"]);
    phaseANodes.push("ImpactAnalysisAgent");
  }

  if (enabled.has("CostEstimationAgent")) {
    const monthlyDelta =
      input.request.exposure === "external"
        ? "$24.50/mo (Edge WAF + L7 LB)"
        : "$4.20/mo (Internal Mesh)";
    nodes.push(
      makeCoreNodeAgent({
        id: "CostEstimationAgent",
        name: "CostEstimationAgent",
        systemPrompt: "Estimate monthly edge/mesh ingress cost delta.",
        tools: [getLbConfigTool],
        fallbackText: `Estimated incremental infra cost: ${monthlyDelta}.`,
      })
    );
    edges.push(["SupervisorAgent", "CostEstimationAgent"]);
    phaseANodes.push("CostEstimationAgent");
  }

  if (enabled.has("SecurityPostureAgent")) {
    nodes.push(
      makeCoreNodeAgent({
        id: "SecurityPostureAgent",
        name: "SecurityPostureAgent",
        systemPrompt: "Verify TLS posture, SAN coverage, and HSTS enforcement.",
        tools: [getTlsCertsTool],
        fallbackText: `Verified HTTPS redirect, HSTS headers, and ${input.request.tlsProfile} cipher posture.`,
      })
    );
    edges.push(["SupervisorAgent", "SecurityPostureAgent"]);
    phaseANodes.push("SecurityPostureAgent");
  }

  const changePlanningAgent = makeCoreNodeAgent({
    id: "ChangePlanningAgent",
    name: "ChangePlanningAgent",
    systemPrompt: "Synthesize Gateway API HTTPRoute YAML, Terraform HCL, and unified diff.",
    fallbackText: `Synthesized HTTPRoute YAML (initial weight ${input.initialCanaryWeight}%), Terraform HCL, and unified diff.`,
  });

  const validationRollbackAgent = makeCoreNodeAgent({
    id: "ValidationRollbackAgent",
    name: "ValidationRollbackAgent",
    systemPrompt: "Verify dry-run gates and seal deterministic RollbackPlan.",
    fallbackText: input.dryRunPassed
      ? "Dry-run passed; deterministic RollbackPlan sealed."
      : `Dry-run blocked: ${input.violations.join("; ") || "policy/veto gate triggered"}`,
  });

  nodes.push(changePlanningAgent, validationRollbackAgent);

  if (phaseANodes.length > 0) {
    for (const pNode of phaseANodes) {
      edges.push([pNode, "ChangePlanningAgent"]);
    }
  } else {
    edges.push(["SupervisorAgent", "ChangePlanningAgent"]);
  }
  edges.push(["ChangePlanningAgent", "ValidationRollbackAgent"]);

  const graph = new Graph({
    id: `ingress-pipeline-${input.workflowId.slice(0, 8)}`,
    nodes,
    edges,
    maxConcurrency: 5,
    maxSteps: 16,
    nodeTimeout: 10_000,
    sessionManager,
    traceAttributes: {
      "ingress.workflow_id": input.workflowId,
      "ingress.app_name": input.request.appName,
      "ingress.environment": input.request.environment,
    },
  });

  const multiAgentResult = await graph.invoke(
    `Evaluate ingress workflow ${input.workflowId} for ${input.request.appName} (${input.request.environment}/${input.request.exposure}) targeting ${input.request.hostname}${input.request.pathPrefix}.`,
    {
      limits: DEFAULT_GRAPH_LIMITS,
      invocationState: {
        workflowId: input.workflowId,
        liveEtag: input.liveEtag,
        planId: input.planId,
        dryRunBaselinePass,
      },
    }
  );

  const nodeDurations: Record<string, number> = {};
  const nodeSummaries: Record<string, string> = {};

  for (const nr of multiAgentResult.results) {
    nodeDurations[nr.nodeId] = Math.max(10, nr.duration);
    const txt = nr.content
      .filter((b) => b.type === "textBlock")
      .map((b) => b.text)
      .join(" ")
      .trim();
    if (txt) nodeSummaries[nr.nodeId] = txt;
  }

  if (multiAgentResult.results.length === 0) {
    recordStrandsAgentResult({
      agentName: "CorePipelineGraph",
      workflowId: input.workflowId,
      sessionId: input.sessionId,
      succeeded: multiAgentResult.status === "COMPLETED",
      result: {
        stopReason: multiAgentResult.status === "COMPLETED" ? "endTurn" : "maxTokens",
        metrics: undefined,
        traces: [],
      },
    });
  }

  return {
    multiAgentResult,
    nodeDurations,
    nodeSummaries,
  };
}

export function buildCoreTracesFromGraphResult(params: {
  graphOut: CorePipelineGraphOutput;
  enabled: Set<string>;
  intakeOutput: AgentStructuredOutput;
  discoveryOutput: AgentStructuredOutput;
  checks: PolicyControlResult[];
  customRuleCount: number;
  blastRadius: BlastRadiusScore;
  dryRunBaselinePass: boolean;
  dryRunPassed: boolean;
  policyViolations: string[];
  request: IngressRequest;
  iteration: number;
  maxIterations: number;
  customInstructions?: string;
  activeBlueprintCount: number;
  initialCanaryWeight: number;
  now: string;
}): AgentStepTrace[] {
  const { nodeDurations, nodeSummaries } = params.graphOut;
  const traces: AgentStepTrace[] = [
    {
      agentName: "IngressIntakeAgent",
      phase: "INTAKE",
      accessMode: "NONE",
      status: "COMPLETED",
      summary: nodeSummaries.IngressIntakeAgent || params.intakeOutput.summary,
      durationMs: nodeDurations.IngressIntakeAgent ?? 45,
      completedAt: params.now,
    },
    {
      agentName: "SupervisorAgent",
      phase: "SUPERVISOR",
      accessMode: "STATE_CHECKPOINT",
      status: "COMPLETED",
      summary:
        nodeSummaries.SupervisorAgent ||
        `Dispatched Phase A parallel & ${params.activeBlueprintCount} hooked dynamic DAG agents (iteration ${params.iteration}/${params.maxIterations})${
          params.customInstructions
            ? ` · Guidance: "${params.customInstructions.slice(0, 60)}"`
            : ""
        }.`,
      durationMs: nodeDurations.SupervisorAgent ?? 35,
      completedAt: params.now,
    },
  ];

  if (params.enabled.has("DiscoveryInventoryAgent")) {
    traces.push({
      agentName: "DiscoveryInventoryAgent",
      phase: "PHASE_A_PARALLEL",
      accessMode: "READ_ONLY",
      status: "COMPLETED",
      summary: nodeSummaries.DiscoveryInventoryAgent || params.discoveryOutput.summary,
      durationMs: nodeDurations.DiscoveryInventoryAgent ?? 85,
      completedAt: params.now,
    });
  }

  if (params.enabled.has("PolicyComplianceAgent")) {
    traces.push({
      agentName: "PolicyComplianceAgent",
      phase: "PHASE_A_PARALLEL",
      accessMode: "READ_ONLY",
      status: params.dryRunBaselinePass ? "COMPLETED" : "FAILED",
      summary:
        nodeSummaries.PolicyComplianceAgent ||
        `${params.checks.filter((c) => c.passed).length}/${params.checks.length} compliance controls passed (incl. ${params.customRuleCount} custom rules).`,
      durationMs: nodeDurations.PolicyComplianceAgent ?? 70,
      completedAt: params.now,
    });
  }

  if (params.enabled.has("ImpactAnalysisAgent")) {
    traces.push({
      agentName: "ImpactAnalysisAgent",
      phase: "PHASE_A_PARALLEL",
      accessMode: "READ_ONLY",
      status: "COMPLETED",
      summary: nodeSummaries.ImpactAnalysisAgent || `Computed BlastRadiusScore: ${params.blastRadius}.`,
      durationMs: nodeDurations.ImpactAnalysisAgent ?? 60,
      completedAt: params.now,
    });
  }

  if (params.enabled.has("CostEstimationAgent")) {
    const monthlyDelta =
      params.request.exposure === "external"
        ? "$24.50/mo (Edge WAF + L7 LB)"
        : "$4.20/mo (Internal Mesh)";
    traces.push({
      agentName: "CostEstimationAgent",
      phase: "PHASE_A_PARALLEL",
      accessMode: "READ_ONLY",
      status: "COMPLETED",
      summary:
        nodeSummaries.CostEstimationAgent || `Estimated incremental infra cost: ${monthlyDelta}.`,
      durationMs: nodeDurations.CostEstimationAgent ?? 55,
      completedAt: params.now,
    });
  }

  if (params.enabled.has("SecurityPostureAgent")) {
    traces.push({
      agentName: "SecurityPostureAgent",
      phase: "PHASE_A_PARALLEL",
      accessMode: "READ_ONLY",
      status: "COMPLETED",
      summary:
        nodeSummaries.SecurityPostureAgent ||
        `Verified HTTPS redirect, HSTS headers, and ${params.request.tlsProfile} cipher posture.`,
      durationMs: nodeDurations.SecurityPostureAgent ?? 65,
      completedAt: params.now,
    });
  }

  return traces;
}
