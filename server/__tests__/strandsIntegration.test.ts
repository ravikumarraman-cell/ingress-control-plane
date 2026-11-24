import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Agent, tool } from "@strands-agents/sdk";
import { createHarness } from "@strands-agents/harness";
import { z } from "zod";
import { createApp } from "../../server.ts";
import {
  createControlPlaneModelRouter,
  createWorkflowSessionManager,
  DEFAULT_CONTROL_PLANE_LIMITS,
  DeterministicControlPlaneModel,
  executeCorePipelineWithStrandsGraph,
  getAllReadOnlyStrandsTools,
  getControlPlaneMemoryManager,
  IngressSteeringHandler,
  ReadOnlyIsolationIntervention,
  SecretAndTlsGuardrailIntervention,
} from "../strands/index.ts";
import type { IngressRequest, WorkflowRun } from "../../src/shared/contracts.ts";

const TEST_REQUEST: IngressRequest = {
  requestId: crypto.randomUUID(),
  requesterId: "alice.dev@corp.example.com",
  ticketRef: "STRANDS-401",
  appName: "strands-gateway-api",
  environment: "prod",
  hostname: "strands-api.corp.example.com",
  pathPrefix: "/v2/orders",
  backendService: "orders-svc",
  backendPort: 8443,
  exposure: "external",
  tlsProfile: "tls_1_3_strict",
  dnsProvider: "infoblox",
  dnsRecordType: "cname",
  healthCheckPath: "/healthz",
  originCertReady: true,
  cloudflareAllowlisted: true,
  rawJustification: "Strands SDK integration verification for external production gateway route.",
};

