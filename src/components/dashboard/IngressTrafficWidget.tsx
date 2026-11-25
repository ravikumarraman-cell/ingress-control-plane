import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertCircle, Radio, ShieldAlert, ShieldCheck } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchTrafficTelemetry } from "../../lib/api";
import { formatTimeHMS } from "../../lib/format";
import { useWorkflowStream } from "../../lib/useWorkflowStream";
import type { TrafficTelemetryPoint, TrafficTelemetryWindow } from "../../shared/contracts";
import { SegmentedTabs } from "../ui/SegmentedTabs";

const numberFormatter = new Intl.NumberFormat("en-US");

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload?: TrafficTelemetryPoint;
  }>;
}

function TrafficTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  const total = point.ingressTraffic + point.blockedThreats;
  const blockPct = total > 0 ? ((point.blockedThreats / total) * 100).toFixed(2) : "0.00";

  return (
    <div className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-md px-3 py-2.5 shadow-sm text-xs space-y-1.5 min-w-[210px]">
      <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-100 pb-1 flex items-center justify-between gap-4 tabular-nums">
        <span>{point.label}</span>
        <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">{blockPct}% blocked</span>
      </div>
      <div className="flex items-center justify-between gap-4 tabular-nums">
        <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
          <span className="h-2 w-2 rounded-xs bg-blue-700 inline-block" aria-hidden="true" />
          Ingress Traffic
        </span>
        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
          {numberFormatter.format(point.ingressTraffic)} req/m
        </span>
      </div>
      <div className="flex items-center justify-between gap-4 tabular-nums">
        <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
          <span className="h-2 w-2 rounded-xs bg-red-600 inline-block" aria-hidden="true" />
          Blocked Threats
        </span>
        <span className="font-mono font-semibold text-red-700 dark:text-rose-400">
          {numberFormatter.format(point.blockedThreats)} req/m
        </span>
      </div>
      <div className="pt-1 border-t border-slate-100 grid grid-cols-3 gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
        <span>WAF: {point.wafBlocks}</span>
        <span>TLS: {point.tlsRejects}</span>
        <span>Veto: {point.policyDriftVetoes}</span>
      </div>
    </div>
  );
}

