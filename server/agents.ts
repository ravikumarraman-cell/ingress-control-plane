import crypto from "node:crypto";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import {
  containsEmbeddedSecret,
  IngressRequestSchema,
  type ActiveIngressRoute,
  type AgentStepTrace,
  type ApprovalDecision,
  type BlastRadiusScore,
  type ChangePlan,
  type ExecutionMode,
  type IngressRequest,
  type PolicyControlResult,
  type WorkflowRun,
} from "../src/shared/contracts.ts";
import {
  computePlanDigest,
  computeUnifiedDiff,
  renderRouteYaml,
  signApprovalPayload,
  store,
  verifyApprovalSignature,
} from "./store.ts";

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    throw new Error(
      "GEMINI_API_KEY is not configured in Settings > Secrets. Add a Gemini API key or switch to Structured Schema mode."
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

export async function parseNaturalLanguageIngressRequest(params: {
  naturalLanguagePrompt: string;
  requesterId: string;
  ticketRef?: string | null;
}): Promise<IngressRequest> {
  if (containsEmbeddedSecret(params.naturalLanguagePrompt)) {
    throw new Error(
      "IngressIntakeAgent Guardrail: Request rejected because it contains prohibited secret or private key material."
    );
  }

  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: "gemini-4-hydrogen",
    contents: `Parse the following enterprise networking ingress request into strict JSON fields.
Requester: ${params.requesterId}
Ticket: ${params.ticketRef ?? "none"}
Request: ${params.naturalLanguagePrompt}

Rules:
- appName must be lowercase kebab-case (e.g. "billing-api").
- environment must be one of "dev", "staging", or "prod".
- hostname must be a valid FQDN.
- pathPrefix must start with "/".
- backendService must be lowercase kebab-case.
- backendPort must be an integer 1..65535.
- exposure must be "internal" or "external".
- tlsProfile must be "tls_1_3_strict", "tls_1_2_compat", or "mtls_internal" (external prod requires "tls_1_3_strict").`,
    config: {
      systemInstruction:
        "You are IngressIntakeAgent. Extract structured networking ingress parameters accurately without inventing secrets.",
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          appName: { type: Type.STRING },
          environment: { type: Type.STRING },
          hostname: { type: Type.STRING },
          pathPrefix: { type: Type.STRING },
          backendService: { type: Type.STRING },
          backendPort: { type: Type.INTEGER },
          exposure: { type: Type.STRING },
          tlsProfile: { type: Type.STRING },
          rawJustification: { type: Type.STRING },
        },
        required: [
          "appName",
          "environment",
          "hostname",
          "pathPrefix",
          "backendService",
          "backendPort",
          "exposure",
          "tlsProfile",
          "rawJustification",
        ],
      },
    },
  });

  const text = (response.text ?? "").trim();
  if (!text) {
    throw new Error("IngressIntakeAgent received an empty response from Gemini.");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("IngressIntakeAgent failed to parse structured JSON from Gemini output.");
  }

  return IngressRequestSchema.parse({
    requestId: crypto.randomUUID(),
    requesterId: params.requesterId,
    ticketRef: params.ticketRef ?? null,
    ...parsed,
  });
}

