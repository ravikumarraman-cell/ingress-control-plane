import {
  Cpu,
  Eye,
  FileCode2,
  GitBranch,
  Lock,
  RotateCcw,
  Search,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import type { DynamicTaskAssignment, WorkflowRun } from "../../shared/contracts";

export type AgentNodeId =
  | "intake"
  | "supervisor"
  | "discovery"
  | "policy"
  | "impact"
  | "planning"
  | "rollback"
  | "hitl"
  | "execution";

export type VisualNodeState =
  | "IDLE"
  | "ACTIVE"
  | "COMPLETED"
  | "WAITING"
  | "ABORTED"
  | "FAILED"
  | "SKIPPED";

export interface AgentGuideMeta {
  id: AgentNodeId;
  traceNames: string[];
  stepNumber: string;
  title: string;
  shortRole: string;
  stageLabel: string;
  permissionLabel: string;
  permissionDetail: string;
  plainEnglish: string;
  receives: string;
  produces: string;
  talksTo: AgentNodeId[];
  receivesFrom: AgentNodeId[];
  icon: typeof Cpu;
}

export const AGENT_GUIDES: Record<AgentNodeId, AgentGuideMeta> = {
  intake: {
    id: "intake",
    traceNames: ["IngressIntakeAgent"],
    stepNumber: "01",
    title: "IngressIntakeAgent",
    shortRole: "Understands & sanitizes your request",
    stageLabel: "Stage 1 · Intake",
    permissionLabel: "No Cluster Access",
    permissionDetail: "Runs with zero infrastructure credentials. Cannot read or write cluster state.",
    plainEnglish:
      "Takes either a structured form or plain-English description (via Gemini) and turns it into a strict, validated request. Immediately blocks any accidental API keys or private keys.",
    receives: "User prompt or structured form fields (app name, hostname, port, TLS profile).",
    produces: "Clean, validated IngressRequest JSON schema with a unique request ID.",
    receivesFrom: [],
    talksTo: ["supervisor"],
    icon: FileCode2,
  },
  supervisor: {
    id: "supervisor",
    traceNames: ["SupervisorAgent"],
    stepNumber: "02",
    title: "SupervisorAgent",
    shortRole: "Orchestrates phases & enforces safety limits",
    stageLabel: "Stage 2 · Orchestrator",
    permissionLabel: "Checkpoint State Only",
    permissionDetail: "Manages workflow state and bounded loop limits (max 5 turns). No direct kubectl write access.",
    plainEnglish:
      "Acts as the air-traffic controller. It dispatches the three read-only inspection agents in parallel, waits for all three to finish, then kicks off planning and pauses at the human approval gate.",
    receives: "Validated IngressRequest from Intake.",
    produces: "Phase A parallel dispatch, Phase B plan coordination, and durable workflow checkpoints.",
    receivesFrom: ["intake"],
    talksTo: ["discovery", "policy", "impact", "planning"],
    icon: GitBranch,
  },
  discovery: {
    id: "discovery",
    traceNames: ["DiscoveryInventoryAgent"],
    stepNumber: "03A",
    title: "DiscoveryInventoryAgent",
    shortRole: "Snapshots live routes & locks ETag",
    stageLabel: "Stage 3 · Parallel Read-Only",
    permissionLabel: "Read-Only (sa-ingress-readonly)",
    permissionDetail: "Strictly scoped read-only service account. Any write verb returns 403.",
    plainEnglish:
      "Inspects the currently running cluster routes and gateways, then computes a SHA-256 fingerprint (ETag) of the live network state so nothing can silently change behind our backs.",
    receives: "Target environment & hostname from SupervisorAgent.",
    produces: "Live route inventory snapshot + pinned target_state_etag fingerprint.",
    receivesFrom: ["supervisor"],
    talksTo: ["planning"],
    icon: Search,
  },
  policy: {
    id: "policy",
    traceNames: ["PolicyComplianceAgent"],
    stepNumber: "03B",
    title: "PolicyComplianceAgent",
    shortRole: "Checks TLS 1.3, WAF & security rules",
    stageLabel: "Stage 3 · Parallel Read-Only",
    permissionLabel: "Read-Only (sa-ingress-readonly)",
    permissionDetail: "Evaluates deterministic security policy controls without touching infrastructure.",
    plainEnglish:
      "Checks every security rule automatically: external production traffic must use strict TLS 1.3, WAF protection must be attached, IP pools must be isolated, and wildcard certs are blocked.",
    receives: "IngressRequest parameters & active policy baseline.",
    produces: "Pass/Block matrix across CTRL-TLS-13, CTRL-WAF-EXT, CTRL-POOL-ISO, and CTRL-CERT.",
    receivesFrom: ["supervisor"],
    talksTo: ["planning"],
    icon: ShieldCheck,
  },
  impact: {
    id: "impact",
    traceNames: ["ImpactAnalysisAgent"],
    stepNumber: "03C",
    title: "ImpactAnalysisAgent",
    shortRole: "Scores Blast Radius & route overlaps",
    stageLabel: "Stage 3 · Parallel Read-Only",
    permissionLabel: "Read-Only (sa-ingress-readonly)",
    permissionDetail: "Computes collision checks and risk tiering purely from read-only telemetry.",
    plainEnglish:
      "Checks if your requested domain or path overlaps with an existing live route and calculates a clear Blast Radius score (LOW, MEDIUM, or HIGH) so reviewers know the exact risk.",
    receives: "Requested host/path + live cluster route table.",
    produces: "BlastRadiusScore (LOW / MEDIUM / HIGH) & route overlap report.",
    receivesFrom: ["supervisor"],
    talksTo: ["planning"],
    icon: Eye,
  },
  planning: {
    id: "planning",
    traceNames: ["ChangePlanningAgent"],
    stepNumber: "04",
    title: "ChangePlanningAgent",
    shortRole: "Synthesizes YAML, Terraform & diffs",
    stageLabel: "Stage 4 · Sequential Plan",
    permissionLabel: "Read-Only Synthesis",
    permissionDetail: "Generates declarative Gateway API YAML & Terraform HCL artifacts in memory.",
    plainEnglish:
      "Combines the discoveries, policy results, and blast radius to build the exact Kubernetes HTTPRoute YAML, Terraform certificate config, and a line-by-line before/after diff.",
    receives: "Outputs from Discovery, Policy, and Impact agents.",
    produces: "Declarative YAML/HCL manifests + unified human-readable diffs.",
    receivesFrom: ["discovery", "policy", "impact"],
    talksTo: ["rollback"],
    icon: Cpu,
  },
  rollback: {
    id: "rollback",
    traceNames: ["ValidationRollbackAgent"],
    stepNumber: "05",
    title: "ValidationRollbackAgent",
    shortRole: "Dry-runs & seals deterministic RollbackPlan",
    stageLabel: "Stage 4 · Sequential Plan",
    permissionLabel: "Read-Only Validation",
    permissionDetail: "Validates manifests and seals cryptographic SHA-256 plan digest before approval.",
    plainEnglish:
      "Runs a dry-run validation and builds a pre-computed undo button (RollbackPlan) BEFORE any human approves. If anything goes wrong later, rollback happens in seconds with zero AI guessing.",
    receives: "Generated manifests & diffs from ChangePlanningAgent.",
    produces: "Sealed planDigestSha256 + deterministic pre-computed RollbackPlan.",
    receivesFrom: ["planning"],
    talksTo: ["hitl"],
    icon: RotateCcw,
  },
  hitl: {
    id: "hitl",
    traceNames: ["HITLApprovalGate", "ApprovalGate", "AdvisoryGate"],
    stepNumber: "06",
    title: "HITLApprovalGate",
    shortRole: "Pauses for Four-Eyes human sign-off",
    stageLabel: "Stage 5 · Human Safety Gate",
    permissionLabel: "RBAC + HMAC Signature",
    permissionDetail: "Requires an authorized reviewer different from the requester for prod or HIGH-risk changes.",
    plainEnglish:
      "Freezes the workflow in a durable checkpoint until an authorized SRE or NetOps reviewer inspects the diffs and signs a cryptographic HMAC approval token. You cannot approve your own prod request.",
    receives: "Sealed ChangePlan, diffs, policy checks, and Blast Radius.",
    produces: "Signed ApprovalDecision (APPROVE or REJECT) bound to the exact plan digest and ETag.",
    receivesFrom: ["rollback"],
    talksTo: ["execution"],
    icon: UserCheck,
  },
  execution: {
    id: "execution",
    traceNames: ["ExecutionAgent", "ExecutionRolloutAgent", "HealthProbeAgent"],
    stepNumber: "07",
    title: "ExecutionAgent",
    shortRole: "Verifies ETag, applies change & probes health",
    stageLabel: "Stage 6 · Protected Rollout",
    permissionLabel: "Gated Scoped Write",
    permissionDetail: "Write tools unlock ONLY after verifying HMAC signature + matching live cluster ETag.",
    plainEnglish:
      "Double-checks the approval signature and verifies the cluster ETag hasn't drifted since planning. Then opens a GitOps PR or rolls out a canary, runs HTTP/TLS health probes, and auto-rolls back if probes fail.",
    receives: "Signed ApprovalDecision + sealed ChangePlan + RollbackPlan.",
    produces: "Live route update or GitOps PR, synthetic probe report, or instant rollback.",
    receivesFrom: ["hitl"],
    talksTo: [],
    icon: Lock,
  },
};

export interface ReplayStepMeta {
  id: string;
  label: string;
  description: string;
  activeNodes: AgentNodeId[];
  completedNodes: AgentNodeId[];
  waitingNodes?: AgentNodeId[];
  abortedNodes?: AgentNodeId[];
  failedNodes?: AgentNodeId[];
}

export const REPLAY_STEPS: ReplayStepMeta[] = [
  {
    id: "step-1",
    label: "1. Intake & Secret Scan",
    description:
      "IngressIntakeAgent parses your request and verifies zero private keys or API secrets are embedded.",
    activeNodes: ["intake"],
    completedNodes: [],
  },
  {
    id: "step-2",
    label: "2. Supervisor Dispatch",
    description:
      "SupervisorAgent saves an initial checkpoint and fans out three read-only checks simultaneously.",
    activeNodes: ["supervisor"],
    completedNodes: ["intake"],
  },
  {
    id: "step-3",
    label: "3. Parallel Inspection (3 Agents at Once)",
    description:
      "Discovery snapshots live routes & ETag, Policy checks TLS/WAF rules, and Impact scores Blast Radius in parallel.",
    activeNodes: ["discovery", "policy", "impact"],
    completedNodes: ["intake", "supervisor"],
  },
  {
    id: "step-4",
    label: "4. Synthesize YAML/HCL Diffs",
    description:
      "ChangePlanningAgent merges all three reports into Kubernetes HTTPRoute YAML, Terraform HCL, and line diffs.",
    activeNodes: ["planning"],
    completedNodes: ["intake", "supervisor", "discovery", "policy", "impact"],
  },
  {
    id: "step-5",
    label: "5. Seal Deterministic RollbackPlan",
    description:
      "ValidationRollbackAgent dry-runs the plan, hashes the digest, and locks in an instant undo plan before approval.",
    activeNodes: ["rollback"],
    completedNodes: ["intake", "supervisor", "discovery", "policy", "impact", "planning"],
  },
  {
    id: "step-6",
    label: "6. Human-in-the-Loop Gate",
    description:
      "Execution pauses safely. A second authorized engineer reviews diffs & signs an HMAC approval token.",
    activeNodes: ["hitl"],
    completedNodes: [
      "intake",
      "supervisor",
      "discovery",
      "policy",
      "impact",
      "planning",
      "rollback",
    ],
    waitingNodes: ["hitl"],
  },
  {
    id: "step-7",
    label: "7. Anti-Drift Check & Protected Rollout",
    description:
      "ExecutionAgent confirms live ETag matches the plan, applies the change, and verifies HTTP 200 / TLS 1.3 health.",
    activeNodes: ["execution"],
    completedNodes: [
      "intake",
      "supervisor",
      "discovery",
      "policy",
      "impact",
      "planning",
      "rollback",
      "hitl",
    ],
  },
];

export const CORE_CANONICAL_NAMES = new Set([
  "IngressIntakeAgent",
  "SupervisorAgent",
  "DiscoveryInventoryAgent",
  "PolicyComplianceAgent",
  "ImpactAnalysisAgent",
  "ChangePlanningAgent",
  "ValidationRollbackAgent",
  "HITLApprovalGate",
  "ApprovalGate",
  "AdvisoryGate",
  "ExecutionAgent",
  "ExecutionRolloutAgent",
  "HealthProbeAgent",
]);

export function stateBadgeStyle(state: VisualNodeState): {
  card: string;
  labelText: string;
  labelClass: string;
  iconColor: string;
} {
  switch (state) {
    case "COMPLETED":
      return {
        card: "bg-white border-emerald-300 shadow-xs",
        labelText: "Completed",
        labelClass: "text-emerald-700",
        iconColor: "text-emerald-700",
      };
    case "ACTIVE":
      return {
        card: "bg-blue-50/70 border-blue-600 ring-2 ring-blue-600/20",
        labelText: "Active Now",
        labelClass: "text-blue-700",
        iconColor: "text-blue-700",
      };
    case "WAITING":
      return {
        card: "bg-amber-50/70 border-amber-400 ring-2 ring-amber-400/20",
        labelText: "Awaiting Human",
        labelClass: "text-amber-800",
        iconColor: "text-amber-700",
      };
    case "ABORTED":
      return {
        card: "bg-red-50/70 border-red-400",
        labelText: "Aborted (Safety)",
        labelClass: "text-red-700",
        iconColor: "text-red-700",
      };
    case "FAILED":
      return {
        card: "bg-red-50/70 border-red-400",
        labelText: "Failed",
        labelClass: "text-red-700",
        iconColor: "text-red-700",
      };
    case "SKIPPED":
      return {
        card: "bg-slate-50 border-slate-200 opacity-75",
        labelText: "Not Reached",
        labelClass: "text-slate-500",
        iconColor: "text-slate-400",
      };
    default:
      return {
        card: "bg-white border-slate-200",
        labelText: "Pending",
        labelClass: "text-slate-500",
        iconColor: "text-slate-500",
      };
  }
}

export function dynamicStatusStyles(status: DynamicTaskAssignment["status"]): {
  card: string;
  labelText: string;
  labelClass: string;
} {
  switch (status) {
    case "COMPLETED":
      return {
        card: "bg-emerald-50/40 border-emerald-300",
        labelText: "Completed",
        labelClass: "text-emerald-700",
      };
    case "RUNNING":
      return {
        card: "bg-blue-50/70 border-blue-500 ring-2 ring-blue-500/20",
        labelText: "Running",
        labelClass: "text-blue-700",
      };
    case "SKIPPED_UPSTREAM_FAILED":
      return {
        card: "bg-red-50/60 border-red-300 opacity-90",
        labelText: "Skipped (Upstream Veto)",
        labelClass: "text-red-700",
      };
    case "VETOED":
      return {
        card: "bg-red-50/70 border-red-400",
        labelText: "Vetoed",
        labelClass: "text-red-700",
      };
    default:
      return {
        card: "bg-slate-50 border-slate-200",
        labelText: "Pending",
        labelClass: "text-slate-600",
      };
  }
}

export function resolveLiveNodeStates(
  workflow: WorkflowRun | null | undefined,
  replayIndex: number | null
): Record<AgentNodeId, VisualNodeState> {
  const initial: Record<AgentNodeId, VisualNodeState> = {
    intake: "IDLE",
    supervisor: "IDLE",
    discovery: "IDLE",
    policy: "IDLE",
    impact: "IDLE",
    planning: "IDLE",
    rollback: "IDLE",
    hitl: "IDLE",
    execution: "IDLE",
  };

  if (replayIndex !== null) {
    const step = REPLAY_STEPS[replayIndex] ?? REPLAY_STEPS[0];
    for (const id of step.completedNodes) initial[id] = "COMPLETED";
    for (const id of step.activeNodes) initial[id] = "ACTIVE";
    for (const id of step.waitingNodes ?? []) initial[id] = "WAITING";
    for (const id of step.abortedNodes ?? []) initial[id] = "ABORTED";
    for (const id of step.failedNodes ?? []) initial[id] = "FAILED";
    return initial;
  }

  if (!workflow) return initial;

  const traceMap = new Map<string, WorkflowRun["agentTraces"][number]>();
  for (const tr of workflow.agentTraces) {
    traceMap.set(tr.agentName, tr);
  }

  for (const nodeId of Object.keys(AGENT_GUIDES) as AgentNodeId[]) {
    const guide = AGENT_GUIDES[nodeId];
    const matched = guide.traceNames
      .map((name) => traceMap.get(name))
      .filter((t): t is NonNullable<typeof t> => Boolean(t));

    if (matched.length > 0) {
      const latest = matched[matched.length - 1];
      if (latest.status === "COMPLETED") initial[nodeId] = "COMPLETED";
      else if (latest.status === "RUNNING") initial[nodeId] = "ACTIVE";
      else if (latest.status === "WAITING") initial[nodeId] = "WAITING";
      else if (latest.status === "ABORTED") initial[nodeId] = "ABORTED";
      else if (latest.status === "FAILED") initial[nodeId] = "FAILED";
      else initial[nodeId] = "IDLE";
    }
  }

  if (workflow.status === "AWAITING_APPROVAL") {
    for (const pre of [
      "intake",
      "supervisor",
      "discovery",
      "policy",
      "impact",
      "planning",
      "rollback",
    ] as AgentNodeId[]) {
      if (initial[pre] === "IDLE") initial[pre] = "COMPLETED";
    }
    initial.hitl = "WAITING";
    initial.execution = "IDLE";
  } else if (workflow.status === "EXECUTING") {
    for (const pre of [
      "intake",
      "supervisor",
      "discovery",
      "policy",
      "impact",
      "planning",
      "rollback",
      "hitl",
    ] as AgentNodeId[]) {
      if (initial[pre] === "IDLE") initial[pre] = "COMPLETED";
    }
    initial.execution = "ACTIVE";
  } else if (workflow.status === "COMPLETED") {
    for (const pre of [
      "intake",
      "supervisor",
      "discovery",
      "policy",
      "impact",
      "planning",
      "rollback",
      "hitl",
      "execution",
    ] as AgentNodeId[]) {
      if (initial[pre] === "IDLE") initial[pre] = "COMPLETED";
    }
  } else if (workflow.status === "DRIFT_ABORTED" || workflow.status === "ROLLED_BACK") {
    for (const pre of [
      "intake",
      "supervisor",
      "discovery",
      "policy",
      "impact",
      "planning",
      "rollback",
      "hitl",
    ] as AgentNodeId[]) {
      if (initial[pre] === "IDLE") initial[pre] = "COMPLETED";
    }
    initial.execution = "ABORTED";
  } else if (workflow.status === "REJECTED") {
    for (const pre of [
      "intake",
      "supervisor",
      "discovery",
      "policy",
      "impact",
      "planning",
      "rollback",
    ] as AgentNodeId[]) {
      if (initial[pre] === "IDLE") initial[pre] = "COMPLETED";
    }
    initial.hitl = "ABORTED";
    initial.execution = "SKIPPED";
  } else if (workflow.status === "FAILED") {
    if (initial.execution === "IDLE" && !workflow.changePlan?.dryRunPassed) {
      initial.hitl = "SKIPPED";
      initial.execution = "SKIPPED";
    }
  }

  return initial;
}
