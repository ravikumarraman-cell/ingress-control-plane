import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server.ts";
import type {
  OnboardingAssessment,
  TroubleshootingDiagnosis,
  WorkflowRun,
} from "../../src/shared/contracts.ts";

describe("Top-10 Ingress Adoption Blockers & 6 Agent Patterns", () => {
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

  it("recommends IP Filtering for internal-only workloads (Blocker #1)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/onboarding/assess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appName: "internal-ledger",
        environment: "prod",
        exposure: "internal",
        internalOnlyPattern: true,
        hostname: "ledger.internal.example.com",
        tlsProfile: "mtls_internal",
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { assessment: OnboardingAssessment };
    expect(json.assessment.verdict).toBe("USE_IP_FILTERING");
    expect(json.assessment.canProceedToIngress).toBe(false);
    expect(json.assessment.recommendedPath).toContain("IP Filtering");
  });

  it("flags unsupported APIM / DR pool / Private Endpoint patterns immediately (Blocker #9)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/onboarding/assess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appName: "apim-edge",
        environment: "prod",
        exposure: "external",
        hostname: "apim.corp.example.com",
        useCaseFlags: ["managed_apim", "private_endpoint"],
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { assessment: OnboardingAssessment };
    expect(json.assessment.verdict).toBe("UNSUPPORTED_CONSTRAINT");
    expect(json.assessment.canProceedToIngress).toBe(false);
    const b9 = json.assessment.blockerChecks.find((b) => b.blockerNumber === 9);
    expect(b9?.status).toBe("BLOCKED");
  });

  it("catches DNS bare A-record, missing health check, cert gap, and Cloudflare allowlist before ticket (Blockers #2-#7)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/onboarding/assess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appName: "legacy-orders",
        environment: "prod",
        exposure: "external",
        hostname: "orders.corp.example.com",
        dnsProvider: "infoblox",
        dnsRecordType: "a_record",
        healthCheckPath: "none",
        originCertReady: false,
        cloudflareAllowlisted: false,
        hasAdminAccess: false,
        ticketRef: "",
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { assessment: OnboardingAssessment };
    expect(json.assessment.verdict).toBe("FIX_PREREQUISITES");
    expect(json.assessment.canProceedToIngress).toBe(false);

    const b2 = json.assessment.blockerChecks.find((b) => b.blockerNumber === 2);
    const b3 = json.assessment.blockerChecks.find((b) => b.blockerNumber === 3);
    const b4 = json.assessment.blockerChecks.find((b) => b.blockerNumber === 4);
    const b5 = json.assessment.blockerChecks.find((b) => b.blockerNumber === 5);
    const b6 = json.assessment.blockerChecks.find((b) => b.blockerNumber === 6);
    expect(b2?.status).toBe("BLOCKED");
    expect(b3?.status).toBe("BLOCKED");
    expect(b4?.status).toBe("BLOCKED");
    expect(b5?.status).toBe("ACTION_REQUIRED");
    expect(b6?.status).toBe("ACTION_REQUIRED");

    // Security guardrail: scoped Cloudflare CIDRs only, never 0.0.0.0/0; Four-Eyes RBAC preserved
    expect(json.assessment.starterTemplates.originAllowlistTf).toContain("173.245.48.0/20");
    expect(json.assessment.starterTemplates.originAllowlistTf).not.toContain("0.0.0.0/0");
    expect(json.assessment.serviceNowPrefill.rbacGuardrailNote).toContain("Four-Eyes Separation");
    expect(json.assessment.serviceNowPrefill.missingPrerequisites.length).toBeGreaterThanOrEqual(4);
  });

  it("blocks constrained or non-CNAME workflow requests during automated agent dry-run", async () => {
    const res = await fetch(`${baseUrl}/api/v1/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intakeMode: "structured",
        executionMode: "gitops_pr_v2",
        request: {
          ticketRef: "NET-9910",
          appName: "blocked-a-rec",
          environment: "staging",
          hostname: "blocked.staging.example.com",
          pathPrefix: "/api",
          backendService: "blocked-svc",
          backendPort: 8080,
          exposure: "external",
          tlsProfile: "tls_1_3_strict",
          dnsProvider: "infoblox",
          dnsRecordType: "a_record",
          healthCheckPath: "/healthz",
          originCertReady: true,
          cloudflareAllowlisted: true,
          rawJustification: "Testing DNS bare A-record pre-flight rejection in DAG pipeline.",
        },
      }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { workflow: WorkflowRun };
    expect(json.workflow.status).toBe("FAILED");
    const preflight = json.workflow.dynamicTaskAssignments?.find(
      (a) => a.agentName === "EligibilityPreflightAgent"
    );
    expect(preflight?.status).toBe("VETOED");
    expect(
      json.workflow.changePlan?.policyViolations.some((v) => v.includes("CTRL-DNS-ELIGIBILITY"))
    ).toBe(true);
  });

  it("classifies TroubleshootingAgent failures cleanly across DNS, CERT, NETWORK, HEALTH_CHECK, WAF, and DRIFT", async () => {
    const cases: Array<{ signal: string; expected: TroubleshootingDiagnosis["category"] }> = [
      { signal: "Error: existing DNS is bare A record, Infoblox CNAME needed", expected: "DNS" },
      { signal: "x509: certificate SAN mismatch and incomplete TLS chain", expected: "CERT" },
      { signal: "HTTP 522 Cloudflare edge origin firewall timeout", expected: "NETWORK" },
      { signal: "Synthetic readiness probe GET /healthz returned HTTP 503", expected: "HEALTH_CHECK" },
      { signal: "Edge WAF rule triggered false positive HTTP 403", expected: "WAF" },
      { signal: "TOCTOU drift detected: live_state_etag mismatch", expected: "DRIFT" },
    ];

    for (const c of cases) {
      const res = await fetch(`${baseUrl}/api/v1/troubleshoot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ errorText: c.signal }),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { diagnosis: TroubleshootingDiagnosis };
      expect(json.diagnosis.category).toBe(c.expected);
      expect(json.diagnosis.nextActions.length).toBeGreaterThan(0);
    }
  });

  it("enforces Rollout Companion WAF Block Mode guardrail (requires false-positive audit first)", async () => {
    const createRes = await fetch(`${baseUrl}/api/v1/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intakeMode: "structured",
        executionMode: "gitops_pr_v2",
        request: {
          ticketRef: "NET-9920",
          appName: "rollout-guard-svc",
          environment: "staging",
          hostname: "rollout-guard.staging.example.com",
          pathPrefix: "/v1/items",
          backendService: "items-svc",
          backendPort: 8443,
          exposure: "external",
          tlsProfile: "tls_1_3_strict",
          rawJustification: "Verify RolloutCompanionAgent bounded 7-21 day WAF Detect to Block guardrail.",
        },
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { workflow: WorkflowRun };
    expect(created.workflow.rolloutCompanion?.wafMode).toBe("DETECT_LOG_ONLY");

    // Attempt premature promotion to WAF Block Mode without False-Positive Audit -> rejected
    const prematureRes = await fetch(
      `${baseUrl}/api/v1/workflows/${created.workflow.workflowId}/rollout-step`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId: "WAF_BLOCK_MODE", status: "COMPLETED" }),
      }
    );
    expect(prematureRes.status).toBe(400);

    // Complete False-Positive Audit, then promote WAF Block Mode -> succeeds
    const auditRes = await fetch(
      `${baseUrl}/api/v1/workflows/${created.workflow.workflowId}/rollout-step`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId: "FALSE_POSITIVE_AUDIT", status: "COMPLETED" }),
      }
    );
    expect(auditRes.status).toBe(200);

    const blockRes = await fetch(
      `${baseUrl}/api/v1/workflows/${created.workflow.workflowId}/rollout-step`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId: "WAF_BLOCK_MODE", status: "COMPLETED" }),
      }
    );
    expect(blockRes.status).toBe(200);
    const updated = (await blockRes.json()) as { workflow: WorkflowRun };
    expect(updated.workflow.rolloutCompanion?.wafMode).toBe("BLOCK_ENFORCED");
  });
});
