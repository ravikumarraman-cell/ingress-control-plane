import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, Lock, X } from "lucide-react";
import type { DynamicTaskAssignment, WorkflowHookStage } from "../../shared/contracts";
import { AGENT_GUIDES, type AgentNodeId, type VisualNodeState } from "./agentFlowCatalog";

type StageId = "understand" | "analyze" | "plan" | "approve" | "rollout";

interface StageDef {
  id: StageId;
  title: string;
  tag: string;
  agents: AgentNodeId[];
}

const STAGES: StageDef[] = [
  { id: "understand", title: "Understand", tag: "Safe intake", agents: ["intake", "supervisor"] },
  { id: "analyze", title: "Analyze", tag: "3 at once · read-only", agents: ["discovery", "policy", "impact"] },
  { id: "plan", title: "Plan & Prove", tag: "Sequential · no write", agents: ["planning", "rollback"] },
  { id: "approve", title: "Human Approval", tag: "Four-eyes lock", agents: ["hitl"] },
  { id: "rollout", title: "Safe Rollout", tag: "Canary + auto-rollback", agents: ["execution"] },
];

const STAGE_OF_HOOK: Record<WorkflowHookStage, StageId> = {
  PRE_INTAKE: "understand",
  PHASE_A_PARALLEL: "analyze",
  PHASE_B_SEQUENTIAL: "plan",
  POST_VERIFY: "rollout",
};

const PANEL_W = 150;
const PANEL_X = [40, 230, 420, 610, 800];

const NODES: Record<AgentNodeId, { x: number; y: number; r: number; label: string }> = {
  intake: { x: 115, y: 140, r: 26, label: "Intake" },
  supervisor: { x: 115, y: 290, r: 26, label: "Supervisor" },
  discovery: { x: 305, y: 130, r: 24, label: "Discovery" },
  policy: { x: 305, y: 215, r: 24, label: "Policy" },
  impact: { x: 305, y: 300, r: 24, label: "Impact" },
  planning: { x: 495, y: 140, r: 26, label: "Planning" },
  rollback: { x: 495, y: 290, r: 26, label: "Rollback plan" },
  hitl: { x: 685, y: 215, r: 34, label: "Human approver" },
  execution: { x: 875, y: 215, r: 34, label: "Rollout" },
};

const EDGES: Array<[AgentNodeId, AgentNodeId]> = [
  ["intake", "supervisor"],
  ["supervisor", "discovery"],
  ["supervisor", "policy"],
  ["supervisor", "impact"],
  ["discovery", "planning"],
  ["policy", "planning"],
  ["impact", "planning"],
  ["planning", "rollback"],
  ["rollback", "hitl"],
  ["hitl", "execution"],
];

const ALL_NODES = Object.keys(NODES) as AgentNodeId[];

function edgePath(from: AgentNodeId, to: AgentNodeId): string {
  const a = NODES[from];
  const b = NODES[to];
  if (Math.abs(a.x - b.x) < 4) {
    return `M ${a.x} ${a.y + a.r} L ${b.x} ${b.y - b.r}`;
  }
  const x1 = a.x + a.r;
  const x2 = b.x - b.r;
  const dx = (x2 - x1) / 2;
  return `M ${x1} ${a.y} C ${x1 + dx} ${a.y}, ${x2 - dx} ${b.y}, ${x2} ${b.y}`;
}

type EdgeMode = "flow" | "done" | "blocked" | "idle";

function edgeMode(from: VisualNodeState, to: VisualNodeState): EdgeMode {
  const bad = (s: VisualNodeState) => s === "ABORTED" || s === "FAILED";
  if (bad(to) || bad(from)) return from === "COMPLETED" || bad(from) ? "blocked" : "idle";
  if (from === "COMPLETED" && (to === "ACTIVE" || to === "WAITING")) return "flow";
  if (from === "COMPLETED" && to === "COMPLETED") return "done";
  return "idle";
}

