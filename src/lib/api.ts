import type {
  ActiveIngressRoute,
  ArchitectureDocPayload,
  AuditEvent,
  CustomPolicyRule,
  ExecutionMode,
  OperatorIdentity,
  ValidationGateResult,
  WorkflowPipelineConfig,
  WorkflowRun,
} from "../shared/contracts";

export const OPERATOR_PERSONAS: OperatorIdentity[] = [
  {
    operatorId: "ravikumar.raman@gmail.com",
    displayName: "Ravi Raman",
    roles: ["net-approver", "platform-sre-lead"],
  },
  {
    operatorId: "maya.lin@corp.example.com",
    displayName: "Maya Lin",
    roles: ["service-owner"],
  },
  {
    operatorId: "secops.auditor@corp.example.com",
    displayName: "Alex Rivera",
    roles: ["secops-admin", "net-approver"],
  },
];

let currentOperator: OperatorIdentity = OPERATOR_PERSONAS[0];

export function getCurrentOperator(): OperatorIdentity {
  return currentOperator;
}

export function setCurrentOperator(op: OperatorIdentity): void {
  currentOperator = op;
}

function buildHeaders(extra?: Record<string, string>): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-operator-id": currentOperator.operatorId,
    "x-operator-roles": currentOperator.roles.join(","),
    ...extra,
  };
}

async function handleJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof data?.error === "string" && data.error.length > 0
        ? data.error
        : `Request failed with HTTP ${res.status}`;
    const err = new Error(msg) as Error & { status?: number; payload?: unknown };
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data as T;
}

export async function fetchRoutes(): Promise<{
  liveStateEtag: string;
  driftCounter: number;
  routes: ActiveIngressRoute[];
}> {
  const res = await fetch("/api/v1/routes", { headers: buildHeaders() });
  return handleJson(res);
}

export async function simulateInfraDrift(): Promise<{
  liveStateEtag: string;
  driftCounter: number;
}> {
  const res = await fetch("/api/v1/infra/simulate-drift", {
    method: "POST",
    headers: buildHeaders(),
  });
  return handleJson(res);
}

export async function fetchWorkflows(): Promise<{
  liveStateEtag: string;
  workflows: WorkflowRun[];
}> {
  const res = await fetch("/api/v1/workflows", { headers: buildHeaders() });
  return handleJson(res);
}

export async function fetchWorkflowById(workflowId: string): Promise<{
  liveStateEtag: string;
  workflow: WorkflowRun;
}> {
  const res = await fetch(`/api/v1/workflows/${encodeURIComponent(workflowId)}`, {
    headers: buildHeaders(),
  });
  return handleJson(res);
}

export type CreateWorkflowInput =
  | {
      intakeMode: "ai";
      naturalLanguagePrompt: string;
      ticketRef?: string | null;
      executionMode: ExecutionMode;
      pipelineConfig?: Partial<WorkflowPipelineConfig>;
    }
  | {
      intakeMode: "structured";
      executionMode: ExecutionMode;
      pipelineConfig?: Partial<WorkflowPipelineConfig>;
      request: {
        ticketRef?: string | null;
        appName: string;
        environment: "dev" | "staging" | "prod";
        hostname: string;
        pathPrefix: string;
        backendService: string;
        backendPort: number;
        exposure: "internal" | "external";
        tlsProfile: "tls_1_3_strict" | "tls_1_2_compat" | "mtls_internal";
        rawJustification: string;
      };
    };

export async function createWorkflow(
  body: CreateWorkflowInput
): Promise<{ liveStateEtag: string; workflow: WorkflowRun }> {
  const res = await fetch("/api/v1/workflows", {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(body),
  });
  return handleJson(res);
}

export async function replanWorkflow(
  workflowId: string
): Promise<{ liveStateEtag: string; workflow: WorkflowRun }> {
  const res = await fetch(`/api/v1/workflows/${encodeURIComponent(workflowId)}/replan`, {
    method: "POST",
    headers: buildHeaders(),
  });
  return handleJson(res);
}

export async function submitWorkflowDecision(params: {
  workflowId: string;
  decision: "APPROVE" | "REJECT";
  rationale: string;
  simulateProbeFailure?: boolean;
}): Promise<{ liveStateEtag: string; workflow: WorkflowRun }> {
  const res = await fetch(
    `/api/v1/workflows/${encodeURIComponent(params.workflowId)}/decision`,
    {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        decision: params.decision,
        rationale: params.rationale,
        simulateProbeFailure: Boolean(params.simulateProbeFailure),
      }),
    }
  );
  return handleJson(res);
}

