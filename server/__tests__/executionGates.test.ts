import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server.ts";
import { store } from "../store.ts";
import type { WorkflowRun } from "../../src/shared/contracts.ts";

type WorkflowResponse = { workflow: WorkflowRun };
type DecisionResponse = { workflow: WorkflowRun; error?: string | null };

describe("execution integrity gates", () => {
  let server: http.Server;
  let baseUrl = "";

  beforeAll(async () => {
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  async function createCanaryWorkflow(hostname: string, appName: string): Promise<WorkflowRun> {
    const response = await fetch(`${baseUrl}/api/v1/workflows`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-operator-id": "requester@example.test",
      },
      body: JSON.stringify({
        intakeMode: "structured",
        executionMode: "direct_canary_v3",
        pipelineConfig: { canarySteps: [10, 50, 100] },
        request: {
          ticketRef: `GATE-${crypto.randomUUID().slice(0, 8)}`,
          appName,
          environment: "staging",
          hostname,
          pathPrefix: "/",
          backendService: `${appName}-svc`,
          backendPort: 8080,
          exposure: "external",
          tlsProfile: "tls_1_3_strict",
          rawJustification: "Exercise the deterministic gated execution path.",
        },
      }),
    });
    expect(response.status).toBe(201);
    const data = (await response.json()) as WorkflowResponse;
    return data.workflow;
  }

  async function approveWorkflow(workflowId: string, reviewerId: string) {
    return fetch(`${baseUrl}/api/v1/workflows/${workflowId}/decision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-operator-id": reviewerId,
        "x-operator-roles": "platform-sre-lead",
      },
      body: JSON.stringify({
        decision: "APPROVE",
        rationale: "Validated the generated artifacts and approved execution.",
      }),
    });
  }

  async function rollbackWorkflow(
    workflowId: string,
    reason: unknown = "Exercise the deterministic rollback gate."
  ) {
    return fetch(`${baseUrl}/api/v1/workflows/${workflowId}/rollback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-operator-id": "operator@example.test",
      },
      body: JSON.stringify({ reason }),
    });
  }

  async function promoteWorkflow(
    workflowId: string,
    body: Record<string, unknown> = {}
  ) {
    return fetch(`${baseUrl}/api/v1/workflows/${workflowId}/canary/promote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-operator-id": "operator@example.test",
      },
      body: JSON.stringify(body),
    });
  }

  it("rejects a change plan whose artifacts changed after planning", async () => {
    const workflow = await createCanaryWorkflow(
      `tamper-${crypto.randomUUID()}.corp.example.com`,
      "tamper-gate"
    );
    const storedWorkflow = store
      .getState()
      .workflows.find((candidate) => candidate.workflowId === workflow.workflowId);
    expect(storedWorkflow?.changePlan).toBeDefined();
    if (!storedWorkflow?.changePlan) throw new Error("Expected a planned change.");
    const artifactPath = Object.keys(storedWorkflow.changePlan.artifacts)[0];
    expect(artifactPath).toBeDefined();
    if (!artifactPath) throw new Error("Expected at least one planned artifact.");

    storedWorkflow.changePlan.artifacts[artifactPath] = "tampered after approval planning";
    const response = await approveWorkflow(workflow.workflowId, "reviewer@example.test");

    expect(response.status).toBe(403);
    const result = (await response.json()) as DecisionResponse;
    expect(result.workflow.status).toBe("FAILED");
    expect(result.error).toBe("Plan digest verification failed.");
    expect(
      store
        .getState()
        .auditEvents.some(
          (event) =>
            event.workflowId === workflow.workflowId && event.eventType === "SIGNATURE_INVALID"
        )
    ).toBe(true);
    expect(
      store.getState().routes.some((route) => route.hostname === workflow.ingressRequest.hostname)
    ).toBe(false);
  });

  it("allows only one same-hostname workflow to commit from a shared ETag", async () => {
    const hostname = `race-${crypto.randomUUID()}.corp.example.com`;
    const first = await createCanaryWorkflow(hostname, "race-one");
    const second = await createCanaryWorkflow(hostname, "race-two");
    expect(first.changePlan?.targetStateEtag).toBe(second.changePlan?.targetStateEtag);

    const responses = await Promise.all([
      approveWorkflow(first.workflowId, "reviewer-one@example.test"),
      approveWorkflow(second.workflowId, "reviewer-two@example.test"),
    ]);
    const results = await Promise.all(
      responses.map(async (response) => ({
        statusCode: response.status,
        data: (await response.json()) as DecisionResponse,
      }))
    );

    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    expect(results.filter((result) => result.data.workflow.status === "EXECUTING")).toHaveLength(1);
    expect(results.filter((result) => result.data.workflow.status === "DRIFT_ABORTED")).toHaveLength(
      1
    );
    expect(store.getState().routes.filter((route) => route.hostname === hostname)).toHaveLength(1);
  });

  it("rejects rollback before approval without changing another workflow's route", async () => {
    const hostname = `rollback-${crypto.randomUUID()}.corp.example.com`;
    const activeWorkflow = await createCanaryWorkflow(hostname, "active-route");
    const approvalResponse = await approveWorkflow(
      activeWorkflow.workflowId,
      "active-reviewer@example.test"
    );
    expect(approvalResponse.status).toBe(200);

    const originalRoute = store
      .getState()
      .routes.find((route) => route.hostname === hostname);
    expect(originalRoute).toBeDefined();
    if (!originalRoute) throw new Error("Expected the approved workflow to create a route.");

    const pendingWorkflow = await createCanaryWorkflow(hostname, "pending-route");
    expect(pendingWorkflow.status).toBe("AWAITING_APPROVAL");

    const rollbackResponse = await rollbackWorkflow(pendingWorkflow.workflowId);

    expect(rollbackResponse.status).toBe(409);
    expect(store.getState().routes.find((route) => route.hostname === hostname)).toEqual(
      originalRoute
    );
    expect(
      store
        .getState()
        .workflows.find((workflow) => workflow.workflowId === pendingWorkflow.workflowId)?.status
    ).toBe("AWAITING_APPROVAL");
  });

  it("rejects rollback when a later workflow owns the active route", async () => {
    const hostname = `rollback-owner-${crypto.randomUUID()}.corp.example.com`;
    const earlierWorkflow = await createCanaryWorkflow(hostname, "earlier-route");
    const earlierApproval = await approveWorkflow(
      earlierWorkflow.workflowId,
      "earlier-reviewer@example.test"
    );
    expect(earlierApproval.status).toBe(200);

    const laterWorkflow = await createCanaryWorkflow(hostname, "later-route");
    const laterApproval = await approveWorkflow(
      laterWorkflow.workflowId,
      "later-reviewer@example.test"
    );
    expect(laterApproval.status).toBe(200);

    const activeRoute = store.getState().routes.find((route) => route.hostname === hostname);
    expect(activeRoute?.revisionNote).toBe(`applied-${laterWorkflow.workflowId.slice(0, 8)}`);

    const rollbackResponse = await rollbackWorkflow(earlierWorkflow.workflowId);

    expect(rollbackResponse.status).toBe(409);
    expect(store.getState().routes.find((route) => route.hostname === hostname)).toEqual(activeRoute);
  });

  it("rejects a rollback reason that exceeds the API limit without mutating state", async () => {
    const hostname = `rollback-reason-${crypto.randomUUID()}.corp.example.com`;
    const workflow = await createCanaryWorkflow(hostname, "rollback-reason");
    const approvalResponse = await approveWorkflow(
      workflow.workflowId,
      "reason-reviewer@example.test"
    );
    expect(approvalResponse.status).toBe(200);

    const route = store.getState().routes.find((candidate) => candidate.hostname === hostname);
    expect(route).toBeDefined();
    if (!route) throw new Error("Expected an active canary route.");
    const originalRoute = { ...route };

    const rollbackResponse = await rollbackWorkflow(workflow.workflowId, "r".repeat(1001));

    expect(rollbackResponse.status).toBe(422);
    expect(store.getState().routes.find((candidate) => candidate.hostname === hostname)).toEqual(
      originalRoute
    );
    expect(
      store
        .getState()
        .workflows.find((candidate) => candidate.workflowId === workflow.workflowId)?.status
    ).toBe("EXECUTING");
  });

  it("rejects a non-string rollback reason without mutating state", async () => {
    const hostname = `rollback-reason-type-${crypto.randomUUID()}.corp.example.com`;
    const workflow = await createCanaryWorkflow(hostname, "rollback-reason-type");
    const approvalResponse = await approveWorkflow(
      workflow.workflowId,
      "reason-type-reviewer@example.test"
    );
    expect(approvalResponse.status).toBe(200);

    const route = store.getState().routes.find((candidate) => candidate.hostname === hostname);
    expect(route).toBeDefined();
    if (!route) throw new Error("Expected an active canary route.");
    const originalRoute = { ...route };

    const rollbackResponse = await rollbackWorkflow(workflow.workflowId, false);

    expect(rollbackResponse.status).toBe(422);
    expect(store.getState().routes.find((candidate) => candidate.hostname === hostname)).toEqual(
      originalRoute
    );
    expect(
      store
        .getState()
        .workflows.find((candidate) => candidate.workflowId === workflow.workflowId)?.status
    ).toBe("EXECUTING");
  });

  it("rejects a second rollback after the workflow has already rolled back", async () => {
    const hostname = `rollback-repeat-${crypto.randomUUID()}.corp.example.com`;
    const workflow = await createCanaryWorkflow(hostname, "rollback-repeat");
    const approvalResponse = await approveWorkflow(
      workflow.workflowId,
      "repeat-reviewer@example.test"
    );
    expect(approvalResponse.status).toBe(200);

    const firstRollbackResponse = await rollbackWorkflow(workflow.workflowId);
    expect(firstRollbackResponse.status).toBe(200);
    const rolledBackRoute = store
      .getState()
      .routes.find((candidate) => candidate.hostname === hostname);

    const secondRollbackResponse = await rollbackWorkflow(workflow.workflowId);

    expect(secondRollbackResponse.status).toBe(409);
    expect(store.getState().routes.find((candidate) => candidate.hostname === hostname)).toEqual(
      rolledBackRoute
    );
    expect(
      store
        .getState()
        .workflows.find((candidate) => candidate.workflowId === workflow.workflowId)?.status
    ).toBe("ROLLED_BACK");
  });

  it("aborts canary promotion when live route state has drifted", async () => {
    const hostname = `promotion-drift-${crypto.randomUUID()}.corp.example.com`;
    const workflow = await createCanaryWorkflow(hostname, "promotion-drift");
    const approvalResponse = await approveWorkflow(
      workflow.workflowId,
      "promotion-reviewer@example.test"
    );
    expect(approvalResponse.status).toBe(200);

    const route = store.getState().routes.find((candidate) => candidate.hostname === hostname);
    expect(route).toBeDefined();
    if (!route) throw new Error("Expected an active canary route.");
    route.backendService = "out-of-band-service";
    const driftedRoute = { ...route };

    const promotionResponse = await promoteWorkflow(workflow.workflowId);

    expect(promotionResponse.status).toBe(409);
    expect(store.getState().routes.find((candidate) => candidate.hostname === hostname)).toEqual(
      driftedRoute
    );
    expect(
      store
        .getState()
        .workflows.find((candidate) => candidate.workflowId === workflow.workflowId)?.status
    ).toBe("DRIFT_ABORTED");
  });

  it("aborts manual rollback when live route state has drifted", async () => {
    const hostname = `rollback-drift-${crypto.randomUUID()}.corp.example.com`;
    const workflow = await createCanaryWorkflow(hostname, "rollback-drift");
    const approvalResponse = await approveWorkflow(
      workflow.workflowId,
      "rollback-reviewer@example.test"
    );
    expect(approvalResponse.status).toBe(200);

    const route = store.getState().routes.find((candidate) => candidate.hostname === hostname);
    expect(route).toBeDefined();
    if (!route) throw new Error("Expected an active canary route.");
    route.backendService = "out-of-band-service";
    const driftedRoute = { ...route };

    const rollbackResponse = await rollbackWorkflow(workflow.workflowId);

    expect(rollbackResponse.status).toBe(409);
    expect(store.getState().routes.find((candidate) => candidate.hostname === hostname)).toEqual(
      driftedRoute
    );
    expect(
      store
        .getState()
        .workflows.find((candidate) => candidate.workflowId === workflow.workflowId)?.status
    ).toBe("DRIFT_ABORTED");
  });

  it("rejects canary promotion if the approved plan artifacts changed after approval", async () => {
    const hostname = `promotion-tamper-${crypto.randomUUID()}.corp.example.com`;
    const workflow = await createCanaryWorkflow(hostname, "promotion-tamper");
    const approvalResponse = await approveWorkflow(
      workflow.workflowId,
      "tamper-reviewer@example.test"
    );
    expect(approvalResponse.status).toBe(200);

    const storedWorkflow = store
      .getState()
      .workflows.find((candidate) => candidate.workflowId === workflow.workflowId);
    expect(storedWorkflow?.changePlan).toBeDefined();
    if (!storedWorkflow?.changePlan) throw new Error("Expected an approved change plan.");
    const artifactPath = Object.keys(storedWorkflow.changePlan.artifacts)[0];
    expect(artifactPath).toBeDefined();
    if (!artifactPath) throw new Error("Expected at least one approved artifact.");
    storedWorkflow.changePlan.artifacts[artifactPath] = "changed after approval";

    const route = store.getState().routes.find((candidate) => candidate.hostname === hostname);
    expect(route).toBeDefined();
    if (!route) throw new Error("Expected an active canary route.");
    const originalRoute = { ...route };

    const promotionResponse = await promoteWorkflow(workflow.workflowId);

    expect(promotionResponse.status).toBe(403);
    expect(store.getState().routes.find((candidate) => candidate.hostname === hostname)).toEqual(
      originalRoute
    );
    expect(
      store
        .getState()
        .auditEvents.some(
          (event) =>
            event.workflowId === workflow.workflowId && event.eventType === "SIGNATURE_INVALID"
        )
    ).toBe(true);
  });

  it("rejects rollback if the sealed rollback artifacts changed after approval", async () => {
    const hostname = `rollback-tamper-${crypto.randomUUID()}.corp.example.com`;
    const workflow = await createCanaryWorkflow(hostname, "rollback-tamper");
    const approvalResponse = await approveWorkflow(
      workflow.workflowId,
      "rollback-reviewer@example.test"
    );
    expect(approvalResponse.status).toBe(200);

    const storedWorkflow = store
      .getState()
      .workflows.find((candidate) => candidate.workflowId === workflow.workflowId);
    expect(storedWorkflow?.changePlan).toBeDefined();
    if (!storedWorkflow?.changePlan) throw new Error("Expected an approved change plan.");
    const artifactPath = Object.keys(
      storedWorkflow.changePlan.rollbackPlan.precomputedArtifacts
    )[0];
    expect(artifactPath).toBeDefined();
    if (!artifactPath) throw new Error("Expected a sealed rollback artifact.");
    storedWorkflow.changePlan.rollbackPlan.precomputedArtifacts[artifactPath] =
      "changed after approval";

    const route = store.getState().routes.find((candidate) => candidate.hostname === hostname);
    expect(route).toBeDefined();
    if (!route) throw new Error("Expected an active canary route.");
    const originalRoute = { ...route };

    const rollbackResponse = await rollbackWorkflow(workflow.workflowId);

    expect(rollbackResponse.status).toBe(403);
    expect(store.getState().routes.find((candidate) => candidate.hostname === hostname)).toEqual(
      originalRoute
    );
    expect(
      store
        .getState()
        .auditEvents.some(
          (event) =>
            event.workflowId === workflow.workflowId && event.eventType === "SIGNATURE_INVALID"
        )
    ).toBe(true);
  });

  it("rejects canary promotion when the approval signature is invalid", async () => {
    const hostname = `promotion-signature-${crypto.randomUUID()}.corp.example.com`;
    const workflow = await createCanaryWorkflow(hostname, "promotion-signature");
    const approvalResponse = await approveWorkflow(
      workflow.workflowId,
      "signature-reviewer@example.test"
    );
    expect(approvalResponse.status).toBe(200);

    const storedWorkflow = store
      .getState()
      .workflows.find((candidate) => candidate.workflowId === workflow.workflowId);
    expect(storedWorkflow?.approvalDecision).toBeDefined();
    if (!storedWorkflow?.approvalDecision) throw new Error("Expected an approval decision.");
    storedWorkflow.approvalDecision.signature = "invalid-signature";

    const route = store.getState().routes.find((candidate) => candidate.hostname === hostname);
    expect(route).toBeDefined();
    if (!route) throw new Error("Expected an active canary route.");
    const originalRoute = { ...route };

    const promotionResponse = await promoteWorkflow(workflow.workflowId);

    expect(promotionResponse.status).toBe(403);
    expect(store.getState().routes.find((candidate) => candidate.hostname === hostname)).toEqual(
      originalRoute
    );
    expect(
      store
        .getState()
        .auditEvents.some(
          (event) =>
            event.workflowId === workflow.workflowId && event.eventType === "SIGNATURE_INVALID"
        )
    ).toBe(true);
  });

  it("rejects a non-boolean simulated probe failure without promoting or rolling back", async () => {
    const hostname = `promotion-input-${crypto.randomUUID()}.corp.example.com`;
    const workflow = await createCanaryWorkflow(hostname, "promotion-input");
    const approvalResponse = await approveWorkflow(
      workflow.workflowId,
      "input-reviewer@example.test"
    );
    expect(approvalResponse.status).toBe(200);

    const route = store.getState().routes.find((candidate) => candidate.hostname === hostname);
    expect(route).toBeDefined();
    if (!route) throw new Error("Expected an active canary route.");
    const originalRoute = { ...route };

    const promotionResponse = await promoteWorkflow(workflow.workflowId, {
      simulateProbeFailure: "false",
    });

    expect(promotionResponse.status).toBe(422);
    expect(store.getState().routes.find((candidate) => candidate.hostname === hostname)).toEqual(
      originalRoute
    );
    expect(
      store
        .getState()
        .workflows.find((candidate) => candidate.workflowId === workflow.workflowId)?.status
    ).toBe("EXECUTING");
  });
});