const NODE_COLORS: Record<VisualNodeState, { stroke: string; fill: string; icon: string }> = {
  IDLE: { stroke: "#cbd5e1", fill: "#ffffff", icon: "#94a3b8" },
  ACTIVE: { stroke: "#2563eb", fill: "#eff6ff", icon: "#1d4ed8" },
  COMPLETED: { stroke: "#10b981", fill: "#ecfdf5", icon: "#047857" },
  WAITING: { stroke: "#d97706", fill: "#fffbeb", icon: "#b45309" },
  ABORTED: { stroke: "#dc2626", fill: "#fef2f2", icon: "#b91c1c" },
  FAILED: { stroke: "#dc2626", fill: "#fef2f2", icon: "#b91c1c" },
  SKIPPED: { stroke: "#e2e8f0", fill: "#f8fafc", icon: "#cbd5e1" },
};

const STATE_CAPTION: Partial<Record<VisualNodeState, string>> = {
  ACTIVE: "Working…",
  WAITING: "Awaiting approval",
  ABORTED: "Stopped safely",
  FAILED: "Failed",
};

interface Narration {
  headline: string;
  detail: string;
  focus: AgentNodeId | null;
  tone: "blue" | "amber" | "green" | "red" | "slate";
}

function deriveNarration(
  states: Record<AgentNodeId, VisualNodeState>,
  replayDescription?: string | null
): Narration {
  const active = ALL_NODES.filter((n) => states[n] === "ACTIVE");
  const waiting = ALL_NODES.filter((n) => states[n] === "WAITING");
  const bad = ALL_NODES.filter((n) => states[n] === "ABORTED" || states[n] === "FAILED");

  if (waiting.length > 0) {
    return {
      headline: "Paused for a human decision",
      detail:
        replayDescription ??
        "Everything is analysed and a rollback is ready. A second authorised engineer must review the diff and sign before anything is changed.",
      focus: waiting[0],
      tone: "amber",
    };
  }
  if (bad.length > 0) {
    return {
      headline: "Stopped safely",
      detail:
        replayDescription ??
        "A safety check failed, so nothing further was applied. The audit log records exactly why.",
      focus: bad[0],
      tone: "red",
    };
  }
  if (active.length > 0) {
    const names = active.map((n) => NODES[n].label);
    return {
      headline:
        active.length > 1 ? `${names.join(", ")} are working in parallel` : `${names[0]} is working`,
      detail: replayDescription ?? AGENT_GUIDES[active[0]].plainEnglish,
      focus: active[0],
      tone: "blue",
    };
  }
  if (states.execution === "COMPLETED") {
    return {
      headline: "Change is live and verified",
      detail: replayDescription ?? "Health probes passed. Every handoff is recorded in the audit chain.",
      focus: "execution",
      tone: "green",
    };
  }
  return {
    headline: "Ready",
    detail: replayDescription ?? "Waiting for a request to enter the pipeline.",
    focus: null,
    tone: "slate",
  };
}

const TONE: Record<Narration["tone"], string> = {
  blue: "border-blue-200 dark:border-sky-500/30 bg-blue-50/60 dark:bg-sky-500/10",
  amber: "border-amber-300 bg-amber-50/70 dark:bg-amber-500/10",
  green: "border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/10",
  red: "border-red-200 dark:border-rose-500/30 bg-red-50/60 dark:bg-rose-500/10",
  slate: "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#090D16]",
};

interface AnimatedAgentFlowProps {
  nodeStates: Record<AgentNodeId, VisualNodeState>;
  assignments: DynamicTaskAssignment[];
  selectedAgentId: AgentNodeId;
  onSelectAgent: (id: AgentNodeId) => void;
  onInspectDynamic: (agentName: string) => void;
  streamConnected: boolean;
  replayDescription?: string | null;
  inspector?: ReactNode;
  onCloseInspector: () => void;
}