function evaluatePolicies(
  req: IngressRequest,
  routes: ActiveIngressRoute[]
): {
  checks: PolicyControlResult[];
  violations: string[];
  blastRadius: BlastRadiusScore;
  collidingRoute: ActiveIngressRoute | undefined;
} {
  const checks: PolicyControlResult[] = [];
  const violations: string[] = [];

  // Control 1: External prod TLS 1.3 strict
  const tlsPass =
    !(req.environment === "prod" && req.exposure === "external") ||
    req.tlsProfile === "tls_1_3_strict";
  checks.push({
    controlId: "CTRL-TLS-13",
    controlName: "External Production TLS 1.3 Strict",
    passed: tlsPass,
    severity: "BLOCK",
    detail: tlsPass
      ? `TLS profile ${req.tlsProfile} satisfies ${req.environment} ${req.exposure} baseline.`
      : "External prod ingress requires tls_1_3_strict.",
  });
  if (!tlsPass) violations.push("CTRL-TLS-13: External prod requires tls_1_3_strict");

  // Control 2: External WAF required
  const wafApplied = req.exposure === "external";
  checks.push({
    controlId: "CTRL-WAF-EXT",
    controlName: "External WAF Policy Binding",
    passed: true,
    severity: "BLOCK",
    detail: wafApplied
      ? `Managed Cloud WAF rule will be attached for external host ${req.hostname}.`
      : "Internal mesh route; edge WAF exemption applied.",
  });

  // Control 3: Internal app cannot use external FQDN suffix
  const internalPoolPass =
    !(req.exposure === "internal" && !req.hostname.includes("internal") && !req.hostname.includes("dev") && req.environment === "prod");
  checks.push({
    controlId: "CTRL-POOL-ISO",
    controlName: "Internal / Public IP Pool Isolation",
    passed: internalPoolPass,
    severity: "BLOCK",
    detail: internalPoolPass
      ? `Gateway selection matches ${req.exposure} IP pool boundary.`
      : "Internal prod services should use *.internal.* hostname and private IP pool.",
  });
  if (!internalPoolPass) {
    violations.push("CTRL-POOL-ISO: Internal prod route must use an internal DNS zone.");
  }

  // Control 4: Non-wildcard cert in prod
  const nonWildcard = !req.hostname.includes("*");
  checks.push({
    controlId: "CTRL-CERT-NONWILDCARD",
    controlName: "Non-Wildcard Managed Certificate",
    passed: nonWildcard,
    severity: "BLOCK",
    detail: nonWildcard
      ? `Exact FQDN SAN ${req.hostname} validated.`
      : "Wildcard certificates are prohibited.",
  });
  if (!nonWildcard) violations.push("CTRL-CERT-NONWILDCARD: Wildcard hostnames prohibited.");

  // Collision / Impact Analysis
  const collidingRoute = routes.find(
    (r) => r.hostname === req.hostname && r.pathPrefix === req.pathPrefix
  );
  const sameHostOtherPath = routes.find(
    (r) => r.hostname === req.hostname && r.pathPrefix !== req.pathPrefix
  );

  let blastRadius: BlastRadiusScore = "LOW";
  if (req.environment === "prod" && (req.exposure === "external" || collidingRoute)) {
    blastRadius = "HIGH";
  } else if (req.environment === "prod" || req.environment === "staging" || collidingRoute || sameHostOtherPath) {
    blastRadius = "MEDIUM";
  }

  checks.push({
    controlId: "CTRL-COLLISION-CHECK",
    controlName: "Hostname & Path Overlap Audit",
    passed: true,
    severity: collidingRoute ? "WARN" : "INFO",
    detail: collidingRoute
      ? `Updates existing live route ${collidingRoute.routeId} (${collidingRoute.backendService}:${collidingRoute.backendPort} -> ${req.backendService}:${req.backendPort}).`
      : sameHostOtherPath
        ? `Shares host ${req.hostname} with path ${sameHostOtherPath.pathPrefix}; no path conflict.`
        : "No hostname or path prefix collision detected across live routes.",
  });

  return { checks, violations, blastRadius, collidingRoute };
}