export function IngressTrafficWidget() {
  const [windowKey, setWindowKey] = useState<TrafficTelemetryWindow>("15m");
  const { streamConnected } = useWorkflowStream();

  const telemetryQuery = useQuery({
    queryKey: ["traffic-telemetry", windowKey],
    queryFn: () => fetchTrafficTelemetry(windowKey),
    refetchInterval: 5_000,
  });

  if (telemetryQuery.isLoading) {
    return (
      <section
        aria-label="Ingress Traffic vs. Blocked Threats"
        className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="h-5 w-64 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
          <div className="h-7 w-40 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
        </div>
        <div className="h-60 bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md animate-pulse" />
      </section>
    );
  }

  if (telemetryQuery.isError || !telemetryQuery.data) {
    return (
      <section
        aria-label="Ingress Traffic vs. Blocked Threats"
        className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-lg p-5"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-red-800">
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
            <span>Unable to load real-time ingress traffic telemetry.</span>
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

  const { summary, series, generatedAt } = telemetryQuery.data;

  return (
    <section
      aria-label="Ingress Traffic vs. Blocked Threats"
      className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <Activity className="h-4 w-4 text-blue-700 dark:text-sky-400 shrink-0" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Ingress Traffic vs. Blocked Threats
            </h2>
            <span className="inline-flex items-center gap-1 text-xs font-mono text-emerald-700 dark:text-emerald-400 tabular-nums">
              <Radio className="h-3 w-3 shrink-0" />
              {streamConnected ? "Live 5s" : "Polling 5s"}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
            Real-time edge throughput against WAF rule blocks, TLS handshake rejections, and
            anti-drift policy vetoes · Updated {formatTimeHMS(generatedAt)}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0 flex-wrap">
          <SegmentedTabs
            ariaLabel="Traffic telemetry time window"
            value={windowKey}
            onChange={setWindowKey}
            items={[
              { id: "15m", label: "15m" },
              { id: "1h", label: "1h" },
              { id: "24h", label: "24h" },
            ]}
          />
        </div>
      </div>

      {/* Inline KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 border-b border-slate-200 dark:border-slate-800 divide-y lg:divide-y-0 divide-x divide-slate-200 dark:divide-slate-800 bg-slate-50/40 dark:bg-[#090D16]">
        <div className="px-5 py-3">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Current Ingress Rate</div>
          <div className="mt-0.5 flex items-baseline gap-1.5 tabular-nums">
            <span className="text-lg font-semibold font-mono text-blue-800">
              {numberFormatter.format(summary.currentIngressRpm)}
            </span>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400">req/min</span>
          </div>
        </div>

        <div className="px-5 py-3">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Blocked Threats Rate</div>
          <div className="mt-0.5 flex items-baseline gap-1.5 tabular-nums">
            <span className="text-lg font-semibold font-mono text-red-700 dark:text-rose-400">
              {numberFormatter.format(summary.currentBlockedRpm)}
            </span>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400">req/min</span>
          </div>
        </div>

        <div className="px-5 py-3">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Window Block Ratio ({windowKey})
          </div>
          <div className="mt-0.5 flex items-baseline gap-1.5 tabular-nums">
            <span className="text-lg font-semibold font-mono text-slate-900 dark:text-slate-100">
              {summary.blockRatePct.toFixed(2)}%
            </span>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
              ({numberFormatter.format(summary.totalBlockedThreats)} blocked)
            </span>
          </div>
        </div>

        <div className="px-5 py-3">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Edge Shield Coverage</div>
          <div className="mt-0.5 flex items-center gap-1.5 tabular-nums">
            <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
            <span className="text-sm font-semibold font-mono text-slate-900 dark:text-slate-100">
              {summary.wafProtectedRoutes}/{summary.totalRoutes} WAF
            </span>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
              · {summary.strictTlsRoutes}/{summary.totalRoutes} Strict TLS
            </span>
          </div>
        </div>
      </div>

      {/* Recharts AreaChart */}
      <div className="px-4 pt-5 pb-3">
        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="ingressTrafficFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#1d4ed8" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#1d4ed8" stopOpacity={0.01} />
                </linearGradient>
                <linearGradient id="blockedThreatsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#dc2626" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#dc2626" stopOpacity={0.02} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />

              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "#64748b", fontFamily: "JetBrains Mono, monospace" }}
                axisLine={{ stroke: "#e2e8f0" }}
                tickLine={false}
                minTickGap={24}
              />

              <YAxis
                yAxisId="traffic"
                width={52}
                tickFormatter={(val: number) =>
                  val >= 1000 ? `${(val / 1000).toFixed(1)}k` : String(val)
                }
                tick={{ fontSize: 11, fill: "#1d4ed8", fontFamily: "JetBrains Mono, monospace" }}
                axisLine={false}
                tickLine={false}
              />

              <YAxis
                yAxisId="threats"
                orientation="right"
                width={44}
                tick={{ fontSize: 11, fill: "#dc2626", fontFamily: "JetBrains Mono, monospace" }}
                axisLine={false}
                tickLine={false}
              />

              <Tooltip content={<TrafficTooltip />} />

              <Area
                yAxisId="traffic"
                type="monotone"
                dataKey="ingressTraffic"
                name="Ingress Traffic"
                stroke="#1d4ed8"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#ingressTrafficFill)"
                isAnimationActive={false}
              />

              <Area
                yAxisId="threats"
                type="monotone"
                dataKey="blockedThreats"
                name="Blocked Threats"
                stroke="#dc2626"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#blockedThreatsFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Footer Legend & Threat Breakdown */}
      <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-[#090D16] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
            <span className="h-2.5 w-2.5 rounded-xs bg-blue-700 inline-block" aria-hidden="true" />
            Allowed Ingress Traffic (left axis, req/min)
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
            <span className="h-2.5 w-2.5 rounded-xs bg-red-600 inline-block" aria-hidden="true" />
            Blocked Threats (right axis, req/min)
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
          <span className="inline-flex items-center gap-1">
            <ShieldAlert className="h-3.5 w-3.5 text-red-600 shrink-0" />
            WAF Rules: {numberFormatter.format(summary.threatBreakdown.wafRuleBlocks)}
          </span>
          <span aria-hidden="true">·</span>
          <span>TLS Rejects: {numberFormatter.format(summary.threatBreakdown.tlsHandshakeRejects)}</span>
          <span aria-hidden="true">·</span>
          <span>Policy/Drift Vetoes: {numberFormatter.format(summary.threatBreakdown.policyDriftVetoes)}</span>
        </div>
      </div>
    </section>
  );
}
