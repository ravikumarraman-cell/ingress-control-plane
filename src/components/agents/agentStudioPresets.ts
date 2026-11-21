import type {
  OutputFieldDefinition,
  ReadOnlyToolId,
  WorkflowHookStage,
} from "../../shared/contracts";

export const STAGE_OPTIONS: ReadonlyArray<{ value: WorkflowHookStage; label: string }> = [
  { value: "PRE_INTAKE", label: "PRE_INTAKE · Stage 1" },
  { value: "PHASE_A_PARALLEL", label: "PHASE_A_PARALLEL · Stage 2 (Parallel Read)" },
  { value: "PHASE_B_SEQUENTIAL", label: "PHASE_B_SEQUENTIAL · Stage 3 (Planning Chain)" },
  { value: "POST_VERIFY", label: "POST_VERIFY · Stage 4 (Post-Verify)" },
];

export interface AgentStudioPreset {
  label: string;
  name: string;
  role: string;
  hookStage: WorkflowHookStage;
  dependsOn: string[];
  taskTemplate: string;
  systemPrompt: string;
  allowedTools: ReadOnlyToolId[];
  outputSchema: OutputFieldDefinition[];
}

export const STARTER_PRESETS: ReadonlyArray<AgentStudioPreset> = [
  {
    label: "Quota & Burst Advisor",
    name: "RateLimitCheckerAgent",
    role: "Verifies gateway rate-limiting & burst quotas for external routes",
    hookStage: "PHASE_B_SEQUENTIAL",
    dependsOn: ["ImpactAgent"],
    taskTemplate:
      "Evaluate {{appName}} ({{environment}}) given Impact risk={{upstream.ImpactAgent.blastRadius}}. Recommend max RPS and burst limits.",
    systemPrompt:
      "You are a read-only Kubernetes gateway rate-limit specialist. Return structured JSON recommendations.",
    allowedTools: ["get_lb_config", "list_k8s_routes"],
    outputSchema: [
      {
        key: "recommendedRpsLimit",
        type: "number",
        description: "Steady-state requests/sec limit",
        required: true,
      },
      {
        key: "burstCap",
        type: "number",
        description: "Token-bucket burst cap",
        required: true,
      },
      {
        key: "enforcedPolicy",
        type: "boolean",
        description: "Whether rate limit is required",
        required: true,
      },
    ],
  },
  {
    label: "TLS & Cert Posture",
    name: "CertPostureAuditor",
    role: "Audits certificate SANs and TLS minimum protocol alignment",
    hookStage: "PHASE_A_PARALLEL",
    dependsOn: ["DiscoveryAgent"],
    taskTemplate:
      "Inspect TLS certificates for {{hostname}} against live route count {{upstream.DiscoveryAgent.routeCount}}.",
    systemPrompt:
      "You are a read-only TLS & PKI auditor. Verify SAN coverage and certificate expiry without cluster writes.",
    allowedTools: ["get_tls_certs", "get_dns_records"],
    outputSchema: [
      {
        key: "minTlsVersion",
        type: "string",
        description: "Minimum negotiated TLS version",
        required: true,
      },
      {
        key: "daysToExpiry",
        type: "number",
        description: "Days until certificate expiration",
        required: true,
      },
    ],
  },
  {
    label: "Canary Weight Guardrail",
    name: "CanaryWeightGuardrail",
    role: "Caps initial canary weight based on policy and blast radius",
    hookStage: "PHASE_B_SEQUENTIAL",
    dependsOn: ["ImpactAgent", "PolicyAgent"],
    taskTemplate:
      "Compute safe canary start percentage given blast radius={{upstream.ImpactAgent.blastRadius}} and policy decision={{upstream.PolicyAgent.summary.decision}}.",
    systemPrompt:
      "You are a progressive delivery specialist generating safe canary weights from upstream read-only telemetry.",
    allowedTools: ["get_lb_config", "check_route_collisions"],
    outputSchema: [
      {
        key: "safeStartPercent",
        type: "number",
        description: "Initial canary traffic weight %",
        required: true,
      },
      {
        key: "soakMinutes",
        type: "number",
        description: "Recommended soak minutes per step",
        required: true,
      },
    ],
  },
];