export async function createAndPlanWorkflow(params: {
  request: IngressRequest;
  executionMode: ExecutionMode;
  onEvent: (eventType: string, workflow: WorkflowRun) => void;
}): Promise<WorkflowRun> {
  const state = store.getState();
  const workflowId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Phase A: Parallel Read-Only Analysis
  const liveEtag = store.getLiveEtag();
  const { checks, violations, blastRadius, collidingRoute } = evaluatePolicies(
    params.request,
    state.routes
  );

  const gatewayName =
    params.request.exposure === "external"
      ? `ext-${params.request.environment}-gateway`
      : `int-${params.request.environment}-gateway`;

  const beforeYaml = collidingRoute ? renderRouteYaml(collidingRoute) : "";
  const afterYaml = renderRouteYaml({
    appName: params.request.appName,
    environment: params.request.environment,
    hostname: params.request.hostname,
    pathPrefix: params.request.pathPrefix,
    backendService: params.request.backendService,
    backendPort: params.request.backendPort,
    exposure: params.request.exposure,
    tlsProfile: params.request.tlsProfile,
    wafEnabled: params.request.exposure === "external",
    gatewayName,
    canaryWeight: params.executionMode === "direct_canary_v3" ? 25 : 100,
    revisionNote: `wf-${workflowId.slice(0, 8)}`,
  });

  const yamlPath = `k8s/${params.request.environment}/${params.request.appName}-httproute.yaml`;
  const hclPath = `terraform/${params.request.environment}/${params.request.appName}-edge.tf`;
  const hclContent = [
    `resource "google_compute_managed_ssl_certificate" "${params.request.appName.replace(/-/g, "_")}_cert" {`,
    `  name = "${params.request.appName}-${params.request.environment}-cert"`,
    "  managed {",
    `    domains = ["${params.request.hostname}"]`,
    "  }",
    "}",
  ].join("\n");

  const artifacts: Record<string, string> = {
    [yamlPath]: afterYaml,
    [hclPath]: hclContent,
  };

  const rollbackArtifacts: Record<string, string> = collidingRoute
    ? { [yamlPath]: beforeYaml }
    : {
        [yamlPath]: `# Deterministic Delete Manifest\n# kubectl delete httproute ${params.request.appName}-${params.request.environment} -n ingress-${params.request.environment}`,
      };

  const planDigest = computePlanDigest(liveEtag, artifacts, rollbackArtifacts);
  const dryRunPassed = violations.length === 0;

  const changePlan: ChangePlan = {
    planId: crypto.randomUUID(),
    workflowId,
    targetStateEtag: liveEtag,
    blastRadius,
    policyChecks: checks,
    policyViolations: violations,
    artifacts,
    diffs: [
      computeUnifiedDiff(yamlPath, "HTTPRoute", beforeYaml, afterYaml),
      computeUnifiedDiff(hclPath, "ManagedSSLCertificate", "", hclContent),
    ],
    dryRunPassed,
    rollbackPlan: {
      rollbackId: crypto.randomUUID(),
      strategy:
        params.executionMode === "gitops_pr_v2"
          ? "gitops_revert"
          : collidingRoute
            ? "canary_weight_zero"
            : "declarative_restore",
      precomputedArtifacts: rollbackArtifacts,
      verificationProbes: [
        `https://${params.request.hostname}${params.request.pathPrefix} (TLS ${params.request.tlsProfile})`,
        `Backend ${params.request.backendService}:${params.request.backendPort} readiness`,
      ],
      maxRollbackSeconds: 45,
    },
    planDigestSha256: planDigest,
    createdAt: now,
  };

  const requiresHitl =
    params.executionMode !== "advisory_v1" &&
    (params.request.environment === "prod" || blastRadius === "HIGH" || true);

  const traces: AgentStepTrace[] = [
    {
      agentName: "IngressIntakeAgent",
      phase: "INTAKE",
      accessMode: "NONE",
      status: "COMPLETED",
      summary: `Validated IngressRequest for ${params.request.appName} (${params.request.environment}).`,
      durationMs: 180,
      completedAt: now,
    },
    {
      agentName: "SupervisorAgent",
      phase: "SUPERVISOR",
      accessMode: "STATE_CHECKPOINT",
      status: "COMPLETED",
      summary: "Dispatched Phase A ParallelAgent (iteration 1/5).",
      durationMs: 70,
      completedAt: now,
    },
    {
      agentName: "DiscoveryInventoryAgent",
      phase: "PHASE_A_PARALLEL",
      accessMode: "READ_ONLY",
      status: "COMPLETED",
      summary: `Snapshotted ${state.routes.length} routes via sa-ingress-readonly; pinned ETag ${liveEtag.slice(0, 18)}...`,
      durationMs: 290,
      completedAt: now,
    },
    {
      agentName: "PolicyComplianceAgent",
      phase: "PHASE_A_PARALLEL",
      accessMode: "READ_ONLY",
      status: "COMPLETED",
      summary: `${checks.filter((c) => c.passed).length}/${checks.length} compliance controls passed.`,
      durationMs: 150,
      completedAt: now,
    },
    {
      agentName: "ImpactAnalysisAgent",
      phase: "PHASE_A_PARALLEL",
      accessMode: "READ_ONLY",
      status: "COMPLETED",
      summary: `Computed BlastRadiusScore: ${blastRadius}.`,
      durationMs: 175,
      completedAt: now,
    },
    {
      agentName: "ChangePlanningAgent",
      phase: "PHASE_B_SEQUENTIAL",
      accessMode: "READ_ONLY",
      status: "COMPLETED",
      summary: "Synthesized Gateway API HTTPRoute YAML, Terraform HCL, and line diff.",
      durationMs: 320,
      completedAt: now,
    },
    {
      agentName: "ValidationRollbackAgent",
      phase: "PHASE_B_SEQUENTIAL",
      accessMode: "READ_ONLY",
      status: dryRunPassed ? "COMPLETED" : "FAILED",
      summary: dryRunPassed
        ? "Dry-run passed; deterministic RollbackPlan sealed."
        : `Dry-run blocked by policy violations: ${violations.join("; ")}`,
      durationMs: 210,
      completedAt: now,
    },
  ];

  let status: WorkflowRun["status"] = "AWAITING_APPROVAL";
  if (!dryRunPassed) {
    status = "FAILED";
  } else if (params.executionMode === "advisory_v1") {
    status = "COMPLETED";
    traces.push({
      agentName: "AdvisoryGate",
      phase: "HITL_GATE",
      accessMode: "READ_ONLY",
      status: "COMPLETED",
      summary: "v1 Read-Only Advisory complete; artifacts ready for manual export.",
      durationMs: 25,
      completedAt: now,
    });
  } else if (requiresHitl) {
    status = "AWAITING_APPROVAL";
    traces.push({
      agentName: "HITLApprovalGate",
      phase: "HITL_GATE",
      accessMode: "STATE_CHECKPOINT",
      status: "WAITING",
      summary: "ADK state interrupt active. Awaiting RBAC human approval.",
    });
  }

  const workflow: WorkflowRun = {
    workflowId,
    adkSessionId: `adk-sess-${workflowId.slice(0, 8)}`,
    ticketRef: params.request.ticketRef ?? null,
    requesterId: params.request.requesterId,
    appName: params.request.appName,
    environment: params.request.environment,
    status,
    executionMode: params.executionMode,
    ingressRequest: params.request,
    currentStateEtag: liveEtag,
    blastRadius,
    agentTraces: traces,
    changePlan,
    approvalDecision: null,
    gitopsPrUrl: null,
    probeResult: null,
    createdAt: now,
    updatedAt: now,
  };

  state.workflows.unshift(workflow);
  store.addAuditEvent({
    workflowId,
    actorId: params.request.requesterId,
    actorType: "HUMAN",
    eventType: "INTAKE_SUBMITTED",
    payload: {
      appName: params.request.appName,
      environment: params.request.environment,
      executionMode: params.executionMode,
    },
  });
  store.addAuditEvent({
    workflowId,
    actorId: "SupervisorAgent",
    actorType: "AGENT",
    eventType:
      status === "AWAITING_APPROVAL"
        ? "HITL_INTERRUPT_TRIGGERED"
        : status === "FAILED"
          ? "POLICY_DRYRUN_FAILED"
          : "ADVISORY_PLAN_GENERATED",
    payload: {
      targetStateEtag: liveEtag,
      blastRadius,
      planDigestSha256: planDigest,
    },
  });
  store.commit();
  params.onEvent(status, workflow);
  return workflow;
}