describe("Strands Agents SDK & Harness Native Integration", () => {
  let server: http.Server;
  let baseUrl = "";

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
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("blocks embedded secrets via SecretAndTlsGuardrailIntervention before invocation", async () => {
    const agent = new Agent({
      id: "test-secret-guard",
      name: "TestSecretGuard",
      printer: false,
      model: new DeterministicControlPlaneModel(),
      interventions: [new SecretAndTlsGuardrailIntervention()],
      tools: getAllReadOnlyStrandsTools(),
    });

    const result = await agent.invoke(
      "Create route with token api_key=sk_test_sensitive_secret_1234567890",
      { limits: DEFAULT_CONTROL_PLANE_LIMITS }
    );
    expect(result.toString().toLowerCase()).toContain("guardrail blocked");
  });

  it("enforces sa-ingress-readonly and blocks unauthorized write tools in ReadOnlyIsolationIntervention", async () => {
    const forbiddenWriteTool = tool({
      name: "kubectl_apply",
      description: "Mutates cluster manifests",
      inputSchema: z.object({ manifest: z.string() }),
      callback: () => ({ applied: true }),
    });

    const rogueModel = new DeterministicControlPlaneModel({
      request: TEST_REQUEST,
    });

    const agent = new Agent({
      id: "test-readonly-isolation",
      name: "TestReadOnlyAgent",
      printer: false,
      model: rogueModel,
      tools: [forbiddenWriteTool],
      interventions: [
        new ReadOnlyIsolationIntervention({
          agentName: "TestReadOnlyAgent",
          allowedTools: ["list_k8s_routes"],
        }),
      ],
    });

    await agent.invoke("Attempt to run kubectl_apply", {
      limits: DEFAULT_CONTROL_PLANE_LIMITS,
    });
    const text = JSON.stringify(agent.messages);
    expect(text).toContain("prohibited under sa-ingress-readonly");

    const escalatedAgent = new Agent({
      id: "test-escalated-sa",
      name: "TestEscalatedSaAgent",
      printer: false,
      model: new DeterministicControlPlaneModel(),
      interventions: [
        new ReadOnlyIsolationIntervention({
          agentName: "TestEscalatedSaAgent",
          allowedTools: ["list_k8s_routes"],
          serviceAccount: "sa-ingress-executor",
        }),
      ],
    });
    const escalatedRes = await escalatedAgent.invoke("Inspect routes", {
      limits: DEFAULT_CONTROL_PLANE_LIMITS,
    });
    expect(escalatedRes.toString()).toContain("Privilege escalation blocked");
  });

  it("executes native Strands Agent + ZodTool + structuredOutputSchema + ModelRouter + traces", async () => {
    const OutputSchema = z.object({
      summary: z.string(),
      data: z.object({ verified: z.boolean(), toolEvidenceCount: z.number() }),
      riskDelta: z.enum(["NONE", "ELEVATE_MEDIUM", "ELEVATE_HIGH"]),
      vetoTriggered: z.boolean(),
      confidence: z.number(),
    });

    const modelRouter = await createControlPlaneModelRouter({
      allowDeterministicFallback: true,
      deterministicConfig: { request: TEST_REQUEST },
    });

    const agent = new Agent({
      id: "test-structured-tool-agent",
      name: "TestStructuredToolAgent",
      printer: false,
      model: modelRouter,
      tools: getAllReadOnlyStrandsTools(),
      interventions: [
        new SecretAndTlsGuardrailIntervention(),
        new ReadOnlyIsolationIntervention({
          agentName: "TestStructuredToolAgent",
          allowedTools: ["list_k8s_routes", "evaluate_opa_policies", "get_tls_certs"],
        }),
        new IngressSteeringHandler(),
      ],
    });

    const result = await agent.invoke("Verify live cluster routes and return structured output.", {
      structuredOutputSchema: OutputSchema,
      limits: DEFAULT_CONTROL_PLANE_LIMITS,
    });

    const so = result.structuredOutput as z.infer<typeof OutputSchema>;
    expect(so.data.verified).toBe(true);
    expect(so.data.toolEvidenceCount).toBeGreaterThanOrEqual(1);
    expect((result.traces ?? []).length).toBeGreaterThan(0);
  });

  it("orchestrates core pipeline through Strands Graph with SessionManager persistence", async () => {
    const workflowId = crypto.randomUUID();
    const sessionId = `adk-sess-${workflowId.slice(0, 8)}`;
    const sessionManager = createWorkflowSessionManager(sessionId);
    expect(sessionManager).toBeDefined();

    const graphOut = await executeCorePipelineWithStrandsGraph({
      workflowId,
      sessionId,
      request: TEST_REQUEST,
      pipelineConfig: {
        hitlPolicy: "always",
        enabledAgents: [
          "DiscoveryInventoryAgent",
          "PolicyComplianceAgent",
          "ImpactAnalysisAgent",
          "CostEstimationAgent",
          "SecurityPostureAgent",
          "ChangePlanningAgent",
          "ValidationRollbackAgent",
        ],
        customAgents: [],
        canarySteps: [10, 100],
        maxSupervisorIterations: 5,
        customInstructions: "",
      },
      iteration: 1,
      liveEtag: "sha256:test-etag-1234",
      routeCount: 3,
      customRuleCount: 2,
      checks: [
        {
          controlId: "CTRL-TLS-13",
          controlName: "External Production TLS 1.3 Strict",
          passed: true,
          severity: "BLOCK",
          detail: "OK",
        },
      ],
      violations: [],
      blastRadius: "HIGH",
      initialCanaryWeight: 10,
      dynamicVetoed: false,
      dryRunPassed: true,
      planId: crypto.randomUUID(),
    });

    expect(graphOut.multiAgentResult.status).toBe("COMPLETED");
    const nodeIds = graphOut.multiAgentResult.results.map((r) => r.nodeId);
    expect(nodeIds).toContain("IngressIntakeAgent");
    expect(nodeIds).toContain("SupervisorAgent");
    expect(nodeIds).toContain("DiscoveryInventoryAgent");
    expect(nodeIds).toContain("PolicyComplianceAgent");
    expect(nodeIds).toContain("ChangePlanningAgent");
    expect(nodeIds).toContain("ValidationRollbackAgent");
  });

  it("supports createHarness() + MemoryManager across onboarding and troubleshooting", async () => {
    const memory = getControlPlaneMemoryManager();
    await memory.add("Resolved HTTP 522 origin timeout by applying Cloudflare CIDR allowlist.", {
      metadata: { category: "NETWORK" },
    });
    const hits = await memory.search("Cloudflare CIDR timeout");
    expect(Array.isArray(hits)).toBe(true);

    const harness = await createHarness({
      id: "test-harness-agent",
      name: "TestHarnessAgent",
      printer: false,
      model: await createControlPlaneModelRouter({
        deterministicConfig: {
          fallbackText: "GuidedOnboardingAgent harness operational.",
        },
      }),
      builtinTools: [],
      builtinPlugins: [],
      skills: false,
      session: false,
      memory: false,
      contextManager: false,
      interventions: [new SecretAndTlsGuardrailIntervention(), new IngressSteeringHandler()],
    });
    const out = await harness.invoke("Check status", { limits: DEFAULT_CONTROL_PLANE_LIMITS });
    expect(out.toString()).toContain("GuidedOnboardingAgent harness operational");
  });

  it("exposes Strands telemetry, provider matrix, evals, and preserves full Four-Eyes/Canary/TOCTOU lifecycle", async () => {
    const providersRes = await fetch(`${baseUrl}/api/v1/strands/providers`);
    expect(providersRes.status).toBe(200);
    const providersJson = (await providersRes.json()) as {
      providers: Array<{ provider: string; configured: boolean }>;
    };
    expect(providersJson.providers.some((p) => p.provider === "deterministic" && p.configured)).toBe(
      true
    );
    expect(providersJson.providers.some((p) => p.provider === "bedrock")).toBe(true);
    expect(providersJson.providers.some((p) => p.provider === "anthropic")).toBe(true);
    expect(providersJson.providers.some((p) => p.provider === "openai")).toBe(true);

    const evalsRes = await fetch(`${baseUrl}/api/v1/strands/evals/run`, { method: "POST" });
    expect(evalsRes.status).toBe(200);
    const evalsJson = (await evalsRes.json()) as {
      allPassed: boolean;
      passedCount: number;
      totalCount: number;
    };
    expect(evalsJson.allPassed).toBe(true);
    expect(evalsJson.passedCount).toBe(evalsJson.totalCount);

    // Full workflow lifecycle with Four-Eyes 403 -> distinct approver 200 -> canary promote -> rollback -> TOCTOU 409
    const createRes = await fetch(`${baseUrl}/api/v1/workflows`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-operator-id": "alice.dev@corp.example.com",
      },
      body: JSON.stringify({
        intakeMode: "structured",
        executionMode: "direct_canary_v3",
        pipelineConfig: { canarySteps: [10, 50, 100] },
        request: {
          ticketRef: "STRANDS-E2E-1",
          appName: "strands-e2e-svc",
          environment: "prod",
          hostname: "strands-e2e.corp.example.com",
          pathPrefix: "/v1/e2e",
          backendService: "e2e-svc",
          backendPort: 8443,
          exposure: "external",
          tlsProfile: "tls_1_3_strict",
          rawJustification: "End-to-end Strands workflow regression & canary lifecycle check.",
        },
      }),
    });
    expect(createRes.status).toBe(201);
    const { workflow: wf } = (await createRes.json()) as { workflow: WorkflowRun };
    expect(wf.status).toBe("AWAITING_APPROVAL");

    // Strands session endpoint
    const sessRes = await fetch(`${baseUrl}/api/v1/workflows/${wf.workflowId}/strands-session`);
    expect(sessRes.status).toBe(200);
    const sessJson = (await sessRes.json()) as {
      sessionId: string;
      invocations: unknown[];
      agentTraces: unknown[];
    };
    expect(sessJson.sessionId).toBe(wf.adkSessionId);
    expect(sessJson.invocations.length).toBeGreaterThanOrEqual(1);

    // Self-approval blocked (Four-Eyes RBAC 403)
    const selfApproveRes = await fetch(`${baseUrl}/api/v1/workflows/${wf.workflowId}/decision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-operator-id": "alice.dev@corp.example.com",
        "x-operator-roles": "net-approver",
      },
      body: JSON.stringify({
        decision: "APPROVE",
        rationale: "Attempting self approval on external production change.",
      }),
    });
    expect(selfApproveRes.status).toBe(403);

    // Distinct reviewer approves -> EXECUTING canary at step 0
    const peerApproveRes = await fetch(`${baseUrl}/api/v1/workflows/${wf.workflowId}/decision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-operator-id": "bob.sre@corp.example.com",
        "x-operator-roles": "platform-sre-lead",
      },
      body: JSON.stringify({
        decision: "APPROVE",
        rationale: "Verified canary weights, TLS 1.3 strict profile, and DNS CNAME readiness.",
      }),
    });
    expect(peerApproveRes.status).toBe(200);
    const approvedJson = (await peerApproveRes.json()) as { workflow: WorkflowRun };
    expect(approvedJson.workflow.status).toBe("EXECUTING");
    expect(approvedJson.workflow.canaryState?.currentWeight).toBeGreaterThan(0);
    expect(approvedJson.workflow.canaryState?.currentWeight).toBeLessThan(100);

    // Promote canary -> higher weight
    const promoteRes = await fetch(`${baseUrl}/api/v1/workflows/${wf.workflowId}/canary/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-operator-id": "bob.sre@corp.example.com" },
      body: JSON.stringify({}),
    });
    expect(promoteRes.status).toBe(200);

    // Rollback
    const rollbackRes = await fetch(`${baseUrl}/api/v1/workflows/${wf.workflowId}/rollback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-operator-id": "bob.sre@corp.example.com" },
      body: JSON.stringify({ reason: "E2E deterministic rollback check" }),
    });
    expect(rollbackRes.status).toBe(200);
    const rolledBackJson = (await rollbackRes.json()) as { workflow: WorkflowRun };
    expect(rolledBackJson.workflow.status).toBe("ROLLED_BACK");

    // Telemetry endpoint reflects recorded Strands invocations, token usage, tool latency, and iterations
    const telemetryRes = await fetch(`${baseUrl}/api/v1/strands/telemetry`);
    expect(telemetryRes.status).toBe(200);
    const telemetryJson = (await telemetryRes.json()) as {
      aggregates: {
        totalInvocations: number;
        totalTokens: number;
        inputTokens: number;
        outputTokens: number;
        totalToolCalls: number;
        avgToolLatencyMs: number;
        totalIterations: number;
        successfulIterations: number;
        iterationSuccessRatePct: number;
      };
      toolLatencyMetrics: Array<{ toolName: string; callCount: number; avgLatencyMs: number }>;
      agentBreakdown: Array<{ agentName: string; totalTokens: number; successfulIterations: number }>;
      iterationSeries: Array<{ label: string; totalTokens: number; successfulIterations: number }>;
    };
    expect(telemetryJson.aggregates.totalInvocations).toBeGreaterThan(0);
    expect(telemetryJson.aggregates.totalTokens).toBeGreaterThan(0);
    expect(telemetryJson.aggregates.inputTokens).toBeGreaterThan(0);
    expect(telemetryJson.aggregates.outputTokens).toBeGreaterThan(0);
    expect(telemetryJson.aggregates.totalToolCalls).toBeGreaterThan(0);
    expect(telemetryJson.aggregates.successfulIterations).toBeGreaterThan(0);
    expect(telemetryJson.aggregates.iterationSuccessRatePct).toBeGreaterThan(0);
    expect(telemetryJson.toolLatencyMetrics.length).toBeGreaterThan(0);
    expect(telemetryJson.agentBreakdown.length).toBeGreaterThan(0);
    expect(telemetryJson.iterationSeries.length).toBeGreaterThan(0);

    // TOCTOU Drift 409 check on a second workflow
    const wf2Res = await fetch(`${baseUrl}/api/v1/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-operator-id": "alice.dev@corp.example.com" },
      body: JSON.stringify({
        intakeMode: "structured",
        executionMode: "gitops_pr_v2",
        request: {
          ticketRef: "STRANDS-E2E-2",
          appName: "strands-drift-svc",
          environment: "staging",
          hostname: "strands-drift.staging.example.com",
          pathPrefix: "/v1/drift",
          backendService: "drift-svc",
          backendPort: 8080,
          exposure: "external",
          tlsProfile: "tls_1_3_strict",
          rawJustification: "TOCTOU ETag drift abort verification.",
        },
      }),
    });
    expect(wf2Res.status).toBe(201);
    const { workflow: wf2 } = (await wf2Res.json()) as { workflow: WorkflowRun };

    await fetch(`${baseUrl}/api/v1/infra/simulate-drift`, { method: "POST" });

    const driftApproveRes = await fetch(`${baseUrl}/api/v1/workflows/${wf2.workflowId}/decision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-operator-id": "bob.sre@corp.example.com",
        "x-operator-roles": "net-approver",
      },
      body: JSON.stringify({
        decision: "APPROVE",
        rationale: "Approving stale plan to verify TOCTOU drift detection aborts safely.",
      }),
    });
    expect(driftApproveRes.status).toBe(409);
    const driftJson = (await driftApproveRes.json()) as { workflow: WorkflowRun };
    expect(driftJson.workflow.status).toBe("DRIFT_ABORTED");
  });
});
