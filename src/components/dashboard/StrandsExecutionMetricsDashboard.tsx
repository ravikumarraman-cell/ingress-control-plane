import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Cpu,
  Layers,
  Play,
  RefreshCw,
  Wrench,
  XCircle,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchStrandsTelemetry, runStrandsEvals } from "../../lib/api";
import { formatTimeHMS } from "../../lib/format";
import type {
  StrandsEvalRunReport,
  StrandsToolBreakdown,
} from "../../shared/contracts";
import { SegmentedTabs } from "../ui/SegmentedTabs";

const numberFormatter = new Intl.NumberFormat("en-US");

type ViewMode = "timeline" | "by-agent";

interface ChartRow {
  xLabel: string;
  agentName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  successfulIterations: number;
  failedIterations: number;
  cycleDurationMs: number;
  durationMs: number;
  avgDurationMs?: number;
  stopReason?: string;
  successRatePct?: number;
}

function shortAgentLabel(name: string): string {
  return name.replace(/Agent$/, "");
}

interface TokenTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload?: ChartRow;
  }>;
}

function TokenUsageTooltip({ active, payload }: TokenTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  return (
    <div className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-md px-3 py-2.5 shadow-sm text-xs space-y-1.5 min-w-[215px]">
      <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-100 pb-1 flex items-center justify-between gap-3">
        <span className="truncate">{row.agentName}</span>
        {row.stopReason && (
          <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">{row.stopReason}</span>
        )}
      </div>
      <div className="flex items-center justify-between gap-4 tabular-nums">
        <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
          <span className="h-2 w-2 rounded-xs bg-blue-700 inline-block" aria-hidden="true" />
          Input Tokens
        </span>
        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
          {numberFormatter.format(row.inputTokens)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4 tabular-nums">
        <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
          <span className="h-2 w-2 rounded-xs bg-sky-500 inline-block" aria-hidden="true" />
          Output Tokens
        </span>
        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
          {numberFormatter.format(row.outputTokens)}
        </span>
      </div>
      <div className="pt-1 border-t border-slate-100 flex items-center justify-between gap-4 text-[11px] font-mono text-slate-600 dark:text-slate-400 tabular-nums">
        <span>Total Tokens</span>
        <span className="font-semibold text-slate-900 dark:text-slate-100">
          {numberFormatter.format(row.totalTokens)}
        </span>
      </div>
    </div>
  );
}

interface ToolTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload?: StrandsToolBreakdown;
  }>;
}

function ToolLatencyTooltip({ active, payload }: ToolTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const tool = payload[0]?.payload;
  if (!tool) return null;

  return (
    <div className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-md px-3 py-2.5 shadow-sm text-xs space-y-1.5 min-w-[220px]">
      <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-100 pb-1">
        {tool.toolName}
      </div>
      <div className="flex items-center justify-between gap-4 tabular-nums">
        <span className="text-slate-600 dark:text-slate-400">Avg Latency</span>
        <span className="font-mono font-semibold text-violet-700">
          {tool.avgLatencyMs.toFixed(1)} ms
        </span>
      </div>
      <div className="flex items-center justify-between gap-4 tabular-nums">
        <span className="text-slate-600 dark:text-slate-400">Cumulative Tool Time</span>
        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
          {tool.totalTimeMs.toFixed(1)} ms
        </span>
      </div>
      <div className="pt-1 border-t border-slate-100 grid grid-cols-3 gap-2 text-[11px] font-mono text-slate-600 dark:text-slate-400 tabular-nums">
        <span>Calls: {tool.callCount}</span>
        <span className="text-emerald-700 dark:text-emerald-400">OK: {tool.successCount}</span>
        <span className={tool.errorCount > 0 ? "text-red-700 dark:text-rose-400" : "text-slate-500 dark:text-slate-400"}>
          Err: {tool.errorCount}
        </span>
      </div>
    </div>
  );
}

interface IterationTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload?: ChartRow;
  }>;
}

