import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server.ts";
import type { WorkflowRun } from "../../src/shared/contracts.ts";

type WorkflowListResponse = {
  liveStateEtag: string;
  workflows: WorkflowRun[];
};

type WorkflowDetailResponse = {
  liveStateEtag: string;
  workflow: WorkflowRun;
};

describe("workflow list endpoint", () => {
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

  it("filters by a supported status while preserving the response envelope", async () => {
    const allResponse = await fetch(`${baseUrl}/api/v1/workflows`);
    expect(allResponse.status).toBe(200);
    const allData = (await allResponse.json()) as WorkflowListResponse;
    const status = allData.workflows[0]?.status;
    expect(status).toBeDefined();

    const filteredResponse = await fetch(
      `${baseUrl}/api/v1/workflows?status=${encodeURIComponent(status ?? "")}`
    );
    expect(filteredResponse.status).toBe(200);
    const filteredData = (await filteredResponse.json()) as WorkflowListResponse;

    expect(filteredData.liveStateEtag).toBe(allData.liveStateEtag);
    expect(filteredData.workflows.length).toBeGreaterThan(0);
    expect(filteredData.workflows.every((workflow) => workflow.status === status)).toBe(true);
  });

  it("rejects an unsupported status filter", async () => {
    const response = await fetch(`${baseUrl}/api/v1/workflows?status=NOT_A_STATUS`);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid workflow status filter." });
  });

  it("returns workflow details and a clear 404 for unknown IDs", async () => {
    const listResponse = await fetch(`${baseUrl}/api/v1/workflows`);
    const listData = (await listResponse.json()) as WorkflowListResponse;
    const workflow = listData.workflows[0];
    expect(workflow).toBeDefined();
    if (!workflow) throw new Error("Expected seeded workflows.");

    const detailResponse = await fetch(
      `${baseUrl}/api/v1/workflows/${encodeURIComponent(workflow.workflowId)}`
    );
    expect(detailResponse.status).toBe(200);
    const detailData = (await detailResponse.json()) as WorkflowDetailResponse;
    expect(detailData.liveStateEtag).toBe(listData.liveStateEtag);
    expect(detailData.workflow).toEqual(workflow);

    const missingResponse = await fetch(
      `${baseUrl}/api/v1/workflows/${encodeURIComponent("missing-workflow")}`
    );
    expect(missingResponse.status).toBe(404);
    expect(await missingResponse.json()).toEqual({ error: "Workflow not found." });
  });
});
