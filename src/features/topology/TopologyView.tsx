import React, { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { FlowEdge } from '../../components/primitives/FlowEdge';
import { TopologyNodeCard } from '../../components/primitives/TopologyNodeCard';
import { EdgeRegion } from '../../core/ir/types';
import { useControlPlane } from '../../store/ControlPlaneContext';

const CARD_HEIGHT = 124;
const CARD_GAP = 16;

export const TopologyView: React.FC = () => {
  const {
    ir,
    desiredHash,
    activeHash,
    selection,
    setSelection,
    telemetry,
    chaos,
    regions,
    syncAllRegions,
    lastTrace,
    setActiveView,
  } = useControlPlane();

  const listeners = useMemo(() => Object.values(ir.listeners), [ir.listeners]);
  const routes = useMemo(
    () =>
      ir.routeOrder
        .map((id) => ir.routes[id])
        .filter((r): r is NonNullable<typeof r> => Boolean(r)),
    [ir.routeOrder, ir.routes]
  );
  const upstreams = useMemo(() => Object.values(ir.upstreams), [ir.upstreams]);

  const hasDrift = desiredHash !== activeHash;

  const maxRows = Math.max(listeners.length, routes.length, upstreams.length, 1);
  const canvasHeight = maxRows * CARD_HEIGHT + Math.max(0, maxRows - 1) * CARD_GAP + 24;

  // Compute deterministic Y center coordinates for SVG Bezier edges (relative to 3-column grid)
  const listenerY = useMemo(() => {
    const map: Record<string, number> = {};
    listeners.forEach((l, i) => {
      map[l.id] = 12 + i * (CARD_HEIGHT + CARD_GAP) + CARD_HEIGHT / 2;
    });
    return map;
  }, [listeners]);

  const routeY = useMemo(() => {
    const map: Record<string, number> = {};
    routes.forEach((r, i) => {
      map[r.id] = 12 + i * (CARD_HEIGHT + CARD_GAP) + CARD_HEIGHT / 2;
    });
    return map;
  }, [routes]);

  const upstreamY = useMemo(() => {
    const map: Record<string, number> = {};
    upstreams.forEach((u, i) => {
      map[u.id] = 12 + i * (CARD_HEIGHT + CARD_GAP) + CARD_HEIGHT / 2;
    });
    return map;
  }, [upstreams]);

  const getLatestMetric = (id: string) => {
    const arr = telemetry[id];
    if (!arr || arr.length === 0) return { rps: 0, p99Ms: 0 };
    const latest = arr[arr.length - 1];
    return { rps: latest.rps, p99Ms: latest.p99Ms };
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-auto p-4 lg:p-5 space-y-5">
      {/* Regional Sync & Control-Plane Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800/80">
        <div>
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100 text-balance">
            Edge Traffic Topology
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Cluster <span className="font-mono text-slate-800 dark:text-slate-200">{ir.clusterName}</span>
            <span className="mx-1.5" aria-hidden="true">·</span>
            <span>{listeners.length} Listeners</span>
            <span className="mx-1.5" aria-hidden="true">·</span>
            <span>{routes.length} Routes</span>
            <span className="mx-1.5" aria-hidden="true">·</span>
            <span>{upstreams.length} Upstream Pools</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {(Object.keys(regions) as EdgeRegion[]).map((regKey) => {
            const reg = regions[regKey];
            const toneClass =
              reg.status === 'synced'
                ? 'text-emerald-700 dark:text-emerald-400'
                : reg.status === 'degraded'
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-amber-700 dark:text-amber-400';
            return (
              <button
                key={regKey}
                type="button"
                onClick={() => setActiveView('security')}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-[11px] transition-colors whitespace-nowrap shrink-0"
                title="Inspect regional sync & drift"
              >
                <span className="font-mono text-slate-700 dark:text-slate-300">{regKey}</span>
                <span aria-hidden="true" className="text-slate-400 dark:text-slate-600">/</span>
                <span className={`font-medium capitalize ${toneClass}`}>{reg.status}</span>
                <span className="font-mono tabular-nums text-slate-500">{reg.syncLatencyMs}ms</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={syncAllRegions}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              hasDrift
                ? 'bg-blue-700 dark:bg-sky-500 text-white dark:text-slate-950 hover:bg-blue-800 dark:hover:bg-sky-400'
                : 'bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{hasDrift ? 'Push Desired State' : 'All Regions Synced'}</span>
          </button>
        </div>
      </div>

      {/* Trace Highlight Banner if active */}
      {lastTrace && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2 rounded-lg bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 text-xs">
          <div className="flex items-center gap-2.5">
            <span
              className={`font-mono font-semibold ${
                lastTrace.outcomeStatus < 400 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {lastTrace.outcomeLabel}
            </span>
            <span className="text-slate-500" aria-hidden="true">·</span>
            <span className="text-slate-700 dark:text-slate-300">
              Trace <span className="font-mono">{lastTrace.requestId}</span> completed in{' '}
              <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">{lastTrace.totalLatencyMs}ms</span>
            </span>
            {lastTrace.failoverTriggered && (
              <>
                <span className="text-slate-500" aria-hidden="true">·</span>
                <span className="text-amber-700 dark:text-amber-300 font-medium">Failover Reroute Active</span>
              </>
            )}
          </div>
          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
            {lastTrace.selectedEndpoint ? `Target ${lastTrace.selectedEndpoint}` : 'Blocked before upstream'}
          </span>
        </div>
      )}

      {/* 3-Column Topology Graph */}
      <div className="relative rounded-xl border border-slate-200 dark:border-slate-800/80 bg-slate-100/70 dark:bg-[#070A12] p-4 overflow-x-auto">
        <div className="min-w-[820px]">
          {/* Column Headers */}
          <div className="grid grid-cols-[240px_1fr_260px_1fr_250px] items-center mb-3 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            <div>Gateway Listeners</div>
            <div />
            <div>Ingress Routes & Middleware</div>
            <div />
            <div>Upstream Pools</div>
          </div>

          <div
            className="relative grid grid-cols-[240px_1fr_260px_1fr_250px] items-start"
            style={{ minHeight: `${canvasHeight}px` }}
          >
            {/* SVG Edges Layer */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox={`0 0 1000 ${canvasHeight}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {/* Listener -> Route edges */}
              {routes.map((rt) => {
                const y1 = listenerY[rt.listenerId];
                const y2 = routeY[rt.id];
                if (y1 === undefined || y2 === undefined) return null;
                const isTraced = lastTrace?.matchedRouteId === rt.id;
                return (
                  <FlowEdge
                    key={`e-lr-${rt.id}`}
                    x1={238}
                    y1={y1}
                    x2={362}
                    y2={y2}
                    state={!rt.enabled ? 'degraded' : isTraced ? 'traced' : 'nominal'}
                  />
                );
              })}

              {/* Route -> Upstream edges */}
              {routes.map((rt) =>
                rt.targets.map((tgt, tIdx) => {
                  const y1 = routeY[rt.id];
                  const y2 = upstreamY[tgt.upstreamId];
                  if (y1 === undefined || y2 === undefined) return null;
                  const ups = ir.upstreams[tgt.upstreamId];
                  const isChaos503 = Boolean(chaos.force503Upstreams[tgt.upstreamId]);
                  const isOpen = ups?.circuitBreaker.state === 'open';
                  const isTraced =
                    lastTrace?.matchedRouteId === rt.id &&
                    lastTrace?.selectedUpstreamId === tgt.upstreamId;

                  const edgeState =
                    isChaos503 || isOpen
                      ? 'blocked'
                      : isTraced
                        ? 'traced'
                        : !rt.enabled
                          ? 'degraded'
                          : 'nominal';

                  return (
                    <FlowEdge
                      key={`e-ru-${rt.id}-${tgt.upstreamId}-${tIdx}`}
                      x1={638}
                      y1={y1}
                      x2={748}
                      y2={y2}
                      label={`${tgt.weight}%`}
                      state={edgeState}
                    />
                  );
                })
              )}
            </svg>

            {/* Column 1: Listeners */}
            <div className="space-y-4 py-3 relative z-10">
              {listeners.map((lst) => {
                const cert = lst.tlsCertId ? ir.certificates[lst.tlsCertId] : undefined;
                const isCertChaosExpired = cert ? Boolean(chaos.forceExpiredCerts[cert.id]) : false;
                const metric = getLatestMetric(lst.id);
                return (
                  <div key={lst.id} style={{ height: `${CARD_HEIGHT}px` }}>
                    <TopologyNodeCard
                      kindLabel={`${lst.protocol} :${lst.port}`}
                      title={lst.name}
                      subtitle={lst.hostnames.join(', ')}
                      statusLabel={isCertChaosExpired ? 'TLS Expired' : lst.tlsMode ? `TLS ${lst.tlsMode}` : 'Active'}
                      statusTone={isCertChaosExpired ? 'critical' : 'healthy'}
                      rps={metric.rps}
                      p99Ms={metric.p99Ms}
                      sparkline={telemetry[lst.id]}
                      selected={selection?.type === 'listener' && selection.id === lst.id}
                      onClick={() => setSelection({ type: 'listener', id: lst.id })}
                    />
                  </div>
                );
              })}
            </div>

            <div />

            {/* Column 2: Ingress Routes */}
            <div className="space-y-4 py-3 relative z-10">
              {routes.map((rt) => {
                const metric = getLatestMetric(rt.id);
                const mwCount = rt.middlewares.filter((m) => m.enabled).length;
                const weightSum = rt.targets.reduce((s, t) => s + t.weight, 0);
                const isTraced = lastTrace?.matchedRouteId === rt.id;

                return (
                  <div key={rt.id} style={{ height: `${CARD_HEIGHT}px` }}>
                    <TopologyNodeCard
                      kindLabel={`Priority ${rt.priority} · ${mwCount} plugins`}
                      title={rt.name}
                      subtitle={`${rt.host}${rt.pathPrefix}`}
                      statusLabel={
                        !rt.enabled
                          ? 'Disabled'
                          : weightSum !== 100
                            ? `Split ${weightSum}%`
                            : 'Active'
                      }
                      statusTone={
                        !rt.enabled ? 'neutral' : weightSum !== 100 ? 'warning' : 'healthy'
                      }
                      rps={metric.rps}
                      p99Ms={metric.p99Ms}
                      sparkline={telemetry[rt.id]}
                      selected={selection?.type === 'route' && selection.id === rt.id}
                      highlighted={isTraced}
                      onClick={() => setSelection({ type: 'route', id: rt.id })}
                    />
                  </div>
                );
              })}
            </div>

            <div />

            {/* Column 3: Upstream Pools */}
            <div className="space-y-4 py-3 relative z-10">
              {upstreams.map((ups) => {
                const metric = getLatestMetric(ups.id);
                const healthyEps = ups.endpoints.filter((e) => e.healthy).length;
                const is503 = Boolean(chaos.force503Upstreams[ups.id]);
                const spike = chaos.latencySpikesMs[ups.id] ?? 0;
                const isOpen = ups.circuitBreaker.state === 'open';
                const isTraced = lastTrace?.selectedUpstreamId === ups.id;

                const statusLabel = is503
                  ? 'Chaos 503'
                  : isOpen
                    ? 'Circuit Open'
                    : spike > 0
                      ? `+${spike}ms Spike`
                      : healthyEps === 0
                        ? 'Down'
                        : `${healthyEps}/${ups.endpoints.length} Healthy`;

                const statusTone =
                  is503 || isOpen || healthyEps === 0
                    ? 'critical'
                    : spike > 0
                      ? 'warning'
                      : 'healthy';

                return (
                  <div key={ups.id} style={{ height: `${CARD_HEIGHT}px` }}>
                    <TopologyNodeCard
                      kindLabel={ups.lbAlgorithm.replace('_', ' ')}
                      title={ups.name}
                      subtitle={
                        ups.endpoints.map((e) => `${e.region}:${e.port}`).slice(0, 2).join(' · ') ||
                        'No endpoints'
                      }
                      statusLabel={statusLabel}
                      statusTone={statusTone}
                      rps={metric.rps}
                      p99Ms={metric.p99Ms}
                      sparkline={telemetry[ups.id]}
                      selected={selection?.type === 'upstream' && selection.id === ups.id}
                      highlighted={isTraced}
                      onClick={() => setSelection({ type: 'upstream', id: ups.id })}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