function IterationSuccessTooltip({ active, payload }: IterationTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  const succ = row.successfulIterations ?? 0;
  const fail = row.failedIterations ?? 0;
  const total = succ + fail;
  const rate =
    typeof row.successRatePct === "number"
      ? row.successRatePct
      : total > 0
        ? Math.round((succ / total) * 1000) / 10
        : 100;
  const duration = row.durationMs ?? row.avgDurationMs ?? 0;

  return (
    <div className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-md px-3 py-2.5 shadow-sm text-xs space-y-1.5 min-w-[220px]">
      <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-100 pb-1 flex items-center justify-between gap-3">
        <span className="truncate">{row.agentName}</span>
        <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400 tabular-nums">
          {rate.toFixed(1)}% pass
        </span>
      </div>
      <div className="flex items-center justify-between gap-4 tabular-nums">
        <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
          <span className="h-2 w-2 rounded-xs bg-emerald-600 inline-block" aria-hidden="true" />
          Successful Iterations
        </span>
        <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">{succ}</span>
      </div>
      <div className="flex items-center justify-between gap-4 tabular-nums">
        <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
          <span className="h-2 w-2 rounded-xs bg-red-600 inline-block" aria-hidden="true" />
          Failed / Guardrail Stops
        </span>
        <span className="font-mono font-semibold text-red-700 dark:text-rose-400">{fail}</span>
      </div>
      <div className="pt-1 border-t border-slate-100 flex items-center justify-between gap-4 text-[11px] font-mono text-slate-600 dark:text-slate-400 tabular-nums">
        <span>Cycle Duration</span>
        <span className="font-semibold text-slate-900 dark:text-slate-100">{duration} ms</span>
      </div>
    </div>
  );
}

