import crypto from "node:crypto";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import {
  containsEmbeddedSecret,
  type ActiveIngressRoute,
  type BlockerCheckItem,
  type ConstrainedUseCase,
  type IngressRequest,
  type OnboardingAssessment,
  type OnboardingAssessmentInput,
  type RolloutCompanionPlan,
  type RolloutMilestone,
  type ServiceNowPrefillPayload,
  type TroubleshootingCategory,
  type TroubleshootingDiagnosis,
  type WorkflowRun,
  type WorkflowStatus,
} from "../src/shared/contracts.ts";
import { renderRouteYaml } from "./store.ts";

// Well-known Cloudflare edge egress CIDR prefixes for origin allowlisting (scoped, never 0.0.0.0/0)
export const CLOUDFLARE_EDGE_CIDRS = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
];

function getOptionalGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    return null;
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

async function withTimeout<T>(promise: Promise<T>, ms = 3500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Gemini request timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function detectConstrainedUseCasesFromText(text: string): ConstrainedUseCase[] {
  const lower = text.toLowerCase();
  const found: ConstrainedUseCase[] = [];
  if (
    lower.includes("managed apim") ||
    lower.includes("apim traffic") ||
    lower.includes("azure apim") ||
    lower.includes("apigee managed")
  ) {
    found.push("managed_apim");
  }
  if (lower.includes("dr pool") || lower.includes("disaster recovery pool")) {
    found.push("dr_pool");
  }
  if (lower.includes("private endpoint") || lower.includes("privatelink")) {
    found.push("private_endpoint");
  }
  return found;
}

export function renderOriginAllowlistTerraform(params: {
  appName: string;
  environment: string;
  backendPort: number;
}): string {
  const safeName = params.appName.replace(/[^a-z0-9_]/gi, "_");
  const cidrLines = CLOUDFLARE_EDGE_CIDRS.map((c) => `    "${c}",`).join("\n");
  return [
    `# Scoped Origin Allowlist for Cloudflare Edge Proxies (no public wildcard ranges)`,
    `resource "google_compute_firewall" "${safeName}_${params.environment}_cf_origin" {`,
    `  name    = "${params.appName}-${params.environment}-allow-cloudflare-edge"`,
    `  network = "vpc-${params.environment}-app"`,
    ``,
    `  allow {`,
    `    protocol = "tcp"`,
    `    ports    = ["${params.backendPort}"]`,
    `  }`,
    ``,
    `  source_ranges = [`,
    cidrLines,
    `  ]`,
    `  target_tags = ["${params.appName}-origin"]`,
    `}`,
  ].join("\n");
}

export function renderEdgeWafTerraform(params: {
  appName: string;
  environment: string;
  hostname: string;
  pathPrefix: string;
  exposure: "internal" | "external";
}): string {
  const safeName = params.appName.replace(/[^a-z0-9_]/gi, "_");
  return [
    `resource "google_compute_managed_ssl_certificate" "${safeName}_cert" {`,
    `  name = "${params.appName}-${params.environment}-cert"`,
    `  managed {`,
    `    domains = ["${params.hostname}"]`,
    `  }`,
    `}`,
    ``,
    `# Consolidated PCAM Edge Baseline: Rate Limit + Fail-Open Safety + Bounded WAF Mode`,
    `resource "google_compute_security_policy_rule" "${safeName}_waf_baseline" {`,
    `  security_policy = "${params.exposure === "external" ? `ext-${params.environment}-waf-policy` : `int-${params.environment}-mesh-policy`}"`,
    `  priority        = 1200`,
    `  action          = "${params.exposure === "external" ? "throttle" : "allow"}"`,
    `  preview         = ${params.environment === "prod" && params.exposure === "external" ? "true  # 7-21 day Detect/Log tuning window before Block Mode promotion" : "false"}`,
    `  match {`,
    `    expr { expression = "request.path.startsWith('${params.pathPrefix}')" }`,
    `  }`,
    `  rate_limit_options {`,
    `    conform_action = "allow"`,
    `    exceed_action  = "deny(429)"`,
    `    rate_limit_threshold {`,
    `      count        = 300`,
    `      interval_sec = 60`,
    `    }`,
    `  }`,
    `}`,
  ].join("\n");
}

export function renderPcamCliCommand(input: {
  appName: string;
  environment: string;
  hostname: string;
  pathPrefix: string;
  backendService: string;
  backendPort: number;
  exposure: "internal" | "external";
  tlsProfile: string;
  healthCheckPath?: string;
  dnsProvider?: string;
  dnsRecordType?: string;
}): string {
  const hcPath = input.healthCheckPath?.trim() || "/healthz";
  return [
    `# Policy-Compliant Ingress CLI Starter (replaces 9-step manual PCAM UI flow)`,
    `ingressctl onboard \\`,
    `  --app "${input.appName}" \\`,
    `  --env "${input.environment}" \\`,
    `  --hostname "${input.hostname}" \\`,
    `  --path-prefix "${input.pathPrefix}" \\`,
    `  --backend "${input.backendService}:${input.backendPort}" \\`,
    `  --exposure "${input.exposure}" \\`,
    `  --tls-profile "${input.tlsProfile}" \\`,
    `  --dns-provider "${input.dnsProvider ?? "infoblox"}" \\`,
    `  --dns-record-type "${input.dnsRecordType ?? "cname"}" \\`,
    `  --health-check "${hcPath}" \\`,
    `  --waf-tuning-mode "detect_7_to_21d" \\`,
    `  --fail-open "false" \\`,
    `  --attestation "auto-signed-via-control-plane"`,
  ].join("\n");
}

export function renderHealthCheckStarterSnippet(path: string, backendPort: number): string {
  const cleanPath = path.startsWith("/") ? path : "/healthz";
  return [
    `# Kubernetes Readiness Probe + Lightweight Express /healthz Handler`,
    `readinessProbe:`,
    `  httpGet:`,
    `    path: ${cleanPath}`,
    `    port: ${backendPort}`,
    `  initialDelaySeconds: 5`,
    `  periodSeconds: 10`,
    ``,
    `// App handler snippet (Node/Express):`,
    `app.get("${cleanPath}", (_req, res) => {`,
    `  res.status(200).json({ status: "ok" });`,
    `});`,
  ].join("\n");
}

export function buildRolloutCompanionPlan(params: {
  request: Pick<IngressRequest, "environment" | "exposure" | "hostname" | "dnsRecordType">;
  status: WorkflowStatus;
  existing?: RolloutCompanionPlan | null;
}): RolloutCompanionPlan {
  if (params.existing) {
    return params.existing;
  }

  const isExternal = params.request.exposure === "external";
  const isCompleted = params.status === "COMPLETED";
  const isExecuting = params.status === "EXECUTING";

  if (!isExternal) {
    const internalMilestones: RolloutMilestone[] = [
      {
        stepId: "PROVISIONING",
        title: "Internal Mesh Route Provisioning",
        windowLabel: "5–15 min",
        status: isCompleted || isExecuting ? "COMPLETED" : "PENDING",
        guidance: `Provision mTLS internal gateway route for ${params.request.hostname}.`,
      },
      {
        stepId: "DNS_CUTOVER",
        title: "Internal Infoblox CNAME Cutover",
        windowLabel: "20–30 min",
        status: isCompleted ? "COMPLETED" : isExecuting ? "ACTIVE" : "PENDING",
        guidance: "Verify internal DNS resolution and zero packet drops on private mesh.",
      },
      {
        stepId: "WAF_LOG_TUNING",
        title: "Edge WAF Log/Detect Tuning",
        windowLabel: "Exempt (Internal)",
        status: "EXEMPT",
        guidance: "Internal mesh routes use IP Filtering & mTLS rather than Edge WAF.",
      },
      {
        stepId: "FALSE_POSITIVE_AUDIT",
        title: "False-Positive Verification",
        windowLabel: "Exempt (Internal)",
        status: "EXEMPT",
        guidance: "Verify backend /healthz metrics in Prometheus.",
      },
      {
        stepId: "WAF_BLOCK_MODE",
        title: "WAF Block Mode Cutover",
        windowLabel: "Exempt (Internal)",
        status: "EXEMPT",
        guidance: "Not applicable for internal-only endpoints.",
      },
    ];
    return {
      wafMode: "EXEMPT_INTERNAL",
      wafTuningWindowDays: 0,
      dnsCutoverMinutes: "20–30 min",
      blockModeGuardrail: "Internal mesh route uses IP Filtering / mTLS; Edge WAF is exempt.",
      milestones: internalMilestones,
    };
  }

  const externalMilestones: RolloutMilestone[] = [
    {
      stepId: "PROVISIONING",
      title: "Edge Gateway & Cloudflare Provisioning",
      windowLabel: "1–3 hours (PRM + Edge Sync)",
      status: isCompleted || isExecuting ? "COMPLETED" : "PENDING",
      guidance: `Provision external gateway & Cloudflare edge bindings for ${params.request.hostname}.`,
    },
    {
      stepId: "DNS_CUTOVER",
      title: "Infoblox CNAME DNS Cutover Window",
      windowLabel: "20–30 min TTL propagation",
      status: isCompleted ? "COMPLETED" : isExecuting ? "ACTIVE" : "PENDING",
      guidance:
        "Switch CNAME target in Infoblox / delegated Cloud DNS and confirm 4-vantage synthetic probes return HTTP 200.",
    },
    {
      stepId: "WAF_LOG_TUNING",
      title: "WAF Log / Detect Tuning Window",
      windowLabel: "7–21 days (bounded)",
      status: isCompleted ? "ACTIVE" : "PENDING",
      guidance:
        "Run WAF rules in Log/Detect preview mode for 7–21 days to capture legitimate payload shapes before blocking.",
    },
    {
      stepId: "FALSE_POSITIVE_AUDIT",
      title: "WAF Dashboard & False-Positive Audit",
      windowLabel: "Before Block Mode",
      status: "PENDING",
      guidance:
        "Confirm zero unexplained 403 signatures in Edge WAF analytics and tune rule exceptions if required.",
    },
    {
      stepId: "WAF_BLOCK_MODE",
      title: "Promote WAF to Block Mode",
      windowLabel: "Mandatory ≤ Day 21",
      status: "PENDING",
      guidance:
        "Security Guardrail: External prod routes must transition from Log/Detect to Block Mode within 21 days (indefinite WAF bypass prohibited).",
    },
  ];

  return {
    wafMode: "DETECT_LOG_ONLY",
    wafTuningWindowDays: params.request.environment === "prod" ? 14 : 7,
    dnsCutoverMinutes: "20–30 min",
    blockModeGuardrail:
      "Guardrail: Bounded 7–21 day WAF Detect window before mandatory Block Mode promotion.",
    milestones: externalMilestones,
  };
}

export async function assessOnboardingAndPreflight(params: {
  input: OnboardingAssessmentInput;
  existingRoutes: ActiveIngressRoute[];
}): Promise<OnboardingAssessment> {
  const { input, existingRoutes } = params;
  const now = new Date().toISOString();

  const textConstrained = detectConstrainedUseCasesFromText(
    `${input.notes ?? ""} ${input.hostname} ${input.appName}`
  );
  const constrainedFlags = Array.from(new Set([...input.useCaseFlags, ...textConstrained]));

  if (containsEmbeddedSecret(`${input.notes ?? ""} ${input.hostname} ${input.backendService}`)) {
    throw new Error(
      "Onboarding Guardrail: Input contains prohibited private key or secret material."
    );
  }

  const blockerChecks: BlockerCheckItem[] = [];

  // Blocker 1: Pattern fit (External Ingress vs IP Filtering)
  const isInternalOnly = input.internalOnlyPattern || input.exposure === "internal";
  blockerChecks.push({
    blockerNumber: 1,
    blockerTitle: "Pattern Fit (External Ingress vs. IP Filtering)",
    status: input.internalOnlyPattern ? "ACTION_REQUIRED" : "PASS",
    finding: input.internalOnlyPattern
      ? "App is marked internal-only with no external edge requirement."
      : input.exposure === "external"
        ? "External edge exposure matches Managed Ingress + Edge WAF architecture."
        : "Internal cluster service mesh gateway selected (mtls_internal).",
    remediation: input.internalOnlyPattern
      ? "Use IP Filtering / Private Service Mesh instead of public Edge WAF Ingress unless external internet consumers exist."
      : "No pattern change required.",
  });

  // Blocker 9: Unsupported / constrained use cases (caught early!)
  const hasConstrained = constrainedFlags.length > 0;
  const constraintDetails = constrainedFlags
    .map((f) =>
      f === "managed_apim"
        ? "Managed APIM traffic"
        : f === "dr_pool"
          ? "DR pool configuration"
          : "Private Endpoints"
    )
    .join(", ");
  blockerChecks.push({
    blockerNumber: 9,
    blockerTitle: "Unsupported / Constrained Use Cases (APIM, DR Pool, Private Endpoint)",
    status: hasConstrained ? "BLOCKED" : "PASS",
    finding: hasConstrained
      ? `Detected constrained capability: ${constraintDetails}.`
      : "Standard HTTP/HTTPS workload — no unsupported APIM, DR pool, or private endpoint constraints.",
    remediation: hasConstrained
      ? "Route Managed APIM via native APIM gateway policies, handle DR pools via regional GSLB failover, or use PrivateLink directly instead of edge WAF ingress."
      : "Eligible for standard Ingress pipeline.",
  });

  // Blocker 2: DNS eligibility (Infoblox / Cloud Native DNS delegated + CNAME)
  const dnsProviderOk = input.dnsProvider !== "external_other";
  const dnsRecordOk = input.dnsRecordType !== "a_record" || input.exposure === "internal";
  const dnsPass = dnsProviderOk && dnsRecordOk;
  blockerChecks.push({
    blockerNumber: 2,
    blockerTitle: "DNS Eligibility (Infoblox / Delegated Cloud DNS + CNAME)",
    status: dnsPass ? "PASS" : "BLOCKED",
    finding: dnsPass
      ? `DNS provider (${input.dnsProvider}) and record type (${input.dnsRecordType}) meet edge CNAME delegation rules.`
      : !dnsProviderOk
        ? "Unsupported DNS provider; zone is not managed by Infoblox or Infoblox-delegated Cloud DNS."
        : "Existing bare A record detected; Cloudflare edge onboarding requires a CNAME (not A record).",
    remediation: dnsPass
      ? "Infoblox CNAME ready for 20–30 min cutover window."
      : !dnsProviderOk
        ? "Delegate DNS subdomain from Infoblox to Cloud Native DNS before onboarding."
        : "Convert existing A record to a CNAME alias in Infoblox before submitting Ingress change.",
  });

  // Blocker 3: Mandatory health-check endpoint
  const hcPath = input.healthCheckPath.trim();
  const hcValid = hcPath.startsWith("/") && hcPath.length >= 2 && hcPath.toLowerCase() !== "/none";
  blockerChecks.push({
    blockerNumber: 3,
    blockerTitle: "Mandatory Health-Check Endpoint",
    status: hcValid ? "PASS" : "BLOCKED",
    finding: hcValid
      ? `Origin probe path "${hcPath}" configured for synthetic health checks.`
      : "Missing HTTP health-check endpoint (e.g., /healthz or /readyz).",
    remediation: hcValid
      ? "Will attach automated 4-vantage probe checks post-apply."
      : "Expose a lightweight HTTP 200 GET /healthz endpoint using the generated starter snippet before onboarding.",
  });

  // Blocker 4: Certificate readiness (TLS 1.2+ origin, TLS 1.3 prod external, SAN + full chain, no wildcard)
  const isWildcard = input.hostname.includes("*");
  const prodTlsOk =
    !(input.environment === "prod" && input.exposure === "external") ||
    input.tlsProfile === "tls_1_3_strict";
  const certOk = input.originCertReady && input.originCertHasSanAndChain && !isWildcard && prodTlsOk;
  blockerChecks.push({
    blockerNumber: 4,
    blockerTitle: "Certificate & TLS Readiness (TLS 1.2+ Origin, Exact SAN, Full Chain)",
    status: certOk ? "PASS" : "BLOCKED",
    finding: certOk
      ? `Origin cert + full chain ready; ${input.tlsProfile} satisfies ${input.environment}/${input.exposure} baseline.`
      : isWildcard
        ? "Wildcard hostname is disallowed for managed prod certificates."
        : !prodTlsOk
          ? "External prod ingress strictly enforces tls_1_3_strict."
          : "Origin certificate is missing full intermediate chain or exact FQDN SAN.",
    remediation: certOk
      ? "Managed SSL + origin TLS validation green."
      : !prodTlsOk
        ? "Select tls_1_3_strict for external production traffic."
        : "Issue origin TLS 1.2+ cert with exact FQDN in SAN and upload full intermediate chain.",
  });

  // Blocker 5: Origin Network Allowlisting (Cloudflare IP ranges)
  const allowlistNeeded = input.exposure === "external";
  const allowlistOk = !allowlistNeeded || input.cloudflareAllowlisted;
  blockerChecks.push({
    blockerNumber: 5,
    blockerTitle: "Origin Network Allowlisting (Cloudflare IP Ranges)",
    status: allowlistOk ? "PASS" : "ACTION_REQUIRED",
    finding: !allowlistNeeded
      ? "Internal exposure exempt from external Cloudflare edge CIDR allowlist."
      : input.cloudflareAllowlisted
        ? "Origin firewall/ACL confirmed to allow documented Cloudflare edge proxy CIDRs."
        : "Origin firewall has not yet allowlisted Cloudflare edge IP ranges.",
    remediation: allowlistOk
      ? "Scoped Cloudflare CIDR posture verified."
      : "Apply the generated scoped Terraform firewall allowlist (`google_compute_firewall` Cloudflare CIDRs — never 0.0.0.0/0).",
  });

  // Blocker 6: Approval & Access Overhead (ServiceNow ticket + Admin access + Four-Eyes RBAC)
  const hasTicket = Boolean(input.ticketRef && input.ticketRef.trim().length > 0);
  const accessAndTicketOk = input.hasAdminAccess && (input.environment !== "prod" || hasTicket);
  blockerChecks.push({
    blockerNumber: 6,
    blockerTitle: "Approval Ticket & Admin Access Prerequisites",
    status: accessAndTicketOk ? "PASS" : "ACTION_REQUIRED",
    finding: accessAndTicketOk
      ? `Admin RBAC confirmed${hasTicket ? ` with ticket ${input.ticketRef}` : ""}; ServiceNow change package pre-filled.`
      : !input.hasAdminAccess
        ? "Requester lacks Admin / service-owner role needed in PRM/PCAM."
        : "Production change requires a ServiceNow change ticket reference (prefilled below).",
    remediation: accessAndTicketOk
      ? "Four-eyes reviewer sign-off required in /approvals after dry-run."
      : "Copy the auto-prefilled ServiceNow payload below and request Admin entitlement if missing (Four-Eyes RBAC preserved).",
  });

  // Blocker 7: Multi-step PCAM UI complexity
  blockerChecks.push({
    blockerNumber: 7,
    blockerTitle: "PCAM Multi-Step Validation Flow Consolidation",
    status: "PASS",
    finding:
      "Collapsed 9 manual PCAM screens (lookup, DNS, pools, steering, rules, rate limit, fail-open, attestation) into starter templates.",
    remediation: "Review or export the pre-compliant YAML, Terraform, and CLI artifacts below.",
  });

  // Blocker 8: Provisioning & Rollout Lag (hours + 20-30m DNS + 7-21d WAF log -> block)
  blockerChecks.push({
    blockerNumber: 8,
    blockerTitle: "Rollout Window & 7–21 Day WAF Log-to-Block Plan",
    status: "PASS",
    finding:
      input.exposure === "external"
        ? "Rollout Companion initialized: 1–3h provisioning, 20–30m DNS cutover, bounded 14-day (7–21d) WAF Detect tuning before Block Mode."
        : "Internal mesh rollout skips multi-week edge WAF tuning.",
    remediation: "Track DNS cutover and false-positive audit in Workflow Rollout Companion.",
  });

  // Blocker 10: Cross-system operating model (PRM, Cloudflare, Infoblox, Origin, Terraform/CLI)
  const existingOverlap = existingRoutes.some(
    (r) => r.hostname === input.hostname && r.pathPrefix === input.pathPrefix
  );
  blockerChecks.push({
    blockerNumber: 10,
    blockerTitle: "Cross-System Coordination (PRM, Cloudflare, Infoblox, Origin)",
    status: "PASS",
    finding: existingOverlap
      ? `Detected existing live route on ${input.hostname}${input.pathPrefix}; progressive canary shift recommended.`
      : "Unified control plane bridges Infoblox CNAME, Cloudflare edge WAF, origin allowlist, and GitOps/Canary execution.",
    remediation: "Submit unified workflow to keep all cross-system checks in a single audit chain.",
  });

  const hasBlocked = blockerChecks.some((b) => b.status === "BLOCKED");
  const hasActionRequired = blockerChecks.some((b) => b.status === "ACTION_REQUIRED");

  let verdict: OnboardingAssessment["verdict"] = "RECOMMENDED_INGRESS";
  let recommendedPath = "Standard Governed Ingress Control Plane (GitOps PR or Staged Canary)";

  if (hasConstrained) {
    verdict = "UNSUPPORTED_CONSTRAINT";
    recommendedPath = `Alternative Architecture Required (${constraintDetails} unsupported in current Edge Ingress)`;
  } else if (input.internalOnlyPattern) {
    verdict = "USE_IP_FILTERING";
    recommendedPath = "IP Filtering / Internal Service Mesh (Skip Edge WAF Ingress)";
  } else if (hasBlocked || hasActionRequired) {
    verdict = "FIX_PREREQUISITES";
    recommendedPath =
      "Resolve Pre-Flight Blockers First (Infoblox CNAME / Cert / Health Check / Origin Allowlist), Then Submit Ingress";
  }

  const canProceedToIngress = !hasConstrained && !hasBlocked && !input.internalOnlyPattern;

  const missingPrerequisites = blockerChecks
    .filter((b) => b.status !== "PASS")
    .map((b) => `[Blocker #${b.blockerNumber}] ${b.blockerTitle}: ${b.remediation}`);

  const riskLevel: ServiceNowPrefillPayload["riskLevel"] =
    input.environment === "prod" && (input.exposure === "external" || existingOverlap)
      ? "HIGH"
      : input.environment === "prod" || input.environment === "staging"
        ? "MEDIUM"
        : "LOW";

  const gatewayName =
    input.exposure === "external"
      ? `ext-${input.environment}-gateway`
      : `int-${input.environment}-gateway`;

  const starterTemplates = {
    httprouteYaml: renderRouteYaml({
      appName: input.appName,
      environment: input.environment,
      hostname: input.hostname,
      pathPrefix: input.pathPrefix,
      backendService: input.backendService,
      backendPort: input.backendPort,
      exposure: input.exposure,
      tlsProfile: input.tlsProfile,
      wafEnabled: input.exposure === "external",
      gatewayName,
      canaryWeight: input.environment === "prod" ? 10 : 100,
      revisionNote: "preflight-starter-template",
    }),
    terraformHcl: renderEdgeWafTerraform({
      appName: input.appName,
      environment: input.environment,
      hostname: input.hostname,
      pathPrefix: input.pathPrefix,
      exposure: input.exposure,
    }),
    originAllowlistTf: renderOriginAllowlistTerraform({
      appName: input.appName,
      environment: input.environment,
      backendPort: input.backendPort,
    }),
    cliOnboardCommand: renderPcamCliCommand(input),
    healthCheckStarterSnippet: renderHealthCheckStarterSnippet(
      hcValid ? hcPath : "/healthz",
      input.backendPort
    ),
  };

  const serviceNowPrefill = {
    shortDescription: `[Ingress Onboard] ${input.appName} (${input.environment}/${input.exposure}) -> ${input.hostname}${input.pathPrefix}`,
    category: "Network / Edge Ingress & WAF",
    assignmentGroup:
      input.exposure === "external" ? "Platform Edge NetOps & SecOps" : "Internal Service Mesh SRE",
    riskLevel,
    rbacGuardrailNote:
      "Four-Eyes Separation Enforced: Ticket automation pre-fills evidence only; requester cannot self-approve prod or HIGH risk changes.",
    implementationPlan: [
      `1. Verify Infoblox (${input.dnsProvider}) ${input.dnsRecordType.toUpperCase()} readiness for ${input.hostname}.`,
      `2. Confirm origin TLS 1.2+ cert SAN/chain and ${hcValid ? hcPath : "/healthz"} readiness on ${input.backendService}:${input.backendPort}.`,
      `3. Apply Cloudflare origin CIDR allowlist firewall rule.`,
      `4. Deploy HTTPRoute + WAF policy (7–21d Detect tuning -> Block Mode) via ${input.environment === "prod" ? "10%->50%->100% canary" : "GitOps PR"}.`,
    ].join("\n"),
    backoutPlan: `Deterministic RollbackPlan (<45s, zero LLM calls): restore prior HTTPRoute manifest or reset canary weight to 0% and verify ${hcValid ? hcPath : "/healthz"} returns HTTP 200.`,
    attestationSummary: `TLS=${input.tlsProfile} | NonWildcard=${!isWildcard} | HealthProbe=${hcValid ? hcPath : "MISSING"} | CloudflareAllowlist=${input.cloudflareAllowlisted}`,
    missingPrerequisites,
  };

  const rolloutPreview = buildRolloutCompanionPlan({
    request: {
      environment: input.environment,
      exposure: input.exposure,
      hostname: input.hostname,
      dnsRecordType: input.dnsRecordType,
    },
    status: "INTAKE",
  });

  let plainEnglishSummary =
    verdict === "RECOMMENDED_INGRESS"
      ? `All 10 adoption & prerequisite checks passed for ${input.appName} (${input.hostname}${input.pathPrefix}). You can submit directly with pre-compliant templates.`
      : verdict === "UNSUPPORTED_CONSTRAINT"
        ? `Stop before filing a ticket: ${constraintDetails} is not supported on standard Edge Ingress. Follow the recommended alternative pattern instead.`
        : verdict === "USE_IP_FILTERING"
          ? `Because ${input.appName} is internal-only, IP Filtering or Private Mesh is simpler and avoids Edge WAF/Cloudflare overhead.`
          : `Found ${missingPrerequisites.length} prerequisite gap(s) before submission. Fixing DNS CNAME, cert chain, health check, or Cloudflare allowlisting now prevents multi-day ticket delays.`;

  let poweredBy: "gemini" | "deterministic" = "deterministic";

  const ai = getOptionalGeminiClient();
  if (ai) {
    try {
      const resp = await withTimeout(
        ai.models.generateContent({
          model: "gemini-4-hydrogen",
          contents: `Summarize this Ingress onboarding pre-flight verdict concisely in 2 plain-English sentences for an application developer.
Verdict: ${verdict}
App: ${input.appName} (${input.environment}, ${input.exposure}, host=${input.hostname}${input.pathPrefix})
Missing prerequisites: ${missingPrerequisites.join(" | ") || "None"}`,
          config: {
            systemInstruction:
              "You are GuidedOnboardingAgent. Be crisp, accurate, and never suggest bypassing Four-Eyes RBAC or disabling WAF permanently.",
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        }),
        3500
      );
      const txt = (resp.text ?? "").trim();
      if (txt.length >= 20) {
        plainEnglishSummary = txt.slice(0, 420);
        poweredBy = "gemini";
      }
    } catch {
      // Retain deterministic summary cleanly if Gemini API is unavailable
    }
  }

  return {
    verdict,
    recommendedPath,
    plainEnglishSummary,
    estimatedLeadTime:
      verdict === "RECOMMENDED_INGRESS"
        ? input.exposure === "external"
          ? "1–3h provisioning + 20–30m DNS cutover (+ 7–21d WAF tuning)"
          : "15–30 min internal mesh apply"
        : "Blocked / Alternative path recommended",
    canProceedToIngress,
    blockerChecks,
    starterTemplates,
    serviceNowPrefill,
    rolloutPreview,
    poweredBy,
    evaluatedAt: now,
  };
}

export async function diagnoseWorkflowFailure(params: {
  workflow?: WorkflowRun | null;
  errorText?: string;
  logs?: string;
  configDiff?: string;
}): Promise<TroubleshootingDiagnosis> {
  const wf = params.workflow ?? null;
  const combinedSignals = [
    wf?.errorMessage ?? "",
    wf?.probeResult?.detail ?? "",
    wf?.changePlan?.policyViolations.join(" ") ?? "",
    wf?.agentTraces.map((t) => `${t.agentName}:${t.status}:${t.summary}`).join(" ") ?? "",
    params.errorText ?? "",
    params.logs ?? "",
    params.configDiff ?? "",
  ]
    .join("\n")
    .toLowerCase();

  let category: TroubleshootingCategory = "POLICY";
  let severity: TroubleshootingDiagnosis["severity"] = "MEDIUM";
  let title = "Policy or Pre-Flight Validation Failure";
  let rootCause = "One or more ingress prerequisites or corporate controls failed validation.";
  let plainEnglishExplanation =
    "The control plane blocked rollout before live traffic was impacted. Review the next steps below to resolve the blocker.";
  let nextActions: string[] = [
    "Review the Policy Matrix tab for exact control failures.",
    "Use Revise with Supervisor to patch port, path, or TLS settings and re-run dry-run checks.",
  ];
  let suggestedPatch: TroubleshootingDiagnosis["suggestedPatch"] = null;

  if (
    combinedSignals.includes("apim") ||
    combinedSignals.includes("dr pool") ||
    combinedSignals.includes("private endpoint")
  ) {
    category = "UNSUPPORTED";
    severity = "HIGH";
    title = "Unsupported / Constrained Pattern (APIM / DR Pool / Private Endpoint)";
    rootCause =
      "Requested pattern matches a constrained ingress topology not supported by standard Edge WAF Ingress.";
    plainEnglishExplanation =
      "Standard Edge WAF Ingress excludes managed APIM gateways, DR failover pools, and private endpoints. Use the dedicated pattern instead of forcing an edge route.";
    nextActions = [
      "For Managed APIM: configure routing and WAF policies directly on the APIM gateway.",
      "For DR Pools: use GSLB / regional Traffic Manager health failover.",
      "For Private Endpoints: deploy PrivateLink or internal IP Filtering.",
    ];
  } else if (
    combinedSignals.includes("toctou") ||
    combinedSignals.includes("etag") ||
    combinedSignals.includes("drift")
  ) {
    category = "DRIFT";
    severity = "HIGH";
    title = "Infrastructure Drift Detected (TOCTOU ETag Lock Triggered)";
    rootCause =
      "Out-of-band cluster or route configuration changed after human approval, rotating live_state_etag.";
    plainEnglishExplanation =
      "ExecutionAgent refused to overwrite unknown live changes. Re-planning snapshots the current cluster state and generates a fresh diff safely.";
    nextActions = [
      "Click 'Re-Plan Against Live ETag' to snapshot the updated cluster state.",
      "Inspect the refreshed YAML/HCL diff to confirm no out-of-band hotfixes are overwritten.",
      "Obtain fresh four-eyes sign-off before execution.",
    ];
  } else if (
    combinedSignals.includes("a_record") ||
    combinedSignals.includes("a record") ||
    combinedSignals.includes("infoblox") ||
    combinedSignals.includes("nxdomain") ||
    combinedSignals.includes("cname") ||
    combinedSignals.includes("dns")
  ) {
    category = "DNS";
    severity = "HIGH";
    title = "DNS Delegation / CNAME Eligibility Issue";
    rootCause =
      "Hostname uses an unsupported bare A record or DNS zone is not delegated from Infoblox / Cloud Native DNS.";
    plainEnglishExplanation =
      "Edge Ingress traffic steering requires an Infoblox-managed or delegated CNAME alias. Bare A records and external DNS zones fail edge verification.";
    nextActions = [
      "Convert the bare A record in Infoblox to a CNAME pointing to the managed edge gateway.",
      "Verify Infoblox / Cloud Native DNS delegation before re-running pre-flight.",
      "Allow 20–30 minutes for DNS TTL propagation during cutover.",
    ];
    suggestedPatch = {
      dnsRecordType: "cname",
      note: "Switch dnsRecordType to 'cname' after Infoblox update.",
    };
  } else if (
    combinedSignals.includes("tls") ||
    combinedSignals.includes("san") ||
    combinedSignals.includes("wildcard") ||
    combinedSignals.includes("cert") ||
    combinedSignals.includes("x509") ||
    combinedSignals.includes("chain")
  ) {
    category = "CERT";
    severity = "HIGH";
    title = "Certificate SAN, Chain, or TLS 1.3 Baseline Failure";
    rootCause =
      "Origin/edge TLS configuration lacks TLS 1.3 strict profile, exact FQDN SAN coverage, or full intermediate cert chain.";
    plainEnglishExplanation =
      "Production external endpoints reject TLS 1.2, wildcard certificates, and incomplete cert chains to prevent edge-to-origin handshake failures.";
    nextActions = [
      "Ensure origin presents TLS 1.2+ with full intermediate CA chain.",
      "Ensure exact FQDN matches certificate SAN/CN (no wildcards in prod).",
      "Switch ingress tlsProfile to tls_1_3_strict for external prod.",
    ];
    suggestedPatch = {
      tlsProfile: "tls_1_3_strict",
      note: "Enforce tls_1_3_strict and verify exact FQDN SAN.",
    };
  } else if (
    combinedSignals.includes("cloudflare") ||
    combinedSignals.includes("allowlist") ||
    combinedSignals.includes("timeout") ||
    combinedSignals.includes("connection refused") ||
    combinedSignals.includes("firewall") ||
    combinedSignals.includes("522")
  ) {
    category = "NETWORK";
    severity = "HIGH";
    title = "Origin Firewall / Cloudflare IP Allowlist Mismatch";
    rootCause =
      "Origin ingress firewall or NetworkPolicy is blocking Cloudflare edge proxy CIDR ranges on the backend port.";
    plainEnglishExplanation =
      "Edge proxies reach your origin from documented Cloudflare CIDR blocks. If your origin firewall drops those ranges, requests time out (HTTP 522/504).";
    nextActions = [
      "Apply the scoped Cloudflare edge CIDR firewall snippet (never open 0.0.0.0/0).",
      "Verify backend Service port matches origin listener port.",
      "Re-test origin reachability from edge health probes.",
    ];
  } else if (
    combinedSignals.includes("503") ||
    combinedSignals.includes("health") ||
    combinedSignals.includes("/healthz") ||
    combinedSignals.includes("readiness") ||
    combinedSignals.includes("probe")
  ) {
    category = "HEALTH_CHECK";
    severity = "CRITICAL";
    title = "Origin Health-Check Endpoint Failure (HTTP 503 / Probe Rollback)";
    rootCause =
      "Synthetic health-check probe failed against origin backend readiness endpoint, triggering deterministic rollback.";
    plainEnglishExplanation =
      "The ingress proxy requires a healthy HTTP 200 probe endpoint before shifting traffic. Your backend returned 503 or did not expose the probe path.";
    nextActions = [
      `Confirm backend service ${wf?.ingressRequest.backendService ?? "origin"} responds HTTP 200 on ${wf?.ingressRequest.healthCheckPath ?? "/healthz"}:${wf?.ingressRequest.backendPort ?? 8080}.`,
      "Use 'Revise with Supervisor' if backend port or health-check path differs from cluster Service.",
      "Re-run canary stage at 10% weight once origin pods pass readiness checks.",
    ];
    suggestedPatch = {
      healthCheckPath: wf?.ingressRequest.healthCheckPath ?? "/healthz",
      note: "Verify backend port and readiness probe path before re-planning.",
    };
  } else if (
    combinedSignals.includes("403") ||
    combinedSignals.includes("waf") ||
    combinedSignals.includes("false positive") ||
    combinedSignals.includes("rate limit") ||
    combinedSignals.includes("429")
  ) {
    category = "WAF";
    severity = "HIGH";
    title = "Edge WAF Rule Block or Rate-Limit False Positive";
    rootCause =
      "Legitimate application traffic matched a strict WAF signature or exceeded the baseline rate limit prior to tuning.";
    plainEnglishExplanation =
      "New external services should run WAF in Log/Detect mode for 7–21 days to tune rule exceptions before enabling Block Mode.";
    nextActions = [
      "Keep WAF in bounded Detect/Log mode during the 7–21 day tuning window.",
      "Inspect WAF rule IDs in Edge analytics and scope narrow path exceptions.",
      "Complete the False-Positive Audit milestone before promoting to WAF Block Mode.",
    ];
  }

  let poweredBy: "gemini" | "deterministic" = "deterministic";
  const ai = getOptionalGeminiClient();
  if (ai && (params.errorText || params.logs || wf?.errorMessage)) {
    try {
      const resp = await withTimeout(
        ai.models.generateContent({
          model: "gemini-4-hydrogen",
          contents: `Classify and diagnose this enterprise ingress issue cleanly.
Workflow app: ${wf?.appName ?? "standalone"} (${wf?.environment ?? "unknown"}, host=${wf?.ingressRequest.hostname ?? "unknown"})
Existing signals: ${combinedSignals.slice(0, 1200)}
Return strict JSON.`,
          config: {
            systemInstruction:
              "You are TroubleshootingAgent. Classify into DNS, CERT, NETWORK, HEALTH_CHECK, WAF, POLICY, DRIFT, or UNSUPPORTED. Give 3 concrete engineering remediation steps.",
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                category: { type: Type.STRING },
                rootCause: { type: Type.STRING },
                plainEnglishExplanation: { type: Type.STRING },
                nextActions: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ["category", "rootCause", "plainEnglishExplanation", "nextActions"],
            },
          },
        }),
        3500
      );
      const raw = (resp.text ?? "").trim();
      if (raw) {
        const parsed = JSON.parse(raw) as {
          category?: string;
          rootCause?: string;
          plainEnglishExplanation?: string;
          nextActions?: string[];
        };
        const validCats: TroubleshootingCategory[] = [
          "DNS",
          "CERT",
          "NETWORK",
          "HEALTH_CHECK",
          "WAF",
          "POLICY",
          "DRIFT",
          "UNSUPPORTED",
        ];
        if (parsed.category && validCats.includes(parsed.category as TroubleshootingCategory)) {
          category = parsed.category as TroubleshootingCategory;
        }
        if (parsed.rootCause) rootCause = parsed.rootCause.slice(0, 300);
        if (parsed.plainEnglishExplanation) {
          plainEnglishExplanation = parsed.plainEnglishExplanation.slice(0, 400);
        }
        if (Array.isArray(parsed.nextActions) && parsed.nextActions.length > 0) {
          nextActions = parsed.nextActions.slice(0, 5);
        }
        poweredBy = "gemini";
      }
    } catch {
      // Deterministic diagnosis remains intact if Gemini fails
    }
  }

  return {
    diagnosisId: crypto.randomUUID(),
    workflowId: wf?.workflowId ?? null,
    category,
    severity,
    title,
    rootCause,
    plainEnglishExplanation,
    nextActions,
    suggestedPatch,
    poweredBy,
    analyzedAt: new Date().toISOString(),
  };
}
