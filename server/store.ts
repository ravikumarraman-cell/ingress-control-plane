import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  ActiveIngressRoute,
  ApprovalDecision,
  ArchitectureDocPayload,
  AuditEvent,
  ChangePlan,
  DiffHunk,
  WorkflowRun,
} from "../src/shared/contracts.ts";

const DATA_DIR = path.resolve(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "control-plane-state.json");
const DOC_FILE = path.resolve(process.cwd(), "docs", "architecture-spec.md");
const PLAN_FILE = path.resolve(process.cwd(), "docs", "implementation-plan.md");

const SIGNING_SECRET =
  process.env.APPROVAL_SIGNING_SECRET && process.env.APPROVAL_SIGNING_SECRET.length >= 16
    ? process.env.APPROVAL_SIGNING_SECRET
    : crypto.randomBytes(32).toString("hex");

export interface PersistedState {
  routes: ActiveIngressRoute[];
  workflows: WorkflowRun[];
  auditEvents: AuditEvent[];
  driftCounter: number;
}

export function computeStateEtag(routes: ActiveIngressRoute[]): string {
  const canonical = routes
    .slice()
    .sort((a, b) => a.routeId.localeCompare(b.routeId))
    .map((r) => ({
      routeId: r.routeId,
      appName: r.appName,
      environment: r.environment,
      hostname: r.hostname,
      pathPrefix: r.pathPrefix,
      backendService: r.backendService,
      backendPort: r.backendPort,
      exposure: r.exposure,
      tlsProfile: r.tlsProfile,
      wafEnabled: r.wafEnabled,
      gatewayName: r.gatewayName,
      canaryWeight: r.canaryWeight,
      revisionNote: r.revisionNote,
    }));
  const digest = crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return `sha256:${digest}`;
}

