import React, { useMemo, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { MiddlewarePipelineDnd } from '../../components/primitives/MiddlewarePipelineDnd';
import { TrafficSplitBar } from '../../components/primitives/TrafficSplitBar';
import { HttpMethod, IngressRoute } from '../../core/ir/types';
import { useControlPlane } from '../../store/ControlPlaneContext';

const ALL_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', '*'];

export const RoutesView: React.FC = () => {
  const {
    ir,
    selection,
    setSelection,
    updateRoute,
    addRoute,
    deleteRoute,
    reorderRouteMiddlewares,
    toggleRouteMiddleware,
    addMiddlewareToRoute,
    removeMiddlewareFromRoute,
    updateMiddlewareConfig,
  } = useControlPlane();

  const [search, setSearch] = useState('');
  const [listenerFilter, setListenerFilter] = useState<string>('all');

  const routes = useMemo(
    () =>
      ir.routeOrder
        .map((id) => ir.routes[id])
        .filter((r): r is IngressRoute => Boolean(r)),
    [ir.routeOrder, ir.routes]
  );

  const filteredRoutes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return routes.filter((rt) => {
      if (listenerFilter !== 'all' && rt.listenerId !== listenerFilter) return false;
      if (!q) return true;
      return (
        rt.name.toLowerCase().includes(q) ||
        rt.host.toLowerCase().includes(q) ||
        rt.pathPrefix.toLowerCase().includes(q)
      );
    });
  }, [routes, search, listenerFilter]);

  const activeRoute =
    (selection?.type === 'route' ? ir.routes[selection.id] : undefined) ?? filteredRoutes[0] ?? routes[0];

  const upstreamNames = useMemo(() => {
    const map: Record<string, string> = {};
    Object.values(ir.upstreams).forEach((u) => {
      map[u.id] = u.name;
    });
    return map;
  }, [ir.upstreams]);

  const handleCreateRoute = () => {
    const firstListener = Object.keys(ir.listeners)[0] ?? '';
    const firstUpstream = Object.keys(ir.upstreams)[0] ?? '';
    const idx = routes.length + 1;
    const newRoute: IngressRoute = {
      id: `rt-${Date.now().toString(36)}`,
      name: `service-route-${idx}`,
      listenerId: firstListener,
      host: ir.listeners[firstListener]?.hostnames[0] ?? 'api.acme.internal',
      pathPrefix: `/v2/resource-${idx}`,
      matchType: 'prefix',
      methods: ['GET', 'POST'],
      priority: 70,
      enabled: true,
      middlewares: [],
      targets: firstUpstream ? [{ upstreamId: firstUpstream, weight: 100, label: 'Primary' }] : [],
    };
    addRoute(newRoute);
  };

  const handleNormalize = () => {
    if (!activeRoute || activeRoute.targets.length === 0) return;
    const total = activeRoute.targets.reduce((s, t) => s + Math.max(0, t.weight), 0);
    const nextTargets =
      total === 0
        ? activeRoute.targets.map((t, i) => ({
            ...t,
            weight: i === 0 ? 100 : 0,
          }))
        : (() => {
            const scaled = activeRoute.targets.map((t) => Math.floor((Math.max(0, t.weight) / total) * 100));
            scaled[0] += 100 - scaled.reduce((a, b) => a + b, 0);
            return activeRoute.targets.map((t, i) => ({ ...t, weight: scaled[i] }));
          })();
    updateRoute(activeRoute.id, { targets: nextTargets });
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-auto p-4 lg:p-5 space-y-5">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800/80">
        <div>
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">Ingress Routes & Canary Matrix</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Priority-ordered host and path matchers with real-time weight distribution.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter host or path..."
              className="pl-8 pr-3 py-1.5 w-48 rounded-md bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-400"
            />
          </div>

          <select
            value={listenerFilter}
            onChange={(e) => setListenerFilter(e.target.value)}
            aria-label="Filter by listener"
            className="px-2.5 py-1.5 rounded-md bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-sky-400"
          >
            <option value="all">All Listeners</option>
            {Object.values(ir.listeners).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} (:{l.port})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleCreateRoute}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-sky-500 text-slate-950 hover:bg-sky-400 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Route</span>
          </button>
        </div>
      </div>

      {/* High-density Route Table */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] overflow-x-auto">
        {filteredRoutes.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
            No routes match the current filter. Clear search or add a new route.
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                <th className="py-2.5 px-3">Route</th>
                <th className="py-2.5 px-3">Matcher</th>
                <th className="py-2.5 px-3">Methods</th>
                <th className="py-2.5 px-3 text-right">Priority</th>
                <th className="py-2.5 px-3">Targets</th>
                <th className="py-2.5 px-3">State</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/70">
              {filteredRoutes.map((rt) => {
                const isSelected = activeRoute?.id === rt.id;
                const weightSum = rt.targets.reduce((s, t) => s + t.weight, 0);
                return (
                  <tr
                    key={rt.id}
                    onClick={() => setSelection({ type: 'route', id: rt.id })}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-blue-50/70 dark:bg-[#131B2E]' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {rt.name}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-700 dark:text-slate-300">
                      <span>{rt.host}</span>
                      <span className="text-blue-700 dark:text-sky-300">{rt.pathPrefix}</span>
                      <span className="text-slate-500 ml-1.5">({rt.matchType})</span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-500 dark:text-slate-400">
                      {rt.methods.join(', ')}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {rt.priority}
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {rt.targets
                        .map((t) => `${upstreamNames[t.upstreamId] ?? t.upstreamId} ${t.weight}%`)
                        .join(' · ')}
                      {weightSum !== 100 && (
                        <span className="ml-2 text-amber-700 dark:text-amber-400">(!{weightSum}%)</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          updateRoute(rt.id, { enabled: !rt.enabled });
                        }}
                        className={`text-xs font-medium ${
                          rt.enabled ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500'
                        }`}
                      >
                        {rt.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteRoute(rt.id);
                        }}
                        aria-label={`Delete ${rt.name}`}
                        className="p-1 text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Selected Route Editor */}
      {activeRoute && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] p-4 space-y-4">
          <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-200 dark:border-slate-800/80">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{activeRoute.name}</h2>
              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                ID {activeRoute.id} · {activeRoute.middlewares.length} middleware bindings
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={activeRoute.enabled}
                onChange={(e) => updateRoute(activeRoute.id, { enabled: e.target.checked })}
                className="accent-sky-500"
              />
              <span>Route Enabled</span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">Route Name</label>
              <input
                type="text"
                value={activeRoute.name}
                onChange={(e) => updateRoute(activeRoute.id, { name: e.target.value })}
                className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">Listener</label>
              <select
                value={activeRoute.listenerId}
                onChange={(e) => updateRoute(activeRoute.id, { listenerId: e.target.value })}
                className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
              >
                {Object.values(ir.listeners).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.protocol}:{l.port})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">Host</label>
              <input
                type="text"
                value={activeRoute.host}
                onChange={(e) => updateRoute(activeRoute.id, { host: e.target.value })}
                className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">Priority</label>
              <input
                type="number"
                value={activeRoute.priority}
                onChange={(e) => updateRoute(activeRoute.id, { priority: Number(e.target.value) })}
                className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
              />
            </div>

            <div className="space-y-1 md:col-span-2">
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">Path Expression</label>
              <input
                type="text"
                value={activeRoute.pathPrefix}
                onChange={(e) => updateRoute(activeRoute.id, { pathPrefix: e.target.value })}
                className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">Match Type</label>
              <select
                value={activeRoute.matchType}
                onChange={(e) =>
                  updateRoute(activeRoute.id, {
                    matchType: e.target.value as IngressRoute['matchType'],
                  })
                }
                className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
              >
                <option value="prefix">prefix</option>
                <option value="exact">exact</option>
                <option value="regex">regex</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">Traffic Policy</label>
              <select
                value={activeRoute.policyId ?? ''}
                onChange={(e) =>
                  updateRoute(activeRoute.id, {
                    policyId: e.target.value || undefined,
                  })
                }
                className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
              >
                <option value="">None (Proxy Defaults)</option>
                {Object.values(ir.policies).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.timeoutMs}ms)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* HTTP Method selector */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Allowed Methods</div>
            <div className="flex flex-wrap gap-1.5">
              {ALL_METHODS.map((m) => {
                const active = activeRoute.methods.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      const next = active
                        ? activeRoute.methods.filter((x) => x !== m)
                        : [...activeRoute.methods.filter((x) => x !== '*'), m];
                      updateRoute(activeRoute.id, {
                        methods: next.length > 0 ? next : ['GET'],
                      });
                    }}
                    className={`px-2.5 py-1 rounded text-[11px] font-mono border transition-colors ${
                      active
                        ? 'bg-sky-500/15 border-sky-400/60 text-blue-700 dark:text-sky-300'
                        : 'bg-slate-50 dark:bg-[#090D16] border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Canary Traffic Split + Drag-and-Drop Middleware Pipeline */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800/80 grid grid-cols-1 xl:grid-cols-2 gap-5">
            <div className="space-y-3">
              <TrafficSplitBar
                targets={activeRoute.targets}
                upstreamNames={upstreamNames}
                onChange={(targets) => updateRoute(activeRoute.id, { targets })}
                onNormalize={handleNormalize}
              />

              {/* Add / Remove Upstream Target */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500 dark:text-slate-400">Add split target:</span>
                {Object.values(ir.upstreams)
                  .filter((u) => !activeRoute.targets.some((t) => t.upstreamId === u.id))
                  .map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() =>
                        updateRoute(activeRoute.id, {
                          targets: [...activeRoute.targets, { upstreamId: u.id, weight: 0, label: u.name }],
                        })
                      }
                      className="px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#090D16] text-slate-700 dark:text-slate-300 hover:border-sky-400/60 hover:text-blue-700 dark:hover:text-sky-300 transition-colors"
                    >
                      + {u.name}
                    </button>
                  ))}
                {activeRoute.targets.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      updateRoute(activeRoute.id, {
                        targets: activeRoute.targets.slice(0, -1),
                      })
                    }
                    className="px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#090D16] text-rose-700 dark:text-rose-300 hover:border-rose-400/60 transition-colors ml-auto"
                  >
                    Remove Last Target
                  </button>
                )}
              </div>
            </div>

            <MiddlewarePipelineDnd
              variant="drawer"
              route={activeRoute}
              plugins={ir.plugins}
              onReorder={(fromIdx, toIdx) => reorderRouteMiddlewares(activeRoute.id, fromIdx, toIdx)}
              onToggle={(bindingId) => toggleRouteMiddleware(activeRoute.id, bindingId)}
              onRemove={(bindingId) => removeMiddlewareFromRoute(activeRoute.id, bindingId)}
              onAttach={(pluginId) => addMiddlewareToRoute(activeRoute.id, pluginId)}
              onUpdateConfig={(bindingId, nextCfg) =>
                updateMiddlewareConfig(activeRoute.id, bindingId, nextCfg)
              }
            />
          </div>
        </div>
      )}
    </div>
  );
};
