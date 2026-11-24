import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  ActiveIngressRoute,
  ApprovalDecision,
  ArchitectureDocPayload,
  AuditEvent,
  ChangePlan,
  CreateDynamicAgentBlueprintInput,
  CustomPolicyRule,
  DiffHunk,
  DynamicAgentBlueprint,
  WorkflowRun,
} from "../src/shared/contracts.ts";
import {
  assertReadOnlyBlueprintSecurity,
  DagValidationError,
  interpolateUpstreamPrompt,
  topologicalSortStageAgents,
  validateAgentDag,
  validateStructuredOutput,
} from "./dagEngine.ts";

export {
  DagValidationError,
  interpolateUpstreamPrompt,
  topologicalSortStageAgents,
  validateAgentDag,
  validateStructuredOutput,
};

const DATA_DIR = path.resolve(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "control-plane-state.json");
const DOC_FILE = path.resolve(process.cwd(), "docs", "architecture-spec.md");
const PLAN_FILE = path.resolve(process.cwd(), "docs", "implementation-plan.md");
const PROGRESS_FILE = path.resolve(process.cwd(), "docs", "implementation-progress.md");

const SIGNING_SECRET =
  process.env.APPROVAL_SIGNING_SECRET && process.env.APPROVAL_SIGNING_SECRET.length >= 16
    ? process.env.APPROVAL_SIGNING_SECRET
    : crypto.randomBytes(32).toString("hex");

export const DEFAULT_CUSTOM_POLICY_RULES: CustomPolicyRule[] = [
  {
    ruleId: "CUSTOM-TICKET-PROD",
    name: "Require Change Ticket on Prod",
    description: "Every production ingress request must supply a ticketRef (e.g. NET-1234).",
    conditionType: "require_ticket",
    value: "prod",
    severity: "BLOCK",
    enabled: false,
  },
  {
    ruleId: "CUSTOM-DOMAIN-ALLOW",
    name: "Corporate Domain Allowlist",
    description: "Ensure external hostnames end with .example.com",
    conditionType: "allowed_domain_suffix",
    value: ".example.com",
    severity: "WARN",
    enabled: true,
  },
];