export async function fetchAuditLog(): Promise<{
  events: AuditEvent[];
  verification: { valid: boolean; checkedCount: number; brokenAtSeq: number | null };
}> {
  const res = await fetch("/api/v1/audit-log", { headers: buildHeaders() });
  return handleJson(res);
}

export async function verifyAuditLog(): Promise<{
  valid: boolean;
  checkedCount: number;
  brokenAtSeq: number | null;
}> {
  const res = await fetch("/api/v1/audit-log/verify", { headers: buildHeaders() });
  return handleJson(res);
}

export async function fetchArchitectureDoc(): Promise<ArchitectureDocPayload> {
  const res = await fetch("/api/v1/architecture", { headers: buildHeaders() });
  return handleJson(res);
}

export async function saveArchitectureDoc(markdown: string): Promise<ArchitectureDocPayload> {
  const res = await fetch("/api/v1/architecture", {
    method: "PUT",
    headers: buildHeaders(),
    body: JSON.stringify({ markdown }),
  });
  return handleJson(res);
}

export async function saveImplementationPlan(markdown: string): Promise<ArchitectureDocPayload> {
  const res = await fetch("/api/v1/implementation-plan", {
    method: "PUT",
    headers: buildHeaders(),
    body: JSON.stringify({ markdown }),
  });
  return handleJson(res);
}

export async function saveImplementationProgress(
  markdown: string
): Promise<ArchitectureDocPayload> {
  const res = await fetch("/api/v1/implementation-progress", {
    method: "PUT",
    headers: buildHeaders(),
    body: JSON.stringify({ markdown }),
  });
  return handleJson(res);
}

export async function reviseWorkflow(params: {
  workflowId: string;
  feedbackInstruction: string;
  pipelineConfig?: Partial<WorkflowPipelineConfig>;
  patchRequest?: {
    backendPort?: number;
    backendService?: string;
    tlsProfile?: "tls_1_3_strict" | "tls_1_2_compat" | "mtls_internal";
    pathPrefix?: string;
  };
}): Promise<{ liveStateEtag: string; workflow: WorkflowRun }> {
  const res = await fetch(
    `/api/v1/workflows/${encodeURIComponent(params.workflowId)}/revise`,
    {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        feedbackInstruction: params.feedbackInstruction,
        pipelineConfig: params.pipelineConfig,
        patchRequest: params.patchRequest,
      }),
    }
  );
  return handleJson(res);
}

export async function promoteCanary(params: {
  workflowId: string;
  simulateProbeFailure?: boolean;
}): Promise<{ liveStateEtag: string; workflow: WorkflowRun }> {
  const res = await fetch(
    `/api/v1/workflows/${encodeURIComponent(params.workflowId)}/canary/promote`,
    {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ simulateProbeFailure: Boolean(params.simulateProbeFailure) }),
    }
  );
  return handleJson(res);
}

export async function triggerManualRollback(params: {
  workflowId: string;
  reason: string;
}): Promise<{ liveStateEtag: string; workflow: WorkflowRun }> {
  const res = await fetch(
    `/api/v1/workflows/${encodeURIComponent(params.workflowId)}/rollback`,
    {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ reason: params.reason }),
    }
  );
  return handleJson(res);
}

export async function fetchPolicies(): Promise<{ rules: CustomPolicyRule[] }> {
  const res = await fetch("/api/v1/policies", { headers: buildHeaders() });
  return handleJson(res);
}

export async function createPolicy(body: {
  name: string;
  description: string;
  conditionType: CustomPolicyRule["conditionType"];
  value: string;
  severity: "WARN" | "BLOCK";
}): Promise<{ rule: CustomPolicyRule; rules: CustomPolicyRule[] }> {
  const res = await fetch("/api/v1/policies", {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(body),
  });
  return handleJson(res);
}

export async function togglePolicy(
  ruleId: string,
  enabled: boolean
): Promise<{ rule: CustomPolicyRule; rules: CustomPolicyRule[] }> {
  const res = await fetch(`/api/v1/policies/${encodeURIComponent(ruleId)}`, {
    method: "PATCH",
    headers: buildHeaders(),
    body: JSON.stringify({ enabled }),
  });
  return handleJson(res);
}

export async function deletePolicy(ruleId: string): Promise<{ rules: CustomPolicyRule[] }> {
  const res = await fetch(`/api/v1/policies/${encodeURIComponent(ruleId)}`, {
    method: "DELETE",
    headers: buildHeaders(),
  });
  return handleJson(res);
}

export async function runValidationSuite(): Promise<{ results: ValidationGateResult[] }> {
  const res = await fetch("/api/v1/validation/run", {
    method: "POST",
    headers: buildHeaders(),
  });
  return handleJson(res);
}
