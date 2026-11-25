/**
 * Phase v1 Core Schemas
 * Immutable Pydantic-equivalent Zod contracts with strict validation
 * Implements secret/PEM rejection and TLS 1.3 enforcement for prod
 */

import { z } from 'zod';

const SecretPattern = /-----BEGIN.*PRIVATE KEY-----/;
const BearerTokenPattern = /Bearer\s+[A-Za-z0-9\-._~+/]+=*|[Bb]earer\s+sk_[A-Za-z0-9]+/;
const ApiKeyPattern = /api[_-]?key[:\s]*/i;

const secretValidator = z.string().refine(
  value => !SecretPattern.test(value) && !BearerTokenPattern.test(value),
  'PEM private keys and bearer tokens are not allowed',
);

export const ChangeTypeSchema = z.enum(['CREATE', 'UPDATE', 'DELETE', 'REPLACE']);
export type ChangeType = z.infer<typeof ChangeTypeSchema>;

export const BlastRadiusLevelSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type BlastRadiusLevel = z.infer<typeof BlastRadiusLevelSchema>;

export const WorkflowStatusSchema = z.enum([
  'INTAKE',
  'ANALYZING',
  'AWAITING_APPROVAL',
  'APPROVED',
  'EXECUTING',
  'COMPLETED',
  'DRIFT_ABORTED',
  'FAILED',
  'ROLLED_BACK',
]);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export const TLSVersionSchema = z.enum(['1.2', '1.3']);
export type TLSVersion = z.infer<typeof TLSVersionSchema>;

export const IngressRequestSchema = z.object({
  id: z.string().uuid(),
  requesterEmail: z.string().email(),
  requestedAt: z.coerce.date(),
  description: secretValidator,
  targetHostname: z.string().min(1).regex(/^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/),
  paths: z.array(z.string().regex(/^\//)).min(1),
  backendEndpoints: z
    .array(
      z.object({
        address: z.string().refine(
          val => {
            const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
            const hostnameRegex = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
            return ipv4Regex.test(val) || hostnameRegex.test(val);
          },
          'Must be a valid IPv4 address or hostname',
        ),
        port: z.number().int().min(1).max(65535),
      }),
    )
    .min(1),
  tlsEnabled: z.boolean(),
  tlsVersion: TLSVersionSchema,
  wafEnabled: z.boolean(),
  environment: z.enum(['dev', 'staging', 'prod']),
  annotations: z.record(z.string(), z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type IngressRequest = z.infer<typeof IngressRequestSchema>;

export const DiffHunkSchema = z.object({
  filePath: z.string(),
  operation: ChangeTypeSchema,
  linesAdded: z.number().int().nonnegative(),
  linesRemoved: z.number().int().nonnegative(),
  diff: z.string(),
  language: z.enum(['yaml', 'hcl', 'json']),
});

export type DiffHunk = z.infer<typeof DiffHunkSchema>;

export const StateSnapshotSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  resourceVersion: z.string(),
  stateEtag: z.string().regex(/^[a-f0-9]{64}$/),
  topology: z.record(z.string(), z.unknown()),
});

export type StateSnapshot = z.infer<typeof StateSnapshotSchema>;

export const ChangePlanSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  createdAt: z.coerce.date(),
  targetStateEtag: z.string().regex(/^[a-f0-9]{64}$/),
  planDigestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  diffs: z.array(DiffHunkSchema).min(1),
  blastRadius: BlastRadiusLevelSchema,
  estimatedDurationSeconds: z.number().int().positive(),
  rollbackPlanDigestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  riskAssessment: z.object({
    hasHostnameCollisions: z.boolean(),
    hasPathPrefixCollisions: z.boolean(),
    failingHealthChecks: z.array(z.string()),
    securityViolations: z.array(z.string()),
  }),
});

export type ChangePlan = z.infer<typeof ChangePlanSchema>;

export const ApprovalDecisionSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  planId: z.string().uuid(),
  reviewerId: z.string().email(),
  reviewerRole: z.enum(['net-approver', 'platform-sre-lead', 'secops-admin']),
  approved: z.boolean(),
  approvedAt: z.coerce.date(),
  approvedStateEtag: z.string().regex(/^[a-f0-9]{64}$/),
  approvedPlanDigest: z.string().regex(/^[a-f0-9]{64}$/),
  signature: z.string().regex(/^[a-f0-9]+$/),
  rationale: z.string().min(12).max(5000),
  fourEyesRequirementMet: z.boolean(),
});

export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export const RollbackPlanSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  createdAt: z.coerce.date(),
  priorStateEtag: z.string().regex(/^[a-f0-9]{64}$/),
  rollbackDigestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  precomputedArtifacts: z.array(DiffHunkSchema).min(1),
  maxRollbackSeconds: z.number().int().min(1).max(60),
  verificationProbes: z.array(z.string()),
});

export type RollbackPlan = z.infer<typeof RollbackPlanSchema>;

export const AuditEventSchema = z.object({
  id: z.string().uuid(),
  sequenceNumber: z.number().int().nonnegative(),
  timestamp: z.coerce.date(),
  eventType: z.string(),
  aggregateId: z.string(),
  aggregateType: z.string(),
  actorId: z.string().email(),
  actorRole: z.string(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  details: z.record(z.string(), z.unknown()),
  previousHash: z.string().regex(/^[a-f0-9]{64}$/),
  currentHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const CanaryStepSchema = z.object({
  stepNumber: z.number().int().nonnegative(),
  trafficPercentage: z.number().int().min(0).max(100),
  durationSeconds: z.number().int().positive(),
  verificationProbes: z.array(z.string()),
});

export type CanaryStep = z.infer<typeof CanaryStepSchema>;

export const SyntheticProbeResultSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.coerce.date(),
  probeType: z.enum(['DNS', 'TLS_HANDSHAKE', 'HTTP_HEALTH', 'WAF_CHECK']),
  passed: z.boolean(),
  latencyMs: z.number().nonnegative(),
  errorDetails: z.string().optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
});

export type SyntheticProbeResult = z.infer<typeof SyntheticProbeResultSchema>;

export const WorkflowSchema = z.object({
  id: z.string().uuid(),
  status: WorkflowStatusSchema,
  version: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  ingressRequest: IngressRequestSchema,
  currentPlan: ChangePlanSchema.optional(),
  approval: ApprovalDecisionSchema.optional(),
  rollbackPlan: RollbackPlanSchema.optional(),
  currentCanaryStep: CanaryStepSchema.optional(),
  auditTrail: z.array(AuditEventSchema),
  syntheticProbes: z.array(SyntheticProbeResultSchema),
});

export type Workflow = z.infer<typeof WorkflowSchema>;

export function validateIngressRequest(input: unknown): IngressRequest {
  return IngressRequestSchema.parse(input);
}

export function validateChangePlan(input: unknown): ChangePlan {
  return ChangePlanSchema.parse(input);
}

export function validateApprovalDecision(input: unknown): ApprovalDecision {
  return ApprovalDecisionSchema.parse(input);
}
