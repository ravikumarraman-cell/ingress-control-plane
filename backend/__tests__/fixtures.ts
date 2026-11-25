/**
 * Phase v1 Testing Framework & Fixtures
 * Comprehensive test utilities and mock data
 */

import {
  IngressRequest,
  ChangePlan,
  ApprovalDecision,
  AuditEvent,
  Workflow,
  DiffHunk,
} from '../schemas/v1-contracts';

export const mockIngressRequest = (): IngressRequest => ({
  id: crypto.randomUUID(),
  requesterEmail: 'developer@example.com',
  requestedAt: new Date(),
  description: 'Create new API ingress route for microservice',
  targetHostname: 'api-v2.example.com',
  paths: ['/users', '/orders'],
  backendEndpoints: [
    { address: '10.0.1.10', port: 8080 },
    { address: '10.0.1.11', port: 8080 },
  ],
  tlsEnabled: true,
  tlsVersion: '1.3',
  wafEnabled: true,
  environment: 'prod',
  annotations: {
    'waf-rule-set': 'OWASP-CRS-3.0',
    'rate-limit': '100-per-minute',
  },
});

export const mockDiffHunk = (): DiffHunk => ({
  filePath: 'k8s/ingress/api-v2-route.yaml',
  operation: 'CREATE',
  linesAdded: 25,
  linesRemoved: 0,
  diff: `--- /dev/null
+++ k8s/ingress/api-v2-route.yaml
@@ -0,0 +1,25 @@
+apiVersion: gateway.networking.k8s.io/v1
+kind: HTTPRoute
+metadata:
+  name: api-v2-route
+  namespace: ingress`,
  language: 'yaml',
});

export const mockChangePlan = (
  overrides?: Partial<ChangePlan>,
): ChangePlan => ({
  id: crypto.randomUUID(),
  workflowId: crypto.randomUUID(),
  createdAt: new Date(),
  targetStateEtag: 'a'.repeat(64),
  planDigestSha256: 'b'.repeat(64),
  diffs: [mockDiffHunk()],
  blastRadius: 'MEDIUM',
  estimatedDurationSeconds: 45,
  rollbackPlanDigestSha256: 'c'.repeat(64),
  riskAssessment: {
    hasHostnameCollisions: false,
    hasPathPrefixCollisions: false,
    failingHealthChecks: [],
    securityViolations: [],
  },
  ...overrides,
});

export const mockApprovalDecision = (
  overrides?: Partial<ApprovalDecision>,
): ApprovalDecision => ({
  id: crypto.randomUUID(),
  workflowId: crypto.randomUUID(),
  planId: crypto.randomUUID(),
  reviewerId: 'platform-lead@example.com',
  reviewerRole: 'platform-sre-lead',
  approved: true,
  approvedAt: new Date(),
  approvedStateEtag: 'a'.repeat(64),
  approvedPlanDigest: 'b'.repeat(64),
  signature: 'd'.repeat(64),
  rationale: 'Approved after verification of WAF rules and health checks',
  fourEyesRequirementMet: true,
  ...overrides,
});

export const mockAuditEvent = (
  overrides?: Partial<AuditEvent>,
): AuditEvent => ({
  id: crypto.randomUUID(),
  sequenceNumber: 1,
  timestamp: new Date(),
  eventType: 'WORKFLOW_CREATED',
  aggregateId: crypto.randomUUID(),
  aggregateType: 'Workflow',
  actorId: 'developer@example.com',
  actorRole: 'requester',
  action: 'create',
  resourceType: 'Workflow',
  resourceId: crypto.randomUUID(),
  details: {
    hostname: 'api-v2.example.com',
    environment: 'prod',
  },
  previousHash: '0'.repeat(64),
  currentHash: 'e'.repeat(64),
  ...overrides,
});

export const mockWorkflow = (
  overrides?: Partial<Workflow>,
): Workflow => ({
  id: crypto.randomUUID(),
  status: 'INTAKE',
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  ingressRequest: mockIngressRequest(),
  auditTrail: [],
  syntheticProbes: [],
  ...overrides,
});

export const topologyWithFixedResourceVersion = (): Record<string, unknown> => ({
  apiVersion: 'gateway.networking.k8s.io/v1',
  kind: 'HTTPRouteList',
  metadata: {
    resourceVersion: '123456',
    creationTimestamp: '2026-01-01T00:00:00Z',
  },
  items: [
    {
      metadata: {
        name: 'api-v1',
        namespace: 'ingress',
        uid: 'some-uid',
        resourceVersion: '789012',
      },
      spec: {
        hostnames: ['api-v1.example.com'],
      },
    },
  ],
});

export const assert = {
  isValidUuid(value: string): void {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(value)) {
      throw new Error(`Expected valid UUID, got: ${value}`);
    }
  },

  isValidSha256(value: string): void {
    const sha256Regex = /^[a-f0-9]{64}$/;
    if (!sha256Regex.test(value)) {
      throw new Error(`Expected valid SHA-256 hash, got: ${value}`);
    }
  },
};
