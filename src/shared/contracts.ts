import { z } from "zod";

export const EnvironmentSchema = z.enum(["dev", "staging", "prod"]);
export type Environment = z.infer<typeof EnvironmentSchema>;

export const ExposureSchema = z.enum(["internal", "external"]);
export type Exposure = z.infer<typeof ExposureSchema>;

export const TlsProfileSchema = z.enum([
  "tls_1_3_strict",
  "tls_1_2_compat",
  "mtls_internal",
]);
export type TlsProfile = z.infer<typeof TlsProfileSchema>;

export const BlastRadiusScoreSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type BlastRadiusScore = z.infer<typeof BlastRadiusScoreSchema>;

export const WorkflowStatusSchema = z.enum([
  "INTAKE",
  "ANALYZING",
  "PLANNING",
  "AWAITING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "DRIFT_ABORTED",
  "EXECUTING",
  "ROLLED_BACK",
  "COMPLETED",
  "FAILED",
]);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export const ExecutionModeSchema = z.enum(["advisory_v1", "gitops_pr_v2", "direct_canary_v3"]);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /(api[_-]?key|secret|password|bearer|token)\s*[:=]\s*['"]?[A-Za-z0-9+/=_-]{16,}/i,
  /\bbearer\s+[A-Za-z0-9._+/=-]{16,}/i,
];

export function containsEmbeddedSecret(value: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

export const IngressRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    requesterId: z.string().min(3).max(128),
    ticketRef: z.string().max(64).nullable().optional(),
    appName: z
      .string()
      .regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, "Lowercase DNS-label app name required")
      .max(63),
    environment: EnvironmentSchema,
    hostname: z
      .string()
      .regex(
        /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
        "Valid FQDN hostname required"
      ),
    pathPrefix: z.string().regex(/^\/[a-zA-Z0-9/_-]*$/, "Path prefix must begin with /"),
    backendService: z
      .string()
      .regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, "Valid Kubernetes service name required"),
    backendPort: z.number().int().min(1).max(65535),
    exposure: ExposureSchema,
    tlsProfile: TlsProfileSchema,
    rawJustification: z.string().min(10).max(2000),
  })
  .superRefine((data, ctx) => {
    if (
      containsEmbeddedSecret(data.rawJustification) ||
      containsEmbeddedSecret(data.hostname) ||
      containsEmbeddedSecret(data.backendService)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Input contains prohibited secret or private key material.",
        path: ["rawJustification"],
      });
    }
    if (data.environment === "prod" && data.exposure === "external") {
      if (data.tlsProfile !== "tls_1_3_strict") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "External prod ingress strictly requires tls_1_3_strict.",
          path: ["tlsProfile"],
        });
      }
    }
  });

export type IngressRequest = z.infer<typeof IngressRequestSchema>;

export interface DiffHunk {
  filePath: string;
  resourceKind: string;
  unifiedDiff: string;
  linesAdded: number;
  linesRemoved: number;
}

export interface RollbackPlan {
  rollbackId: string;
  strategy: "gitops_revert" | "declarative_restore" | "canary_weight_zero";
  precomputedArtifacts: Record<string, string>;
  verificationProbes: string[];
  maxRollbackSeconds: number;
}

export interface PolicyControlResult {
  controlId: string;
  controlName: string;
  passed: boolean;
  severity: "INFO" | "WARN" | "BLOCK";
  detail: string;
}

export interface ChangePlan {
  planId: string;
  workflowId: string;
  targetStateEtag: string;
  blastRadius: BlastRadiusScore;
  policyChecks: PolicyControlResult[];
  policyViolations: string[];
  artifacts: Record<string, string>;
  diffs: DiffHunk[];
  dryRunPassed: boolean;
  rollbackPlan: RollbackPlan;
  planDigestSha256: string;
  createdAt: string;
}

export interface ApprovalDecision {
  decisionId: string;
  workflowId: string;
  planId: string;
  decision: "APPROVE" | "REJECT";
  reviewerId: string;
  reviewerRoles: string[];
  rationale: string;
  approvedStateEtag: string;
  approvedPlanDigest: string;
  signature: string;
  decidedAt: string;
}

