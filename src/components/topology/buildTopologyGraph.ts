import type {
  ActiveIngressRoute,
  DynamicAgentBlueprint,
  WorkflowRun,
} from "../../shared/contracts";

export type TopologyViewMode = "all" | "agents" | "traffic";

export type TopologyNodeKind =
  | "ui"
  | "api"
  | "agent_ro"
  | "agent_dynamic"
  | "hitl"
  | "agent_rw"
  | "store"
  | "infra"
  | "route";

export type TopologyEdgeKind =
  | "control"
  | "readonly"
  | "approval"
  | "dynamic"
  | "traffic";

export interface TopologyNode {
  id: string;
  label: string;
  subtitle: string;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: TopologyNodeKind;
  source: "spec" | "dynamic_agent" | "live_route";
  securityBoundary: string;
  metricsSummary: string;
  detailText: string;
}

export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  kind: TopologyEdgeKind;
  dashed?: boolean;
  weightPercent?: number;
}

export interface ParsedMermaidSpec {
  specNodeCount: number;
  specEdgeCount: number;
  specNodeLabels: Record<string, string>;
  specEdges: Array<{ source: string; target: string; label?: string; dashed: boolean }>;
}

const NODE_CLASS_TO_KIND: Record<string, TopologyNodeKind> = {
  ui: "ui",
  api: "api",
  adkRead: "agent_ro",
  hitl: "hitl",
  adkWrite: "agent_rw",
  db: "store",
  infra: "infra",
};

const SPEC_NODE_META: Record<
  string,
  {
    column: number;
    shortLabel: string;
    subtitle: string;
    boundary: string;
    detail: string;
  }
> = {
  Router: {
    column: 0,
    shortLabel: "TanStack UI",
    subtitle: "Control Plane SPA",
    boundary: "OIDC User Session",
    detail: "Type-safe route views for Workflows, Agent Flow, Approvals, Audit Log, and Architecture.",
  },
  CmdAPI: {
    column: 0,
    shortLabel: "FastAPI + SSE",
    subtitle: "RBAC & Event Bridge",
    boundary: "JWT + Four-Eyes Guard",
    detail: "Validates schemas, enforces requester != reviewer, signs ApprovalTokens, and pushes SSE updates.",
  },
  Intake: {
    column: 1,
    shortLabel: "IngressIntakeAgent",
    subtitle: "No Infra Tools",
    boundary: "Zero Infra Access",
    detail: "Parses plain-English or structured requests into frozen IngressRequest schemas; rejects embedded secrets.",
  },
  Supervisor: {
    column: 1,
    shortLabel: "SupervisorAgent",
    subtitle: "Bounded Orchestrator",
    boundary: "max_iterations = 5",
    detail: "Coordinates Phase A/B specialists, handles operator revision loops, and routes escalation decisions.",
  },
  Discovery: {
    column: 2,
    shortLabel: "DiscoveryInventory",
    subtitle: "Phase A · Parallel",
    boundary: "sa-ingress-readonly",
    detail: "Snapshots K8s Gateway routes, LB pools, DNS, and TLS certs to compute deterministic SHA-256 ETag.",
  },
  Policy: {
    column: 2,
    shortLabel: "PolicyCompliance",
    subtitle: "Phase A · Parallel",
    boundary: "sa-ingress-readonly",
    detail: "Evaluates TLS 1.3, WAF, non-wildcard cert, and dynamic runtime policy rules.",
  },
  Impact: {
    column: 2,
    shortLabel: "ImpactAnalysis",
    subtitle: "Phase A · Parallel",
    boundary: "sa-ingress-readonly",
    detail: "Detects hostname/path collisions and computes BlastRadiusScore (LOW / MEDIUM / HIGH).",
  },
  Planner: {
    column: 3,
    shortLabel: "ChangePlanning",
    subtitle: "Phase B · Sequential",
    boundary: "sa-ingress-readonly",
    detail: "Synthesizes Gateway API HTTPRoute YAML, Terraform diffs, and digests from Phase A context.",
  },
  Validator: {
    column: 3,
    shortLabel: "ValidationRollback",
    subtitle: "Phase B · Sequential",
    boundary: "sa-ingress-readonly",
    detail: "Runs server-side API dry-runs and seals pre-computed zero-LLM RollbackPlan artifacts.",
  },
  AuditDB: {
    column: 3,
    shortLabel: "State & Audit Store",
    subtitle: "PostgreSQL / Hash Chain",
    boundary: "Append-Only Trigger",
    detail: "Persists workflow checkpoints, ChangePlans, signed approvals, and SHA-256 hash-chained audit logs.",
  },
  HITL: {
    column: 4,
    shortLabel: "HITL Approval Gate",
    subtitle: "Four-Eyes Checkpoint",
    boundary: "HMAC / KMS Signer",
    detail: "Suspends execution at AWAITING_APPROVAL until an authorized reviewer signs the plan digest and ETag.",
  },
  Execution: {
    column: 4,
    shortLabel: "ExecutionAgent",
    subtitle: "Scoped Write Engine",
    boundary: "sa-ingress-executor",
    detail: "Verifies ApprovalToken signature & live ETag parity (TOCTOU lock) before applying Gateway patches or PRs.",
  },
  K8s: {
    column: 5,
    shortLabel: "K8s Gateway API",
    subtitle: "HTTPRoute Controllers",
    boundary: "Scoped Namespace RBAC",
    detail: "Applies validated HTTPRoute & canary backend weights without LLM latency in the request path.",
  },
  CloudNet: {
    column: 5,
    shortLabel: "Cloud LB, WAF & TLS",
    subtitle: "Edge Ingress Edge",
    boundary: "TLS 1.3 / WAF Active",
    detail: "Terminates TLS 1.3, enforces WAF rules, and routes external/internal traffic to active backends.",
  },
  Probes: {
    column: 5,
    shortLabel: "Synthetic Probes",
    subtitle: "Post-Apply Verify",
    boundary: "< 60s Auto-Rollback",
    detail: "Verifies DNS, TLS ALPN, HTTP health, and WAF enforcement; triggers deterministic rollback on failure.",
  },
  DataPlane: {
    column: 6,
    shortLabel: "Live Packet Path",
    subtitle: "0ms LLM Latency",
    boundary: "Data Plane Isolated",
    detail: "Customer application traffic flows directly through configured Gateways and backend pools.",
  },
};

