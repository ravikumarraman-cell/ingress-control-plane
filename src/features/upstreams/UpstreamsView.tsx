import React, { useState } from 'react';
import { Plus, RotateCcw } from 'lucide-react';
import { EdgeRegion, LoadBalancerAlgorithm } from '../../core/ir/types';
import { useControlPlane } from '../../store/ControlPlaneContext';

export const UpstreamsView: React.FC = () => {
  const {
    ir,
    selection,
    setSelection,
    updateUpstream,
    toggleEndpointHealth,
    chaos,
    telemetry,
  } = useControlPlane();

  const upstreams = Object.values(ir.upstreams);
  const [newEpAddr, setNewEpAddr] = useState('10.48.20.12');
  const [newEpPort, setNewEpPort] = useState(8080);
  const [newEpRegion, setNewEpRegion] = useState<EdgeRegion>('us-east');

  const activePool =
    (selection?.type === 'upstream' ? ir.upstreams[selection.id] : undefined) ?? upstreams[0];

  return (
    <div className="flex flex-col h-full min-h-0 overflow-auto p-4 lg:p-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800/80">
        <div>
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">Upstream Pools & Load Balancing</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Configure load-balancing strategies, outlier circuit breakers, and regional endpoints.
          </p>
        </div>
      </div>

      {/* Pool Selector Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {upstreams.map((pool) => {
          const isSelected = activePool?.id === pool.id;
          const is503 = Boolean(chaos.force503Upstreams[pool.id]);
          const healthyCount = pool.endpoints.filter((e) => e.healthy).length;
          const latest = telemetry[pool.id]?.[telemetry[pool.id].length - 1];

          return (
            <button
              key={pool.id}
              type="button"
              onClick={() => setSelection({ type: 'upstream', id: pool.id })}
              className={`text-left rounded-lg border p-3.5 transition-colors ${
                isSelected
                  ? 'bg-blue-50/70 dark:bg-[#131B2E] border-sky-400/80'
                  : 'bg-white dark:bg-[#0F172A] border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">{pool.name}</span>
                <span
                  className={`font-medium shrink-0 ${
                    is503 || pool.circuitBreaker.state === 'open' || healthyCount === 0
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                >
                  {is503
                    ? 'Chaos 503'
                    : pool.circuitBreaker.state === 'open'
                      ? 'Circuit Open'
                      : `${healthyCount}/${pool.endpoints.length} Healthy`}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                <span>{pool.lbAlgorithm}</span>
                <span aria-hidden="true">·</span>
                <span className="truncate">{pool.healthCheckPath}</span>
              </div>
              <div className="mt-2.5 pt-2 border-t border-slate-200 dark:border-slate-800/70 flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                <span>RPS {latest?.rps ?? 0}</span>
                <span>p99 {latest?.p99Ms ?? 0}ms</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected Upstream Pool Editor */}
      {activePool && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800/80">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{activePool.name}</h2>
              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                Pool ID {activePool.id} · Circuit Breaker:{' '}
                <span
                  className={
                    activePool.circuitBreaker.state === 'open'
                      ? 'text-rose-600 dark:text-rose-400 font-semibold'
                      : 'text-emerald-700 dark:text-emerald-400'
                  }
                >
                  {activePool.circuitBreaker.state}
                </span>
              </div>
            </div>

            {activePool.circuitBreaker.state !== 'closed' && (
              <button
                type="button"
                onClick={() =>
                  updateUpstream(activePool.id, {
                    circuitBreaker: { ...activePool.circuitBreaker, state: 'closed' },
                  })
                }
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 text-xs font-medium transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Circuit Breaker</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Load Balancing Algorithm
              </label>
              <select
                value={activePool.lbAlgorithm}
                onChange={(e) =>
                  updateUpstream(activePool.id, {
                    lbAlgorithm: e.target.value as LoadBalancerAlgorithm,
                  })
                }
                className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
              >
                <option value="round_robin">round_robin</option>
                <option value="least_conn">least_conn</option>
                <option value="consistent_hash">consistent_hash</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Consistent Hash Header
              </label>
              <input
                type="text"
                disabled={activePool.lbAlgorithm !== 'consistent_hash'}
                value={activePool.hashHeader ?? 'X-Session-ID'}
                onChange={(e) => updateUpstream(activePool.id, { hashHeader: e.target.value })}
                className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 disabled:opacity-40 focus:outline-none focus:border-sky-400"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Circuit Max 5xx Errors
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={activePool.circuitBreaker.maxErrors}
                onChange={(e) =>
                  updateUpstream(activePool.id, {
                    circuitBreaker: {
                      ...activePool.circuitBreaker,
                      maxErrors: Math.max(1, Number(e.target.value)),
                    },
                  })
                }
                className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Health Check Path
              </label>
              <input
                type="text"
                value={activePool.healthCheckPath}
                onChange={(e) => updateUpstream(activePool.id, { healthCheckPath: e.target.value })}
                className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
              />
            </div>
          </div>

          {/* Endpoints Table */}
          <div className="pt-2">
            <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">Registered Endpoints</div>
            <div className="rounded-md border border-slate-200 dark:border-slate-800 overflow-x-auto bg-slate-50 dark:bg-[#090D16]">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                    <th className="py-2 px-3">Address</th>
                    <th className="py-2 px-3">Region</th>
                    <th className="py-2 px-3 text-right">Active Conns</th>
                    <th className="py-2 px-3 text-right">Base Latency</th>
                    <th className="py-2 px-3 text-right">Health</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800/70">
                  {activePool.endpoints.map((ep) => (
                    <tr key={ep.id} className="hover:bg-slate-100/80 dark:hover:bg-slate-800/30">
                      <td className="py-2 px-3 font-mono text-slate-800 dark:text-slate-200">
                        {ep.address}:{ep.port}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-500 dark:text-slate-400">{ep.region}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {ep.activeConnections}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {ep.baseLatencyMs}ms
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => toggleEndpointHealth(activePool.id, ep.id)}
                          className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                            ep.healthy
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              : 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                          }`}
                        >
                          {ep.healthy ? 'Healthy' : 'Drained'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Add endpoint inline form */}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <input
                type="text"
                value={newEpAddr}
                onChange={(e) => setNewEpAddr(e.target.value)}
                placeholder="10.48.20.12"
                className="w-36 bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
              />
              <input
                type="number"
                value={newEpPort}
                onChange={(e) => setNewEpPort(Number(e.target.value))}
                className="w-20 bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
              />
              <select
                value={newEpRegion}
                onChange={(e) => setNewEpRegion(e.target.value as EdgeRegion)}
                className="bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
              >
                <option value="us-east">us-east</option>
                <option value="eu-central">eu-central</option>
                <option value="ap-south">ap-south</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  if (!newEpAddr.trim()) return;
                  updateUpstream(activePool.id, {
                    endpoints: [
                      ...activePool.endpoints,
                      {
                        id: `ep-${Date.now().toString(36)}`,
                        address: newEpAddr.trim(),
                        port: newEpPort || 8080,
                        region: newEpRegion,
                        healthy: true,
                        activeConnections: 12,
                        baseLatencyMs: 15,
                      },
                    ],
                  });
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#090D16] text-xs font-medium text-slate-800 dark:text-slate-200 hover:border-sky-400 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Endpoint</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