export const DEFAULT_DYNAMIC_BLUEPRINTS: DynamicAgentBlueprint[] = [
  {
    agentId: "55555555-4444-4000-8000-000000000500",
    name: "EligibilityPreflightAgent",
    role: "Adoption Pre-Flight & Blocker Verifier",
    systemPrompt:
      "You are EligibilityPreflightAgent under sa-ingress-readonly. Validate Infoblox/CNAME DNS eligibility, origin health-check readiness, Cloudflare IP allowlisting, origin TLS cert readiness, and unsupported APIM/DR/private endpoint patterns prior to planning.",
    taskTemplate:
      "Run pre-flight adoption readiness checks for {{upstream.IngressIntakeAgent.hostname}} ({{upstream.IngressIntakeAgent.environment}}/{{upstream.IngressIntakeAgent.exposure}}) using DNS, LB, and TLS telemetry.",
    hookStage: "PRE_INTAKE",
    dependsOn: ["IngressIntakeAgent"],
    outputSchema: [
      {
        key: "eligible",
        type: "boolean",
        description: "True when all pre-flight DNS, health check, cert, and allowlist prerequisites pass",
        required: true,
      },
      {
        key: "dnsEligible",
        type: "boolean",
        description: "Infoblox/Cloud DNS CNAME readiness check",
        required: true,
      },
      {
        key: "recommendedPattern",
        type: "string",
        description: "Recommended pattern (STANDARD_EDGE_INGRESS, INTERNAL_MESH_OR_IP_FILTERING, or UNSUPPORTED)",
        required: true,
      },
    ],
    allowedTools: ["get_dns_records", "get_tls_certs", "get_lb_config"],
    triggerCondition: { alwaysActive: true },
    canForceApproval: false,
    spawnedBy: "OPERATOR",
    enabled: true,
    createdAt: "2026-11-20T11:58:00.000Z",
  },
  {
    agentId: "55555555-4444-4000-8000-000000000501",
    name: "TLSInspectorAgent",
    role: "Certificate & TLS Posture Inspector",
    systemPrompt:
      "You are TLSInspectorAgent under sa-ingress-readonly. Inspect managed TLS certificates, SAN coverage, and expiry windows without modifying infrastructure.",
    taskTemplate:
      "Inspect TLS certificate and SAN posture for host {{upstream.DiscoveryAgent.liveEtag}} and verify minimum TLS version and expiry horizon.",
    hookStage: "PHASE_A_PARALLEL",
    dependsOn: ["DiscoveryAgent"],
    outputSchema: [
      {
        key: "minTlsVersion",
        type: "string",
        description: "Minimum negotiated TLS version (e.g. TLSv1.3)",
        required: true,
      },
      {
        key: "expiringWithinDays",
        type: "number",
        description: "Days until managed certificate expiration",
        required: true,
      },
      {
        key: "sanCoverageOk",
        type: "boolean",
        description: "Whether exact FQDN SAN matches requested hostname",
        required: true,
      },
      {
        key: "sanList",
        type: "string[]",
        description: "List of SAN entries covered by the certificate",
        required: false,
      },
    ],
    allowedTools: ["get_tls_certs", "get_lb_config"],
    triggerCondition: { alwaysActive: true },
    canForceApproval: false,
    spawnedBy: "OPERATOR",
    enabled: true,
    createdAt: "2026-11-20T12:00:00.000Z",
  },
  {
    agentId: "55555555-4444-4000-8000-000000000502",
    name: "CanaryWeightPlannerAgent",
    role: "Progressive Canary Rollout Strategist",
    systemPrompt:
      "You are CanaryWeightPlannerAgent under sa-ingress-readonly. Compute safe initial canary traffic weight and soak window from upstream TLS expiry and Blast Radius.",
    taskTemplate:
      "Given cert expiry in {{upstream.TLSInspectorAgent.expiringWithinDays}} days (TLS {{upstream.TLSInspectorAgent.minTlsVersion}}) and blast radius {{upstream.ImpactAgent.blastRadius}}, recommend initial canary weight and soak duration.",
    hookStage: "PHASE_B_SEQUENTIAL",
    dependsOn: ["TLSInspectorAgent", "ImpactAgent"],
    outputSchema: [
      {
        key: "recommendedCanaryPercent",
        type: "number",
        description: "Safe initial canary traffic percentage (1-100)",
        required: true,
      },
      {
        key: "soakMinutes",
        type: "number",
        description: "Minimum soak duration in minutes before promotion",
        required: true,
      },
    ],
    allowedTools: ["list_k8s_routes", "check_route_collisions"],
    triggerCondition: { alwaysActive: true },
    canForceApproval: false,
    spawnedBy: "OPERATOR",
    enabled: true,
    createdAt: "2026-11-20T12:01:00.000Z",
  },
  {
    agentId: "55555555-4444-4000-8000-000000000503",
    name: "RolloutCompanionAgent",
    role: "DNS Cutover & 7-21d WAF Tuning Companion",
    systemPrompt:
      "You are RolloutCompanionAgent under sa-ingress-readonly. Schedule the post-approval rollout milestones covering the 20-30 minute Infoblox CNAME cutover window and bounded 7-21 day WAF log-to-block tuning cadence.",
    taskTemplate:
      "Prepare post-apply cutover and WAF tuning checklist from ChangePlan {{upstream.ChangePlanAgent.planId}} (dryRunPassed={{upstream.ChangePlanAgent.dryRunPassed}}).",
    hookStage: "POST_VERIFY",
    dependsOn: ["ChangePlanAgent"],
    outputSchema: [
      {
        key: "dnsCutoverWindow",
        type: "string",
        description: "Expected DNS CNAME TTL cutover window",
        required: true,
      },
      {
        key: "wafTuningDays",
        type: "number",
        description: "Bounded WAF Log/Detect tuning days (7-21 external, 0 internal)",
        required: true,
      },
      {
        key: "targetWafMode",
        type: "string",
        description: "WAF lifecycle transition plan",
        required: true,
      },
      {
        key: "checklist",
        type: "string[]",
        description: "Ordered rollout companion checklist",
        required: false,
      },
    ],
    allowedTools: ["get_dns_records", "evaluate_opa_policies"],
    triggerCondition: { alwaysActive: true },
    canForceApproval: false,
    spawnedBy: "OPERATOR",
    enabled: true,
    createdAt: "2026-11-20T12:02:00.000Z",
  },
];

export interface PersistedState {
  routes: ActiveIngressRoute[];
  workflows: WorkflowRun[];
  auditEvents: AuditEvent[];
  customPolicyRules: CustomPolicyRule[];
  dynamicAgentBlueprints: DynamicAgentBlueprint[];
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
    customPolicyRules: DEFAULT_CUSTOM_POLICY_RULES.map((r) => ({ ...r })),
    dynamicAgentBlueprints: DEFAULT_DYNAMIC_BLUEPRINTS.map((bp) => ({ ...bp })),
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
  private readonly persistToDisk = !process.env.VITEST;

  constructor() {
    this.state = this.persistToDisk ? this.loadOrInit() : buildInitialState();
  }