const BASE_SPEC_EDGES: Array<{
  source: string;
  target: string;
  label?: string;
  kind: TopologyEdgeKind;
  dashed?: boolean;
}> = [
  { source: "Router", target: "CmdAPI", label: "REST / SSE", kind: "control" },
  { source: "CmdAPI", target: "Intake", label: "IngressRequest", kind: "control" },
  { source: "Intake", target: "Supervisor", label: "Validated Schema", kind: "control" },
  { source: "Supervisor", target: "Discovery", label: "Phase A", kind: "readonly" },
  { source: "Supervisor", target: "Policy", label: "Phase A", kind: "readonly" },
  { source: "Supervisor", target: "Impact", label: "Phase A", kind: "readonly" },
  { source: "Discovery", target: "Planner", label: "Topology + ETag", kind: "readonly" },
  { source: "Policy", target: "Planner", label: "PolicyMatrix", kind: "readonly" },
  { source: "Impact", target: "Validator", label: "BlastRadius", kind: "readonly" },
  { source: "Planner", target: "Validator", label: "ChangePlan", kind: "readonly" },
  { source: "Planner", target: "AuditDB", label: "Seal Digest", kind: "readonly", dashed: true },
  { source: "Validator", target: "HITL", label: "Rollback Sealed", kind: "approval" },
  { source: "HITL", target: "AuditDB", label: "Signed Event", kind: "approval", dashed: true },
  { source: "HITL", target: "Execution", label: "ApprovalToken + ETag", kind: "approval" },
  { source: "Execution", target: "K8s", label: "Gated Patch / PR", kind: "traffic" },
  { source: "Execution", target: "CloudNet", label: "WAF / TLS Policy", kind: "traffic" },
  { source: "Execution", target: "Probes", label: "Verify Health", kind: "readonly", dashed: true },
  { source: "K8s", target: "DataPlane", label: "Route Traffic", kind: "traffic" },
  { source: "CloudNet", target: "DataPlane", label: "Edge Ingress", kind: "traffic" },
  { source: "Probes", target: "DataPlane", label: "Synthetic Probe", kind: "readonly", dashed: true },
];