export interface AuditEvent {
  seqNo: number;
  eventId: string;
  workflowId: string;
  actorId: string;
  actorType: "HUMAN" | "AGENT" | "SYSTEM";
  eventType: string;
  payload: Record<string, unknown>;
  prevEventHash: string;
  eventHash: string;
  occurredAt: string;
}

export interface ActiveIngressRoute {
  routeId: string;
  appName: string;
  environment: Environment;
  hostname: string;
  pathPrefix: string;
  backendService: string;
  backendPort: number;
  exposure: Exposure;
  tlsProfile: TlsProfile;
  wafEnabled: boolean;
  gatewayName: string;
  canaryWeight: number;
  revisionNote: string;
  updatedAt: string;
}

export interface AgentStepTrace {
  agentName: string;
  phase: "INTAKE" | "SUPERVISOR" | "PHASE_A_PARALLEL" | "PHASE_B_SEQUENTIAL" | "HITL_GATE" | "EXECUTION";
  accessMode: "NONE" | "READ_ONLY" | "STATE_CHECKPOINT" | "SCOPED_WRITE";
  status: "PENDING" | "RUNNING" | "COMPLETED" | "WAITING" | "ABORTED" | "FAILED";
  summary: string;
  durationMs?: number;
  completedAt?: string;
}

export interface CustomAgentSpec {
  agentName: string;
  instruction: string;
  accessMode: "READ_ONLY" | "NONE";
}

export type HitlPolicyMode = "always" | "prod_or_high" | "auto_low_risk";

export interface WorkflowPipelineConfig {
  hitlPolicy: HitlPolicyMode;
  enabledAgents: string[];
  customAgents: CustomAgentSpec[];
  canarySteps: number[];
  maxSupervisorIterations: number;
  customInstructions?: string;
}

export interface CanaryState {
  steps: number[];
  stageIndex: number;
  currentWeight: number;
  lastPromotedAt?: string;
}

export interface CustomPolicyRule {
  ruleId: string;
  name: string;
  description: string;
  conditionType:
    | "require_ticket"
    | "max_port"
    | "allowed_domain_suffix"
    | "enforce_waf_staging";
  value: string;
  severity: "WARN" | "BLOCK";
  enabled: boolean;
}

export interface ValidationGateResult {
  gateId: string;
  phase: "v1" | "v2" | "v3";
  name: string;
  passed: boolean;
  detail: string;
  checkedAt: string;
}

export interface WorkflowRun {
  workflowId: string;
  adkSessionId: string;
  ticketRef: string | null;
  requesterId: string;
  appName: string;
  environment: Environment;
  status: WorkflowStatus;
  executionMode: ExecutionMode;
  pipelineConfig?: WorkflowPipelineConfig;
  supervisorIteration?: number;
  canaryState?: CanaryState | null;
  ingressRequest: IngressRequest;
  currentStateEtag: string;
  blastRadius: BlastRadiusScore;
  agentTraces: AgentStepTrace[];
  changePlan: ChangePlan | null;
  approvalDecision: ApprovalDecision | null;
  gitopsPrUrl?: string | null;
  probeResult?: {
    passed: boolean;
    dnsResolved: boolean;
    tlsVerified: boolean;
    httpStatus: number;
    latencyMs: number;
    checkedAt: string;
    detail: string;
    probes?: {
      dns: string;
      tls13Alpn: string;
      httpHealth: string;
      wafEnforcement: string;
    };
  } | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OperatorIdentity {
  operatorId: string;
  displayName: string;
  roles: string[];
}

export interface ArchitectureSection {
  id: string;
  title: string;
  summary: string;
}

export interface ArchitectureDocPayload {
  title: string;
  version: string;
  updatedAt: string;
  filePath: string;
  markdown: string;
  flowchartMermaid: string;
  sequenceMermaid: string;
  implementationPlanPath: string;
  implementationPlanMarkdown: string;
  implementationProgressPath: string;
  implementationProgressMarkdown: string;
}