  private loadOrInit(): PersistedState {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = fs.readFileSync(STATE_FILE, "utf-8");
        const parsed = JSON.parse(raw) as PersistedState;
        if (!Array.isArray(parsed.customPolicyRules)) {
          parsed.customPolicyRules = DEFAULT_CUSTOM_POLICY_RULES.map((r) => ({ ...r }));
        }
        if (!Array.isArray(parsed.dynamicAgentBlueprints)) {
          parsed.dynamicAgentBlueprints = DEFAULT_DYNAMIC_BLUEPRINTS.map((bp) => ({ ...bp }));
        } else {
          const existingIds = new Set(parsed.dynamicAgentBlueprints.map((b) => b.agentId));
          const existingNames = new Set(parsed.dynamicAgentBlueprints.map((b) => b.name));
          for (const defBp of DEFAULT_DYNAMIC_BLUEPRINTS) {
            if (!existingIds.has(defBp.agentId) && !existingNames.has(defBp.name)) {
              parsed.dynamicAgentBlueprints.push({ ...defBp });
            }
          }
        }
        return parsed;
      }
    } catch {
      // Fallback to fresh initial state if file is unreadable
    }
    const initial = buildInitialState();
    this.save(initial);
    return initial;
  }

  private save(nextState: PersistedState = this.state): void {
    if (!this.persistToDisk) return;
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
    const implementationProgressMarkdown = fs.existsSync(PROGRESS_FILE)
      ? fs.readFileSync(PROGRESS_FILE, "utf-8")
      : "# Implementation Progress Not Found";
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
      adoptionMermaid: mermaidBlocks[2] ?? "",
      implementationPlanPath: "docs/implementation-plan.md",
      implementationPlanMarkdown,
      implementationProgressPath: "docs/implementation-progress.md",
      implementationProgressMarkdown,
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

  listBlueprints(): DynamicAgentBlueprint[] {
    return this.state.dynamicAgentBlueprints;
  }

  createBlueprint(input: CreateDynamicAgentBlueprintInput): DynamicAgentBlueprint {
    assertReadOnlyBlueprintSecurity({
      name: input.name,
      allowedTools: (input.allowedTools ?? []) as DynamicAgentBlueprint["allowedTools"],
      serviceAccount: input.serviceAccount,
    });

    const blueprint: DynamicAgentBlueprint = {
      agentId: crypto.randomUUID(),
      name: input.name,
      role: input.role,
      systemPrompt: input.systemPrompt,
      taskTemplate: input.taskTemplate,
      hookStage: input.hookStage,
      dependsOn: input.dependsOn ?? [],
      outputSchema: (input.outputSchema ?? []).map((f) => ({
        ...f,
        required: f.required ?? true,
      })),
      allowedTools: (input.allowedTools ?? []) as DynamicAgentBlueprint["allowedTools"],
      triggerCondition: input.triggerCondition ?? { alwaysActive: true },
      canForceApproval: input.canForceApproval ?? false,
      spawnedBy: input.spawnedBy ?? "OPERATOR",
      enabled: input.enabled ?? true,
      createdAt: new Date().toISOString(),
    };

    const nextRoster = [...this.state.dynamicAgentBlueprints, blueprint];
    validateAgentDag(nextRoster);
    this.state.dynamicAgentBlueprints = nextRoster;
    this.commit();
    return blueprint;
  }

  updateBlueprint(
    agentId: string,
    patch: Partial<CreateDynamicAgentBlueprintInput>
  ): DynamicAgentBlueprint {
    const idx = this.state.dynamicAgentBlueprints.findIndex((b) => b.agentId === agentId);
    if (idx === -1) {
      throw new Error("Dynamic agent blueprint not found.");
    }

    const existing = this.state.dynamicAgentBlueprints[idx];
    assertReadOnlyBlueprintSecurity({
      name: patch.name ?? existing.name,
      allowedTools: (patch.allowedTools ?? existing.allowedTools) as DynamicAgentBlueprint["allowedTools"],
      serviceAccount: patch.serviceAccount,
    });

    const updated: DynamicAgentBlueprint = {
      ...existing,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.role !== undefined ? { role: patch.role } : {}),
      ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
      ...(patch.taskTemplate !== undefined ? { taskTemplate: patch.taskTemplate } : {}),
      ...(patch.hookStage !== undefined ? { hookStage: patch.hookStage } : {}),
      ...(patch.dependsOn !== undefined ? { dependsOn: patch.dependsOn } : {}),
      ...(patch.outputSchema !== undefined
        ? {
            outputSchema: patch.outputSchema.map((f) => ({
              ...f,
              required: f.required ?? true,
            })),
          }
        : {}),
      ...(patch.allowedTools !== undefined
        ? { allowedTools: patch.allowedTools as DynamicAgentBlueprint["allowedTools"] }
        : {}),
      ...(patch.triggerCondition !== undefined ? { triggerCondition: patch.triggerCondition } : {}),
      ...(patch.canForceApproval !== undefined ? { canForceApproval: patch.canForceApproval } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    };

    const nextRoster = this.state.dynamicAgentBlueprints.slice();
    nextRoster[idx] = updated;
    validateAgentDag(nextRoster);
    this.state.dynamicAgentBlueprints = nextRoster;
    this.commit();
    return updated;
  }

  deleteBlueprint(agentId: string): DynamicAgentBlueprint[] {
    this.state.dynamicAgentBlueprints = this.state.dynamicAgentBlueprints.filter(
      (b) => b.agentId !== agentId
    );
    this.commit();
    return this.state.dynamicAgentBlueprints;
  }

  saveImplementationProgress(markdown: string): ArchitectureDocPayload {
    const docsDir = path.resolve(process.cwd(), "docs");
    if (!PROGRESS_FILE.startsWith(docsDir + path.sep)) {
      throw new Error("Invalid document path boundary");
    }
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(PROGRESS_FILE, markdown, "utf-8");
    return this.getArchitectureDoc();
  }
}

export const store = new ControlPlaneStore();
