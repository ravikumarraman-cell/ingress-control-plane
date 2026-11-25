import React, { useEffect, useState } from 'react';
import { Flame, Play, RotateCcw, X } from 'lucide-react';
import { EdgeRegion, HttpMethod, ProtocolType } from '../../core/ir/types';
import { SimulatedRequest } from '../../core/simulator/requestTracer';
import { useControlPlane } from '../../store/ControlPlaneContext';

const STEP_TONE: Record<string, string> = {
  pass: 'text-emerald-700 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/5',
  mutate: 'text-blue-700 dark:text-sky-300 border-sky-500/30 bg-sky-500/5',
  reroute: 'text-amber-700 dark:text-amber-300 border-amber-500/40 bg-amber-500/10',
  block: 'text-rose-700 dark:text-rose-300 border-rose-500/40 bg-rose-500/10',
  fail: 'text-rose-700 dark:text-rose-300 border-rose-500/40 bg-rose-500/10',
};

export const RequestTracerDrawer: React.FC = () => {
  const {
    ir,
    tracerOpen,
    setTracerOpen,
    chaos,
    setChaosFault,
    resetChaos,
    runTrace,
    lastTrace,
    clearTrace,
  } = useControlPlane();

  const firstRoute = ir.routeOrder[0] ? ir.routes[ir.routeOrder[0]] : undefined;
  const firstListener = firstRoute ? ir.listeners[firstRoute.listenerId] : Object.values(ir.listeners)[0];

  const [req, setReq] = useState<SimulatedRequest>({
    method: 'GET',
    protocol: firstListener?.protocol ?? 'HTTPS',
    host: firstRoute?.host ?? 'api.acme.internal',
    path: firstRoute?.pathPrefix ?? '/v2/orders',
    headers: { 'X-Session-ID': 'sess-9921a', Origin: 'https://app.ingressos.io' },
    authToken: 'Bearer eyJhbGciOiJFUzI1NiJ9.valid.token',
    clientIp: '203.0.113.42',
    clientCertPresent: true,
    sourceRegion: 'us-east',
    payloadSample: '{"orderId": "ord-102"}',
  });

  // Sync default request host/path when user switches presets
  useEffect(() => {
    if (firstRoute) {
      const lst = ir.listeners[firstRoute.listenerId];
      setReq((prev) => ({
        ...prev,
        protocol: lst?.protocol ?? 'HTTPS',
        host: firstRoute.host,
        path: firstRoute.pathPrefix,
        method: firstRoute.methods[0] === '*' ? 'GET' : firstRoute.methods[0] ?? 'GET',
      }));
    }
  }, [ir.clusterName]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tracerOpen) return null;

  const upstreams = Object.values(ir.upstreams);
  const certificates = Object.values(ir.certificates);

  return (
    <section
      aria-label="Live Request Tracer and Chaos Sandbox"
      className="fixed inset-x-0 bottom-0 z-40 h-[440px] max-h-[75vh] bg-white dark:bg-[#0B111E] border-t border-slate-300 dark:border-slate-700/80 shadow-2xl flex flex-col"
    >
      {/* Drawer Header */}
      <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A]">
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Live Request Tracer & Chaos Sandbox
          </h2>
          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
            Cmd/Ctrl+J to toggle
          </span>
        </div>

        <div className="flex items-center gap-2">
          {lastTrace && (
            <button
              type="button"
              onClick={clearTrace}
              className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              Clear Trace
            </button>
          )}
          <button
            type="button"
            onClick={() => runTrace(req)}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Trace Request</span>
          </button>
          <button
            type="button"
            onClick={() => setTracerOpen(false)}
            className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
            aria-label="Close Request Tracer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 3-Column Drawer Content */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800 overflow-hidden">
        {/* Column 1: Simulated Request Builder */}
        <div className="lg:col-span-4 p-3.5 overflow-y-auto space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">Request Builder</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setReq((p) => ({
                    ...p,
                    payloadSample: "SELECT * FROM users WHERE id = '1' UNION SELECT password FROM creds",
                  }))
                }
                className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#090D16] text-[10.5px] text-amber-700 dark:text-amber-300 hover:border-amber-400/50"
              >
                Test SQLi
              </button>
              <button
                type="button"
                onClick={() =>
                  setReq((p) => ({
                    ...p,
                    authToken: '',
                    clientCertPresent: false,
                  }))
                }
                className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#090D16] text-[10.5px] text-rose-700 dark:text-rose-300 hover:border-rose-400/50"
              >
                Strip Auth
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <select
              value={req.protocol}
              onChange={(e) => setReq((p) => ({ ...p, protocol: e.target.value as ProtocolType }))}
              className="bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100"
            >
              <option value="HTTPS">HTTPS</option>
              <option value="HTTP">HTTP</option>
              <option value="GRPC">GRPC</option>
            </select>
            <select
              value={req.method}
              onChange={(e) => setReq((p) => ({ ...p, method: e.target.value as HttpMethod }))}
              className="bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100"
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="DELETE">DELETE</option>
            </select>
            <select
              value={req.sourceRegion}
              onChange={(e) => setReq((p) => ({ ...p, sourceRegion: e.target.value as EdgeRegion }))}
              className="bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100"
            >
              <option value="us-east">us-east</option>
              <option value="eu-central">eu-central</option>
              <option value="ap-south">ap-south</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={req.host}
              onChange={(e) => setReq((p) => ({ ...p, host: e.target.value }))}
              placeholder="Host"
              className="bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100"
            />
            <input
              type="text"
              value={req.path}
              onChange={(e) => setReq((p) => ({ ...p, path: e.target.value }))}
              placeholder="/v2/orders"
              className="bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={req.clientIp}
              onChange={(e) => setReq((p) => ({ ...p, clientIp: e.target.value }))}
              placeholder="Client IP"
              className="bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100"
            />
            <label className="flex items-center gap-2 px-2 py-1 rounded bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={req.clientCertPresent}
                onChange={(e) => setReq((p) => ({ ...p, clientCertPresent: e.target.checked }))}
                className="accent-sky-500"
              />
              <span>Client mTLS Cert</span>
            </label>
          </div>

          <input
            type="text"
            value={req.authToken}
            onChange={(e) => setReq((p) => ({ ...p, authToken: e.target.value }))}
            placeholder="Authorization: Bearer ..."
            className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100"
          />

          <input
            type="text"
            value={req.payloadSample}
            onChange={(e) => setReq((p) => ({ ...p, payloadSample: e.target.value }))}
            placeholder="Body / Query sample for WAF inspection"
            className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100"
          />
        </div>

        {/* Column 2: Step-by-Step Packet Execution Trace */}
        <div className="lg:col-span-5 p-3.5 overflow-y-auto space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">Pipeline Execution Trace</span>
            {lastTrace && (
              <span
                className={`text-xs font-mono font-semibold tabular-nums ${
                  lastTrace.outcomeStatus < 400 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {lastTrace.outcomeLabel} · {lastTrace.totalLatencyMs}ms
              </span>
            )}
          </div>

          {!lastTrace ? (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#090D16] p-6 text-center text-xs text-slate-500 dark:text-slate-400">
              Click <span className="text-blue-700 dark:text-sky-300 font-medium">Trace Request</span> to step a simulated packet through TLS Termination, Route Resolution, Middleware Chain, Load Balancer, and Upstream Target.
            </div>
          ) : (
            <div className="space-y-2">
              {lastTrace.steps.map((step, i) => (
                <div
                  key={step.id}
                  className={`rounded-md border px-3 py-2 text-xs ${
                    STEP_TONE[step.status] ?? 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#090D16] text-slate-800 dark:text-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[10.5px] opacity-75 shrink-0">
                        0{i + 1} · {step.stage}
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">{step.title}</span>
                    </div>
                    <span className="font-mono tabular-nums text-[10.5px] shrink-0">
                      {step.durationMs}ms · {step.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-700 dark:text-slate-300/90 mt-1">{step.summary}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Column 3: Chaos Fault Injection Sandbox */}
        <div className="lg:col-span-3 p-3.5 overflow-y-auto space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 inline-flex items-center gap-1.5">
              <Flame className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
              <span>Chaos Sandbox</span>
            </span>
            <button
              type="button"
              onClick={resetChaos}
              className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          </div>

          <div className="space-y-2">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Upstream Faults</div>
            {upstreams.map((ups) => {
              const is503 = Boolean(chaos.force503Upstreams[ups.id]);
              const spike = chaos.latencySpikesMs[ups.id] ?? 0;
              return (
                <div
                  key={ups.id}
                  className="rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#090D16] p-2 space-y-1.5 text-[11px]"
                >
                  <div className="font-mono text-slate-800 dark:text-slate-200 truncate">{ups.name}</div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setChaosFault((prev) => ({
                          ...prev,
                          force503Upstreams: {
                            ...prev.force503Upstreams,
                            [ups.id]: !is503,
                          },
                        }))
                      }
                      className={`px-2 py-0.5 rounded border font-medium transition-colors ${
                        is503
                          ? 'border-rose-500/60 bg-rose-500/15 text-rose-700 dark:text-rose-300'
                          : 'border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                      }`}
                    >
                      {is503 ? '503 Active' : 'Inject 503'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setChaosFault((prev) => ({
                          ...prev,
                          latencySpikesMs: {
                            ...prev.latencySpikesMs,
                            [ups.id]: spike > 0 ? 0 : 350,
                          },
                        }))
                      }
                      className={`px-2 py-0.5 rounded border font-medium transition-colors ${
                        spike > 0
                          ? 'border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                          : 'border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                      }`}
                    >
                      {spike > 0 ? `+${spike}ms` : '+350ms'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-1.5 pt-1 border-t border-slate-200 dark:border-slate-800/80">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Force TLS Expiry</div>
            {certificates.map((cert) => {
              const expired = Boolean(chaos.forceExpiredCerts[cert.id]);
              return (
                <button
                  key={cert.id}
                  type="button"
                  onClick={() =>
                    setChaosFault((prev) => ({
                      ...prev,
                      forceExpiredCerts: {
                        ...prev.forceExpiredCerts,
                        [cert.id]: !expired,
                      },
                    }))
                  }
                  className={`w-full text-left px-2.5 py-1 rounded border text-[11px] font-mono transition-colors ${
                    expired
                      ? 'border-rose-500/60 bg-rose-500/15 text-rose-700 dark:text-rose-300'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#090D16] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  {cert.name}: {expired ? 'Expired Fault ON' : 'Valid'}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
