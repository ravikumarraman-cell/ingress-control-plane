import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DagValidationError,
  MissingUpstreamFieldError,
  StructuredOutputValidationError,
  interpolateUpstreamPrompt,
  topologicalSortStageAgents,
  validateAgentDag,
  validateStructuredOutput,
} from "../dagEngine.ts";
import { executeStageDynamicAgents } from "../dagRunner.ts";
import { createApp } from "../../server.ts";
import type {
  AgentStructuredOutput,
  DynamicAgentBlueprint,
  IngressRequest,
} from "../../src/shared/contracts.ts";

function makeBlueprint(
  overrides: Partial<DynamicAgentBlueprint> & { name: string }
): DynamicAgentBlueprint {
  return {
    agentId: crypto.randomUUID(),
    role: "Read-only analyzer",
    systemPrompt: "Inspect read-only telemetry and produce typed JSON.",
    taskTemplate: "Inspect {{appName}} in {{environment}}.",
    hookStage: "PHASE_A_PARALLEL",
    dependsOn: [],
    outputSchema: [{ key: "finding", type: "string", description: "Finding", required: true }],
    allowedTools: ["list_k8s_routes"],
    triggerCondition: { alwaysActive: true },
    canForceApproval: false,
    spawnedBy: "OPERATOR",
    enabled: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const SAMPLE_REQUEST: IngressRequest = {
  requestId: crypto.randomUUID(),
  requesterId: "ravikumar.raman@gmail.com",
  ticketRef: "TEST-101",
  appName: "payments-api",
  environment: "staging",
  hostname: "payments.staging.example.com",
  pathPrefix: "/v1/payments",
  backendService: "payments-svc",
  backendPort: 8443,
  exposure: "external",
  tlsProfile: "tls_1_3_strict",
  rawJustification: "Integration verification request for staged dynamic agent DAG execution.",
};

describe("1. Topological DAG Validation (validateAgentDag)", () => {
  it("rejects self-loop dependency (A -> A)", () => {
    const a = makeBlueprint({ name: "AgentA", dependsOn: ["AgentA"] });
    expect(() => validateAgentDag([a])).toThrowError(DagValidationError);
  });

  it("rejects 2-node direct cycle (A -> B -> A)", () => {
    const a = makeBlueprint({ name: "AgentA", dependsOn: ["AgentB"] });
    const b = makeBlueprint({ name: "AgentB", dependsOn: ["AgentA"] });
    expect(() => validateAgentDag([a, b])).toThrowError(DagValidationError);
  });

  it("rejects 3-node transitive cycle (A -> B -> C -> A) with cycle path in message", () => {
    const a = makeBlueprint({ name: "AgentA", dependsOn: ["AgentC"] });
    const b = makeBlueprint({ name: "AgentB", dependsOn: ["AgentA"] });
    const c = makeBlueprint({ name: "AgentC", dependsOn: ["AgentB"] });

    try {
      validateAgentDag([a, b, c]);
      expect.fail("Expected DagValidationError");
    } catch (err) {
      expect(err).toBeInstanceOf(DagValidationError);
      const msg = (err as Error).message;
      expect(msg).toContain("Cycle detected");
      expect(msg).toContain("AgentA");
      expect(msg).toContain("AgentB");
      expect(msg).toContain("AgentC");
    }
  });

  it("rejects backward cross-stage dependency (PHASE_A depending on PHASE_B)", () => {
    const phaseB = makeBlueprint({
      name: "PlannerChild",
      hookStage: "PHASE_B_SEQUENTIAL",
    });
    const phaseA = makeBlueprint({
      name: "EarlyReader",
      hookStage: "PHASE_A_PARALLEL",
      dependsOn: ["PlannerChild"],
    });
    expect(() => validateAgentDag([phaseB, phaseA])).toThrowError(DagValidationError);
  });

  it("rejects prohibited write tools and non-readonly service accounts", () => {
    const writeToolBp = {
      ...makeBlueprint({ name: "BadToolAgent" }),
      allowedTools: ["kubectl_apply" as unknown as DynamicAgentBlueprint["allowedTools"][number]],
    };
    expect(() => validateAgentDag([writeToolBp])).toThrowError(DagValidationError);

    const badSaBp = {
      ...makeBlueprint({ name: "BadSaAgent" }),
      serviceAccount: "sa-ingress-executor",
    };
    expect(() => validateAgentDag([badSaBp])).toThrowError(DagValidationError);
  });

  it("accepts valid diamond DAG and forward cross-stage dependency", () => {
    const root = makeBlueprint({ name: "RootAgent", hookStage: "PHASE_A_PARALLEL" });
    const left = makeBlueprint({
      name: "LeftAgent",
      hookStage: "PHASE_A_PARALLEL",
      dependsOn: ["RootAgent"],
    });
    const right = makeBlueprint({
      name: "RightAgent",
      hookStage: "PHASE_A_PARALLEL",
      dependsOn: ["RootAgent"],
    });
    const sink = makeBlueprint({
      name: "SinkAgent",
      hookStage: "PHASE_B_SEQUENTIAL",
      dependsOn: ["LeftAgent", "RightAgent"],
    });

    expect(validateAgentDag([root, left, right, sink])).toEqual({ valid: true });
  });
});

describe("2. Topological Wave Scheduling (topologicalSortStageAgents)", () => {
  it("groups diamond dependency graph into Wave 0 [Root], Wave 1 [Left, Right], Wave 2 [Sink]", () => {
    const root = makeBlueprint({ name: "Root", hookStage: "PHASE_A_PARALLEL", dependsOn: ["DiscoveryAgent"] });
    const left = makeBlueprint({ name: "Left", hookStage: "PHASE_A_PARALLEL", dependsOn: ["Root"] });
    const right = makeBlueprint({ name: "Right", hookStage: "PHASE_A_PARALLEL", dependsOn: ["Root"] });
    const sink = makeBlueprint({ name: "Sink", hookStage: "PHASE_A_PARALLEL", dependsOn: ["Left", "Right"] });

    const satisfied = new Set(["DiscoveryAgent"]);
    const waves = topologicalSortStageAgents("PHASE_A_PARALLEL", [sink, right, left, root], satisfied);

    expect(waves).toHaveLength(3);
    expect(waves[0].map((bp) => bp.name)).toEqual(["Root"]);
    expect(waves[1].map((bp) => bp.name).sort()).toEqual(["Left", "Right"]);
    expect(waves[2].map((bp) => bp.name)).toEqual(["Sink"]);
  });
});

describe("3. Prompt Interpolation & Structured Output Validation", () => {
  it("interpolates primitives, booleans, nested dot-paths, and JSON-stringified arrays", () => {
    const bus: Record<string, AgentStructuredOutput> = {
      TLSInspectorAgent: {
        summary: "Cert expires in 9 days",
        data: {
          expiringWithinDays: 9,
          sanCoverageOk: false,
          sanList: ["payments.example.com", "api.example.com"],
        },
        riskDelta: "ELEVATE_HIGH",
        vetoTriggered: false,
        confidence: 0.96,
      },
      PolicyComplianceAgent: {
        summary: "Policy check complete",
        data: {
          summary: { decision: "BLOCK" },
        },
        riskDelta: "ELEVATE_HIGH",
        vetoTriggered: false,
        confidence: 1,
      },
    };

    const res = interpolateUpstreamPrompt(
      "Days={{upstream.TLSInspectorAgent.expiringWithinDays}} SANOK={{upstream.TLSInspectorAgent.sanCoverageOk}} List={{upstream.TLSInspectorAgent.sanList}} Policy={{upstream.PolicyAgent.summary.decision}}",
      bus,
      ["TLSInspectorAgent", "PolicyAgent"]
    );

    expect(res.resolvedPrompt).toBe(
      'Days=9 SANOK=false List=["payments.example.com","api.example.com"] Policy=BLOCK'
    );
    expect(Object.keys(res.consumedInputs)).toContain("TLSInspectorAgent");
  });

  it("throws MissingUpstreamFieldError when referenced field is absent", () => {
    const bus: Record<string, AgentStructuredOutput> = {
      TLSInspectorAgent: {
        summary: "OK",
        data: { minTlsVersion: "TLSv1.3" },
        riskDelta: "NONE",
        vetoTriggered: false,
        confidence: 0.9,
      },
    };

    expect(() =>
      interpolateUpstreamPrompt(
        "Read {{upstream.TLSInspectorAgent.nonExistentField}}",
        bus,
        ["TLSInspectorAgent"]
      )
    ).toThrowError(MissingUpstreamFieldError);
  });

  it("validates conforming output and rejects missing required fields or type mismatches", () => {
    const schema = [
      { key: "recommendedCanaryPercent", type: "number" as const, description: "Weight", required: true },
      { key: "sanList", type: "string[]" as const, description: "SANs", required: true },
    ];

    const valid = validateStructuredOutput(
      {
        summary: "Planned 15% canary",
        data: { recommendedCanaryPercent: 15, sanList: ["a.example.com"] },
        riskDelta: "NONE",
        vetoTriggered: false,
        confidence: 0.9,
      },
      schema
    );
    expect(valid.data.recommendedCanaryPercent).toBe(15);

    expect(() =>
      validateStructuredOutput(
        {
          summary: "Missing required key",
          data: { recommendedCanaryPercent: 15 },
          riskDelta: "NONE",
          vetoTriggered: false,
          confidence: 0.9,
        },
        schema
      )
    ).toThrowError(StructuredOutputValidationError);

    expect(() =>
      validateStructuredOutput(
        {
          summary: "Wrong type",
          data: { recommendedCanaryPercent: "fifteen", sanList: ["a.example.com"] },
          riskDelta: "NONE",
          vetoTriggered: false,
          confidence: 0.9,
        },
        schema
      )
    ).toThrowError(StructuredOutputValidationError);
  });
});

describe("4. End-to-End Veto Propagation & REST API Integration", () => {
  let server: http.Server;
  let baseUrl = "";
  const createdBlueprintIds: string[] = [];

  beforeAll(async () => {
    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    for (const id of createdBlueprintIds) {
      await fetch(`${baseUrl}/api/v1/agents/blueprints/${id}`, { method: "DELETE" }).catch(
        () => undefined
      );
    }
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("aborts downstream dependents with SKIPPED_UPSTREAM_FAILED when upstream triggers veto", async () => {
    const vetoProducer = makeBlueprint({
      name: "VetoProducer",
      hookStage: "PHASE_A_PARALLEL",
      outputSchema: [{ key: "safe", type: "boolean", description: "Safe flag", required: true }],
    });
    const dependentChild = makeBlueprint({
      name: "DependentChild",
      hookStage: "PHASE_A_PARALLEL",
      dependsOn: ["VetoProducer"],
      taskTemplate: "Use {{upstream.VetoProducer.safe}}",
      outputSchema: [{ key: "weight", type: "number", description: "Weight", required: true }],
    });
    const siblingAgent = makeBlueprint({
      name: "IndependentSibling",
      hookStage: "PHASE_A_PARALLEL",
      dependsOn: [],
      outputSchema: [{ key: "status", type: "string", description: "Status", required: true }],
    });

    const executor = vi.fn(async ({ blueprint }: { blueprint: DynamicAgentBlueprint }) => {
      if (blueprint.name === "VetoProducer") {
        return {
          summary: "Critical TLS expiry veto",
          data: { safe: false },
          riskDelta: "ELEVATE_HIGH",
          vetoTriggered: true,
          confidence: 0.99,
        };
      }
      return {
        summary: "Sibling healthy",
        data: { status: "OK" },
        riskDelta: "NONE",
        vetoTriggered: false,
        confidence: 0.95,
      };
    });

    const bus: Record<string, AgentStructuredOutput> = {};
    const outcome = await executeStageDynamicAgents({
      stage: "PHASE_A_PARALLEL",
      blueprints: [vetoProducer, dependentChild, siblingAgent],
      request: SAMPLE_REQUEST,
      sharedContextBus: bus,
      executor,
    });

    const dependentAssignment = outcome.assignments.find((a) => a.agentName === "DependentChild");
    const siblingAssignment = outcome.assignments.find((a) => a.agentName === "IndependentSibling");

    expect(dependentAssignment?.status).toBe("SKIPPED_UPSTREAM_FAILED");
    expect(siblingAssignment?.status).toBe("COMPLETED");
    // Executor was called for VetoProducer and IndependentSibling, NEVER for DependentChild
    const calledNames = executor.mock.calls.map((c) => c[0].blueprint.name);
    expect(calledNames).toContain("VetoProducer");
    expect(calledNames).toContain("IndependentSibling");
    expect(calledNames).not.toContain("DependentChild");
  });

  it("REST API returns 400 on cyclic/write-tool blueprints and 201 on valid chained blueprint", async () => {
    const cycleRes = await fetch(`${baseUrl}/api/v1/agents/blueprints`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "SelfCycleAgent",
        role: "Invalid self-cycling agent",
        systemPrompt: "Test prompt",
        taskTemplate: "Test {{upstream.SelfCycleAgent.foo}}",
        hookStage: "PHASE_A_PARALLEL",
        dependsOn: ["SelfCycleAgent"],
        outputSchema: [{ key: "foo", type: "string", description: "Foo", required: true }],
        allowedTools: ["list_k8s_routes"],
      }),
    });
    expect(cycleRes.status).toBe(400);

    const writeToolRes = await fetch(`${baseUrl}/api/v1/agents/blueprints`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "UnauthorizedWriteAgent",
        role: "Attempt forbidden write tool",
        systemPrompt: "Test prompt",
        taskTemplate: "Apply manifests",
        hookStage: "PHASE_B_SEQUENTIAL",
        dependsOn: [],
        outputSchema: [],
        allowedTools: ["kubectl_apply"],
      }),
    });
    expect(writeToolRes.status).toBe(400);

    const validName = `TestChainedAgent_${Date.now().toString().slice(-5)}`;
    const validRes = await fetch(`${baseUrl}/api/v1/agents/blueprints`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: validName,
        role: "Reads TLS expiry from TLSInspectorAgent",
        systemPrompt: "Return canary weight adjustments.",
        taskTemplate: "Check expiry={{upstream.TLSInspectorAgent.expiringWithinDays}} days.",
        hookStage: "PHASE_B_SEQUENTIAL",
        dependsOn: ["TLSInspectorAgent"],
        outputSchema: [
          { key: "maxBurst", type: "number", description: "Max burst limit", required: true },
        ],
        allowedTools: ["get_tls_certs"],
      }),
    });
    expect(validRes.status).toBe(201);
    const validJson = (await validRes.json()) as { blueprint: DynamicAgentBlueprint };
    createdBlueprintIds.push(validJson.blueprint.agentId);
    expect(validJson.blueprint.name).toBe(validName);

    // Create a staging workflow and hook an ad-hoc chained agent dynamically
    const wfCreateRes = await fetch(`${baseUrl}/api/v1/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intakeMode: "structured",
        executionMode: "gitops_pr_v2",
        request: {
          ticketRef: "DAG-INT-1",
          appName: "dag-test-svc",
          environment: "staging",
          hostname: "dag-test.staging.example.com",
          pathPrefix: "/v1/dag",
          backendService: "dag-core-svc",
          backendPort: 8080,
          exposure: "external",
          tlsProfile: "tls_1_3_strict",
          rawJustification: "Verify runtime dynamic agent assignment and context bus handoff.",
        },
      }),
    });
    expect(wfCreateRes.status).toBe(201);
    const createdWf = (await wfCreateRes.json()) as { workflow: { workflowId: string } };

    const assignRes = await fetch(
      `${baseUrl}/api/v1/workflows/${createdWf.workflow.workflowId}/assign-agent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adHocBlueprint: {
            name: "AdHocQuotaAdvisor",
            role: "Computes burst quota from ImpactAgent",
            systemPrompt: "Return JSON quota recommendation.",
            taskTemplate: "Assess {{upstream.ImpactAgent.blastRadius}} risk.",
            hookStage: "PHASE_B_SEQUENTIAL",
            dependsOn: ["ImpactAgent"],
            outputSchema: [
              { key: "burstQuota", type: "number", description: "Burst RPS quota", required: true },
            ],
            allowedTools: ["get_lb_config"],
          },
        }),
      }
    );
    expect(assignRes.status).toBe(200);
    const assignedPayload = (await assignRes.json()) as {
      workflow: {
        dynamicTaskAssignments?: Array<{ agentName: string; status: string; consumedInputs: Record<string, unknown> }>;
        sharedContextBus?: Record<string, unknown>;
      };
    };
    const adHocTask = assignedPayload.workflow.dynamicTaskAssignments?.find(
      (a) => a.agentName === "AdHocQuotaAdvisor"
    );
    expect(adHocTask?.status).toBe("COMPLETED");
    expect(adHocTask?.consumedInputs).toHaveProperty("ImpactAgent");
    expect(assignedPayload.workflow.sharedContextBus).toHaveProperty("AdHocQuotaAdvisor");
  });
});
