import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Database,
  Lock,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  SkipBack,
  SkipForward,
} from "lucide-react";
import type {
  DynamicAgentBlueprint,
  DynamicTaskAssignment,
  WorkflowHookStage,
  WorkflowRun,
} from "../shared/contracts";
import { CodeViewer } from "./ui/CodeViewer";
import {
  AGENT_GUIDES,
  CORE_CANONICAL_NAMES,
  REPLAY_STEPS,
  resolveLiveNodeStates,
  type AgentNodeId,
} from "./agents/agentFlowCatalog";
import { AgentHandoffDrawer, type AgentHandoffInspectorTarget } from "./agents/AgentHandoffDrawer";
import { AgentHandoffFeed } from "./agents/AgentHandoffFeed";
import { AgentInspectorPanel } from "./agents/AgentInspectorPanel";
import { CoreAgentNodeCard, DynamicTaskNodeCard } from "./agents/AgentNodeCard";
import { useDagEdgeGeometry } from "./agents/useDagEdgeGeometry";

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
  const [showContextBus, setShowContextBus] = useState(false);
  const [drawerTarget, setDrawerTarget] = useState<AgentHandoffInspectorTarget | null>(null);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const { dagEdges, registerNodeRef } = useDagEdgeGeometry(canvasRef, workflow, [
    replayIndex,
    selectedAgentId,
  ]);

  useEffect(() => {
    if (replayIndex !== null || !workflow) return;
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
  }, [workflow?.workflowId, workflow?.status, replayIndex, workflow]);

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

  const assignmentsByStage = useMemo(() => {
    const grouped: Record<WorkflowHookStage, DynamicTaskAssignment[]> = {
      PRE_INTAKE: [],
      PHASE_A_PARALLEL: [],
      PHASE_B_SEQUENTIAL: [],
      POST_VERIFY: [],
    };
    if (!workflow) return grouped;
    for (const a of workflow.dynamicTaskAssignments ?? []) {
      grouped[a.hookStage]?.push(a);
    }
    return grouped;
  }, [workflow]);

  const blueprintByName = useMemo(() => {
    const map = new Map<string, DynamicAgentBlueprint>();
    for (const bp of workflow?.spawnedAgents ?? []) {
      map.set(bp.name, bp);
    }
    return map;
  }, [workflow?.spawnedAgents]);

  const openAgentDrawer = useCallback(
    (agentName: string) => {
      const assignment =
        workflow?.dynamicTaskAssignments?.find((a) => a.agentName === agentName) ?? null;
      const blueprint = blueprintByName.get(agentName) ?? null;
      const contextOutput = workflow?.sharedContextBus?.[agentName] ?? null;
      setDrawerTarget({
        agentName,
        hookStage: assignment?.hookStage ?? blueprint?.hookStage,
        assignment,
        blueprint,
        contextOutput,
      });
    },
    [workflow, blueprintByName]
  );

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

  const renderCoreCard = (id: AgentNodeId) => {
    const meta = AGENT_GUIDES[id];
    const trace = workflow?.agentTraces.find((t) => meta.traceNames.includes(t.agentName));
    return (
      <CoreAgentNodeCard
        key={id}
        id={id}
        state={nodeStates[id]}
        isSelected={selectedAgentId === id}
        trace={trace}
        onSelect={setSelectedAgentId}
        nodeRef={registerNodeRef([meta.title, ...meta.traceNames])}
      />
    );
  };

  const renderDynamicStageCards = (stage: WorkflowHookStage) => {
    const items = assignmentsByStage[stage];
    if (!items || items.length === 0) return null;
    return items.map((assignment) => (
      <DynamicTaskNodeCard
        key={assignment.taskId}
        assignment={assignment}
        blueprint={blueprintByName.get(assignment.agentName)}
        onInspect={openAgentDrawer}
        nodeRef={registerNodeRef([assignment.agentName])}
      />
    ));
  };

  const activeReplayStep = replayIndex !== null ? REPLAY_STEPS[replayIndex] : null;
  const targetEtag = workflow?.changePlan?.targetStateEtag ?? workflow?.currentStateEtag;
  const hasDrift = Boolean(liveEtag && targetEtag && liveEtag !== targetEtag);
  const contextBusEntries = Object.keys(workflow?.sharedContextBus ?? {}).length;

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
            <span>{streamConnected ? "Live SSE Connected" : "Reconnecting Stream"}</span>
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
              : "Click any agent node below to inspect inputs, outputs, and downstream handoffs."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {workflow && contextBusEntries > 0 && (
            <button
              type="button"
              onClick={() => setShowContextBus((v) => !v)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                showContextBus
                  ? "bg-slate-900 border-slate-900 text-white"
                  : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              Context Bus ({contextBusEntries})
            </button>
          )}

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
              onClick={() => {
                setIsPlaying(false);
                setReplayIndex(null);
              }}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              Return to Live State
            </button>
          )}
        </div>
      </div>

      {showContextBus && workflow?.sharedContextBus && (
        <CodeViewer
          title={`Shared Multi-Agent Context Bus (${workflow.appName} · ${contextBusEntries} entries)`}
          code={JSON.stringify(workflow.sharedContextBus, null, 2)}
          copyLabel="Copy Bus JSON"
          accentTextClass="text-emerald-300"
          maxHeightClass="max-h-72"
        />
      )}

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

      {/* Main Split: Interactive Multi-Agent Graph + Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        <div className="xl:col-span-8 bg-white border border-slate-200 rounded-lg p-5 space-y-5 overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Multi-Agent Coordination Topology
              </h2>
              <p className="text-xs text-slate-500">
                Intake → Orchestrator → 3 Parallel Checks → Sequential Planning → Human Gate →
                Protected Rollout
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

          <div className="min-w-[780px] space-y-4">
            <div className="grid grid-cols-5 gap-3 text-[11px] font-medium text-slate-500 px-1">
              <div>1. Intake & Orchestrator</div>
              <div>2. Phase A (Parallel Read)</div>
              <div>3. Phase B (Sequential)</div>
              <div>4. Human Safety Gate</div>
              <div>5. Scoped Execution</div>
            </div>

            <div ref={canvasRef} className="relative grid grid-cols-5 gap-3 items-start">
              {dagEdges.length > 0 && (
                <svg
                  className="pointer-events-none absolute inset-0 w-full h-full z-0"
                  aria-hidden="true"
                >
                  <defs>
                    <marker
                      id="dag-arrow-blue"
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 1 L 10 5 L 0 9 z" fill="#1d4ed8" />
                    </marker>
                    <marker
                      id="dag-arrow-red"
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 1 L 10 5 L 0 9 z" fill="#dc2626" />
                    </marker>
                  </defs>
                  {dagEdges.map((edge) => (
                    <g key={edge.id}>
                      <path
                        d={edge.path}
                        fill="none"
                        stroke={edge.vetoed ? "#dc2626" : edge.active ? "#1d4ed8" : "#94a3b8"}
                        strokeWidth={edge.active ? 2 : 1.5}
                        strokeDasharray={edge.vetoed ? "4 3" : undefined}
                        markerEnd={edge.vetoed ? "url(#dag-arrow-red)" : "url(#dag-arrow-blue)"}
                        opacity={0.75}
                      />
                      {edge.active && !edge.vetoed && (
                        <circle r="3" fill="#2563eb">
                          <animateMotion dur="2.2s" repeatCount="indefinite" path={edge.path} />
                        </circle>
                      )}
                    </g>
                  ))}
                </svg>
              )}

              {/* Column 1 */}
              <div className="space-y-2.5">
                {renderDynamicStageCards("PRE_INTAKE")}
                {renderCoreCard("intake")}
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
                {renderCoreCard("supervisor")}
              </div>

              {/* Column 2 */}
              <div className="space-y-2.5 relative">
                <div className="text-[10px] font-medium text-slate-500 text-center bg-slate-50 border border-slate-200 rounded py-1">
                  Run Simultaneously (sa-ingress-readonly)
                </div>
                {renderCoreCard("discovery")}
                {renderCoreCard("policy")}
                {renderCoreCard("impact")}
                {renderDynamicStageCards("PHASE_A_PARALLEL")}
                {workflow?.agentTraces
                  .filter(
                    (tr) =>
                      tr.phase === "PHASE_A_PARALLEL" &&
                      !CORE_CANONICAL_NAMES.has(tr.agentName) &&
                      !assignmentsByStage.PHASE_A_PARALLEL.some(
                        (a) => a.agentName === tr.agentName
                      )
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

              {/* Column 3 */}
              <div className="space-y-2.5">
                <div className="text-[10px] font-medium text-slate-500 text-center bg-slate-50 border border-slate-200 rounded py-1">
                  Fan-In Sequential Build
                </div>
                {renderCoreCard("planning")}
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
                {renderCoreCard("rollback")}
                {renderDynamicStageCards("PHASE_B_SEQUENTIAL")}
              </div>

              {/* Column 4 */}
              <div className="space-y-2.5">
                <div className="text-[10px] font-medium text-amber-800 text-center bg-amber-50 border border-amber-200 rounded py-1">
                  Four-Eyes Lock
                </div>
                {renderCoreCard("hitl")}
                <div className="p-2.5 rounded-md border border-slate-200 bg-slate-50 text-[11px] text-slate-600 space-y-1">
                  <div className="font-semibold text-slate-800 flex items-center gap-1">
                    <Database className="h-3 w-3 text-slate-500" />
                    Durable State Store
                  </div>
                  <p className="leading-snug">
                    Saves ADK checkpoint, ETag lock, and SHA-256 hash-chained audit trail across
                    restarts.
                  </p>
                </div>
              </div>

              {/* Column 5 */}
              <div className="space-y-2.5">
                <div className="text-[10px] font-medium text-slate-500 text-center bg-slate-50 border border-slate-200 rounded py-1">
                  ETag Re-Check + Probe
                </div>
                {renderCoreCard("execution")}
                {renderDynamicStageCards("POST_VERIFY")}
                <div className="p-2.5 rounded-md border border-slate-200 bg-slate-50 text-[11px] text-slate-600 space-y-1">
                  <div className="font-semibold text-slate-800 flex items-center gap-1">
                    <RotateCcw className="h-3 w-3 text-slate-500" />
                    Deterministic Safety
                  </div>
                  <p className="leading-snug">
                    If cluster ETag drifted → abort safely. If probe returns 503 → instant
                    pre-computed rollback.
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <ArrowRight className="h-3.5 w-3.5 text-blue-700 shrink-0" />
                <span>
                  <strong className="text-slate-800 font-medium">Data Handoff Flow:</strong>{" "}
                  Read-only workers never gain write keys. Dynamic DAG links ({dagEdges.length}{" "}
                  active) pass typed JSON outputs downstream.
                </span>
              </div>
            </div>
          </div>
        </div>

        <AgentInspectorPanel
          guide={selectedGuide}
          nodeState={nodeStates[selectedGuide.id]}
          workflow={workflow}
          matchingTrace={matchingTrace}
          compact={compact}
          onSelectAgent={setSelectedAgentId}
          onOpenContextDrawer={openAgentDrawer}
        />
      </div>

      {workflow && !compact && (
        <AgentHandoffFeed workflow={workflow} onInspectAgent={openAgentDrawer} />
      )}

      <AgentHandoffDrawer
        target={drawerTarget}
        onClose={() => setDrawerTarget(null)}
        onSelectUpstreamAgent={(depName) => openAgentDrawer(depName)}
      />
    </div>
  );
}
