import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { adapterRegistry } from '../core/adapters/registry';
import { validateIR } from '../core/compiler/validator';
import { PRESET_ARCHITECTURES } from '../core/ir/presets';
import { hashIR, loadPersistedIR, savePersistedIR } from '../core/ir/storage';
import {
  ChaosFaultConfig,
  ConfigSnapshot,
  Diagnostic,
  EdgeRegion,
  IngressIR,
  IngressRoute,
  MiddlewarePlugin,
  RegionalNodeState,
  RouteMiddlewareBinding,
  TelemetryPoint,
  TlsCertificate,
  UpstreamPool,
} from '../core/ir/types';
import {
  SimulatedRequest,
  TraceResult,
  simulateRequestTrace,
} from '../core/simulator/requestTracer';
import {
  EDGE_REGION_META,
  createInitialRegions,
  reconcileRegionDrift,
} from '../core/simulator/syncEngine';

export type WorkspaceView = 'topology' | 'routes' | 'upstreams' | 'policies' | 'security';

export interface EntitySelection {
  type: 'listener' | 'route' | 'upstream' | 'certificate' | 'policy';
  id: string;
}

interface ControlPlaneContextValue {
  ir: IngressIR;
  activeDeployedIR: IngressIR;
  desiredHash: string;
  activeHash: string;
  activePresetId: string;
  activeView: WorkspaceView;
  setActiveView: (view: WorkspaceView) => void;
  selection: EntitySelection | null;
  setSelection: (sel: EntitySelection | null) => void;
  inspectorOpen: boolean;
  setInspectorOpen: (open: boolean) => void;
  tracerOpen: boolean;
  setTracerOpen: (open: boolean) => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  customPluginModalOpen: boolean;
  setCustomPluginModalOpen: (open: boolean) => void;
  activeAdapterId: string;
  setActiveAdapterId: (id: string) => void;
  desiredConfig: string;
  activeConfig: string;
  diagnostics: Diagnostic[];
  regions: Record<EdgeRegion, RegionalNodeState>;
  snapshots: ConfigSnapshot[];
  chaos: ChaosFaultConfig;
  telemetry: Record<string, TelemetryPoint[]>;
  lastTrace: TraceResult | null;

  // Actions
  updateIR: (updater: (prev: IngressIR) => IngressIR) => void;
  loadPreset: (presetId: string) => void;
  importIR: (nextIR: IngressIR, label?: string) => void;
  applyAutoFix: (diag: Diagnostic) => void;
  syncAllRegions: () => void;
  syncRegion: (region: EdgeRegion) => void;
  rollbackSnapshot: (snapshotId: string) => void;
  registerCustomPlugin: (plugin: MiddlewarePlugin) => void;
  updateRoute: (routeId: string, patch: Partial<IngressRoute>) => void;
  addRoute: (route: IngressRoute) => void;
  deleteRoute: (routeId: string) => void;
  reorderRouteMiddlewares: (routeId: string, fromIdx: number, toIdx: number) => void;
  toggleRouteMiddleware: (routeId: string, bindingId: string) => void;
  addMiddlewareToRoute: (routeId: string, pluginId: string) => void;
  removeMiddlewareFromRoute: (routeId: string, bindingId: string) => void;
  updateMiddlewareConfig: (routeId: string, bindingId: string, config: Record<string, unknown>) => void;
  updateUpstream: (upstreamId: string, patch: Partial<UpstreamPool>) => void;
  toggleEndpointHealth: (upstreamId: string, endpointId: string) => void;
  updateCertificate: (certId: string, patch: Partial<TlsCertificate>) => void;
  setChaosFault: (updater: (prev: ChaosFaultConfig) => ChaosFaultConfig) => void;
  resetChaos: () => void;
  runTrace: (req: SimulatedRequest) => TraceResult;
  clearTrace: () => void;
}

const ControlPlaneContext = createContext<ControlPlaneContextValue | null>(null);

