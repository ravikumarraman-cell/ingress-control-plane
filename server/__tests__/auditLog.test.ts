import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server.ts";
import type { AuditEvent } from "../../src/shared/contracts.ts";

type AuditLogResponse = {
  events: AuditEvent[];
  verification: { valid: boolean; checkedCount: number; brokenAtSeq: number | null };
  pagination?: {
    limit: number;
    offset: number;
    total: number;
    totalEvents: number;
    hasMore: boolean;
  };
};

describe("audit log endpoint", () => {
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

  it("preserves the unpaginated response when pagination is not requested", async () => {
    const response = await fetch(`${baseUrl}/api/v1/audit-log`);

    expect(response.status).toBe(200);
    const data = (await response.json()) as AuditLogResponse;
    expect(data.pagination).toBeUndefined();
    expect(data.verification.valid).toBe(true);
  });

  it("returns bounded pages and metadata for pagination requests", async () => {
    const allResponse = await fetch(`${baseUrl}/api/v1/audit-log`);
    const allData = (await allResponse.json()) as AuditLogResponse;
    const response = await fetch(`${baseUrl}/api/v1/audit-log?limit=1&offset=0`);

    expect(response.status).toBe(200);
    const pageData = (await response.json()) as AuditLogResponse;
    expect(pageData.events).toEqual(allData.events.slice(0, 1));
    expect(pageData.pagination).toEqual({
      limit: 1,
      offset: 0,
      total: allData.events.length,
      totalEvents: allData.events.length,
      hasMore: allData.events.length > 1,
    });
    expect(pageData.verification).toEqual(allData.verification);
  });

  it("applies actor and search filters before paging", async () => {
    const allResponse = await fetch(`${baseUrl}/api/v1/audit-log`);
    const allData = (await allResponse.json()) as AuditLogResponse;
    const sample = allData.events[0];
    expect(sample).toBeDefined();
    if (!sample) throw new Error("Expected seeded audit events.");

    const query = new URLSearchParams({
      limit: "50",
      offset: "0",
      actorType: sample.actorType,
      search: sample.eventType,
    });
    const response = await fetch(`${baseUrl}/api/v1/audit-log?${query}`);

    expect(response.status).toBe(200);
    const pageData = (await response.json()) as AuditLogResponse;
    expect(pageData.events.length).toBeGreaterThan(0);
    expect(
      pageData.events.every(
        (event) =>
          event.actorType === sample.actorType &&
          event.eventType.toLowerCase().includes(sample.eventType.toLowerCase())
      )
    ).toBe(true);
    expect(pageData.pagination?.total).toBe(pageData.events.length);
    expect(pageData.pagination?.totalEvents).toBe(allData.events.length);
  });

  it("verifies the complete audit chain independently of the requested page", async () => {
    const [pageResponse, verificationResponse] = await Promise.all([
      fetch(`${baseUrl}/api/v1/audit-log?limit=1&offset=0`),
      fetch(`${baseUrl}/api/v1/audit-log/verify`),
    ]);

    expect(pageResponse.status).toBe(200);
    expect(verificationResponse.status).toBe(200);
    const pageData = (await pageResponse.json()) as AuditLogResponse;
    const verification = await verificationResponse.json();
    expect(verification).toEqual(pageData.verification);
  });

  it("rejects malformed or out-of-range pagination parameters", async () => {
    for (const query of [
      "limit=0",
      "limit=101",
      "limit=invalid",
      "offset=-1",
      "actorType=UNKNOWN",
      `search=${"x".repeat(201)}`,
    ]) {
      const response = await fetch(`${baseUrl}/api/v1/audit-log?${query}`);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Invalid audit log query parameters.",
      });
    }
  });
});