export function parseArchitectureFlowchartSpec(flowchartMermaid: string): ParsedMermaidSpec {
  const specNodeLabels: Record<string, string> = {};
  const specEdges: ParsedMermaidSpec["specEdges"] = [];

  if (!flowchartMermaid) {
    return { specNodeCount: 0, specEdgeCount: 0, specNodeLabels, specEdges };
  }

  const lines = flowchartMermaid.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("%%") || line.startsWith("classDef")) continue;

    // Match node definitions like: Intake["IngressIntakeAgent ..."]:::adkRead or HITL{{"..."}}:::hitl
    const nodeMatch = line.match(/^([A-Za-z0-9_]+)\s*(?:\[\("?|\[|\{\{)"([^"]+)"/);
    if (nodeMatch) {
      const [, id, rawLabel] = nodeMatch;
      specNodeLabels[id] = rawLabel.replace(/\\n/g, " · ");
    }

    // Match Mermaid arrows: A --> B, A -.->|"label"| B, A -->|"label"| B, A <-->|"..."| B
    const edgeMatch = line.match(
      /^([A-Za-z0-9_]+)\s+(<-->|-->|-\.->|---)\s*(?:\|"([^"]+)"\|\s*)?([A-Za-z0-9_]+)$/
    );
    if (edgeMatch) {
      const [, source, arrow, label, target] = edgeMatch;
      specEdges.push({
        source,
        target,
        label,
        dashed: arrow.includes("."),
      });
    }
  }

  return {
    specNodeCount: Object.keys(specNodeLabels).length,
    specEdgeCount: specEdges.length,
    specNodeLabels,
    specEdges,
  };
}

function getColumnX(col: number): number {
  const xs = [115, 345, 585, 825, 1065, 1310, 1555];
  return xs[col] ?? 1555;
}

export function buildTopologyGraph(params: {
  flowchartMermaid: string;
  blueprints: DynamicAgentBlueprint[];
  routes: ActiveIngressRoute[];
  workflows: WorkflowRun[];
  viewMode: TopologyViewMode;
}): {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  specSummary: ParsedMermaidSpec;
  canvasWidth: number;
  canvasHeight: number;
} {
  const { flowchartMermaid, blueprints, routes, workflows, viewMode } = params;
  const specSummary = parseArchitectureFlowchartSpec(flowchartMermaid);

  const awaitingCount = workflows.filter((w) => w.status === "AWAITING_APPROVAL").length;
  const executingCount = workflows.filter((w) => w.status === "EXECUTING").length;
  const completedCount = workflows.filter((w) => w.status === "COMPLETED").length;
  const probeRuns = workflows.filter((w) => Boolean(w.probeResult)).length;
  const enabledBlueprints = blueprints.filter((b) => b.enabled);

  // Determine class kind from Mermaid spec text when available
  const kindFromMermaid = (id: string): TopologyNodeKind => {
    const classMatch = flowchartMermaid.match(new RegExp(`${id}[^\\n]*:::(ui|api|adkRead|hitl|adkWrite|db|infra)`));
    if (classMatch && NODE_CLASS_TO_KIND[classMatch[1]]) {
      return NODE_CLASS_TO_KIND[classMatch[1]];
    }
    if (id === "HITL") return "hitl";
    if (id === "Execution") return "agent_rw";
    if (id === "AuditDB") return "store";
    if (id === "Router") return "ui";
    if (id === "CmdAPI") return "api";
    if (["K8s", "CloudNet", "Probes", "DataPlane"].includes(id)) return "infra";
    return "agent_ro";
  };

  // Build candidate nodes
  const allNodes: TopologyNode[] = [];
  const allEdges: TopologyEdge[] = [];

  for (const [id, meta] of Object.entries(SPEC_NODE_META)) {
    let metricsSummary = specSummary.specNodeLabels[id] ? "Defined in architecture-spec.md" : "Core Blueprint";
    if (id === "HITL") {
      metricsSummary = `${awaitingCount} workflow(s) paused at gate`;
    } else if (id === "Execution") {
      metricsSummary = `${executingCount} executing · ${completedCount} completed`;
    } else if (id === "Probes") {
      metricsSummary = `${probeRuns} probe verification(s) recorded`;
    } else if (id === "Supervisor") {
      metricsSummary = `${enabledBlueprints.length} dynamic specialist(s) attached`;
    } else if (id === "K8s" || id === "CloudNet") {
      metricsSummary = `${routes.length} active cluster route(s)`;
    }

    allNodes.push({
      id,
      label: meta.shortLabel,
      subtitle: meta.subtitle,
      column: meta.column,
      x: getColumnX(meta.column),
      y: 0,
      width: 176,
      height: 58,
      kind: kindFromMermaid(id),
      source: "spec",
      securityBoundary: meta.boundary,
      metricsSummary,
      detailText: meta.detail,
    });
  }

  for (let idx = 0; idx < BASE_SPEC_EDGES.length; idx += 1) {
    const e = BASE_SPEC_EDGES[idx];
    allEdges.push({
      id: `spec-edge-${idx}`,
      source: e.source,
      target: e.target,
      label: e.label,
      kind: e.kind,
      dashed: e.dashed,
    });
  }

  // Inject live On-the-Fly Specialist Agents from Blueprints
  const stageToColumn: Record<DynamicAgentBlueprint["hookStage"], number> = {
    PRE_INTAKE: 1,
    PHASE_A_PARALLEL: 2,
    PHASE_B_SEQUENTIAL: 3,
    POST_VERIFY: 4,
  };

  for (const bp of enabledBlueprints) {
    const bpNodeId = `dyn:${bp.name}`;
    allNodes.push({
      id: bpNodeId,
      label: bp.name,
      subtitle: `Dynamic · ${bp.hookStage.replace("_", " ")}`,
      column: stageToColumn[bp.hookStage] ?? 2,
      x: getColumnX(stageToColumn[bp.hookStage] ?? 2),
      y: 0,
      width: 176,
      height: 58,
      kind: "agent_dynamic",
      source: "dynamic_agent",
      securityBoundary: `sa-ingress-readonly (${bp.allowedTools.length} tools)`,
      metricsSummary: `${bp.outputSchema.length} typed JSON field(s) · ${bp.spawnedBy}`,
      detailText: `${bp.role}. Task: ${bp.taskTemplate}`,
    });

    if (bp.dependsOn.length > 0) {
      for (const dep of bp.dependsOn) {
        const depTarget =
          allNodes.some((n) => n.id === `dyn:${dep}`)
            ? `dyn:${dep}`
            : dep.includes("Discovery")
              ? "Discovery"
              : dep.includes("Policy")
                ? "Policy"
                : dep.includes("Impact")
                  ? "Impact"
                  : dep.includes("Intake")
                    ? "Intake"
                    : dep.includes("ChangePlan")
                      ? "Planner"
                      : "Supervisor";

        allEdges.push({
          id: `dyn-dep-${depTarget}-${bpNodeId}`,
          source: depTarget,
          target: bpNodeId,
          label: `{{${dep}}}`,
          kind: "dynamic",
          dashed: true,
        });
      }
    } else {
      const fallbackParent =
        bp.hookStage === "PRE_INTAKE"
          ? "Intake"
          : bp.hookStage === "PHASE_A_PARALLEL"
            ? "Supervisor"
            : bp.hookStage === "PHASE_B_SEQUENTIAL"
              ? "Planner"
              : "Execution";
      allEdges.push({
        id: `dyn-hook-${fallbackParent}-${bpNodeId}`,
        source: fallbackParent,
        target: bpNodeId,
        label: "On-the-Fly Hook",
        kind: "dynamic",
        dashed: true,
      });
    }

    // Wire dynamic specialist output forward into Planner / HITL / Probes
    const forwardTarget =
      bp.hookStage === "PRE_INTAKE"
        ? "Supervisor"
        : bp.hookStage === "PHASE_A_PARALLEL"
          ? "Planner"
          : bp.hookStage === "PHASE_B_SEQUENTIAL"
            ? "HITL"
            : "DataPlane";
    allEdges.push({
      id: `dyn-fwd-${bpNodeId}-${forwardTarget}`,
      source: bpNodeId,
      target: forwardTarget,
      label: bp.canForceApproval ? "Context + Veto" : "Typed Context",
      kind: "dynamic",
    });
  }

  // Inject Live Active Ingress Routes for real traffic flow paths
  const activeRoutes = routes.slice(0, 6);
  for (const route of activeRoutes) {
    const routeNodeId = `route:${route.routeId}`;
    allNodes.push({
      id: routeNodeId,
      label: route.appName,
      subtitle: `${route.backendService}:${route.backendPort}`,
      column: 6,
      x: getColumnX(6),
      y: 0,
      width: 176,
      height: 58,
      kind: "route",
      source: "live_route",
      securityBoundary: `${route.tlsProfile} · ${route.wafEnabled ? "WAF On" : "WAF Off"}`,
      metricsSummary: `${route.canaryWeight}% traffic · ${route.environment} (${route.exposure})`,
      detailText: `Live route serving ${route.hostname}${route.pathPrefix} via ${route.gatewayName}.`,
    });

    const sourceGateway = route.exposure === "external" ? "CloudNet" : "K8s";
    allEdges.push({
      id: `traffic-${sourceGateway}-${routeNodeId}`,
      source: sourceGateway,
      target: routeNodeId,
      label: `${route.canaryWeight}% Traffic`,
      kind: "traffic",
      weightPercent: route.canaryWeight,
    });
  }

  // Filter based on selected TopologyViewMode
  let visibleNodes = allNodes;
  if (viewMode === "agents") {
    visibleNodes = allNodes.filter((n) => n.column <= 4);
  } else if (viewMode === "traffic") {
    visibleNodes = allNodes.filter((n) => n.column >= 4 || n.id === "AuditDB");
  }

  // Re-index columns smoothly when sliced so view fits cleanly
  const minCol = visibleNodes.reduce((min, n) => Math.min(min, n.column), 99);
  const byCol = new Map<number, TopologyNode[]>();
  for (const node of visibleNodes) {
    const normCol = node.column - minCol;
    const list = byCol.get(normCol) ?? [];
    list.push(node);
    byCol.set(normCol, list);
  }

  const maxRowsInAnyCol = Math.max(1, ...Array.from(byCol.values()).map((l) => l.length));
  const rowGap = 86;
  const topPad = 68;
  const canvasHeight = Math.max(460, topPad + maxRowsInAnyCol * rowGap + 48);
  const colCount = Math.max(1, byCol.size);
  const colSpacing = 240;
  const startX = 115;
  const canvasWidth = startX + (colCount - 1) * colSpacing + 145;

  const positionedNodes: TopologyNode[] = [];
  for (const [colIdx, list] of Array.from(byCol.entries()).sort((a, b) => a[0] - b[0])) {
    const totalColHeight = (list.length - 1) * rowGap;
    const colStartY = (canvasHeight - totalColHeight) / 2;
    list.forEach((node, rowIdx) => {
      positionedNodes.push({
        ...node,
        column: colIdx,
        x: startX + colIdx * colSpacing,
        y: colStartY + rowIdx * rowGap,
      });
    });
  }

  const visibleIds = new Set(positionedNodes.map((n) => n.id));
  const visibleEdges = allEdges.filter(
    (e) => visibleIds.has(e.source) && visibleIds.has(e.target)
  );

  return {
    nodes: positionedNodes,
    edges: visibleEdges,
    specSummary,
    canvasWidth,
    canvasHeight,
  };
}