function seedInitialTelemetry(ir: IngressIR): Record<string, TelemetryPoint[]> {
  const map: Record<string, TelemetryPoint[]> = {};
  const now = Date.now();
  const buildSeries = (baseRps: number, baseLatency: number) =>
    Array.from({ length: 16 }, (_, idx) => ({
      ts: now - (15 - idx) * 1500,
      rps: Math.max(12, Math.round(baseRps + Math.sin(idx * 0.7) * (baseRps * 0.12))),
      p99Ms: Math.max(4, Math.round(baseLatency + Math.cos(idx * 0.6) * 4)),
      errorRate: 0.1,
    }));

  Object.keys(ir.listeners).forEach((id, idx) => {
    map[id] = buildSeries(1600 - idx * 350, 14 + idx * 3);
  });
  Object.keys(ir.routes).forEach((id, idx) => {
    map[id] = buildSeries(920 - idx * 180, 18 + idx * 4);
  });
  Object.keys(ir.upstreams).forEach((id, idx) => {
    const ups = ir.upstreams[id];
    const avgLat =
      ups.endpoints.length > 0
        ? ups.endpoints.reduce((s, e) => s + e.baseLatencyMs, 0) / ups.endpoints.length
        : 18;
    map[id] = buildSeries(640 - idx * 110, avgLat + 6);
  });
  return map;
}

