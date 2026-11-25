import React, { useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, PanelRightClose, Wrench } from 'lucide-react';
import { LiveConfigInspector } from '../../components/primitives/LiveConfigInspector';
import { MiddlewarePipelineDnd } from '../../components/primitives/MiddlewarePipelineDnd';
import { TrafficSplitBar } from '../../components/primitives/TrafficSplitBar';
import { LoadBalancerAlgorithm } from '../../core/ir/types';
import { useControlPlane } from '../../store/ControlPlaneContext';

type InspectorTab = 'config' | 'diagnostics' | 'selected';

export const InspectorPane: React.FC = () => {
  const {
    ir,
    inspectorOpen,
    setInspectorOpen,
    activeAdapterId,
    setActiveAdapterId,
    desiredConfig,
    activeConfig,
    desiredHash,
    activeHash,
    diagnostics,
    applyAutoFix,
    selection,
    updateRoute,
    reorderRouteMiddlewares,
    toggleRouteMiddleware,
    addMiddlewareToRoute,
    removeMiddlewareFromRoute,
    updateMiddlewareConfig,
    updateUpstream,
    updateIR,
    setActiveView,
  } = useControlPlane();

  const [tab, setTab] = useState<InspectorTab>('config');

  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warnCount = diagnostics.filter((d) => d.severity === 'warning').length;

  const upstreamNames = useMemo(() => {
    const map: Record<string, string> = {};
    Object.values(ir.upstreams).forEach((u) => {
      map[u.id] = u.name;
    });
    return map;
  }, [ir.upstreams]);

  if (!inspectorOpen) return null;

  const renderSelectedEditor = () => {
    if (!selection) {
      return (
        <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
          Click any listener, route, or upstream node in the workspace to edit it here.
        </div>
      );
    }

    if (selection.type === 'route') {
      const route = ir.routes[selection.id];
      if (!route) return null;
      return (
        <div className="space-y-4">
          <div className="pb-2.5 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">{route.name}</div>
              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                {route.host}
                {route.pathPrefix}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveView('routes')}
              className="text-[11px] text-blue-600 dark:text-sky-400 hover:text-blue-700 dark:hover:text-sky-300 transition-colors shrink-0"
            >
              Open Full Editor
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <label className="block text-[11px] text-slate-500 dark:text-slate-400">Host</label>
              <input
                type="text"
                value={route.host}
                onChange={(e) => updateRoute(route.id, { host: e.target.value })}
                className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[11px] text-slate-500 dark:text-slate-400">Priority</label>
              <input
                type="number"
                value={route.priority}
                onChange={(e) => updateRoute(route.id, { priority: Number(e.target.value) })}
                className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded px-2 py-1 text-xs font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
              />
            </div>
            <div className="col-span-2 space-y-1">
              <label className="block text-[11px] text-slate-500 dark:text-slate-400">Path Prefix</label>
              <input
                type="text"
                value={route.pathPrefix}
                onChange={(e) => updateRoute(route.id, { pathPrefix: e.target.value })}
                className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
              />
            </div>
          </div>

          <TrafficSplitBar
            targets={route.targets}
            upstreamNames={upstreamNames}
            onChange={(targets) => updateRoute(route.id, { targets })}
            onNormalize={() => {
              const total = route.targets.reduce((s, t) => s + Math.max(0, t.weight), 0);
              if (route.targets.length === 0) return;
              const nextTargets =
                total === 0
                  ? route.targets.map((t, i) => ({ ...t, weight: i === 0 ? 100 : 0 }))
                  : (() => {
                      const scaled = route.targets.map((t) =>
                        Math.floor((Math.max(0, t.weight) / total) * 100)
                      );
                      scaled[0] += 100 - scaled.reduce((a, b) => a + b, 0);
                      return route.targets.map((t, i) => ({ ...t, weight: scaled[i] }));
                    })();
              updateRoute(route.id, { targets: nextTargets });
            }}
          />

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800/80 space-y-3">
            <MiddlewarePipelineDnd
              variant="drawer"
              route={route}
              plugins={ir.plugins}
              onReorder={(fromIdx, toIdx) => reorderRouteMiddlewares(route.id, fromIdx, toIdx)}
              onToggle={(bindingId) => toggleRouteMiddleware(route.id, bindingId)}
              onRemove={(bindingId) => removeMiddlewareFromRoute(route.id, bindingId)}
              onAttach={(pluginId) => addMiddlewareToRoute(route.id, pluginId)}
              onUpdateConfig={(bindingId, nextCfg) =>
                updateMiddlewareConfig(route.id, bindingId, nextCfg)
              }
            />

            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => setActiveView('policies')}
                className="text-blue-600 dark:text-sky-400 hover:text-blue-700 dark:hover:text-sky-300 text-[11px] font-medium"
              >
                Open Full Policy Editor →
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (selection.type === 'upstream') {
      const ups = ir.upstreams[selection.id];
      if (!ups) return null;
      return (
        <div className="space-y-4">
          <div className="pb-2.5 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">{ups.name}</div>
              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                {ups.endpoints.length} endpoints · Circuit {ups.circuitBreaker.state}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveView('upstreams')}
              className="text-[11px] text-blue-600 dark:text-sky-400 hover:text-blue-700 dark:hover:text-sky-300"
            >
              Manage Pool
            </button>
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] text-slate-500 dark:text-slate-400">Load Balancing Strategy</label>
            <select
              value={ups.lbAlgorithm}
              onChange={(e) =>
                updateUpstream(ups.id, { lbAlgorithm: e.target.value as LoadBalancerAlgorithm })
              }
              className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
            >
              <option value="round_robin">round_robin</option>
              <option value="least_conn">least_conn</option>
              <option value="consistent_hash">consistent_hash</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Endpoints</div>
            {ups.endpoints.map((ep) => (
              <div
                key={ep.id}
                className="flex items-center justify-between px-2.5 py-1.5 rounded bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 text-xs font-mono"
              >
                <span className="text-slate-800 dark:text-slate-200">
                  {ep.address}:{ep.port}
                </span>
                <span className={ep.healthy ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                  {ep.healthy ? `${ep.region} · ok` : 'drained'}
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (selection.type === 'listener') {
      const lst = ir.listeners[selection.id];
      if (!lst) return null;
      return (
        <div className="space-y-4">
          <div className="pb-2.5 border-b border-slate-200 dark:border-slate-800/80">
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">{lst.name}</div>
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {lst.protocol} on port {lst.port}
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="space-y-1">
              <label className="block text-[11px] text-slate-500 dark:text-slate-400">TLS Mode</label>
              <select
                value={lst.tlsMode ?? 'terminate'}
                onChange={(e) =>
                  updateIR((prev) => ({
                    ...prev,
                    listeners: {
                      ...prev.listeners,
                      [lst.id]: {
                        ...prev.listeners[lst.id],
                        tlsMode: e.target.value as 'terminate' | 'passthrough' | 'mutual',
                      },
                    },
                  }))
                }
                className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
              >
                <option value="terminate">terminate</option>
                <option value="mutual">mutual (mTLS)</option>
                <option value="passthrough">passthrough</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] text-slate-500 dark:text-slate-400">Bound Certificate</label>
              <select
                value={lst.tlsCertId ?? ''}
                onChange={(e) =>
                  updateIR((prev) => ({
                    ...prev,
                    listeners: {
                      ...prev.listeners,
                      [lst.id]: {
                        ...prev.listeners[lst.id],
                        tlsCertId: e.target.value || undefined,
                      },
                    },
                  }))
                }
                className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
              >
                <option value="">None</option>
                {Object.values(ir.certificates).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.commonName})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <aside className="w-full lg:w-[440px] xl:w-[480px] shrink-0 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0F172A] flex flex-col h-full min-h-0">
      {/* Inspector Header Tabs */}
      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800/80">
        <div className="flex items-center gap-1 p-0.5 rounded-md bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setTab('config')}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              tab === 'config'
                ? 'bg-white dark:bg-slate-800 text-blue-700 dark:text-sky-300 shadow-xs dark:shadow-none'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Compiled Config
          </button>
          <button
            type="button"
            onClick={() => setTab('diagnostics')}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              tab === 'diagnostics'
                ? 'bg-white dark:bg-slate-800 text-blue-700 dark:text-sky-300 shadow-xs dark:shadow-none'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <span>Diagnostics</span>
            <span
              className={`font-mono tabular-nums text-[11px] ${
                errorCount > 0
                  ? 'text-rose-600 dark:text-rose-400'
                  : warnCount > 0
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-emerald-700 dark:text-emerald-400'
              }`}
            >
              {diagnostics.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setTab('selected')}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              tab === 'selected'
                ? 'bg-white dark:bg-slate-800 text-blue-700 dark:text-sky-300 shadow-xs dark:shadow-none'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {selection?.type === 'route' ? 'Route Config' : 'Properties'}
          </button>
        </div>

        <button
          type="button"
          onClick={() => setInspectorOpen(false)}
          className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
          title="Collapse Inspector"
          aria-label="Collapse Inspector"
        >
          <PanelRightClose className="w-4 h-4" />
        </button>
      </div>

      {/* Tab Body */}
      <div className="flex-1 min-h-0 p-3.5 overflow-hidden flex flex-col">
        {tab === 'config' && (
          <LiveConfigInspector
            activeAdapterId={activeAdapterId}
            onSelectAdapter={setActiveAdapterId}
            desiredConfig={desiredConfig}
            activeConfig={activeConfig}
            desiredHash={desiredHash}
            activeHash={activeHash}
          />
        )}

        {tab === 'diagnostics' && (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-0.5">
            {diagnostics.length === 0 ? (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5 text-center space-y-1.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-700 dark:text-emerald-400 mx-auto" />
                <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  Zero Compiler Diagnostics
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  All routes, upstream references, canary weights, and TLS certificates passed AST validation.
                </p>
              </div>
            ) : (
              diagnostics.map((diag) => {
                const Icon =
                  diag.severity === 'error'
                    ? AlertCircle
                    : diag.severity === 'warning'
                      ? AlertTriangle
                      : Info;
                const tone =
                  diag.severity === 'error'
                    ? 'border-rose-500/35 bg-rose-500/5 text-rose-700 dark:text-rose-300'
                    : diag.severity === 'warning'
                      ? 'border-amber-500/35 bg-amber-500/5 text-amber-700 dark:text-amber-300'
                      : 'border-sky-500/30 bg-sky-500/5 text-blue-700 dark:text-sky-300';

                return (
                  <div key={diag.id} className={`rounded-lg border p-3 space-y-2 ${tone}`}>
                    <div className="flex items-start gap-2">
                      <Icon className="w-4 h-4 shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-slate-900 dark:text-slate-100 leading-snug">
                          {diag.message}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                          {diag.detail}
                        </p>
                      </div>
                    </div>
                    {diag.autoFix && diag.autoFixLabel && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => applyAutoFix(diag)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#090D16] hover:border-sky-400 text-[11px] font-medium text-blue-700 dark:text-sky-300 transition-colors"
                        >
                          <Wrench className="w-3 h-3" />
                          <span>{diag.autoFixLabel}</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {tab === 'selected' && (
          <div className="flex-1 min-h-0 overflow-y-auto pr-0.5">{renderSelectedEditor()}</div>
        )}
      </div>
    </aside>
  );
};
