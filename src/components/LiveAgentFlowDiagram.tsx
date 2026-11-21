import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  Eye,
  FileCode2,
  GitBranch,
  Lock,
  Pause,
  Play,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  SkipBack,
  SkipForward,
  UserCheck,
  XCircle,
} from "lucide-react";
import type { WorkflowRun } from "../shared/contracts";

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

interface AgentGuideMeta {
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

const AGENT_GUIDES: Record<AgentNodeId, AgentGuideMeta> = {
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

const REPLAY_STEPS: Array<{
  id: string;
  label: string;
  description: string;
  activeNodes: AgentNodeId[];
  completedNodes: AgentNodeId[];
  waitingNodes?: AgentNodeId[];
  abortedNodes?: AgentNodeId[];
  failedNodes?: AgentNodeId[];
}> = [
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

function stateBadgeStyle(state: VisualNodeState): {
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

function StateIcon({ state }: { state: VisualNodeState }) {
  switch (state) {
    case "COMPLETED":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 shrink-0" />;
    case "ACTIVE":
      return <Clock className="h-3.5 w-3.5 text-blue-700 shrink-0" />;
    case "WAITING":
      return <Lock className="h-3.5 w-3.5 text-amber-700 shrink-0" />;
    case "ABORTED":
      return <ShieldAlert className="h-3.5 w-3.5 text-red-700 shrink-0" />;
    case "FAILED":
      return <XCircle className="h-3.5 w-3.5 text-red-700 shrink-0" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />;
  }
}

function resolveLiveNodeStates(
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

  // Map traces onto our 9 diagram nodes
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

  // Fill sensible defaults when inspecting seeded workflows with partial traces
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

export interface LiveAgentFlowDiagramProps {
  workflow?: WorkflowRun | null;
  liveEtag?: string;
  streamConnected?: boolean;
  compact?: boolean;
}

export function LiveAgentFlowDiagram({
  workflow,
  liveEtag,
  streamConnected = true,
  compact = false,
}: LiveAgentFlowDiagramProps) {
  const [selectedAgentId, setSelectedAgentId] = useState<AgentNodeId>("supervisor");
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // Auto-select the most relevant agent when workflow status updates live via SSE
  useEffect(() => {
    if (replayIndex !== null) return;
    if (!workflow) return;
    if (workflow.status === "AWAITING_APPROVAL") setSelectedAgentId("hitl");
    else if (
      workflow.status === "EXECUTING" ||
      workflow.status === "COMPLETED" ||
      workflow.status === "DRIFT_ABORTED" ||
      workflow.status === "ROLLED_BACK"
    ) {
      setSelectedAgentId("execution");
    } else if (workflow.status === "FAILED") {
      setSelectedAgentId("rollback");
    }
  }, [workflow?.workflowId, workflow?.status, replayIndex]);

  // Step-by-step live replay timer
  useEffect(() => {
    if (!isPlaying) return;
    if (replayIndex === null) {
      setReplayIndex(0);
      return;
    }
    if (replayIndex >= REPLAY_STEPS.length - 1) {
      const doneTimer = setTimeout(() => setIsPlaying(false), 1800);
      return () => clearTimeout(doneTimer);
    }
    const timer = setTimeout(() => {
      setReplayIndex((prev) => (prev === null ? 0 : Math.min(prev + 1, REPLAY_STEPS.length - 1)));
    }, 1700);
    return () => clearTimeout(timer);
  }, [isPlaying, replayIndex]);

  const nodeStates = useMemo(
    () => resolveLiveNodeStates(workflow, replayIndex),
    [workflow, replayIndex]
  );

  // Focus inspector on active node while replaying
  useEffect(() => {
    if (replayIndex === null) return;
    const step = REPLAY_STEPS[replayIndex];
    if (step && step.activeNodes.length > 0) {
      setSelectedAgentId(step.activeNodes[0]);
    }
  }, [replayIndex]);

  const selectedGuide = AGENT_GUIDES[selectedAgentId];

  const matchingTrace = useMemo(() => {
    if (!workflow) return null;
    const traces = workflow.agentTraces.filter((tr) =>
      selectedGuide.traceNames.includes(tr.agentName)
    );
    return traces.length > 0 ? traces[traces.length - 1] : null;
  }, [workflow, selectedGuide]);

  const handleTogglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      if (replayIndex === null || replayIndex >= REPLAY_STEPS.length - 1) {
        setReplayIndex(0);
      }
      setIsPlaying(true);
    }
  };

  const handleExitReplay = () => {
    setIsPlaying(false);
    setReplayIndex(null);
  };

  const renderAgentCard = (id: AgentNodeId) => {
    const meta = AGENT_GUIDES[id];
    const state = nodeStates[id];
    const styles = stateBadgeStyle(state);
    const isSelected = selectedAgentId === id;
    const Icon = meta.icon;
    const trace = workflow?.agentTraces.find((t) => meta.traceNames.includes(t.agentName));

    return (
      <button
        key={id}
        type="button"
        onClick={() => setSelectedAgentId(id)}
        aria-pressed={isSelected}
        className={`w-full text-left rounded-lg border p-3.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
          styles.card
        } ${
          isSelected
            ? "ring-2 ring-blue-700 border-blue-700 shadow-sm"
            : "hover:border-slate-400"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-7 w-7 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
              <Icon className={`h-3.5 w-3.5 ${styles.iconColor}`} />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-mono text-slate-500">
                Step {meta.stepNumber}
              </div>
              <div className="text-xs font-semibold text-slate-900 truncate">
                {meta.title}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <StateIcon state={state} />
          </div>
        </div>

        <p className="text-xs text-slate-600 mt-2 leading-snug">{meta.shortRole}</p>

        <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-[11px]">
          <span className={`font-medium ${styles.labelClass}`}>{styles.labelText}</span>
          <span className="font-mono tabular-nums text-slate-500 truncate">
            {trace?.durationMs ? `${trace.durationMs}ms` : meta.permissionLabel.split(" ")[0]}
          </span>
        </div>
      </button>
    );
  };

  const activeReplayStep = replayIndex !== null ? REPLAY_STEPS[replayIndex] : null;
  const targetEtag = workflow?.changePlan?.targetStateEtag ?? workflow?.currentStateEtag;
  const hasDrift = Boolean(liveEtag && targetEtag && liveEtag !== targetEtag);

  return (
    <div className="space-y-4">
      {/* Interactive Control Strip */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-medium text-slate-800">
              {replayIndex !== null ? "Interactive Step Walkthrough" : "Real-Time Live Mode"}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {streamConnected ? "Live SSE Connected" : "Reconnecting Stream"}
            </span>
            {workflow && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-slate-700">
                  {workflow.appName} ({workflow.environment})
                </span>
              </>
            )}
          </div>
          <p className="text-xs text-slate-600">
            {activeReplayStep
              ? activeReplayStep.description
              : "Click any agent node below to see what it receives, what it checks, and who it talks to next."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleTogglePlay}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 transition-colors whitespace-nowrap"
          >
            {isPlaying ? (
              <>
                <Pause className="h-3.5 w-3.5" />
                Pause Walkthrough
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                {replayIndex !== null ? "Resume Walkthrough" : "Walk Through Step-by-Step"}
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setIsPlaying(false);
              setReplayIndex((prev) => (prev === null ? 0 : Math.max(0, prev - 1)));
            }}
            className="p-1.5 text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
            aria-label="Previous step"
            title="Previous step"
          >
            <SkipBack className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => {
              setIsPlaying(false);
              setReplayIndex((prev) =>
                prev === null ? 0 : Math.min(REPLAY_STEPS.length - 1, prev + 1)
              );
            }}
            className="p-1.5 text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
            aria-label="Next step"
            title="Next step"
          >
            <SkipForward className="h-3.5 w-3.5" />
          </button>

          {replayIndex !== null && (
            <button
              type="button"
              onClick={handleExitReplay}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              Return to Live State
            </button>
          )}
        </div>
      </div>

      {/* Walkthrough Step Progress Strip when active */}
      {replayIndex !== null && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {REPLAY_STEPS.map((step, idx) => {
            const active = idx === replayIndex;
            const passed = idx < replayIndex;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  setReplayIndex(idx);
                }}
                className={`text-left px-3 py-2 rounded-md border text-xs transition-colors ${
                  active
                    ? "bg-blue-700 border-blue-700 text-white font-medium"
                    : passed
                      ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                <div className="truncate">{step.label}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* Drift Warning inside Live Diagram */}
      {replayIndex === null && hasDrift && workflow?.status === "AWAITING_APPROVAL" && (
        <div className="flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-900">
          <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Live Drift Detected Between Planning & Approval:</span>{" "}
            The cluster ETag changed out-of-band. When{" "}
            <span className="font-mono">ExecutionAgent</span> verifies the lock, it will safely abort
            with <span className="font-mono">DRIFT_ABORTED</span> instead of overwriting newer
            changes.
          </div>
        </div>
      )}

      {/* Main Split: Interactive Multi-Agent Graph + Plain-English Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Topology Canvas */}
        <div className="xl:col-span-8 bg-white border border-slate-200 rounded-lg p-5 space-y-5 overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Multi-Agent Coordination Topology
              </h2>
              <p className="text-xs text-slate-500">
                Intake → Orchestrator → 3 Parallel Checks → Sequential Planning → Human Gate → Protected Rollout
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                Completed
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5 text-blue-700" />
                Active
              </span>
              <span className="inline-flex items-center gap-1">
                <Lock className="h-3.5 w-3.5 text-amber-700" />
                Human Gate
              </span>
              <span className="inline-flex items-center gap-1">
                <ShieldAlert className="h-3.5 w-3.5 text-red-700" />
                Aborted / Failed
              </span>
            </div>
          </div>

          {/* 5-Column Visual Flow Pipeline */}
          <div className="min-w-[780px] space-y-4">
            {/* Row 1: Stage Column Headers */}
            <div className="grid grid-cols-5 gap-3 text-[11px] font-medium text-slate-500 px-1">
              <div>1. Intake & Orchestrator</div>
              <div>2. Phase A (Parallel Read)</div>
              <div>3. Phase B (Sequential)</div>
              <div>4. Human Safety Gate</div>
              <div>5. Scoped Execution</div>
            </div>

            {/* Row 2: Flow Nodes & Animated Arrows */}
            <div className="grid grid-cols-5 gap-3 items-center">
              {/* Column 1: Intake -> Supervisor */}
              <div className="space-y-2.5">
                {renderAgentCard("intake")}
                <div className="flex justify-center text-slate-400">
                  <div className="flex flex-col items-center">
                    <div
                      className={`h-4 w-0.5 ${
                        nodeStates.intake === "COMPLETED" ? "bg-emerald-500" : "bg-slate-300"
                      }`}
                    />
                    <span className="text-[10px] font-mono text-slate-400">schema</span>
                  </div>
                </div>
                {renderAgentCard("supervisor")}
              </div>

              {/* Column 2: Phase A Parallel Workers */}
              <div className="space-y-2.5 relative">
                <div className="text-[10px] font-medium text-slate-500 text-center bg-slate-50 border border-slate-200 rounded py-1">
                  Run Simultaneously (sa-ingress-readonly)
                </div>
                {renderAgentCard("discovery")}
                {renderAgentCard("policy")}
                {renderAgentCard("impact")}
                {workflow?.agentTraces
                  .filter(
                    (tr) =>
                      tr.phase === "PHASE_A_PARALLEL" &&
                      ![
                        "DiscoveryInventoryAgent",
                        "PolicyComplianceAgent",
                        "ImpactAnalysisAgent",
                      ].includes(tr.agentName)
                  )
                  .map((extra, idx) => (
                    <div
                      key={`${extra.agentName}-${idx}`}
                      className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-2.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900 truncate">
                          {extra.agentName}
                        </span>
                        <span className="text-[10px] font-mono text-emerald-700 shrink-0">
                          {extra.durationMs ? `${extra.durationMs}ms` : "OK"}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-1 leading-snug">
                        {extra.summary}
                      </p>
                    </div>
                  ))}
              </div>

              {/* Column 3: Phase B Sequential */}
              <div className="space-y-2.5">
                <div className="text-[10px] font-medium text-slate-500 text-center bg-slate-50 border border-slate-200 rounded py-1">
                  Fan-In Sequential Build
                </div>
                {renderAgentCard("planning")}
                <div className="flex justify-center text-slate-400">
                  <div className="flex flex-col items-center">
                    <div
                      className={`h-4 w-0.5 ${
                        nodeStates.planning === "COMPLETED" ? "bg-emerald-500" : "bg-slate-300"
                      }`}
                    />
                    <span className="text-[10px] font-mono text-slate-400">manifests</span>
                  </div>
                </div>
                {renderAgentCard("rollback")}
              </div>

              {/* Column 4: HITL Gate */}
              <div className="space-y-2.5">
                <div className="text-[10px] font-medium text-amber-800 text-center bg-amber-50 border border-amber-200 rounded py-1">
                  Four-Eyes Lock
                </div>
                {renderAgentCard("hitl")}
                <div className="p-2.5 rounded-md border border-slate-200 bg-slate-50 text-[11px] text-slate-600 space-y-1">
                  <div className="font-semibold text-slate-800 flex items-center gap-1">
                    <Database className="h-3 w-3 text-slate-500" />
                    Durable State Store
                  </div>
                  <p className="leading-snug">
                    Saves ADK checkpoint, ETag lock, and SHA-256 hash-chained audit trail across restarts.
                  </p>
                </div>
              </div>

              {/* Column 5: Execution & Probe */}
              <div className="space-y-2.5">
                <div className="text-[10px] font-medium text-slate-500 text-center bg-slate-50 border border-slate-200 rounded py-1">
                  ETag Re-Check + Probe
                </div>
                {renderAgentCard("execution")}
                <div className="p-2.5 rounded-md border border-slate-200 bg-slate-50 text-[11px] text-slate-600 space-y-1">
                  <div className="font-semibold text-slate-800 flex items-center gap-1">
                    <RotateCcw className="h-3 w-3 text-slate-500" />
                    Deterministic Safety
                  </div>
                  <p className="leading-snug">
                    If cluster ETag drifted → abort safely. If probe returns 503 → instant pre-computed rollback.
                  </p>
                </div>
              </div>
            </div>

            {/* Animated Live Handoff Signal Bar */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <ArrowRight className="h-3.5 w-3.5 text-blue-700 shrink-0" />
                <span>
                  <strong className="text-slate-800 font-medium">Data Handoff Flow:</strong>{" "}
                  Read-only workers never gain write keys. Only{" "}
                  <span className="font-mono text-slate-700">ExecutionAgent</span> unlocks scoped write
                  tools after a verified HMAC token.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Plain-English Inspector Panel */}
        <aside className="xl:col-span-4 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <div className="text-xs font-mono text-slate-500">{selectedGuide.stageLabel}</div>
              <h3 className="text-base font-semibold text-slate-900 mt-0.5">
                {selectedGuide.title}
              </h3>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 shrink-0">
              <StateIcon state={nodeStates[selectedGuide.id]} />
              <span>{stateBadgeStyle(nodeStates[selectedGuide.id]).labelText}</span>
            </div>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <div className="font-semibold text-slate-800 mb-1">What It Does (In Plain English)</div>
              <p className="text-slate-600 leading-relaxed">{selectedGuide.plainEnglish}</p>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-1">
              <div className="font-semibold text-slate-800">
                Security Boundary · {selectedGuide.permissionLabel}
              </div>
              <p className="text-slate-600 leading-relaxed">{selectedGuide.permissionDetail}</p>
            </div>

            <div className="grid grid-cols-1 gap-2.5 pt-1">
              <div>
                <div className="font-semibold text-slate-800">Receives (Input)</div>
                <p className="text-slate-600 mt-0.5 leading-snug">{selectedGuide.receives}</p>
              </div>
              <div>
                <div className="font-semibold text-slate-800">Produces (Output)</div>
                <p className="text-slate-600 mt-0.5 leading-snug">{selectedGuide.produces}</p>
              </div>
            </div>

            {/* Interactive Handoff Navigation */}
            {(selectedGuide.receivesFrom.length > 0 || selectedGuide.talksTo.length > 0) && (
              <div className="pt-2 border-t border-slate-100 space-y-2">
                {selectedGuide.receivesFrom.length > 0 && (
                  <div>
                    <div className="text-[11px] font-medium text-slate-500 mb-1">
                      Triggered By
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedGuide.receivesFrom.map((prevId) => (
                        <button
                          key={prevId}
                          type="button"
                          onClick={() => setSelectedAgentId(prevId)}
                          className="px-2.5 py-1 text-[11px] font-mono bg-slate-100 hover:bg-slate-200 text-slate-800 rounded transition-colors"
                        >
                          ← {AGENT_GUIDES[prevId].title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {selectedGuide.talksTo.length > 0 && (
                  <div>
                    <div className="text-[11px] font-medium text-slate-500 mb-1">
                      Hands Off To
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedGuide.talksTo.map((nextId) => (
                        <button
                          key={nextId}
                          type="button"
                          onClick={() => setSelectedAgentId(nextId)}
                          className="px-2.5 py-1 text-[11px] font-mono bg-blue-50 hover:bg-blue-100 text-blue-800 rounded transition-colors"
                        >
                          {AGENT_GUIDES[nextId].title} →
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Live Workflow Trace Output for this Agent */}
            {workflow && (
              <div className="pt-3 border-t border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900">
                    Live Execution Trace ({workflow.appName})
                  </span>
                  {matchingTrace?.durationMs && (
                    <span className="font-mono tabular-nums text-slate-500">
                      {matchingTrace.durationMs}ms
                    </span>
                  )}
                </div>
                <div className="p-3 bg-slate-950 text-slate-100 rounded-md font-mono text-[11px] leading-relaxed">
                  {matchingTrace
                    ? matchingTrace.summary
                    : `Current workflow status is ${workflow.status}. Select an active or completed step to view recorded trace output.`}
                </div>

                {!compact && (
                  <div className="pt-1 flex items-center justify-between gap-2">
                    <Link
                      to="/workflows/$workflowId"
                      params={{ workflowId: workflow.workflowId }}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:underline"
                    >
                      Open Diffs & Approval Gate
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Chronological Real-Time Interaction Timeline */}
      {workflow && workflow.agentTraces.length > 0 && !compact && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Real-Time Agent Handoff Feed ({workflow.appName})
              </h3>
              <p className="text-xs text-slate-500">
                Updates automatically over Server-Sent Events as each agent completes its step.
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {workflow.agentTraces.length} steps recorded
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {workflow.agentTraces.map((tr, idx) => (
              <div
                key={`${tr.agentName}-${idx}`}
                className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono tabular-nums text-slate-400 w-5 shrink-0">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <span className="font-semibold text-slate-900 whitespace-nowrap">
                    {tr.agentName}
                  </span>
                  <span className="text-slate-400" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-slate-600 truncate">{tr.summary}</span>
                </div>
                <div className="flex items-center gap-3 font-mono text-[11px] text-slate-500 shrink-0 tabular-nums">
                  <span>{tr.accessMode}</span>
                  <span aria-hidden="true">·</span>
                  <span>{tr.status}</span>
                  <span aria-hidden="true">·</span>
                  <span>{tr.durationMs ? `${tr.durationMs}ms` : "waiting"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