export const ControlPlaneProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initialIR = useMemo(() => loadPersistedIR() ?? PRESET_ARCHITECTURES[0].createIR(), []);
  const initialHash = useMemo(() => hashIR(initialIR), [initialIR]);

  const [ir, setIr] = useState<IngressIR>(initialIR);
  const [debouncedIR, setDebouncedIR] = useState<IngressIR>(initialIR);
  const [activeDeployedIR, setActiveDeployedIR] = useState<IngressIR>(initialIR);
  const [activePresetId, setActivePresetId] = useState<string>('canary-microservices');
  const [activeView, setActiveView] = useState<WorkspaceView>('topology');
  const [selection, setSelection] = useState<EntitySelection | null>(() => {
    const firstRouteId = initialIR.routeOrder[0];
    return firstRouteId ? { type: 'route', id: firstRouteId } : null;
  });

  const [inspectorOpen, setInspectorOpen] = useState<boolean>(true);
  const [tracerOpen, setTracerOpen] = useState<boolean>(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false);
  const [customPluginModalOpen, setCustomPluginModalOpen] = useState<boolean>(false);
  const [activeAdapterId, setActiveAdapterId] = useState<string>('envoy-xds');

  const [regions, setRegions] = useState<Record<EdgeRegion, RegionalNodeState>>(() =>
    createInitialRegions(initialIR)
  );
  const [snapshots, setSnapshots] = useState<ConfigSnapshot[]>(() => [
    {
      id: `snap-${initialHash}`,
      hash: initialHash,
      label: 'Initial Control Plane Baseline',
      timestamp: new Date().toISOString(),
      ir: initialIR,
    },
  ]);

  const [chaos, setChaos] = useState<ChaosFaultConfig>({
    force503Upstreams: {},
    latencySpikesMs: {},
    forceExpiredCerts: {},
    droppedRegion: null,
  });

  const [telemetry, setTelemetry] = useState<Record<string, TelemetryPoint[]>>(() =>
    seedInitialTelemetry(initialIR)
  );
  const [lastTrace, setLastTrace] = useState<TraceResult | null>(null);
  const rrCounterRef = useRef<number>(0);

  // Persist normalized IR to localStorage and debounce AST validation
  useEffect(() => {
    savePersistedIR(ir);
    const timer = window.setTimeout(() => {
      setDebouncedIR(ir);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [ir]);

  const desiredHash = useMemo(() => hashIR(ir), [ir]);
  const activeHash = useMemo(() => hashIR(activeDeployedIR), [activeDeployedIR]);

  // Reconcile regional drift whenever desiredHash or chaos droppedRegion changes
  useEffect(() => {
    setRegions((prev) => reconcileRegionDrift(prev, desiredHash, chaos.droppedRegion));
  }, [desiredHash, chaos.droppedRegion]);

  // Global keyboard shortcuts: Cmd/Ctrl+K (Command Palette), Cmd/Ctrl+J (Tracer Drawer)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((v) => !v);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setTracerOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Telemetry tick loop for live RPS & p99 sparklines (reflects active chaos faults)
  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();
      setTelemetry((prev) => {
        const next: Record<string, TelemetryPoint[]> = {};
        const append = (id: string, baseRps: number, baseP99: number, errRate: number) => {
          const series = prev[id] ?? [];
          const jitterRps = Math.max(5, Math.round(baseRps + (Math.random() - 0.5) * baseRps * 0.14));
          const jitterP99 = Math.max(3, Math.round(baseP99 + (Math.random() - 0.5) * 6));
          next[id] = [...series.slice(-15), { ts: now, rps: jitterRps, p99Ms: jitterP99, errorRate: errRate }];
        };

        Object.values(ir.listeners).forEach((l, idx) => {
          append(l.id, 1520 - idx * 300, 14 + idx * 3, 0.05);
        });
        Object.values(ir.routes).forEach((r, idx) => {
          const has503 = r.targets.some((t) => chaos.force503Upstreams[t.upstreamId]);
          const maxSpike = r.targets.reduce(
            (mx, t) => Math.max(mx, chaos.latencySpikesMs[t.upstreamId] ?? 0),
            0
          );
          append(
            r.id,
            r.enabled ? 880 - idx * 140 : 0,
            (r.enabled ? 19 : 0) + maxSpike,
            has503 ? 14.5 : 0.08
          );
        });
        Object.values(ir.upstreams).forEach((u, idx) => {
          const is503 = Boolean(chaos.force503Upstreams[u.id]);
          const spike = chaos.latencySpikesMs[u.id] ?? 0;
          const healthyCount = u.endpoints.filter((e) => e.healthy).length;
          const avgBase =
            u.endpoints.length > 0
              ? u.endpoints.reduce((s, e) => s + e.baseLatencyMs, 0) / u.endpoints.length
              : 16;
          append(
            u.id,
            is503 || healthyCount === 0 ? 18 : 610 - idx * 95,
            avgBase + 8 + spike,
            is503 ? 98.4 : healthyCount === 0 ? 100 : 0.1
          );
        });
        return next;
      });
    }, 1500);

    return () => window.clearInterval(interval);
  }, [ir.listeners, ir.routes, ir.upstreams, chaos]);

  const diagnostics = useMemo(() => {
    const coreDiags = validateIR(debouncedIR, chaos);
    const adapter = adapterRegistry.get(activeAdapterId);
    const adapterDiags = adapter ? adapter.validate(debouncedIR) : [];
    return [...coreDiags, ...adapterDiags];
  }, [debouncedIR, chaos, activeAdapterId]);

  const desiredConfig = useMemo(() => {
    const adapter = adapterRegistry.get(activeAdapterId) ?? adapterRegistry.list()[0];
    return adapter ? adapter.compile(ir) : '';
  }, [ir, activeAdapterId]);

  const activeConfig = useMemo(() => {
    const adapter = adapterRegistry.get(activeAdapterId) ?? adapterRegistry.list()[0];
    return adapter ? adapter.compile(activeDeployedIR) : '';
  }, [activeDeployedIR, activeAdapterId]);

  const updateIR = useCallback((updater: (prev: IngressIR) => IngressIR) => {
    setIr((prev) => updater(prev));
  }, []);

  const loadPreset = useCallback((presetId: string) => {
    const preset = PRESET_ARCHITECTURES.find((p) => p.id === presetId);
    if (!preset) return;
    const freshIR = preset.createIR();
    const freshHash = hashIR(freshIR);
    setActivePresetId(presetId);
    setIr(freshIR);
    setDebouncedIR(freshIR);
    setActiveDeployedIR(freshIR);
    setRegions(createInitialRegions(freshIR));
    setChaos({ force503Upstreams: {}, latencySpikesMs: {}, forceExpiredCerts: {}, droppedRegion: null });
    setTelemetry(seedInitialTelemetry(freshIR));
    setLastTrace(null);
    setSnapshots((prev) => [
      {
        id: `snap-${freshHash}-${Date.now()}`,
        hash: freshHash,
        label: `Preset: ${preset.name}`,
        timestamp: new Date().toISOString(),
        ir: freshIR,
      },
      ...prev.slice(0, 11),
    ]);
    const firstRoute = freshIR.routeOrder[0];
    setSelection(firstRoute ? { type: 'route', id: firstRoute } : null);
  }, []);

  const importIR = useCallback((nextIR: IngressIR, label = 'Imported IR Snapshot') => {
    const nextHash = hashIR(nextIR);
    setIr(nextIR);
    setDebouncedIR(nextIR);
    setTelemetry(seedInitialTelemetry(nextIR));
    setSnapshots((prev) => [
      {
        id: `snap-${nextHash}-${Date.now()}`,
        hash: nextHash,
        label,
        timestamp: new Date().toISOString(),
        ir: nextIR,
      },
      ...prev.slice(0, 11),
    ]);
    const firstRoute = nextIR.routeOrder[0];
    setSelection(firstRoute ? { type: 'route', id: firstRoute } : null);
  }, []);

  const applyAutoFix = useCallback(
    (diag: Diagnostic) => {
      if (!diag.autoFix) return;
      const fixFn = diag.autoFix;
      setIr((prev) => fixFn(prev));
      if (diag.category === 'tls-expiry' && diag.entityType === 'certificate') {
        setChaos((prev) => ({
          ...prev,
          forceExpiredCerts: { ...prev.forceExpiredCerts, [diag.entityId]: false },
        }));
      }
    },
    []
  );

  const syncAllRegions = useCallback(() => {
    const currentHash = hashIR(ir);
    const now = new Date().toISOString();
    setActiveDeployedIR(ir);
    setRegions((prev) => {
      const next = { ...prev };
      (Object.keys(next) as EdgeRegion[]).forEach((reg) => {
        next[reg] = {
          ...next[reg],
          status: chaos.droppedRegion === reg ? 'degraded' : 'synced',
          activeHash: chaos.droppedRegion === reg ? next[reg].activeHash : currentHash,
          lastSyncedAt: now,
          syncLatencyMs: EDGE_REGION_META[reg].baseSyncLatencyMs + Math.round(Math.random() * 8),
        };
      });
      return next;
    });
    setSnapshots((prev) => [
      {
        id: `snap-${currentHash}-${Date.now()}`,
        hash: currentHash,
        label: `Global Rollout (${ir.clusterName})`,
        timestamp: now,
        ir,
      },
      ...prev.slice(0, 11),
    ]);
  }, [ir, chaos.droppedRegion]);

  const syncRegion = useCallback(
    (region: EdgeRegion) => {
      const currentHash = hashIR(ir);
      const now = new Date().toISOString();
      setRegions((prev) => ({
        ...prev,
        [region]: {
          ...prev[region],
          status: chaos.droppedRegion === region ? 'degraded' : 'synced',
          activeHash: currentHash,
          lastSyncedAt: now,
          syncLatencyMs: EDGE_REGION_META[region].baseSyncLatencyMs + Math.round(Math.random() * 6),
        },
      }));
      setActiveDeployedIR(ir);
    },
    [ir, chaos.droppedRegion]
  );

  const rollbackSnapshot = useCallback((snapshotId: string) => {
    setSnapshots((prev) => {
      const target = prev.find((s) => s.id === snapshotId);
      if (!target) return prev;
      setIr(target.ir);
      setDebouncedIR(target.ir);
      setActiveDeployedIR(target.ir);
      const rolledHash = hashIR(target.ir);
      const now = new Date().toISOString();
      setRegions((curr) => {
        const updated = { ...curr };
        (Object.keys(updated) as EdgeRegion[]).forEach((r) => {
          updated[r] = { ...updated[r], status: 'synced', activeHash: rolledHash, lastSyncedAt: now };
        });
        return updated;
      });
      return prev;
    });
  }, []);

  const registerCustomPlugin = useCallback((plugin: MiddlewarePlugin) => {
    setIr((prev) => ({
      ...prev,
      plugins: {
        ...prev.plugins,
        [plugin.id]: plugin,
      },
    }));
  }, []);

  const updateRoute = useCallback((routeId: string, patch: Partial<IngressRoute>) => {
    setIr((prev) => {
      const existing = prev.routes[routeId];
      if (!existing) return prev;
      return {
        ...prev,
        routes: {
          ...prev.routes,
          [routeId]: { ...existing, ...patch },
        },
      };
    });
  }, []);

  const addRoute = useCallback((route: IngressRoute) => {
    setIr((prev) => ({
      ...prev,
      routes: { ...prev.routes, [route.id]: route },
      routeOrder: [route.id, ...prev.routeOrder],
    }));
    setSelection({ type: 'route', id: route.id });
  }, []);

  const deleteRoute = useCallback((routeId: string) => {
    setIr((prev) => {
      const nextRoutes = { ...prev.routes };
      delete nextRoutes[routeId];
      return {
        ...prev,
        routes: nextRoutes,
        routeOrder: prev.routeOrder.filter((id) => id !== routeId),
      };
    });
    setSelection((sel) => (sel?.type === 'route' && sel.id === routeId ? null : sel));
  }, []);

  const reorderRouteMiddlewares = useCallback((routeId: string, fromIdx: number, toIdx: number) => {
    setIr((prev) => {
      const route = prev.routes[routeId];
      if (!route || fromIdx === toIdx) return prev;
      const nextMw = [...route.middlewares];
      const [moved] = nextMw.splice(fromIdx, 1);
      if (!moved) return prev;
      nextMw.splice(toIdx, 0, moved);
      return {
        ...prev,
        routes: { ...prev.routes, [routeId]: { ...route, middlewares: nextMw } },
      };
    });
  }, []);

  const toggleRouteMiddleware = useCallback((routeId: string, bindingId: string) => {
    setIr((prev) => {
      const route = prev.routes[routeId];
      if (!route) return prev;
      return {
        ...prev,
        routes: {
          ...prev.routes,
          [routeId]: {
            ...route,
            middlewares: route.middlewares.map((m) =>
              m.id === bindingId ? { ...m, enabled: !m.enabled } : m
            ),
          },
        },
      };
    });
  }, []);

  const addMiddlewareToRoute = useCallback((routeId: string, pluginId: string) => {
    setIr((prev) => {
      const route = prev.routes[routeId];
      const plugin = prev.plugins[pluginId];
      if (!route || !plugin) return prev;
      const binding: RouteMiddlewareBinding = {
        id: `mw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
        pluginId,
        enabled: true,
        config: { ...plugin.defaultConfig },
      };
      return {
        ...prev,
        routes: {
          ...prev.routes,
          [routeId]: { ...route, middlewares: [...route.middlewares, binding] },
        },
      };
    });
  }, []);

  const removeMiddlewareFromRoute = useCallback((routeId: string, bindingId: string) => {
    setIr((prev) => {
      const route = prev.routes[routeId];
      if (!route) return prev;
      return {
        ...prev,
        routes: {
          ...prev.routes,
          [routeId]: {
            ...route,
            middlewares: route.middlewares.filter((m) => m.id !== bindingId),
          },
        },
      };
    });
  }, []);

  const updateMiddlewareConfig = useCallback(
    (routeId: string, bindingId: string, config: Record<string, unknown>) => {
      setIr((prev) => {
        const route = prev.routes[routeId];
        if (!route) return prev;
        return {
          ...prev,
          routes: {
            ...prev.routes,
            [routeId]: {
              ...route,
              middlewares: route.middlewares.map((m) =>
                m.id === bindingId ? { ...m, config } : m
              ),
            },
          },
        };
      });
    },
    []
  );

  const updateUpstream = useCallback((upstreamId: string, patch: Partial<UpstreamPool>) => {
    setIr((prev) => {
      const existing = prev.upstreams[upstreamId];
      if (!existing) return prev;
      return {
        ...prev,
        upstreams: {
          ...prev.upstreams,
          [upstreamId]: { ...existing, ...patch },
        },
      };
    });
  }, []);

  const toggleEndpointHealth = useCallback((upstreamId: string, endpointId: string) => {
    setIr((prev) => {
      const pool = prev.upstreams[upstreamId];
      if (!pool) return prev;
      return {
        ...prev,
        upstreams: {
          ...prev.upstreams,
          [upstreamId]: {
            ...pool,
            endpoints: pool.endpoints.map((ep) =>
              ep.id === endpointId ? { ...ep, healthy: !ep.healthy } : ep
            ),
          },
        },
      };
    });
  }, []);

  const updateCertificate = useCallback((certId: string, patch: Partial<TlsCertificate>) => {
    setIr((prev) => {
      const existing = prev.certificates[certId];
      if (!existing) return prev;
      return {
        ...prev,
        certificates: {
          ...prev.certificates,
          [certId]: { ...existing, ...patch },
        },
      };
    });
  }, []);

  const setChaosFault = useCallback((updater: (prev: ChaosFaultConfig) => ChaosFaultConfig) => {
    setChaos((prev) => {
      const next = updater(prev);
      return next;
    });
  }, []);

  const resetChaos = useCallback(() => {
    setChaos({
      force503Upstreams: {},
      latencySpikesMs: {},
      forceExpiredCerts: {},
      droppedRegion: null,
    });
    // Close tripped circuit breakers when chaos is cleared
    setIr((prev) => {
      const nextUpstreams: Record<string, UpstreamPool> = {};
      for (const [id, pool] of Object.entries(prev.upstreams)) {
        nextUpstreams[id] = {
          ...pool,
          circuitBreaker: { ...pool.circuitBreaker, state: 'closed' },
        };
      }
      return { ...prev, upstreams: nextUpstreams };
    });
  }, []);

  const runTrace = useCallback(
    (req: SimulatedRequest): TraceResult => {
      rrCounterRef.current += 1;
      const result = simulateRequestTrace(ir, req, chaos, rrCounterRef.current);
      setLastTrace(result);

      if (result.trippedCircuitBreakerUpstreamId) {
        const trippedId = result.trippedCircuitBreakerUpstreamId;
        setIr((prev) => {
          const pool = prev.upstreams[trippedId];
          if (!pool || pool.circuitBreaker.state === 'open') return prev;
          return {
            ...prev,
            upstreams: {
              ...prev.upstreams,
              [trippedId]: {
                ...pool,
                circuitBreaker: { ...pool.circuitBreaker, state: 'open' },
              },
            },
          };
        });
      }
      return result;
    },
    [ir, chaos]
  );

  const clearTrace = useCallback(() => {
    setLastTrace(null);
  }, []);

  const value: ControlPlaneContextValue = {
    ir,
    activeDeployedIR,
    desiredHash,
    activeHash,
    activePresetId,
    activeView,
    setActiveView,
    selection,
    setSelection,
    inspectorOpen,
    setInspectorOpen,
    tracerOpen,
    setTracerOpen,
    commandPaletteOpen,
    setCommandPaletteOpen,
    customPluginModalOpen,
    setCustomPluginModalOpen,
    activeAdapterId,
    setActiveAdapterId,
    desiredConfig,
    activeConfig,
    diagnostics,
    regions,
    snapshots,
    chaos,
    telemetry,
    lastTrace,
    updateIR,
    loadPreset,
    importIR,
    applyAutoFix,
    syncAllRegions,
    syncRegion,
    rollbackSnapshot,
    registerCustomPlugin,
    updateRoute,
    addRoute,
    deleteRoute,
    reorderRouteMiddlewares,
    toggleRouteMiddleware,
    addMiddlewareToRoute,
    removeMiddlewareFromRoute,
    updateMiddlewareConfig,
    updateUpstream,
    toggleEndpointHealth,
    updateCertificate,
    setChaosFault,
    resetChaos,
    runTrace,
    clearTrace,
  };

  return <ControlPlaneContext.Provider value={value}>{children}</ControlPlaneContext.Provider>;
};

export function useControlPlane(): ControlPlaneContextValue {
  const ctx = useContext(ControlPlaneContext);
  if (!ctx) throw new Error('useControlPlane must be used inside ControlPlaneProvider');
  return ctx;
}
