import type {
  ActiveIngressRoute,
  ArchitectureDocPayload,
  AuditEvent,
  ConstrainedUseCase,
  CreateDynamicAgentBlueprintInput,
  CustomPolicyRule,
  DnsProvider,
  DnsRecordType,
  DynamicAgentBlueprint,
  ExecutionMode,
  OnboardingAssessment,
  OnboardingAssessmentInput,
  OperatorIdentity,
  OutputFieldDefinition,
  ReadOnlyToolId,
  RolloutMilestone,
  TroubleshootingDiagnosis,
  ValidationGateResult,
  WorkflowHookStage,
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
        dnsProvider?: DnsProvider;
        dnsRecordType?: DnsRecordType;
        healthCheckPath?: string;
        originCertReady?: boolean;
        cloudflareAllowlisted?: boolean;
        useCaseFlags?: ConstrainedUseCase[];
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

export interface AgentBlueprintsResponse {
  blueprints: DynamicAgentBlueprint[];
  coreAgentCatalog: {
    stages: Record<string, WorkflowHookStage>;
    outputs: Array<{
      agentName: string;
      stage: WorkflowHookStage;
      fields: Array<{ key: string; type: OutputFieldDefinition["type"]; description: string }>;
    }>;
  };
  readOnlyToolCatalog: Array<{
    id: ReadOnlyToolId;
    label: string;
    description: string;
  }>;
}

export async function fetchAgentBlueprints(): Promise<AgentBlueprintsResponse> {
  const res = await fetch("/api/v1/agents/blueprints", { headers: buildHeaders() });
  return handleJson(res);
}

export async function createAgentBlueprint(
  body: CreateDynamicAgentBlueprintInput
): Promise<{ blueprint: DynamicAgentBlueprint; blueprints: DynamicAgentBlueprint[] }> {
  const res = await fetch("/api/v1/agents/blueprints", {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(body),
  });
  return handleJson(res);
}

export async function updateAgentBlueprint(
  agentId: string,
  patch: Partial<DynamicAgentBlueprint>
): Promise<{ blueprint: DynamicAgentBlueprint; blueprints: DynamicAgentBlueprint[] }> {
  const res = await fetch(`/api/v1/agents/blueprints/${encodeURIComponent(agentId)}`, {
    method: "PATCH",
    headers: buildHeaders(),
    body: JSON.stringify(patch),
  });
  return handleJson(res);
}

export async function deleteAgentBlueprint(
  agentId: string
): Promise<{ deletedAgentId: string; blueprints: DynamicAgentBlueprint[] }> {
  const res = await fetch(`/api/v1/agents/blueprints/${encodeURIComponent(agentId)}`, {
    method: "DELETE",
    headers: buildHeaders(),
  });
  return handleJson(res);
}

export async function assignAgentToWorkflow(params: {
  workflowId: string;
  blueprintId?: string;
  adHocBlueprint?: CreateDynamicAgentBlueprintInput;
  saveToRoster?: boolean;
}): Promise<{ liveStateEtag: string; workflow: WorkflowRun }> {
  const res = await fetch(
    `/api/v1/workflows/${encodeURIComponent(params.workflowId)}/assign-agent`,
    {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        blueprintId: params.blueprintId,
        adHocBlueprint: params.adHocBlueprint,
        saveToRoster: Boolean(params.saveToRoster),
      }),
    }
  );
  return handleJson(res);
}

export async function assessOnboarding(
  input: OnboardingAssessmentInput
): Promise<{ assessment: OnboardingAssessment }> {
  const res = await fetch("/api/v1/onboarding/assess", {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(input),
  });
  return handleJson(res);
}

export async function troubleshootWorkflow(params: {
  workflowId: string;
  errorText?: string;
  logs?: string;
  configDiff?: string;
}): Promise<{ diagnosis: TroubleshootingDiagnosis }> {
  const res = await fetch(
    `/api/v1/workflows/${encodeURIComponent(params.workflowId)}/troubleshoot`,
    {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        errorText: params.errorText,
        logs: params.logs,
        configDiff: params.configDiff,
      }),
    }
  );
  return handleJson(res);
}

export async function troubleshootStandalone(params: {
  errorText?: string;
  logs?: string;
  configDiff?: string;
}): Promise<{ diagnosis: TroubleshootingDiagnosis }> {
  const res = await fetch("/api/v1/troubleshoot", {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(params),
  });
  return handleJson(res);
}

export async function updateRolloutStep(params: {
  workflowId: string;
  stepId: RolloutMilestone["stepId"];
  status: "ACTIVE" | "COMPLETED";
}): Promise<{ liveStateEtag: string; workflow: WorkflowRun }> {
  const res = await fetch(
    `/api/v1/workflows/${encodeURIComponent(params.workflowId)}/rollout-step`,
    {
      method: "PATCH",
      headers: buildHeaders(),
      body: JSON.stringify({ stepId: params.stepId, status: params.status }),
    }
  );
  return handleJson(res);
}