export function computePlanDigest(
  targetStateEtag: string,
  artifacts: Record<string, string>,
  rollbackArtifacts: Record<string, string>
): string {
  const canonical = JSON.stringify({
    targetStateEtag,
    artifacts: Object.fromEntries(Object.entries(artifacts).sort(([a], [b]) => a.localeCompare(b))),
    rollbackArtifacts: Object.fromEntries(
      Object.entries(rollbackArtifacts).sort(([a], [b]) => a.localeCompare(b))
    ),
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export function signApprovalPayload(params: {
  workflowId: string;
  planId: string;
  approvedStateEtag: string;
  approvedPlanDigest: string;
  reviewerId: string;
}): string {
  const message = [
    params.workflowId,
    params.planId,
    params.approvedStateEtag,
    params.approvedPlanDigest,
    params.reviewerId,
  ].join("|");
  return crypto.createHmac("sha256", SIGNING_SECRET).update(message).digest("hex");
}

export function verifyApprovalSignature(decision: ApprovalDecision): boolean {
  const expected = signApprovalPayload({
    workflowId: decision.workflowId,
    planId: decision.planId,
    approvedStateEtag: decision.approvedStateEtag,
    approvedPlanDigest: decision.approvedPlanDigest,
    reviewerId: decision.reviewerId,
  });
  const a = Buffer.from(decision.signature, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function computeUnifiedDiff(
  filePath: string,
  resourceKind: string,
  beforeText: string,
  afterText: string
): DiffHunk {
  const beforeLines = beforeText ? beforeText.split("\n") : [];
  const afterLines = afterText.split("\n");
  const lines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];
  let added = 0;
  let removed = 0;

  const maxLen = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < maxLen; i++) {
    const b = beforeLines[i];
    const a = afterLines[i];
    if (b === a) {
      if (a !== undefined) lines.push(` ${a}`);
    } else {
      if (b !== undefined) {
        lines.push(`-${b}`);
        removed++;
      }
      if (a !== undefined) {
        lines.push(`+${a}`);
        added++;
      }
    }
  }

  return {
    filePath,
    resourceKind,
    unifiedDiff: lines.join("\n"),
    linesAdded: added,
    linesRemoved: removed,
  };
}

export function renderRouteYaml(route: {
  appName: string;
  environment: string;
  hostname: string;
  pathPrefix: string;
  backendService: string;
  backendPort: number;
  exposure: string;
  tlsProfile: string;
  wafEnabled: boolean;
  gatewayName: string;
  canaryWeight: number;
  revisionNote: string;
}): string {
  return [
    "apiVersion: gateway.networking.k8s.io/v1",
    "kind: HTTPRoute",
    "metadata:",
    `  name: ${route.appName}-${route.environment}`,
    `  namespace: ingress-${route.environment}`,
    "  annotations:",
    `    ingress.controlplane/tls-profile: "${route.tlsProfile}"`,
    `    ingress.controlplane/waf-enforced: "${route.wafEnabled}"`,
    `    ingress.controlplane/revision: "${route.revisionNote}"`,
    "spec:",
    "  parentRefs:",
    `    - name: ${route.gatewayName}`,
    "      namespace: gateway-system",
    "  hostnames:",
    `    - "${route.hostname}"`,
    "  rules:",
    "    - matches:",
    "        - path:",
    "            type: PathPrefix",
    `            value: "${route.pathPrefix}"`,
    "      backendRefs:",
    `        - name: ${route.backendService}`,
    `          port: ${route.backendPort}`,
    `          weight: ${route.canaryWeight}`,
  ].join("\n");
}

function buildInitialState(): PersistedState {
  const now = new Date();
  const iso = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();

  const routes: ActiveIngressRoute[] = [
    {
      routeId: "rt-payments-prod",
      appName: "payments-api",
      environment: "prod",
      hostname: "payments.corp.example.com",
      pathPrefix: "/v2/payments",
      backendService: "payments-gateway-svc",
      backendPort: 8443,
      exposure: "external",
      tlsProfile: "tls_1_3_strict",
      wafEnabled: true,
      gatewayName: "ext-prod-gateway",
      canaryWeight: 100,
      revisionNote: "rev-2026-11-18-prod",
      updatedAt: iso(1440),
    },
    {
      routeId: "rt-checkout-prod",
      appName: "checkout-web",
      environment: "prod",
      hostname: "checkout.corp.example.com",
      pathPrefix: "/api/checkout",
      backendService: "checkout-core-svc",
      backendPort: 8080,
      exposure: "external",
      tlsProfile: "tls_1_3_strict",
      wafEnabled: true,
      gatewayName: "ext-prod-gateway",
      canaryWeight: 100,
      revisionNote: "rev-2026-11-19-prod",
      updatedAt: iso(420),
    },
    {
      routeId: "rt-ledger-internal",
      appName: "ledger-rpc",
      environment: "prod",
      hostname: "ledger.internal.example.com",
      pathPrefix: "/grpc/ledger",
      backendService: "ledger-grpc-svc",
      backendPort: 9090,
      exposure: "internal",
      tlsProfile: "mtls_internal",
      wafEnabled: false,
      gatewayName: "int-prod-mesh-gw",
      canaryWeight: 100,
      revisionNote: "rev-2026-11-15-int",
      updatedAt: iso(2880),
    },
    {
      routeId: "rt-analytics-staging",
      appName: "analytics-ingest",
      environment: "staging",
      hostname: "analytics.staging.example.com",
      pathPrefix: "/ingest",
      backendService: "analytics-collector-svc",
      backendPort: 8080,
      exposure: "external",
      tlsProfile: "tls_1_3_strict",
      wafEnabled: true,
      gatewayName: "ext-staging-gateway",
      canaryWeight: 100,
      revisionNote: "rev-2026-11-20-stg",
      updatedAt: iso(45),
    },
    {
      routeId: "rt-sandbox-dev",
      appName: "partner-sandbox",
      environment: "dev",
      hostname: "sandbox.dev.example.com",
      pathPrefix: "/webhooks",
      backendService: "partner-webhook-svc",
      backendPort: 3000,
      exposure: "internal",
      tlsProfile: "tls_1_2_compat",
      wafEnabled: false,
      gatewayName: "int-dev-gateway",
      canaryWeight: 100,
      revisionNote: "rev-2026-11-20-dev",
      updatedAt: iso(180),
    },
  ];

  const liveEtag = computeStateEtag(routes);

  // Seeded Workflow 1: AWAITING_APPROVAL on prod checkout-web
  const wf1Id = "11111111-4444-4000-8000-000000000101";
  const plan1Id = "22222222-4444-4000-8000-000000000201";
  const rb1Id = "33333333-4444-4000-8000-000000000301";
  const existingCheckout = routes[1];
  const beforeYaml = renderRouteYaml(existingCheckout);
  const afterYaml = renderRouteYaml({
    ...existingCheckout,
    backendService: "checkout-v2-svc",
    backendPort: 8443,
    canaryWeight: 25,
    revisionNote: "rev-2026-11-20-canary25",
  });
  const hclArtifact = [
    'resource "google_compute_security_policy_rule" "checkout_v2_waf" {',
    '  security_policy = "ext-prod-waf-policy"',
    "  priority        = 1200",
    '  action          = "allow"',
    "  match {",
    '    expr { expression = "request.path.startsWith(\'/api/checkout\')" }',
    "  }",
    "}",
  ].join("\n");

  const artifacts1 = {
    "k8s/prod/checkout-web-httproute.yaml": afterYaml,
    "terraform/prod/checkout-waf.tf": hclArtifact,
  };
  const rollbackArtifacts1 = {
    "k8s/prod/checkout-web-httproute.yaml": beforeYaml,
  };
  const planDigest1 = computePlanDigest(liveEtag, artifacts1, rollbackArtifacts1);

  const wf1Plan: ChangePlan = {
    planId: plan1Id,
    workflowId: wf1Id,
    targetStateEtag: liveEtag,
    blastRadius: "HIGH",
    policyChecks: [
      {
        controlId: "CTRL-TLS-13",
        controlName: "External Production TLS 1.3 Strict",
        passed: true,
        severity: "BLOCK",
        detail: "tls_1_3_strict enforced on checkout.corp.example.com",
      },
      {
        controlId: "CTRL-WAF-EXT",
        controlName: "External WAF Policy Binding",
        passed: true,
        severity: "BLOCK",
        detail: "ext-prod-waf-policy rule priority 1200 attached",
      },
      {
        controlId: "CTRL-CERT-NONWILDCARD",
        controlName: "Non-Wildcard Managed Certificate",
        passed: true,
        severity: "BLOCK",
        detail: "SAN verified as checkout.corp.example.com (exact FQDN)",
      },
      {
        controlId: "CTRL-COLLISION-CHECK",
        controlName: "Hostname & Path Overlap Audit",
        passed: true,
        severity: "WARN",
        detail: "Replacing live route rt-checkout-prod via 25% canary shift",
      },
    ],
    policyViolations: [],
    artifacts: artifacts1,
    diffs: [
      computeUnifiedDiff("k8s/prod/checkout-web-httproute.yaml", "HTTPRoute", beforeYaml, afterYaml),
      computeUnifiedDiff("terraform/prod/checkout-waf.tf", "WAFPolicyRule", "", hclArtifact),
    ],
    dryRunPassed: true,
    rollbackPlan: {
      rollbackId: rb1Id,
      strategy: "canary_weight_zero",
      precomputedArtifacts: rollbackArtifacts1,
      verificationProbes: [
        "https://checkout.corp.example.com/api/checkout/healthz (expect 200)",
        "TLS 1.3 ALPN h2 handshake verification",
      ],
      maxRollbackSeconds: 45,
    },
    planDigestSha256: planDigest1,
    createdAt: iso(14),
  };

  const wf1: WorkflowRun = {
    workflowId: wf1Id,
    adkSessionId: "adk-sess-98a1c4",
    ticketRef: "NET-4821",
    requesterId: "maya.lin@corp.example.com",
    appName: "checkout-web",
    environment: "prod",
    status: "AWAITING_APPROVAL",
    executionMode: "direct_canary_v3",
    ingressRequest: {
      requestId: "aaaaaaaa-4444-4000-8000-000000000101",
      requesterId: "maya.lin@corp.example.com",
      ticketRef: "NET-4821",
      appName: "checkout-web",
      environment: "prod",
      hostname: "checkout.corp.example.com",
      pathPrefix: "/api/checkout",
      backendService: "checkout-v2-svc",
      backendPort: 8443,
      exposure: "external",
      tlsProfile: "tls_1_3_strict",
      rawJustification:
        "Migrate checkout API route in prod to checkout-v2-svc on port 8443 with 25% canary traffic weight and strict TLS 1.3.",
    },
    currentStateEtag: liveEtag,
    blastRadius: "HIGH",
    agentTraces: [
      {
        agentName: "IngressIntakeAgent",
        phase: "INTAKE",
        accessMode: "NONE",
        status: "COMPLETED",
        summary: "Validated IngressRequest schema; zero secrets detected.",
        durationMs: 240,
        completedAt: iso(15),
      },
      {
        agentName: "SupervisorAgent",
        phase: "SUPERVISOR",
        accessMode: "STATE_CHECKPOINT",
        status: "COMPLETED",
        summary: "Dispatched Phase A parallel workers (iteration 1/5).",
        durationMs: 95,
        completedAt: iso(15),
      },
      {
        agentName: "DiscoveryInventoryAgent",
        phase: "PHASE_A_PARALLEL",
        accessMode: "READ_ONLY",
        status: "COMPLETED",
        summary: `Snapshotted 5 live routes via sa-ingress-readonly; ETag ${liveEtag.slice(0, 18)}...`,
        durationMs: 380,
        completedAt: iso(15),
      },
      {
        agentName: "PolicyComplianceAgent",
        phase: "PHASE_A_PARALLEL",
        accessMode: "READ_ONLY",
        status: "COMPLETED",
        summary: "4/4 security controls passed (TLS 1.3, WAF, non-wildcard SAN).",
        durationMs: 185,
        completedAt: iso(15),
      },
      {
        agentName: "ImpactAnalysisAgent",
        phase: "PHASE_A_PARALLEL",
        accessMode: "READ_ONLY",
        status: "COMPLETED",
        summary: "Existing prod external route replacement detected -> BlastRadius HIGH.",
        durationMs: 210,
        completedAt: iso(15),
      },
      {
        agentName: "ChangePlanningAgent",
        phase: "PHASE_B_SEQUENTIAL",
        accessMode: "READ_ONLY",
        status: "COMPLETED",
        summary: "Generated HTTPRoute YAML + WAF HCL and unified diff.",
        durationMs: 490,
        completedAt: iso(14),
      },
      {
        agentName: "ValidationRollbackAgent",
        phase: "PHASE_B_SEQUENTIAL",
        accessMode: "READ_ONLY",
        status: "COMPLETED",
        summary: "Server-side dry-run passed; deterministic RollbackPlan sealed.",
        durationMs: 270,
        completedAt: iso(14),
      },
      {
        agentName: "HITLApprovalGate",
        phase: "HITL_GATE",
        accessMode: "STATE_CHECKPOINT",
        status: "WAITING",
        summary: "ADK state interrupt active. Mandatory human approval for prod + HIGH blast radius.",
      },
    ],
    changePlan: wf1Plan,
    approvalDecision: null,
    gitopsPrUrl: null,
    probeResult: null,
    createdAt: iso(15),
    updatedAt: iso(14),
  };

  // Seeded Workflow 2: COMPLETED staging workflow
  const wf2Id = "11111111-4444-4000-8000-000000000102";
  const plan2Id = "22222222-4444-4000-8000-000000000202";
  const rb2Id = "33333333-4444-4000-8000-000000000302";
  const analyticsYaml = renderRouteYaml(routes[3]);
  const artifacts2 = { "k8s/staging/analytics-ingest-httproute.yaml": analyticsYaml };
  const rbArtifacts2 = { "k8s/staging/analytics-ingest-httproute.yaml": "# delete newly created route" };
  const digest2 = computePlanDigest(liveEtag, artifacts2, rbArtifacts2);
  const sig2 = signApprovalPayload({
    workflowId: wf2Id,
    planId: plan2Id,
    approvedStateEtag: liveEtag,
    approvedPlanDigest: digest2,
    reviewerId: "ravikumar.raman@gmail.com",
  });

  const wf2: WorkflowRun = {
    workflowId: wf2Id,
    adkSessionId: "adk-sess-77b2f9",
    ticketRef: "NET-4809",
    requesterId: "devon.park@corp.example.com",
    appName: "analytics-ingest",
    environment: "staging",
    status: "COMPLETED",
    executionMode: "gitops_pr_v2",
    ingressRequest: {
      requestId: "aaaaaaaa-4444-4000-8000-000000000102",
      requesterId: "devon.park@corp.example.com",
      ticketRef: "NET-4809",
      appName: "analytics-ingest",
      environment: "staging",
      hostname: "analytics.staging.example.com",
      pathPrefix: "/ingest",
      backendService: "analytics-collector-svc",
      backendPort: 8080,
      exposure: "external",
      tlsProfile: "tls_1_3_strict",
      rawJustification: "Expose staging telemetry collector on analytics.staging.example.com/ingest with WAF enabled.",
    },
    currentStateEtag: liveEtag,
    blastRadius: "LOW",
    agentTraces: [
      {
        agentName: "IngressIntakeAgent",
        phase: "INTAKE",
        accessMode: "NONE",
        status: "COMPLETED",
        summary: "Validated staging IngressRequest.",
        durationMs: 190,
        completedAt: iso(50),
      },
      {
        agentName: "DiscoveryInventoryAgent",
        phase: "PHASE_A_PARALLEL",
        accessMode: "READ_ONLY",
        status: "COMPLETED",
        summary: "Snapshotted staging gateway topology.",
        durationMs: 310,
        completedAt: iso(49),
      },
      {
        agentName: "ExecutionAgent",
        phase: "EXECUTION",
        accessMode: "SCOPED_WRITE",
        status: "COMPLETED",
        summary: "ETag verified; opened GitOps PR #1408 and verified synthetic probe (HTTP 200).",
        durationMs: 620,
        completedAt: iso(45),
      },
    ],
    changePlan: {
      planId: plan2Id,
      workflowId: wf2Id,
      targetStateEtag: liveEtag,
      blastRadius: "LOW",
      policyChecks: [
        {
          controlId: "CTRL-TLS-13",
          controlName: "External TLS 1.3",
          passed: true,
          severity: "BLOCK",
          detail: "tls_1_3_strict verified",
        },
      ],
      policyViolations: [],
      artifacts: artifacts2,
      diffs: [
        computeUnifiedDiff(
          "k8s/staging/analytics-ingest-httproute.yaml",
          "HTTPRoute",
          "",
          analyticsYaml
        ),
      ],
      dryRunPassed: true,
      rollbackPlan: {
        rollbackId: rb2Id,
        strategy: "gitops_revert",
        precomputedArtifacts: rbArtifacts2,
        verificationProbes: ["https://analytics.staging.example.com/ingest/healthz"],
        maxRollbackSeconds: 45,
      },
      planDigestSha256: digest2,
      createdAt: iso(48),
    },
    approvalDecision: {
      decisionId: "44444444-4444-4000-8000-000000000402",
      workflowId: wf2Id,
      planId: plan2Id,
      decision: "APPROVE",
      reviewerId: "ravikumar.raman@gmail.com",
      reviewerRoles: ["net-approver", "platform-sre-lead"],
      rationale: "Staging collector route complies with TLS 1.3 and WAF baselines.",
      approvedStateEtag: liveEtag,
      approvedPlanDigest: digest2,
      signature: sig2,
      decidedAt: iso(46),
    },
    gitopsPrUrl: "https://gitops.corp.example.com/platform/ingress-configs/pull/1408",
    probeResult: {
      passed: true,
      dnsResolved: true,
      tlsVerified: true,
      httpStatus: 200,
      latencyMs: 38,
      checkedAt: iso(45),
      detail: "TLS 1.3 handshake + HTTP 200 verified from external probe.",
    },
    createdAt: iso(50),
    updatedAt: iso(45),
  };

  const state: PersistedState = {
    routes,
    workflows: [wf1, wf2],
    auditEvents: [],
    driftCounter: 0,
  };

  // Seed hash-chained audit events
  appendAuditEventInMemory(state, {
    workflowId: wf2Id,
    actorId: "devon.park@corp.example.com",
    actorType: "HUMAN",
    eventType: "INTAKE_SUBMITTED",
    payload: { appName: "analytics-ingest", environment: "staging", ticketRef: "NET-4809" },
    occurredAt: iso(50),
  });
  appendAuditEventInMemory(state, {
    workflowId: wf2Id,
    actorId: "ravikumar.raman@gmail.com",
    actorType: "HUMAN",
    eventType: "APPROVAL_SIGNED",
    payload: { decision: "APPROVE", approvedStateEtag: liveEtag },
    occurredAt: iso(46),
  });
  appendAuditEventInMemory(state, {
    workflowId: wf2Id,
    actorId: "ExecutionAgent",
    actorType: "AGENT",
    eventType: "GITOPS_PR_CREATED",
    payload: { prNumber: 1408, probeStatus: 200 },
    occurredAt: iso(45),
  });
  appendAuditEventInMemory(state, {
    workflowId: wf1Id,
    actorId: "maya.lin@corp.example.com",
    actorType: "HUMAN",
    eventType: "INTAKE_SUBMITTED",
    payload: { appName: "checkout-web", environment: "prod", ticketRef: "NET-4821" },
    occurredAt: iso(15),
  });
  appendAuditEventInMemory(state, {
    workflowId: wf1Id,
    actorId: "SupervisorAgent",
    actorType: "AGENT",
    eventType: "HITL_INTERRUPT_TRIGGERED",
    payload: {
      reason: "prod environment + HIGH blast radius",
      targetStateEtag: liveEtag,
      planDigestSha256: planDigest1,
    },
    occurredAt: iso(14),
  });

  return state;
}

export function appendAuditEventInMemory(
  state: PersistedState,
  input: {
    workflowId: string;
    actorId: string;
    actorType: "HUMAN" | "AGENT" | "SYSTEM";
    eventType: string;
    payload: Record<string, unknown>;
    occurredAt?: string;
  }
): AuditEvent {
  const seqNo = state.auditEvents.length + 1;
  const prevEventHash =
    state.auditEvents.length > 0
      ? state.auditEvents[state.auditEvents.length - 1].eventHash
      : "0".repeat(64);
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const eventId = crypto.randomUUID();
  const body = JSON.stringify({
    seqNo,
    eventId,
    workflowId: input.workflowId,
    actorId: input.actorId,
    actorType: input.actorType,
    eventType: input.eventType,
    payload: input.payload,
    prevEventHash,
    occurredAt,
  });
  const eventHash = crypto.createHash("sha256").update(body).digest("hex");

  const ev: AuditEvent = {
    seqNo,
    eventId,
    workflowId: input.workflowId,
    actorId: input.actorId,
    actorType: input.actorType,
    eventType: input.eventType,
    payload: input.payload,
    prevEventHash,
    eventHash,
    occurredAt,
  };
  state.auditEvents.push(ev);
  return ev;
}

export function verifyAuditChain(events: AuditEvent[]): {
  valid: boolean;
  checkedCount: number;
  brokenAtSeq: number | null;
} {
  let expectedPrev = "0".repeat(64);
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.prevEventHash !== expectedPrev) {
      return { valid: false, checkedCount: i, brokenAtSeq: ev.seqNo };
    }
    const body = JSON.stringify({
      seqNo: ev.seqNo,
      eventId: ev.eventId,
      workflowId: ev.workflowId,
      actorId: ev.actorId,
      actorType: ev.actorType,
      eventType: ev.eventType,
      payload: ev.payload,
      prevEventHash: ev.prevEventHash,
      occurredAt: ev.occurredAt,
    });
    const recomputed = crypto.createHash("sha256").update(body).digest("hex");
    if (recomputed !== ev.eventHash) {
      return { valid: false, checkedCount: i, brokenAtSeq: ev.seqNo };
    }
    expectedPrev = ev.eventHash;
  }
  return { valid: true, checkedCount: events.length, brokenAtSeq: null };
}

class ControlPlaneStore {
  private state: PersistedState;

  constructor() {
    this.state = this.loadOrInit();
  }

  private loadOrInit(): PersistedState {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = fs.readFileSync(STATE_FILE, "utf-8");
        return JSON.parse(raw) as PersistedState;
      }
    } catch {
      // Fallback to fresh initial state if file is unreadable
    }
    const initial = buildInitialState();
    this.save(initial);
    return initial;
  }

  private save(nextState: PersistedState = this.state): void {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmpFile = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(nextState, null, 2), "utf-8");
    fs.renameSync(tmpFile, STATE_FILE);
  }

  getState(): PersistedState {
    return this.state;
  }

  commit(): void {
    this.save(this.state);
  }

  getLiveEtag(): string {
    return computeStateEtag(this.state.routes);
  }

  addAuditEvent(input: {
    workflowId: string;
    actorId: string;
    actorType: "HUMAN" | "AGENT" | "SYSTEM";
    eventType: string;
    payload: Record<string, unknown>;
  }): AuditEvent {
    const ev = appendAuditEventInMemory(this.state, input);
    this.commit();
    return ev;
  }

  getArchitectureDoc(): ArchitectureDocPayload {
    const markdown = fs.existsSync(DOC_FILE)
      ? fs.readFileSync(DOC_FILE, "utf-8")
      : "# Architecture Document Not Found";
    const implementationPlanMarkdown = fs.existsSync(PLAN_FILE)
      ? fs.readFileSync(PLAN_FILE, "utf-8")
      : "# Implementation Plan Not Found";
    const stat = fs.existsSync(DOC_FILE) ? fs.statSync(DOC_FILE) : null;

    const mermaidBlocks = Array.from(markdown.matchAll(/```mermaid\n([\s\S]*?)```/g)).map(
      (m) => m[1].trim()
    );

    return {
      title: "Governed Multi-Agent Networking Ingress Control Plane",
      version: "1.0.0",
      updatedAt: stat ? stat.mtime.toISOString() : new Date().toISOString(),
      filePath: "docs/architecture-spec.md",
      markdown,
      flowchartMermaid: mermaidBlocks[0] ?? "",
      sequenceMermaid: mermaidBlocks[1] ?? "",
      implementationPlanPath: "docs/implementation-plan.md",
      implementationPlanMarkdown,
    };
  }

  saveArchitectureDoc(markdown: string): ArchitectureDocPayload {
    const docsDir = path.resolve(process.cwd(), "docs");
    if (!DOC_FILE.startsWith(docsDir + path.sep)) {
      throw new Error("Invalid document path boundary");
    }
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(DOC_FILE, markdown, "utf-8");
    return this.getArchitectureDoc();
  }

  saveImplementationPlan(markdown: string): ArchitectureDocPayload {
    const docsDir = path.resolve(process.cwd(), "docs");
    if (!PLAN_FILE.startsWith(docsDir + path.sep)) {
      throw new Error("Invalid document path boundary");
    }
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(PLAN_FILE, markdown, "utf-8");
    return this.getArchitectureDoc();
  }
}

export const store = new ControlPlaneStore();
