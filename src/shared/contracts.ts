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

// Dynamic Agent Studio & Topological DAG Contracts
export const WorkflowHookStageSchema = z.enum([
  "PRE_INTAKE",
  "PHASE_A_PARALLEL",
  "PHASE_B_SEQUENTIAL",
  "POST_VERIFY",
]);
export type WorkflowHookStage = z.infer<typeof WorkflowHookStageSchema>;

export const WORKFLOW_STAGE_ORDER: Record<WorkflowHookStage, number> = {
  PRE_INTAKE: 0,
  PHASE_A_PARALLEL: 1,
  PHASE_B_SEQUENTIAL: 2,
  POST_VERIFY: 3,
};

export const ReadOnlyToolIdSchema = z.enum([
  "list_k8s_routes",
  "get_lb_config",
  "get_dns_records",
  "get_tls_certs",
  "evaluate_opa_policies",
  "check_route_collisions",
]);
export type ReadOnlyToolId = z.infer<typeof ReadOnlyToolIdSchema>;

export const READ_ONLY_TOOL_CATALOG: Array<{
  id: ReadOnlyToolId;
  label: string;
  description: string;
}> = [
  {
    id: "list_k8s_routes",
    label: "list_k8s_routes",
    description: "Inspect Gateway API HTTPRoute manifests via sa-ingress-readonly",
  },
  {
    id: "get_lb_config",
    label: "get_lb_config",
    description: "Read load balancer backend pool and canary traffic weights",
  },
  {
    id: "get_dns_records",
    label: "get_dns_records",
    description: "Inspect Cloud DNS A/AAAA/CNAME records for target hostname",
  },
  {
    id: "get_tls_certs",
    label: "get_tls_certs",
    description: "Inspect managed TLS certificates, SANs, and expiry windows",
  },
  {
    id: "evaluate_opa_policies",
    label: "evaluate_opa_policies",
    description: "Evaluate OPA / custom compliance baselines (read-only)",
  },
  {
    id: "check_route_collisions",
    label: "check_route_collisions",
    description: "Detect hostname/path overlaps against active routes",
  },
];

export const OutputFieldTypeSchema = z.enum([
  "string",
  "number",
  "boolean",
  "string[]",
  "object",
]);
export type OutputFieldType = z.infer<typeof OutputFieldTypeSchema>;

export const OutputFieldDefinitionSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z][a-zA-Z0-9]{0,63}$/, "Output field key must be camelCase identifier"),
  type: OutputFieldTypeSchema,
  description: z.string().min(2).max(240),
  required: z.boolean().default(true),
});
export type OutputFieldDefinition = z.infer<typeof OutputFieldDefinitionSchema>;

export const RiskDeltaSchema = z.enum(["NONE", "ELEVATE_MEDIUM", "ELEVATE_HIGH"]);
export type RiskDelta = z.infer<typeof RiskDeltaSchema>;

export const AgentStructuredOutputSchema = z.object({
  summary: z.string().min(1).max(600),
  data: z.record(z.string(), z.unknown()),
  riskDelta: RiskDeltaSchema.default("NONE"),
  vetoTriggered: z.boolean().default(false),
  confidence: z.number().min(0).max(1),
});
export type AgentStructuredOutput = z.infer<typeof AgentStructuredOutputSchema>;

export const DynamicAgentTriggerConditionSchema = z.object({
  environments: z.array(EnvironmentSchema).optional(),
  exposures: z.array(ExposureSchema).optional(),
  alwaysActive: z.boolean().optional(),
});
export type DynamicAgentTriggerCondition = z.infer<typeof DynamicAgentTriggerConditionSchema>;

export const DynamicAgentBlueprintSchema = z.object({
  agentId: z.string().uuid(),
  name: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_-]{1,62}$/, "Agent name must be alphanumeric/slug (2-63 chars)"),
  role: z.string().min(2).max(120),
  systemPrompt: z.string().min(4).max(1000),
  taskTemplate: z.string().min(4).max(2000),
  hookStage: WorkflowHookStageSchema,
  dependsOn: z.array(z.string().min(1)).default([]),
  outputSchema: z.array(OutputFieldDefinitionSchema).default([]),
  allowedTools: z.array(ReadOnlyToolIdSchema).default([]),
  triggerCondition: DynamicAgentTriggerConditionSchema.default({ alwaysActive: true }),
  canForceApproval: z.boolean().default(false),
  spawnedBy: z.enum(["OPERATOR", "SUPERVISOR"]).default("OPERATOR"),
  enabled: z.boolean().default(true),
  createdAt: z.string(),
});
export type DynamicAgentBlueprint = z.infer<typeof DynamicAgentBlueprintSchema>;

export const CreateDynamicAgentBlueprintInputSchema = z.object({
  name: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_-]{1,62}$/, "Agent name must be alphanumeric/slug (2-63 chars)"),
  role: z.string().min(2).max(120),
  systemPrompt: z.string().min(4).max(1000),
  taskTemplate: z.string().min(4).max(2000),
  hookStage: WorkflowHookStageSchema,
  dependsOn: z.array(z.string().min(1)).default([]),
  outputSchema: z.array(OutputFieldDefinitionSchema).default([]),
  allowedTools: z.array(z.string().min(1)).default([]),
  serviceAccount: z.string().optional(),
  triggerCondition: DynamicAgentTriggerConditionSchema.optional(),
  canForceApproval: z.boolean().optional(),
  spawnedBy: z.enum(["OPERATOR", "SUPERVISOR"]).optional(),
  enabled: z.boolean().optional(),
});
export type CreateDynamicAgentBlueprintInput = z.infer<typeof CreateDynamicAgentBlueprintInputSchema>;