export function AnimatedAgentFlow({
  nodeStates,
  assignments,
  selectedAgentId,
  onSelectAgent,
  onInspectDynamic,
  streamConnected,
  replayDescription,
  inspector,
  onCloseInspector,
}: AnimatedAgentFlowProps) {
  const uid = useId().replace(/:/g, "");
  const prevStates = useRef(nodeStates);
  const [burstNodes, setBurstNodes] = useState<AgentNodeId[]>([]);

  useEffect(() => {
    const justCompleted = ALL_NODES.filter(
      (n) => nodeStates[n] === "COMPLETED" && prevStates.current[n] !== "COMPLETED"
    );
    prevStates.current = nodeStates;
    if (justCompleted.length === 0) return;
    setBurstNodes(justCompleted);
    const t = setTimeout(() => setBurstNodes([]), 2400);
    return () => clearTimeout(t);
  }, [nodeStates]);

  const completedCount = ALL_NODES.filter((n) => nodeStates[n] === "COMPLETED").length;
  const percent = Math.round((completedCount / ALL_NODES.length) * 100);
  const narration = useMemo(
    () => deriveNarration(nodeStates, replayDescription),
    [nodeStates, replayDescription]
  );
  const focusGuide = narration.focus ? AGENT_GUIDES[narration.focus] : null;

  const dynamicByStage = useMemo(() => {
    const map: Record<StageId, DynamicTaskAssignment[]> = {
      understand: [],
      analyze: [],
      plan: [],
      approve: [],
      rollout: [],
    };
    for (const a of assignments) map[STAGE_OF_HOOK[a.hookStage]]?.push(a);
    return map;
  }, [assignments]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span
          className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
            streamConnected
              ? "text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10"
              : "text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#090D16]"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              streamConnected ? "bg-emerald-500 afd-live-dot" : "bg-slate-400"
            }`}
          />
          {streamConnected ? "LIVE" : "OFFLINE"}
        </span>
        <div
          className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Pipeline progress"
        >
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500"
            initial={false}
            animate={{ width: `${percent}%` }}
            transition={{ type: "spring", stiffness: 90, damping: 20 }}
          />
        </div>
        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
          {completedCount}/{ALL_NODES.length} agents done
        </span>
      </div>

      <svg
        viewBox="0 0 1000 440"
        className="w-full h-auto select-none"
        role="group"
        aria-label="Animated multi-agent pipeline"
      >
        <defs>
          <filter id={`${uid}-glow`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {STAGES.map((stage, i) => {
          const states = stage.agents.map((a) => nodeStates[a]);
          const hasActive = states.includes("ACTIVE");
          const hasWaiting = states.includes("WAITING");
          const hasBad = states.some((s) => s === "ABORTED" || s === "FAILED");
          const allDone = states.every((s) => s === "COMPLETED");
          const stroke = hasBad
            ? "#fca5a5"
            : hasWaiting
              ? "#fcd34d"
              : hasActive
                ? "#93c5fd"
                : allDone
                  ? "#a7f3d0"
                  : "#e2e8f0";
          const fill = hasBad
            ? "#fef2f2"
            : hasWaiting
              ? "#fffbeb"
              : hasActive
                ? "#f0f7ff"
                : allDone
                  ? "#f6fdf9"
                  : "#f8fafc";
          return (
            <g key={stage.id}>
              <rect
                x={PANEL_X[i]}
                y={46}
                width={PANEL_W}
                height={316}
                rx={16}
                fill={fill}
                stroke={stroke}
                strokeWidth={hasActive || hasWaiting ? 2 : 1.25}
                className={hasActive || hasWaiting ? "afd-panel-glow" : undefined}
                style={{ transition: "fill .5s, stroke .5s" }}
              />
              <text
                x={PANEL_X[i] + PANEL_W / 2}
                y={70}
                textAnchor="middle"
                className="fill-slate-900"
                style={{ fontSize: 13, fontWeight: 700 }}
              >
                {i + 1}. {stage.title}
              </text>
              <text
                x={PANEL_X[i] + PANEL_W / 2}
                y={86}
                textAnchor="middle"
                className="fill-slate-500"
                style={{ fontSize: 10 }}
              >
                {stage.tag}
              </text>
            </g>
          );
        })}

        {EDGES.map(([from, to]) => {
          const mode: EdgeMode = burstNodes.includes(from)
            ? "flow"
            : edgeMode(nodeStates[from], nodeStates[to]);
          const d = edgePath(from, to);
          const color =
            mode === "flow"
              ? "#2563eb"
              : mode === "done"
                ? "#10b981"
                : mode === "blocked"
                  ? "#dc2626"
                  : "#cbd5e1";
          return (
            <g key={`${from}-${to}`}>
              <path
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={mode === "flow" ? 2.5 : 2}
                strokeLinecap="round"
                strokeDasharray={
                  mode === "flow" ? "6 6" : mode === "idle" || mode === "blocked" ? "3 5" : undefined
                }
                className={mode === "flow" ? "afd-flow-dash" : undefined}
                style={{ transition: "stroke .4s" }}
              />
              {mode === "flow" && (
                <>
                  <circle r={5} fill="#2563eb" filter={`url(#${uid}-glow)`}>
                    <animateMotion dur="1.5s" repeatCount="indefinite" path={d} />
                  </circle>
                  <circle r={3} fill="#93c5fd" opacity={0.9}>
                    <animateMotion dur="1.5s" begin="0.5s" repeatCount="indefinite" path={d} />
                  </circle>
                </>
              )}
            </g>
          );
        })}

        {ALL_NODES.map((id) => {
          const n = NODES[id];
          const state = nodeStates[id];
          const c = NODE_COLORS[state];
          const Icon = state === "WAITING" ? Lock : AGENT_GUIDES[id].icon;
          const caption = STATE_CAPTION[state];
          const selected = selectedAgentId === id;
          return (
            <g
              key={id}
              role="button"
              tabIndex={0}
              aria-label={`${AGENT_GUIDES[id].title}: ${state.toLowerCase()}`}
              onClick={() => onSelectAgent(id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectAgent(id);
                }
              }}
              className="cursor-pointer outline-none afd-node"
              opacity={state === "SKIPPED" ? 0.55 : 1}
            >
              {selected && (
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.r + 9}
                  fill="none"
                  stroke="#0f172a"
                  strokeWidth={1.5}
                  strokeDasharray="2 4"
                />
              )}
              {state === "ACTIVE" && (
                <>
                  <circle cx={n.x} cy={n.y} r={n.r} fill="none" stroke="#3b82f6" strokeWidth={2} className="afd-ping" />
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={n.r + 5}
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeDasharray="28 120"
                    className="afd-spin"
                  />
                </>
              )}
              {state === "WAITING" && (
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.r + 4}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth={3}
                  className="afd-breathe"
                />
              )}
              <circle
                cx={n.x}
                cy={n.y}
                r={n.r}
                fill={c.fill}
                stroke={c.stroke}
                strokeWidth={2.5}
                style={{ transition: "fill .4s, stroke .4s" }}
              />
              <Icon
                x={n.x - n.r * 0.5}
                y={n.y - n.r * 0.5}
                width={n.r}
                height={n.r}
                color={c.icon}
                strokeWidth={2}
              />
              {state === "COMPLETED" && (
                <g className="afd-pop">
                  <circle cx={n.x + n.r * 0.75} cy={n.y - n.r * 0.75} r={9} fill="#10b981" stroke="#fff" strokeWidth={2} />
                  <Check
                    x={n.x + n.r * 0.75 - 5.5}
                    y={n.y - n.r * 0.75 - 5.5}
                    width={11}
                    height={11}
                    color="#fff"
                    strokeWidth={3.5}
                  />
                </g>
              )}
              {(state === "ABORTED" || state === "FAILED") && (
                <g className="afd-pop">
                  <circle cx={n.x + n.r * 0.75} cy={n.y - n.r * 0.75} r={9} fill="#dc2626" stroke="#fff" strokeWidth={2} />
                  <X
                    x={n.x + n.r * 0.75 - 5.5}
                    y={n.y - n.r * 0.75 - 5.5}
                    width={11}
                    height={11}
                    color="#fff"
                    strokeWidth={3.5}
                  />
                </g>
              )}
              <text
                x={n.x}
                y={n.y + n.r + 24}
                textAnchor="middle"
                className="fill-slate-800"
                style={{ fontSize: 12, fontWeight: 600, paintOrder: "stroke", stroke: "#fff", strokeWidth: 4 }}
              >
                {n.label}
              </text>
              {caption && (
                <text
                  x={n.x}
                  y={n.y + n.r + 38}
                  textAnchor="middle"
                  style={{
                    fontSize: 10,
                    fill: c.icon,
                    fontWeight: 600,
                    paintOrder: "stroke",
                    stroke: "#fff",
                    strokeWidth: 4,
                  }}
                >
                  {caption}
                </text>
              )}
            </g>
          );
        })}

        {STAGES.map((stage, i) => {
          const items = dynamicByStage[stage.id];
          if (items.length === 0) return null;
          const shown = items.slice(0, 2);
          const extra = items.length - shown.length;
          return (
            <g key={`dyn-${stage.id}`}>
              {shown.map((a, row) => {
                const done = a.status === "COMPLETED";
                const running = a.status === "RUNNING";
                const bad = a.status.startsWith("SKIPPED");
                const dot = bad ? "#dc2626" : done ? "#10b981" : running ? "#2563eb" : "#94a3b8";
                const y = 380 + row * 22;
                const name = a.agentName.replace(/Agent$/, "");
                return (
                  <g
                    key={a.taskId}
                    role="button"
                    tabIndex={0}
                    aria-label={`Specialist agent ${a.agentName}`}
                    onClick={() => onInspectDynamic(a.agentName)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onInspectDynamic(a.agentName);
                      }
                    }}
                    className="cursor-pointer outline-none afd-node"
                  >
                    <rect x={PANEL_X[i]} y={y} width={PANEL_W} height={18} rx={9} fill="#fff" stroke="#e2e8f0" />
                    <circle
                      cx={PANEL_X[i] + 11}
                      cy={y + 9}
                      r={4}
                      fill={dot}
                      className={running ? "afd-live-dot" : undefined}
                    />
                    <text x={PANEL_X[i] + 21} y={y + 12.5} style={{ fontSize: 10 }} className="fill-slate-700">
                      {name.length > 21 ? `${name.slice(0, 20)}…` : name}
                    </text>
                  </g>
                );
              })}
              {extra > 0 && (
                <text
                  x={PANEL_X[i] + 8}
                  y={380 + shown.length * 22 + 12}
                  style={{ fontSize: 10 }}
                  className="fill-slate-500"
                >
                  +{extra} more specialist{extra > 1 ? "s" : ""}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <AnimatePresence mode="wait">
        <motion.div
          key={narration.headline}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.25 }}
          className={`rounded-lg border p-4 ${TONE[narration.tone]}`}
          aria-live="polite"
        >
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{narration.headline}</div>
          <p className="text-xs text-slate-700 dark:text-slate-300 mt-1 leading-relaxed">{narration.detail}</p>
          {focusGuide && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="px-2 py-1 rounded-md bg-white dark:bg-[#0F172A]/80 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                <span className="font-medium text-slate-800 dark:text-slate-200">Receives:</span> {focusGuide.receives}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
              <span className="px-2 py-1 rounded-md bg-white dark:bg-[#0F172A]/80 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                <span className="font-medium text-slate-800 dark:text-slate-200">Produces:</span> {focusGuide.produces}
              </span>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {inspector ? (
        <div className="relative">
          <button
            type="button"
            onClick={onCloseInspector}
            className="absolute right-2 top-2 z-10 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A]"
          >
            Close details
          </button>
          {inspector}
        </div>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
          Click any agent to see what it receives, produces and who it hands off to. Switch to Detailed for the full diagram.
        </p>
      )}
    </div>
  );
}