export function StrandsExecutionMetricsDashboard() {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");
  const [lastEvalReport, setLastEvalReport] = useState<StrandsEvalRunReport | null>(null);

  const telemetryQuery = useQuery({
    queryKey: ["strands-telemetry"],
    queryFn: fetchStrandsTelemetry,
    refetchInterval: 10_000,
  });

  const evalsMutation = useMutation({
    mutationFn: runStrandsEvals,
    onSuccess: (report) => {
      setLastEvalReport(report);
      queryClient.invalidateQueries({ queryKey: ["strands-telemetry"] });
    },
  });

  if (telemetryQuery.isLoading) {
    return (
      <section
        aria-label="Strands Agents Execution Metrics"
        className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="h-5 w-72 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
          <div className="h-8 w-44 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-64 bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  if (telemetryQuery.isError || !telemetryQuery.data) {
    return (
      <section
        aria-label="Strands Agents Execution Metrics"
        className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-lg p-5"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-red-800">
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
            <span>Unable to load Strands Agents execution metrics.</span>
          </div>
          <button
            type="button"
            onClick={() => telemetryQuery.refetch()}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/60 whitespace-nowrap"
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  const data = telemetryQuery.data;
  const { aggregates, toolLatencyMetrics, agentBreakdown, iterationSeries, recentInvocations, providers } =
    data;

  const isEmpty = aggregates.totalInvocations === 0;

  const chartSeriesData: ChartRow[] =
    viewMode === "timeline"
      ? iterationSeries.map((pt) => ({
          xLabel: `${shortAgentLabel(pt.agentName)}#${pt.index}`,
          agentName: pt.agentName,
          inputTokens: pt.inputTokens,
          outputTokens: pt.outputTokens,
          totalTokens: pt.totalTokens,
          successfulIterations: pt.successfulIterations,
          failedIterations: pt.failedIterations,
          cycleDurationMs: pt.durationMs,
          durationMs: pt.durationMs,
          stopReason: pt.stopReason,
        }))
      : agentBreakdown.slice(0, 10).map((ag) => ({
          xLabel: shortAgentLabel(ag.agentName),
          agentName: ag.agentName,
          inputTokens: ag.inputTokens,
          outputTokens: ag.outputTokens,
          totalTokens: ag.totalTokens,
          successfulIterations: ag.successfulIterations,
          failedIterations: ag.failedIterations,
          cycleDurationMs: ag.avgDurationMs,
          durationMs: ag.avgDurationMs,
          avgDurationMs: ag.avgDurationMs,
          successRatePct: ag.successRatePct,
        }));

  const topTools = toolLatencyMetrics.slice(0, 8);
  const configuredLiveProviders = providers.filter(
    (p) => p.configured && p.provider !== "deterministic"
  );

  return (
    <section
      aria-label="Strands Agents Execution Metrics"
      className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden"
    >
      {/* Dashboard Header */}
      <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <Cpu className="h-4 w-4 text-blue-700 dark:text-sky-400 shrink-0" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Strands Agents Execution Metrics
            </h2>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
              {data.sdkVersion} · {data.harnessVersion}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
            Token consumption, read-only tool call latency, and agent loop iteration success across
            Strands Graph, Harness, and Eval runs ·{" "}
            {data.telemetryConfig.otlpEnabled ? "OTLP Exporter Active" : "Local Meter Active"} ·{" "}
            {configuredLiveProviders.length > 0
              ? `Live LLM: ${configuredLiveProviders.map((p) => p.provider).join(", ")}`
              : "Deterministic Control Plane Model"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <SegmentedTabs
            ariaLabel="Strands execution chart aggregation mode"
            value={viewMode}
            onChange={setViewMode}
            items={[
              { id: "timeline", label: "Recent Runs" },
              { id: "by-agent", label: "By Agent" },
            ]}
          />

          <button
            type="button"
            onClick={() => telemetryQuery.refetch()}
            disabled={telemetryQuery.isFetching}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/60 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${telemetryQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>

          <button
            type="button"
            onClick={() => evalsMutation.mutate()}
            disabled={evalsMutation.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
          >
            <Play className="h-3.5 w-3.5 shrink-0" />
            {evalsMutation.isPending ? "Running Evals..." : "Run Strands Evals"}
          </button>
        </div>
      </div>

      {/* Inline Eval Feedback Banner (only rendered after an explicit eval run) */}
      {lastEvalReport && (
        <div className="px-5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#090D16] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            {lastEvalReport.allPassed ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 text-red-600 shrink-0" />
            )}
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              Strands Eval Suite: {lastEvalReport.passedCount}/{lastEvalReport.totalCount} Passed
            </span>
            <span className="text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              @ {formatTimeHMS(lastEvalReport.evaluatedAt)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-slate-600 dark:text-slate-400 tabular-nums">
            {lastEvalReport.cases.map((c) => (
              <span key={c.evalId} className="inline-flex items-center gap-1">
                <span className={c.passed ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-rose-400"}>
                  {c.evalId}: {c.passed ? "PASS" : "FAIL"}
                </span>
                <span className="text-slate-400">({c.durationMs}ms)</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 4-KPI Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 border-b border-slate-200 dark:border-slate-800 divide-y lg:divide-y-0 divide-x divide-slate-200 dark:divide-slate-800 bg-slate-50/40 dark:bg-[#090D16]">
        <div className="px-5 py-3.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            <Layers className="h-3.5 w-3.5 text-blue-700 dark:text-sky-400 shrink-0" />
            Total Token Usage
          </div>
          <div className="mt-1 flex items-baseline gap-2 tabular-nums">
            <span className="text-xl font-semibold font-mono text-slate-900 dark:text-slate-100">
              {numberFormatter.format(aggregates.totalTokens)}
            </span>
            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">tokens</span>
          </div>
          <div className="mt-0.5 text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
            {numberFormatter.format(aggregates.inputTokens)} in ·{" "}
            {numberFormatter.format(aggregates.outputTokens)} out
          </div>
        </div>

        <div className="px-5 py-3.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            <Wrench className="h-3.5 w-3.5 text-violet-700 shrink-0" />
            Avg Tool Call Latency
          </div>
          <div className="mt-1 flex items-baseline gap-1.5 tabular-nums">
            <span className="text-xl font-semibold font-mono text-violet-800">
              {aggregates.avgToolLatencyMs.toFixed(1)}
            </span>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400">ms</span>
          </div>
          <div className="mt-0.5 text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
            {numberFormatter.format(aggregates.totalToolCalls)} tool call(s) across{" "}
            {toolLatencyMetrics.length} tools
          </div>
        </div>

        <div className="px-5 py-3.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            Successful Agent Iterations
          </div>
          <div className="mt-1 flex items-baseline gap-2 tabular-nums">
            <span className="text-xl font-semibold font-mono text-emerald-700 dark:text-emerald-400">
              {numberFormatter.format(aggregates.successfulIterations)}
            </span>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
              / {numberFormatter.format(aggregates.totalIterations)} ({aggregates.iterationSuccessRatePct.toFixed(1)}%)
            </span>
          </div>
          <div className="mt-0.5 text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
            {aggregates.failedIterations} guardrail / policy stop(s)
          </div>
        </div>

        <div className="px-5 py-3.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            <Clock className="h-3.5 w-3.5 text-slate-600 dark:text-slate-400 shrink-0" />
            Agent Invocations
          </div>
          <div className="mt-1 flex items-baseline gap-2 tabular-nums">
            <span className="text-xl font-semibold font-mono text-slate-900 dark:text-slate-100">
              {numberFormatter.format(aggregates.totalInvocations)}
            </span>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400">runs</span>
          </div>
          <div className="mt-0.5 text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
            {aggregates.liveInvocations} live SDK · {aggregates.avgDurationMs} ms avg duration
          </div>
        </div>
      </div>

      {isEmpty ? (
        <div className="p-10 text-center space-y-2">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            No Strands agent executions recorded yet
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Trigger a workflow or click Run Strands Evals to stream token, tool latency, and cycle metrics.
          </p>
        </div>
      ) : (
        <>
          {/* Three Recharts Visualizations */}
          <div className="p-5 grid grid-cols-1 xl:grid-cols-3 gap-5">
            {/* Chart 1: Token Usage */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex flex-col">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Token Usage</h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Input vs. output tokens ({viewMode === "timeline" ? "chronological runs" : "by agent"})
                  </p>
                </div>
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                  {numberFormatter.format(aggregates.totalTokens)} tok
                </span>
              </div>

              <div className="h-[230px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartSeriesData}
                    margin={{ top: 8, right: 8, left: 0, bottom: 16 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis
                      dataKey="xLabel"
                      tick={{ fontSize: 10, fill: "#64748b", fontFamily: "JetBrains Mono, monospace" }}
                      axisLine={{ stroke: "#e2e8f0" }}
                      tickLine={false}
                      interval={0}
                      angle={-25}
                      textAnchor="end"
                      height={44}
                    />
                    <YAxis
                      width={42}
                      tick={{ fontSize: 10, fill: "#64748b", fontFamily: "JetBrains Mono, monospace" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<TokenUsageTooltip />} />
                    <Bar
                      dataKey="inputTokens"
                      stackId="tokens"
                      name="Input Tokens"
                      fill="#1d4ed8"
                      radius={[0, 0, 0, 0]}
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="outputTokens"
                      stackId="tokens"
                      name="Output Tokens"
                      fill="#0ea5e9"
                      radius={[3, 3, 0, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-2 pt-2 border-t border-slate-100 flex items-center gap-4 text-[11px] text-slate-600 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-xs bg-blue-700 inline-block" aria-hidden="true" />
                  Input Tokens
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-xs bg-sky-500 inline-block" aria-hidden="true" />
                  Output Tokens
                </span>
              </div>
            </div>

            {/* Chart 2: Tool Call Latency */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex flex-col">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Tool Call Latency</h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Mean execution latency (ms) per read-only / vended tool
                  </p>
                </div>
                <span className="text-[11px] font-mono text-violet-700 tabular-nums shrink-0">
                  {aggregates.avgToolLatencyMs.toFixed(1)} ms avg
                </span>
              </div>

              {topTools.length === 0 ? (
                <div className="h-[230px] flex items-center justify-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded">
                  No tool calls captured yet.
                </div>
              ) : (
                <div className="h-[230px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={topTools}
                      layout="vertical"
                      margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 10, fill: "#64748b", fontFamily: "JetBrains Mono, monospace" }}
                        axisLine={{ stroke: "#e2e8f0" }}
                        tickLine={false}
                        unit="ms"
                      />
                      <YAxis
                        type="category"
                        dataKey="toolName"
                        width={142}
                        tick={{ fontSize: 10, fill: "#334155", fontFamily: "JetBrains Mono, monospace" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip content={<ToolLatencyTooltip />} />
                      <Bar
                        dataKey="avgLatencyMs"
                        name="Avg Latency (ms)"
                        radius={[0, 3, 3, 0]}
                        barSize={16}
                        isAnimationActive={false}
                      >
                        {topTools.map((tool) => (
                          <Cell
                            key={tool.toolName}
                            fill={tool.errorCount > 0 ? "#dc2626" : "#7c3aed"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-xs bg-violet-600 inline-block" aria-hidden="true" />
                  Healthy Tool Latency
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-xs bg-red-600 inline-block" aria-hidden="true" />
                  Includes Error / Block
                </span>
              </div>
            </div>

            {/* Chart 3: Successful Agent Iterations */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex flex-col">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Successful Agent Iterations
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Completed vs. failed loop cycles & duration trend
                  </p>
                </div>
                <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400 tabular-nums shrink-0">
                  {aggregates.iterationSuccessRatePct.toFixed(1)}% pass
                </span>
              </div>

              <div className="h-[230px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={chartSeriesData}
                    margin={{ top: 8, right: 6, left: 0, bottom: 16 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis
                      dataKey="xLabel"
                      tick={{ fontSize: 10, fill: "#64748b", fontFamily: "JetBrains Mono, monospace" }}
                      axisLine={{ stroke: "#e2e8f0" }}
                      tickLine={false}
                      interval={0}
                      angle={-25}
                      textAnchor="end"
                      height={44}
                    />
                    <YAxis
                      yAxisId="cycles"
                      width={28}
                      allowDecimals={false}
                      tick={{ fontSize: 10, fill: "#059669", fontFamily: "JetBrains Mono, monospace" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      yAxisId="duration"
                      orientation="right"
                      width={38}
                      tick={{ fontSize: 10, fill: "#475569", fontFamily: "JetBrains Mono, monospace" }}
                      axisLine={false}
                      tickLine={false}
                      unit="ms"
                    />
                    <Tooltip content={<IterationSuccessTooltip />} />
                    <Bar
                      yAxisId="cycles"
                      dataKey="successfulIterations"
                      stackId="cycles"
                      name="Successful Iterations"
                      fill="#059669"
                      isAnimationActive={false}
                    />
                    <Bar
                      yAxisId="cycles"
                      dataKey="failedIterations"
                      stackId="cycles"
                      name="Failed Iterations"
                      fill="#dc2626"
                      radius={[3, 3, 0, 0]}
                      isAnimationActive={false}
                    />
                    <Line
                      yAxisId="duration"
                      type="monotone"
                      dataKey="cycleDurationMs"
                      name="Duration (ms)"
                      stroke="#475569"
                      strokeWidth={1.75}
                      dot={{ r: 2.5, fill: "#475569" }}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap items-center gap-3 text-[11px] text-slate-600 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-xs bg-emerald-600 inline-block" aria-hidden="true" />
                  Succeeded
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-xs bg-red-600 inline-block" aria-hidden="true" />
                  Failed / Guardrail
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-3 bg-slate-600 inline-block" aria-hidden="true" />
                  Duration (ms)
                </span>
              </div>
            </div>
          </div>

          {/* Compact Recent Invocations & Provider Readiness Footer */}
          <div className="border-t border-slate-200 dark:border-slate-800 px-5 py-4 bg-slate-50/30 dark:bg-[#090D16] space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                Recent Strands Agent Executions
              </h3>
              <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                <span>Providers:</span>
                {providers.map((p) => (
                  <span
                    key={p.provider}
                    className={p.configured ? "text-emerald-700 dark:text-emerald-400 font-medium" : "text-slate-400"}
                  >
                    {p.provider}
                    {p.configured ? " ✓" : ""}
                  </span>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-md bg-white dark:bg-[#0F172A]">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#090D16] text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    <th className="py-2 px-3">Agent</th>
                    <th className="py-2 px-3">Source</th>
                    <th className="py-2 px-3">Stop Reason</th>
                    <th className="py-2 px-3 text-right">Iterations</th>
                    <th className="py-2 px-3 text-right">Tokens (In/Out)</th>
                    <th className="py-2 px-3 text-right">Tool Latency</th>
                    <th className="py-2 px-3 text-right">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono tabular-nums">
                  {recentInvocations.slice(0, 6).map((inv) => (
                    <tr key={inv.recordId} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/60">
                      <td className="py-2 px-3 font-sans font-medium text-slate-900 dark:text-slate-100">
                        {inv.agentName}
                      </td>
                      <td className="py-2 px-3 text-[11px] text-slate-600 dark:text-slate-400">
                        {inv.source === "live_strands" ? "Live Strands SDK" : "Workflow Trace"}
                      </td>
                      <td className="py-2 px-3 text-[11px]">
                        <span
                          className={
                            inv.failedCycles > 0 ? "text-red-700 dark:text-rose-400 font-medium" : "text-emerald-700 dark:text-emerald-400"
                          }
                        >
                          {inv.stopReason}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right text-slate-800 dark:text-slate-200">
                        {inv.successfulCycles}/{inv.totalCycles}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-800 dark:text-slate-200">
                        {inv.tokenUsage.totalTokens}{" "}
                        <span className="text-[11px] text-slate-400">
                          ({inv.tokenUsage.inputTokens}/{inv.tokenUsage.outputTokens})
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right text-violet-700">
                        {inv.toolCallsCount > 0 ? `${inv.avgToolLatencyMs.toFixed(1)} ms` : "—"}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-800 dark:text-slate-200">{inv.durationMs} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