export const DynamicTaskAssignmentStatusSchema = z.enum([
  "QUEUED",
  "WAITING_ON_DEPS",
  "RUNNING",
  "COMPLETED",
  "SKIPPED_UPSTREAM_FAILED",
  "VETOED",
]);
export type DynamicTaskAssignmentStatus = z.infer<typeof DynamicTaskAssignmentStatusSchema>;

export interface DynamicTaskAssignment {
  taskId: string;
  agentId: string;
  agentName: string;
  hookStage: WorkflowHookStage;
  dependsOn: string[];
  resolvedTaskPrompt: string;
  status: DynamicTaskAssignmentStatus;
  structuredOutput: AgentStructuredOutput | null;
  consumedInputs: Record<string, unknown>;
  executedAt?: string;
  auditEventHash?: string;
  durationMs?: number;
}

export const CORE_AGENT_STAGE_MAP: Record<string, WorkflowHookStage> = {
  IngressIntakeAgent: "PRE_INTAKE",
  SupervisorAgent: "PRE_INTAKE",
  DiscoveryAgent: "PHASE_A_PARALLEL",
  DiscoveryInventoryAgent: "PHASE_A_PARALLEL",
  PolicyAgent: "PHASE_A_PARALLEL",
  PolicyComplianceAgent: "PHASE_A_PARALLEL",
  ImpactAgent: "PHASE_A_PARALLEL",
  ImpactAnalysisAgent: "PHASE_A_PARALLEL",
  CostEstimationAgent: "PHASE_A_PARALLEL",
  SecurityPostureAgent: "PHASE_A_PARALLEL",
  ChangePlanAgent: "PHASE_B_SEQUENTIAL",
  ChangePlanningAgent: "PHASE_B_SEQUENTIAL",
  ValidationRollbackAgent: "PHASE_B_SEQUENTIAL",
  VerifyAgent: "POST_VERIFY",
  ExecutionAgent: "POST_VERIFY",
  HealthProbeAgent: "POST_VERIFY",
};

export const CORE_AGENT_OUTPUT_FIELDS: Array<{
  agentName: string;
  stage: WorkflowHookStage;
  fields: Array<{ key: string; type: OutputFieldType; description: string }>;
}> = [
  {
    agentName: "IngressIntakeAgent",
    stage: "PRE_INTAKE",
    fields: [
      { key: "appName", type: "string", description: "Validated application slug" },
      { key: "environment", type: "string", description: "Target environment (dev/staging/prod)" },
      { key: "hostname", type: "string", description: "Validated FQDN hostname" },
      { key: "exposure", type: "string", description: "Exposure tier (internal/external)" },
    ],
  },
  {
    agentName: "DiscoveryAgent",
    stage: "PHASE_A_PARALLEL",
    fields: [
      { key: "liveEtag", type: "string", description: "Pinned cluster state SHA-256 ETag" },
      { key: "routeCount", type: "number", description: "Total active routes snapshotted" },
      { key: "collidingRouteId", type: "string", description: "Matching route ID if updating" },
    ],
  },
  {
    agentName: "PolicyAgent",
    stage: "PHASE_A_PARALLEL",
    fields: [
      { key: "passedCount", type: "number", description: "Number of passing policy controls" },
      { key: "totalCount", type: "number", description: "Total evaluated controls" },
      { key: "violations", type: "string[]", description: "List of blocking policy violations" },
      { key: "summary", type: "object", description: "Nested policy decision object (summary.decision)" },
    ],
  },
  {
    agentName: "ImpactAgent",
    stage: "PHASE_A_PARALLEL",
    fields: [
      { key: "blastRadius", type: "string", description: "Computed BlastRadiusScore (LOW/MEDIUM/HIGH)" },
      { key: "collidingRouteId", type: "string", description: "Impacted live route ID" },
      { key: "hasCollision", type: "boolean", description: "Whether host/path overlaps live traffic" },
    ],
  },
  {
    agentName: "ChangePlanAgent",
    stage: "PHASE_B_SEQUENTIAL",
    fields: [
      { key: "planId", type: "string", description: "Sealed ChangePlan UUID" },
      { key: "planDigestSha256", type: "string", description: "Canonical SHA-256 plan digest" },
      { key: "dryRunPassed", type: "boolean", description: "Dry-run validation result" },
    ],
  },
];

export const MAX_DYNAMIC_AGENTS_PER_WORKFLOW = 4;

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
  phase:
    | "INTAKE"
    | "SUPERVISOR"
    | "PHASE_A_PARALLEL"
    | "PHASE_B_SEQUENTIAL"
    | "HITL_GATE"
    | "EXECUTION";
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
  dynamicTaskAssignments?: DynamicTaskAssignment[];
  spawnedAgents?: DynamicAgentBlueprint[];
  sharedContextBus?: Record<string, AgentStructuredOutput>;
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
  adoptionMermaid?: string;
  implementationPlanPath: string;
  implementationPlanMarkdown: string;
  implementationProgressPath: string;
  implementationProgressMarkdown: string;
}