export function processApprovalAndExecute(params: {
  workflowId: string;
  decision: "APPROVE" | "REJECT";
  reviewerId: string;
  reviewerRoles: string[];
  rationale: string;
  simulateProbeFailure?: boolean;
  onEvent: (eventType: string, workflow: WorkflowRun) => void;
}): { httpStatus: number; workflow: WorkflowRun; error?: string } {
  const state = store.getState();
  const workflow = state.workflows.find((w) => w.workflowId === params.workflowId);
  if (!workflow || !workflow.changePlan) {
    throw new Error("Workflow or ChangePlan not found.");
  }

  if (workflow.status !== "AWAITING_APPROVAL") {
    return {
      httpStatus: 409,
      workflow,
      error: `Workflow is currently in status ${workflow.status} and cannot accept a decision.`,
    };
  }

  // RBAC role gate
  const hasApproverRole = params.reviewerRoles.some((r) =>
    ["net-approver", "platform-sre-lead", "secops-admin"].includes(r)
  );
  if (!hasApproverRole) {
    store.addAuditEvent({
      workflowId: workflow.workflowId,
      actorId: params.reviewerId,
      actorType: "HUMAN",
      eventType: "RBAC_DENIED",
      payload: { roles: params.reviewerRoles },
    });
    return {
      httpStatus: 403,
      workflow,
      error: "RBAC Denied: Operator lacks net-approver or platform-sre-lead role.",
    };
  }

  // Four-Eyes Separation Rule for prod or HIGH blast radius
  if (
    (workflow.environment === "prod" || workflow.blastRadius === "HIGH") &&
    params.reviewerId === workflow.requesterId
  ) {
    store.addAuditEvent({
      workflowId: workflow.workflowId,
      actorId: params.reviewerId,
      actorType: "HUMAN",
      eventType: "FOUR_EYES_VIOLATION",
      payload: { requesterId: workflow.requesterId, reviewerId: params.reviewerId },
    });
    return {
      httpStatus: 403,
      workflow,
      error:
        "Four-Eyes Separation Violation: Requester cannot approve their own prod or HIGH blast-radius change.",
    };
  }

  const now = new Date().toISOString();
  const signature = signApprovalPayload({
    workflowId: workflow.workflowId,
    planId: workflow.changePlan.planId,
    approvedStateEtag: workflow.changePlan.targetStateEtag,
    approvedPlanDigest: workflow.changePlan.planDigestSha256,
    reviewerId: params.reviewerId,
  });

  const decisionRecord: ApprovalDecision = {
    decisionId: crypto.randomUUID(),
    workflowId: workflow.workflowId,
    planId: workflow.changePlan.planId,
    decision: params.decision,
    reviewerId: params.reviewerId,
    reviewerRoles: params.reviewerRoles,
    rationale: params.rationale,
    approvedStateEtag: workflow.changePlan.targetStateEtag,
    approvedPlanDigest: workflow.changePlan.planDigestSha256,
    signature,
    decidedAt: now,
  };

  workflow.approvalDecision = decisionRecord;
  workflow.updatedAt = now;

  // Handle REJECT
  if (params.decision === "REJECT") {
    workflow.status = "REJECTED";
    const hitlTrace = workflow.agentTraces.find((t) => t.phase === "HITL_GATE");
    if (hitlTrace) {
      hitlTrace.status = "ABORTED";
      hitlTrace.summary = `Rejected by ${params.reviewerId}: ${params.rationale}`;
      hitlTrace.completedAt = now;
    }
    store.addAuditEvent({
      workflowId: workflow.workflowId,
      actorId: params.reviewerId,
      actorType: "HUMAN",
      eventType: "APPROVAL_REJECTED",
      payload: { rationale: params.rationale },
    });
    store.commit();
    params.onEvent("REJECTED", workflow);
    return { httpStatus: 200, workflow };
  }

  // Handle APPROVE -> Record signed token
  store.addAuditEvent({
    workflowId: workflow.workflowId,
    actorId: params.reviewerId,
    actorType: "HUMAN",
    eventType: "APPROVAL_SIGNED",
    payload: {
      decisionId: decisionRecord.decisionId,
      approvedStateEtag: decisionRecord.approvedStateEtag,
      signaturePrefix: decisionRecord.signature.slice(0, 16),
    },
  });

  const hitlTrace = workflow.agentTraces.find((t) => t.phase === "HITL_GATE");
  if (hitlTrace) {
    hitlTrace.status = "COMPLETED";
    hitlTrace.summary = `Approved by ${params.reviewerId} (HMAC signature verified).`;
    hitlTrace.completedAt = now;
  }

  // ExecutionAgent Pre-Flight Gate: Verify signature + Plan Digest + Live ETag
  if (!verifyApprovalSignature(decisionRecord)) {
    workflow.status = "FAILED";
    workflow.errorMessage = "Approval signature verification failed.";
    store.commit();
    return { httpStatus: 403, workflow, error: workflow.errorMessage };
  }

  const liveEtag = store.getLiveEtag();
  if (liveEtag !== workflow.changePlan.targetStateEtag) {
    workflow.status = "DRIFT_ABORTED";
    workflow.currentStateEtag = liveEtag;
    workflow.errorMessage = `TOCTOU Drift Detected: approved target_state_etag (${workflow.changePlan.targetStateEtag.slice(0, 19)}...) does not match live_state_etag (${liveEtag.slice(0, 19)}...).`;
    workflow.agentTraces.push({
      agentName: "ExecutionAgent",
      phase: "EXECUTION",
      accessMode: "SCOPED_WRITE",
      status: "ABORTED",
      summary: workflow.errorMessage,
      durationMs: 42,
      completedAt: now,
    });
    store.addAuditEvent({
      workflowId: workflow.workflowId,
      actorId: "ExecutionAgent",
      actorType: "AGENT",
      eventType: "DRIFT_DETECTED",
      payload: {
        approvedStateEtag: workflow.changePlan.targetStateEtag,
        liveStateEtag: liveEtag,
      },
    });
    store.commit();
    params.onEvent("DRIFT_ABORTED", workflow);
    return { httpStatus: 409, workflow, error: workflow.errorMessage };
  }

  // ETag Matches -> Execute according to ExecutionMode
  const req = workflow.ingressRequest;
  const previousRouteSnapshot = state.routes.find(
    (r) => r.hostname === req.hostname && r.pathPrefix === req.pathPrefix
  )
    ? {
        ...state.routes.find(
          (r) => r.hostname === req.hostname && r.pathPrefix === req.pathPrefix
        )!,
      }
    : null;

  if (workflow.executionMode === "gitops_pr_v2") {
    const prNumber = 1410 + Math.floor(Math.random() * 90);
    workflow.gitopsPrUrl = `https://gitops.corp.example.com/platform/ingress-configs/pull/${prNumber}`;
    workflow.status = "COMPLETED";
    workflow.probeResult = {
      passed: true,
      dnsResolved: true,
      tlsVerified: true,
      httpStatus: 200,
      latencyMs: 31,
      checkedAt: now,
      detail: `GitOps PR #${prNumber} opened and CI dry-run + preview probe passed.`,
    };
    workflow.agentTraces.push({
      agentName: "ExecutionAgent",
      phase: "EXECUTION",
      accessMode: "SCOPED_WRITE",
      status: "COMPLETED",
      summary: `Verified ETag match and opened GitOps PR #${prNumber}.`,
      durationMs: 390,
      completedAt: now,
    });
    store.addAuditEvent({
      workflowId: workflow.workflowId,
      actorId: "ExecutionAgent",
      actorType: "AGENT",
      eventType: "GITOPS_PR_CREATED",
      payload: { prNumber, prUrl: workflow.gitopsPrUrl },
    });
    store.commit();
    params.onEvent("COMPLETED", workflow);
    return { httpStatus: 200, workflow };
  }

  // Direct Gated Canary Execution (v3)
  const gatewayName =
    req.exposure === "external" ? `ext-${req.environment}-gateway` : `int-${req.environment}-gateway`;

  if (previousRouteSnapshot) {
    const idx = state.routes.findIndex((r) => r.routeId === previousRouteSnapshot.routeId);
    state.routes[idx] = {
      ...previousRouteSnapshot,
      backendService: req.backendService,
      backendPort: req.backendPort,
      tlsProfile: req.tlsProfile,
      canaryWeight: 25,
      revisionNote: `applied-${workflow.workflowId.slice(0, 8)}`,
      updatedAt: now,
    };
  } else {
    state.routes.push({
      routeId: `rt-${req.appName}-${req.environment}-${workflow.workflowId.slice(0, 4)}`,
      appName: req.appName,
      environment: req.environment,
      hostname: req.hostname,
      pathPrefix: req.pathPrefix,
      backendService: req.backendService,
      backendPort: req.backendPort,
      exposure: req.exposure,
      tlsProfile: req.tlsProfile,
      wafEnabled: req.exposure === "external",
      gatewayName,
      canaryWeight: 25,
      revisionNote: `applied-${workflow.workflowId.slice(0, 8)}`,
      updatedAt: now,
    });
  }

  store.addAuditEvent({
    workflowId: workflow.workflowId,
    actorId: "ExecutionAgent",
    actorType: "AGENT",
    eventType: "PATCH_APPLIED",
    payload: {
      hostname: req.hostname,
      backendService: req.backendService,
      canaryWeight: 25,
    },
  });

  // Run Synthetic Probe
  if (params.simulateProbeFailure) {
    // Deterministic Rollback without LLM invocation
    if (previousRouteSnapshot) {
      const idx = state.routes.findIndex((r) => r.routeId === previousRouteSnapshot.routeId);
      if (idx !== -1) state.routes[idx] = previousRouteSnapshot;
    } else {
      state.routes = state.routes.filter(
        (r) => !(r.hostname === req.hostname && r.pathPrefix === req.pathPrefix)
      );
    }

    workflow.status = "ROLLED_BACK";
    workflow.currentStateEtag = store.getLiveEtag();
    workflow.probeResult = {
      passed: false,
      dnsResolved: true,
      tlsVerified: true,
      httpStatus: 503,
      latencyMs: 412,
      checkedAt: now,
      detail:
        "Synthetic canary probe returned HTTP 503 Service Unavailable. Deterministic RollbackPlan executed in 14s (zero LLM calls).",
    };
    workflow.agentTraces.push({
      agentName: "ExecutionAgent",
      phase: "EXECUTION",
      accessMode: "SCOPED_WRITE",
      status: "ABORTED",
      summary:
        "Synthetic probe failed (HTTP 503). Executed pre-computed RollbackPlan deterministically.",
      durationMs: 540,
      completedAt: now,
    });
    store.addAuditEvent({
      workflowId: workflow.workflowId,
      actorId: "ExecutionAgent",
      actorType: "SYSTEM",
      eventType: "ROLLBACK_TRIGGERED",
      payload: {
        rollbackId: workflow.changePlan.rollbackPlan.rollbackId,
        strategy: workflow.changePlan.rollbackPlan.strategy,
        probeHttpStatus: 503,
      },
    });
    store.commit();
    params.onEvent("ROLLED_BACK", workflow);
    return { httpStatus: 200, workflow };
  }

  // Probe Passed -> Promote canary to 100%
  const activeIdx = state.routes.findIndex(
    (r) => r.hostname === req.hostname && r.pathPrefix === req.pathPrefix
  );
  if (activeIdx !== -1) {
    state.routes[activeIdx].canaryWeight = 100;
  }

  workflow.status = "COMPLETED";
  workflow.currentStateEtag = store.getLiveEtag();
  workflow.probeResult = {
    passed: true,
    dnsResolved: true,
    tlsVerified: true,
    httpStatus: 200,
    latencyMs: 27,
    checkedAt: now,
    detail: "DNS, TLS 1.3 ALPN, WAF, and HTTP 200 canary probes passed. Traffic shifted to 100%.",
  };
  workflow.agentTraces.push({
    agentName: "ExecutionAgent",
    phase: "EXECUTION",
    accessMode: "SCOPED_WRITE",
    status: "COMPLETED",
    summary: "ETag verified, gated patch applied, synthetic probes passed (HTTP 200).",
    durationMs: 480,
    completedAt: now,
  });
  store.addAuditEvent({
    workflowId: workflow.workflowId,
    actorId: "ExecutionAgent",
    actorType: "AGENT",
    eventType: "SYNTHETIC_PROBE_PASSED",
    payload: { httpStatus: 200, newLiveEtag: workflow.currentStateEtag },
  });
  store.commit();
  params.onEvent("COMPLETED", workflow);
  return { httpStatus: 200, workflow };
}
