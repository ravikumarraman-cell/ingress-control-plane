import React, { useMemo, useState } from 'react';
import { ArrowRight, Plus } from 'lucide-react';
import { motion } from 'motion/react';
import { MiddlewarePipelineDnd } from '../../components/primitives/MiddlewarePipelineDnd';
import { SchemaDrivenForm } from '../../components/primitives/SchemaDrivenForm';
import { useControlPlane } from '../../store/ControlPlaneContext';

export const PoliciesView: React.FC = () => {
  const {
    ir,
    selection,
    setSelection,
    reorderRouteMiddlewares,
    toggleRouteMiddleware,
    addMiddlewareToRoute,
    removeMiddlewareFromRoute,
    updateMiddlewareConfig,
    setCustomPluginModalOpen,
  } = useControlPlane();

  const routes = useMemo(
    () =>
      ir.routeOrder
        .map((id) => ir.routes[id])
        .filter((r): r is NonNullable<typeof r> => Boolean(r)),
    [ir.routeOrder, ir.routes]
  );

  const activeRoute =
    (selection?.type === 'route' ? ir.routes[selection.id] : undefined) ?? routes[0];

  const [selectedBindingId, setSelectedBindingId] = useState<string | null>(null);
  const [attachPluginId, setAttachPluginId] = useState<string>(Object.keys(ir.plugins)[0] ?? 'rate-limit');

  const plugins = useMemo(() => Object.values(ir.plugins), [ir.plugins]);

  const activeBinding =
    activeRoute?.middlewares.find((m) => m.id === selectedBindingId) ??
    activeRoute?.middlewares[0];
  const activePlugin = activeBinding ? ir.plugins[activeBinding.pluginId] : undefined;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-auto p-4 lg:p-5 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800/80">
        <div>
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Composable Middleware Pipeline & Plugin Registry
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Drag policy cards to reorder execution order per route or hot-register custom JSON Schema plugins.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setCustomPluginModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-sky-500 text-slate-950 hover:bg-sky-400 text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Register Custom Plugin</span>
        </button>
      </div>

      {/* Route Pipeline Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] px-4 py-3">
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Target Route Pipeline:</label>
          <select
            value={activeRoute?.id ?? ''}
            onChange={(e) => {
              setSelection({ type: 'route', id: e.target.value });
              setSelectedBindingId(null);
            }}
            className="bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
          >
            {routes.map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.name} ({rt.host}
                {rt.pathPrefix})
              </option>
            ))}
          </select>
        </div>

        {activeRoute && (
          <div className="flex items-center gap-2">
            <select
              value={attachPluginId}
              onChange={(e) => setAttachPluginId(e.target.value)}
              aria-label="Select plugin to attach"
              className="bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-sky-400"
            >
              {plugins.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.builtIn ? '' : '(Custom)'}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => addMiddlewareToRoute(activeRoute.id, attachPluginId)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#090D16] text-xs font-medium text-slate-800 dark:text-slate-200 hover:border-sky-400 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Attach Step</span>
            </button>
          </div>
        )}
      </div>

      {/* Live Execution Flow Preview */}
      {activeRoute && activeRoute.middlewares.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-[#0B111E] text-[11px] font-mono text-slate-600 dark:text-slate-400">
          <span className="text-slate-800 dark:text-slate-200 font-semibold">Client</span>
          {activeRoute.middlewares.map((mw, idx) => {
            const p = ir.plugins[mw.pluginId];
            return (
              <motion.span
                key={mw.id}
                layout="position"
                transition={{ type: 'spring', stiffness: 520, damping: 34 }}
                className="inline-flex items-center gap-1.5"
              >
                <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />
                <span
                  className={
                    mw.enabled
                      ? 'text-blue-700 dark:text-sky-300 font-medium'
                      : 'text-slate-400 dark:text-slate-600 line-through'
                  }
                >
                  {String(idx + 1).padStart(2, '0')}. {p?.name ?? mw.pluginId}
                </span>
              </motion.span>
            );
          })}
          <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />
          <span className="text-emerald-700 dark:text-emerald-400 font-semibold">Upstream</span>
        </div>
      )}

      {/* Split Middleware Chain + SchemaDrivenForm Editor */}
      {activeRoute ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Draggable Middleware Chain */}
          <div className="lg:col-span-6">
            <MiddlewarePipelineDnd
              variant="full"
              route={activeRoute}
              plugins={ir.plugins}
              selectedBindingId={activeBinding?.id ?? null}
              onSelectBinding={(id) => setSelectedBindingId(id)}
              onReorder={(fromIdx, toIdx) => reorderRouteMiddlewares(activeRoute.id, fromIdx, toIdx)}
              onToggle={(bindingId) => toggleRouteMiddleware(activeRoute.id, bindingId)}
              onRemove={(bindingId) => removeMiddlewareFromRoute(activeRoute.id, bindingId)}
            />
          </div>

          {/* SchemaDrivenForm Panel */}
          <div className="lg:col-span-6">
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] p-4">
              {activeBinding && activePlugin ? (
                <div className="space-y-4">
                  <div className="pb-3 border-b border-slate-200 dark:border-slate-800/80">
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{activePlugin.name}</div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{activePlugin.description}</p>
                    <div className="text-[11px] font-mono text-slate-500 mt-1">
                      Plugin ID {activePlugin.id} · {activePlugin.builtIn ? 'Built-in' : 'Custom Schema'}
                    </div>
                  </div>
                  <SchemaDrivenForm
                    schema={activePlugin.schema}
                    value={activeBinding.config}
                    onChange={(nextCfg) =>
                      updateMiddlewareConfig(activeRoute.id, activeBinding.id, nextCfg)
                    }
                  />
                </div>
              ) : (
                <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                  Select a middleware step on the left to configure its schema-driven parameters.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Registered Plugin Catalog */}
      <div className="pt-2">
        <h2 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2.5">
          Registered Control-Plane Plugins ({plugins.length})
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {plugins.map((plugin) => (
            <div
              key={plugin.id}
              className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] p-3.5 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">{plugin.name}</span>
                <span
                  className={`font-mono text-[11px] shrink-0 ${
                    plugin.builtIn ? 'text-slate-500 dark:text-slate-400' : 'text-blue-600 dark:text-sky-400'
                  }`}
                >
                  {plugin.builtIn ? plugin.category : 'custom'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{plugin.description}</p>
              <div className="text-[11px] font-mono text-slate-500 pt-1">
                {Object.keys(plugin.schema.properties).length} schema fields · id: {plugin.id}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
