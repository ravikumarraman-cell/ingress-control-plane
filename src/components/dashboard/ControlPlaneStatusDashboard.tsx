import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Cpu,
  Radio,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import {
  fetchAgentBlueprints,
  fetchRoutes,
  fetchWorkflows,
} from "../../lib/api";
import { shortHash } from "../../lib/format";
import { useWorkflowStream } from "../../lib/useWorkflowStream";
import type { WorkflowStatus } from "../../shared/contracts";

const CORE_GOVERNED_AGENT_COUNT = 9;
const BLAST_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export interface ControlPlaneStatusDashboardProps {
  activeStatusFilter?: "all" | WorkflowStatus;
  onSelectStatusFilter?: (status: "all" | WorkflowStatus) => void;
  onShowRoutes?: () => void;
}

function MetricProgressRow({
  label,
  valueText,
  percent,
  barColorClass = "bg-emerald-600",
}: {
  label: string;
  valueText: string;
  percent: number;
  barColorClass?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-slate-600">{label}</span>
        <span className="font-mono font-medium text-slate-900 tabular-nums">{valueText}</span>
      </div>
      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColorClass} transition-all duration-200`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

export function ControlPlaneStatusDashboard({
  activeStatusFilter,
  onSelectStatusFilter,
  onShowRoutes,
}: ControlPlaneStatusDashboardProps) {
  const { streamConnected } = useWorkflowStream();

  const workflowsQuery = useQuery({
    queryKey: ["workflows"],
    queryFn: () => fetchWorkflows(),
  });

  const routesQuery = useQuery({
    queryKey: ["routes"],
    queryFn: fetchRoutes,
  });

  const blueprintsQuery = useQuery({
    queryKey: ["agent-blueprints"],
    queryFn: fetchAgentBlueprints,
  });

  const workflows = workflowsQuery.data?.workflows ?? [];
  const routes = routesQuery.data?.routes ?? [];
  const blueprints = blueprintsQuery.data?.blueprints ?? [];
  const liveEtag = routesQuery.data?.liveStateEtag ?? workflowsQuery.data?.liveStateEtag ?? "";
  const driftCounter = routesQuery.data?.driftCounter ?? 0;

  const isLoading =
    workflowsQuery.isLoading || routesQuery.isLoading || blueprintsQuery.isLoading;

  const networkHealth = useMemo(() => {
    const totalRoutes = routes.length;
    const wafCount = routes.filter((r) => r.wafEnabled).length;
    const strictTlsCount = routes.filter((r) => r.tlsProfile !== "tls_1_2_compat").length;
    const canaryRoutes = routes.filter((r) => r.canaryWeight > 0 && r.canaryWeight < 100).length;

    const probedWorkflows = workflows.filter((w) => Boolean(w.probeResult));
    const passedProbes = probedWorkflows.filter((w) => w.probeResult?.passed).length;
    const avgLatencyMs =
      probedWorkflows.length > 0
        ? Math.round(
            probedWorkflows.reduce((sum, w) => sum + (w.probeResult?.latencyMs ?? 0), 0) /
              probedWorkflows.length
          )
        : null;

    const wafPct = totalRoutes > 0 ? (wafCount / totalRoutes) * 100 : 100;
    const tlsPct = totalRoutes > 0 ? (strictTlsCount / totalRoutes) * 100 : 100;
    const probePct =
      probedWorkflows.length > 0 ? (passedProbes / probedWorkflows.length) * 100 : 100;

    const driftAbortedCount = workflows.filter((w) => w.status === "DRIFT_ABORTED").length;
    const rolledBackCount = workflows.filter((w) => w.status === "ROLLED_BACK").length;
    const isDegraded =
      (totalRoutes > 0 && (wafCount < totalRoutes || strictTlsCount < totalRoutes)) ||
      (probedWorkflows.length > 0 && passedProbes < probedWorkflows.length);

    return {
      totalRoutes,
      wafCount,
      strictTlsCount,
      canaryRoutes,
      probedCount: probedWorkflows.length,
      passedProbes,
      avgLatencyMs,
      wafPct,
      tlsPct,
      probePct,
      driftAbortedCount,
      rolledBackCount,
      isDegraded,
    };
  }, [routes, workflows]);

  const agentStats = useMemo(() => {
    const enabledBlueprints = blueprints.filter((b) => b.enabled);
    const inFlightWorkflows = workflows.filter((w) =>
      ["INTAKE", "ANALYZING", "PLANNING", "EXECUTING"].includes(w.status)
    );
    const dynamicTaskRuns = workflows.reduce(
      (sum, w) => sum + (w.dynamicTaskAssignments?.length ?? 0),
      0
    );
    const dynamicVetoCount = workflows.reduce(
      (sum, w) =>
        sum +
        (w.dynamicTaskAssignments?.filter((t) => t.structuredOutput?.vetoTriggered).length ?? 0),
      0
    );

    const stageCounts = {
      PRE_INTAKE: enabledBlueprints.filter((b) => b.hookStage === "PRE_INTAKE").length,
      PHASE_A_PARALLEL: enabledBlueprints.filter((b) => b.hookStage === "PHASE_A_PARALLEL").length,
      PHASE_B_SEQUENTIAL: enabledBlueprints.filter((b) => b.hookStage === "PHASE_B_SEQUENTIAL")
        .length,
      POST_VERIFY: enabledBlueprints.filter((b) => b.hookStage === "POST_VERIFY").length,
    };

    return {
      coreCount: CORE_GOVERNED_AGENT_COUNT,
      totalRegisteredBlueprints: blueprints.length,
      enabledBlueprintCount: enabledBlueprints.length,
      totalActiveFleet: CORE_GOVERNED_AGENT_COUNT + enabledBlueprints.length,
      inFlightCount: inFlightWorkflows.length,
      dynamicTaskRuns,
      dynamicVetoCount,
      stageCounts,
    };
  }, [blueprints, workflows]);

  const pendingApprovals = useMemo(() => {
    return workflows
      .filter((w) => w.status === "AWAITING_APPROVAL")
      .sort((a, b) => {
        const diff = (BLAST_ORDER[a.blastRadius] ?? 9) - (BLAST_ORDER[b.blastRadius] ?? 9);
        if (diff !== 0) return diff;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
  }, [workflows]);

  const highRiskPendingCount = useMemo(
    () => pendingApprovals.filter((w) => w.blastRadius === "HIGH").length,
    [pendingApprovals]
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-24 bg-white border border-slate-200 rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-5 h-64 bg-white border border-slate-200 rounded-lg animate-pulse" />
          <div className="lg:col-span-7 h-64 bg-white border border-slate-200 rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <section aria-label="Control Plane Status Overview" className="space-y-5">
      {/* Top 4-Metric Real-Time Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 bg-white border border-slate-200 rounded-lg divide-y sm:divide-y-0 sm:divide-x divide-slate-200 overflow-hidden">
        {/* Metric 1: Network Health */}
        <button
          type="button"
          onClick={() => onShowRoutes?.()}
          className="p-4 text-left hover:bg-slate-50/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Network Health</span>
            {networkHealth.isDegraded ? (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
            ) : (
              <Activity className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            )}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={`text-xl font-semibold font-mono tabular-nums ${
                networkHealth.isDegraded ? "text-amber-700" : "text-emerald-700"
              }`}
            >
              {networkHealth.isDegraded ? "Degraded" : "Healthy"}
            </span>
            <span className="text-xs font-mono text-slate-500 tabular-nums">
              {networkHealth.totalRoutes} routes
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500 font-mono tabular-nums truncate">
            WAF {networkHealth.wafCount}/{networkHealth.totalRoutes} ·{" "}
            {networkHealth.avgLatencyMs !== null
              ? `${networkHealth.avgLatencyMs}ms avg probe`
              : "No probe failures"}
          </div>
        </button>

        {/* Metric 2: Active Agents */}
        <Link
          to="/agents"
          className="p-4 text-left hover:bg-slate-50/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 block"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Active Agents</span>
            <Cpu className="h-3.5 w-3.5 text-blue-700 shrink-0" />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-semibold text-slate-950 font-mono tabular-nums">
              {agentStats.totalActiveFleet}
            </span>
            <span className="text-xs font-mono text-slate-500 tabular-nums">
              {agentStats.coreCount} core + {agentStats.enabledBlueprintCount} dynamic
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500 font-mono tabular-nums truncate">
            {agentStats.inFlightCount} running · {agentStats.dynamicTaskRuns} DAG handoffs
          </div>
        </Link>

        {/* Metric 3: Pending Approval Requests */}
        <button
          type="button"
          onClick={() =>
            onSelectStatusFilter?.(
              activeStatusFilter === "AWAITING_APPROVAL" ? "all" : "AWAITING_APPROVAL"
            )
          }
          className={`p-4 text-left hover:bg-slate-50/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 ${
            activeStatusFilter === "AWAITING_APPROVAL" ? "bg-amber-50/50" : ""
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Pending Approvals</span>
            <ShieldAlert
              className={`h-3.5 w-3.5 shrink-0 ${
                pendingApprovals.length > 0 ? "text-amber-600" : "text-slate-400"
              }`}
            />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={`text-xl font-semibold font-mono tabular-nums ${
                pendingApprovals.length > 0 ? "text-amber-700" : "text-slate-900"
              }`}
            >
              {pendingApprovals.length}
            </span>
            <span className="text-xs font-mono text-slate-500 tabular-nums">
              {highRiskPendingCount > 0 ? `${highRiskPendingCount} high blast` : "HITL gate"}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500 truncate">
            {activeStatusFilter === "AWAITING_APPROVAL"
              ? "Filtering pending gates below"
              : "Click to filter workflow queue"}
          </div>
        </button>

        {/* Metric 4: Cluster State ETag & Anti-Drift Guard */}
        <button
          type="button"
          onClick={() =>
            onSelectStatusFilter?.(
              activeStatusFilter === "DRIFT_ABORTED" ? "all" : "DRIFT_ABORTED"
            )
          }
          className={`p-4 text-left hover:bg-slate-50/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 ${
            activeStatusFilter === "DRIFT_ABORTED" ? "bg-slate-50" : ""
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Telemetry & Drift Guard</span>
            <Radio
              className={`h-3.5 w-3.5 shrink-0 ${
                streamConnected ? "text-emerald-600" : "text-amber-600"
              }`}
            />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-semibold text-slate-950 font-mono tabular-nums">
              {driftCounter}
            </span>
            <span className="text-xs font-mono text-slate-500 tabular-nums">
              drift events ({networkHealth.driftAbortedCount} blocked)
            </span>
          </div>
          <div className="mt-1 text-[11px] font-mono text-slate-500 tabular-nums truncate">
            {streamConnected ? "Live SSE" : "Reconnecting"} · ETag{" "}
            {liveEtag ? shortHash(liveEtag, 12) : "—"}
          </div>
        </button>
      </div>

      {/* Detailed Two-Column Operational Posture */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left: Network Health Metrics */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-700 shrink-0" />
              <h2 className="text-sm font-semibold text-slate-900">
                Network Health Metrics
              </h2>
            </div>
            <span className="text-xs font-mono text-slate-500 tabular-nums">
              {networkHealth.canaryRoutes} canary active
            </span>
          </div>

          <div className="space-y-3">
            <MetricProgressRow
              label="WAF Policy Enforcement"
              valueText={`${networkHealth.wafCount}/${networkHealth.totalRoutes} routes`}
              percent={networkHealth.wafPct}
              barColorClass={networkHealth.wafPct < 100 ? "bg-amber-600" : "bg-emerald-600"}
            />
            <MetricProgressRow
              label="Strict TLS (1.3 / mTLS)"
              valueText={`${networkHealth.strictTlsCount}/${networkHealth.totalRoutes} routes`}
              percent={networkHealth.tlsPct}
              barColorClass={networkHealth.tlsPct < 100 ? "bg-amber-600" : "bg-blue-700"}
            />
            <MetricProgressRow
              label="Synthetic Probe Verification"
              valueText={
                networkHealth.probedCount > 0
                  ? `${networkHealth.passedProbes}/${networkHealth.probedCount} passed`
                  : "Standby (no recent apply)"
              }
              percent={networkHealth.probePct}
              barColorClass={networkHealth.probePct < 100 ? "bg-red-600" : "bg-emerald-600"}
            />
          </div>
        </div>

        {/* Right: Active Agent Roster Breakdown */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">
                Active Agent Roster Breakdown
              </h2>
              <Link
                to="/agents"
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
              >
                Agent Studio
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs pt-1">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Core Pipeline</span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {agentStats.coreCount} active
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">On-the-Fly Active</span>
                <span className="font-mono font-semibold text-blue-700 tabular-nums">
                  {agentStats.enabledBlueprintCount}/{agentStats.totalRegisteredBlueprints}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Phase A / B Dynamic</span>
                <span className="font-mono text-slate-800 tabular-nums">
                  {agentStats.stageCounts.PHASE_A_PARALLEL}A ·{" "}
                  {agentStats.stageCounts.PHASE_B_SEQUENTIAL}B
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Dynamic Vetoes</span>
                <span className="font-mono text-slate-800 tabular-nums">
                  {agentStats.dynamicVetoCount}
                </span>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-2 text-xs text-slate-500 tabular-nums">
            <span>
              In-flight workflows: <strong className="font-mono text-slate-900">{agentStats.inFlightCount}</strong>
            </span>
            <span>
              Total DAG handoffs: <strong className="font-mono text-slate-900">{agentStats.dynamicTaskRuns}</strong>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
