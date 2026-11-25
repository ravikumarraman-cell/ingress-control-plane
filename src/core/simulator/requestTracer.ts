import {
  ChaosFaultConfig,
  EdgeRegion,
  GatewayListener,
  HttpMethod,
  IngressIR,
  IngressRoute,
  ProtocolType,
  UpstreamEndpoint,
  UpstreamPool,
} from '../ir/types';

export interface SimulatedRequest {
  method: HttpMethod;
  protocol: ProtocolType;
  host: string;
  path: string;
  headers: Record<string, string>;
  authToken: string;
  clientIp: string;
  clientCertPresent: boolean;
  sourceRegion: EdgeRegion;
  payloadSample: string;
}

export interface TraceStep {
  id: string;
  stage:
    | 'TLS Termination'
    | 'Listener Match'
    | 'Route Resolution'
    | 'Middleware Chain'
    | 'Load Balancer'
    | 'Upstream Target';
  title: string;
  status: 'pass' | 'mutate' | 'block' | 'reroute' | 'fail';
  durationMs: number;
  summary: string;
  details: Record<string, unknown>;
}

export interface TraceResult {
  requestId: string;
  timestamp: string;
  outcomeStatus: number;
  outcomeLabel: string;
  totalLatencyMs: number;
  matchedRouteId?: string;
  selectedUpstreamId?: string;
  selectedEndpoint?: string;
  trippedCircuitBreakerUpstreamId?: string;
  failoverTriggered: boolean;
  mutatedHeaders: Record<string, string>;
  steps: TraceStep[];
}

function simpleHash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function matchRoutePath(route: IngressRoute, path: string): boolean {
  if (route.matchType === 'exact') return path === route.pathPrefix;
  if (route.matchType === 'regex') {
    try {
      return new RegExp(route.pathPrefix).test(path);
    } catch {
      return false;
    }
  }
  return path.startsWith(route.pathPrefix);
}

function pickWeightedTarget(route: IngressRoute, seed: number): string | undefined {
  if (route.targets.length === 0) return undefined;
  const total = route.targets.reduce((acc, t) => acc + Math.max(0, t.weight), 0);
  if (total <= 0) return route.targets[0].upstreamId;
  const roll = seed % total;
  let cursor = 0;
  for (const t of route.targets) {
    cursor += Math.max(0, t.weight);
    if (roll < cursor) return t.upstreamId;
  }
  return route.targets[0].upstreamId;
}

function selectEndpoint(
  pool: UpstreamPool,
  req: SimulatedRequest,
  rrCounter: number,
  droppedRegion?: EdgeRegion | null
): UpstreamEndpoint | undefined {
  const candidates = pool.endpoints.filter(
    (ep) => ep.healthy && (!droppedRegion || ep.region !== droppedRegion)
  );
  if (candidates.length === 0) return undefined;

  // Prefer local region endpoints when available
  const regional = candidates.filter((ep) => ep.region === req.sourceRegion);
  const activeSet = regional.length > 0 ? regional : candidates;

  if (pool.lbAlgorithm === 'least_conn') {
    return [...activeSet].sort((a, b) => a.activeConnections - b.activeConnections)[0];
  }
  if (pool.lbAlgorithm === 'consistent_hash') {
    const keyHeader = pool.hashHeader ?? 'X-Session-ID';
    const keyVal = req.headers[keyHeader] ?? req.headers[keyHeader.toLowerCase()] ?? req.clientIp;
    const idx = simpleHash(keyVal) % activeSet.length;
    return activeSet[idx];
  }
  return activeSet[rrCounter % activeSet.length];
}

export function simulateRequestTrace(
  ir: IngressIR,
  req: SimulatedRequest,
  chaos: ChaosFaultConfig,
  rrCounter: number,
  referenceNow: Date = new Date('2026-11-25T07:30:00Z')
): TraceResult {
  const steps: TraceStep[] = [];
  const mutatedHeaders: Record<string, string> = { ...req.headers };
  const requestId = `req-${Math.random().toString(36).slice(2, 8)}`;
  let totalLatencyMs = 0;

  const listeners = Object.values(ir.listeners);
  const matchedListener: GatewayListener | undefined =
    listeners.find(
      (l) =>
        l.protocol === req.protocol &&
        (l.hostnames.includes(req.host) || l.hostnames.includes('*'))
    ) ?? listeners.find((l) => l.protocol === req.protocol);

  // Stage 1: TLS Termination
  if (req.protocol === 'HTTPS' || req.protocol === 'GRPC') {
    const cert = matchedListener?.tlsCertId ? ir.certificates[matchedListener.tlsCertId] : undefined;
    const isChaosExpired = cert ? Boolean(chaos.forceExpiredCerts[cert.id]) : false;
    const isDateExpired = cert ? new Date(cert.notAfter).getTime() <= referenceNow.getTime() : true;
    const tlsLatency = 6;
    totalLatencyMs += tlsLatency;

    if (!cert || isChaosExpired || isDateExpired) {
      steps.push({
        id: 'step-tls',
        stage: 'TLS Termination',
        title: cert ? `Certificate "${cert.name}" expired` : 'Missing TLS certificate',
        status: 'block',
        durationMs: tlsLatency,
        summary: isChaosExpired
          ? `Chaos fault forced TLS expiry on ${cert?.commonName}; handshake aborted.`
          : 'TLS handshake rejected due to expired or missing X.509 certificate.',
        details: { certId: cert?.id ?? 'none', commonName: cert?.commonName ?? 'unknown', chaosFault: isChaosExpired },
      });
      return {
        requestId,
        timestamp: new Date().toISOString(),
        outcomeStatus: 495,
        outcomeLabel: '495 SSL Certificate Error',
        totalLatencyMs,
        failoverTriggered: false,
        mutatedHeaders,
        steps,
      };
    }

    if (matchedListener?.tlsMode === 'mutual' && !req.clientCertPresent) {
      steps.push({
        id: 'step-tls',
        stage: 'TLS Termination',
        title: `mTLS handshake failed on ${matchedListener.name}`,
        status: 'block',
        durationMs: tlsLatency,
        summary: 'Listener enforces mutual TLS, but simulated client presented no X.509 certificate.',
        details: { tlsMode: 'mutual', clientCertPresent: false },
      });
      return {
        requestId,
        timestamp: new Date().toISOString(),
        outcomeStatus: 403,
        outcomeLabel: '403 Client Certificate Required',
        totalLatencyMs,
        failoverTriggered: false,
        mutatedHeaders,
        steps,
      };
    }

    steps.push({
      id: 'step-tls',
      stage: 'TLS Termination',
      title: `Terminated ${cert.algorithm} via "${cert.name}"`,
      status: 'pass',
      durationMs: tlsLatency,
      summary: `Verified SAN for ${req.host} (${matchedListener?.tlsMode ?? 'terminate'}).`,
      details: { certificate: cert.name, algorithm: cert.algorithm, issuer: cert.issuer },
    });
  } else {
    steps.push({
      id: 'step-tls',
      stage: 'TLS Termination',
      title: 'Plaintext HTTP listener (TLS bypassed)',
      status: 'pass',
      durationMs: 1,
      summary: 'Incoming request uses cleartext HTTP; no TLS termination required.',
      details: { protocol: req.protocol },
    });
    totalLatencyMs += 1;
  }

  // Stage 2: Listener Match
  if (!matchedListener) {
    steps.push({
      id: 'step-listener',
      stage: 'Listener Match',
      title: `No listener bound for ${req.protocol} / ${req.host}`,
      status: 'fail',
      durationMs: 1,
      summary: 'Connection dropped at edge listener dispatch.',
      details: { protocol: req.protocol, host: req.host },
    });
    return {
      requestId,
      timestamp: new Date().toISOString(),
      outcomeStatus: 404,
      outcomeLabel: '404 No Matching Listener',
      totalLatencyMs: totalLatencyMs + 1,
      failoverTriggered: false,
      mutatedHeaders,
      steps,
    };
  }

  totalLatencyMs += 1;
  steps.push({
    id: 'step-listener',
    stage: 'Listener Match',
    title: `Bound to ${matchedListener.name} (:${matchedListener.port})`,
    status: 'pass',
    durationMs: 1,
    summary: `Matched ${matchedListener.protocol} listener from ${req.sourceRegion}.`,
    details: { listenerId: matchedListener.id, port: matchedListener.port, sourceRegion: req.sourceRegion },
  });

  // Stage 3: Route Resolution
  const candidateRoutes = ir.routeOrder
    .map((id) => ir.routes[id])
    .filter((r): r is IngressRoute => Boolean(r) && r.enabled && r.listenerId === matchedListener.id)
    .sort((a, b) => b.priority - a.priority);

  const matchedRoute = candidateRoutes.find(
    (r) =>
      (r.host === req.host || r.host === '*') &&
      (r.methods.includes('*') || r.methods.includes(req.method)) &&
      matchRoutePath(r, req.path)
  );

  totalLatencyMs += 2;
  if (!matchedRoute) {
    steps.push({
      id: 'step-route',
      stage: 'Route Resolution',
      title: `No route matched ${req.method} ${req.host}${req.path}`,
      status: 'block',
      durationMs: 2,
      summary: 'Evaluated active route table in priority order; no host/path/method rule matched.',
      details: { evaluatedRoutes: candidateRoutes.length },
    });
    return {
      requestId,
      timestamp: new Date().toISOString(),
      outcomeStatus: 404,
      outcomeLabel: '404 Route Not Found',
      totalLatencyMs,
      failoverTriggered: false,
      mutatedHeaders,
      steps,
    };
  }

  steps.push({
    id: 'step-route',
    stage: 'Route Resolution',
    title: `Matched "${matchedRoute.name}" (${matchedRoute.matchType}: ${matchedRoute.pathPrefix})`,
    status: 'pass',
    durationMs: 2,
    summary: `Priority ${matchedRoute.priority} rule selected with ${matchedRoute.middlewares.filter((m) => m.enabled).length} active middlewares.`,
    details: { routeId: matchedRoute.id, priority: matchedRoute.priority, targets: matchedRoute.targets },
  });

  // Stage 4: Middleware Chain
  let hasAutoFailoverMiddleware = false;
  for (const binding of matchedRoute.middlewares) {
    if (!binding.enabled) continue;
    const plugin = ir.plugins[binding.pluginId];
    const pluginName = plugin?.name ?? binding.pluginId;
    const stepLatency = 2;
    totalLatencyMs += stepLatency;

    if (binding.pluginId === 'rate-limit') {
      const simulatedBurst = Number(req.headers['X-Simulate-RPS'] ?? req.headers['x-simulate-rps'] ?? 0);
      const rpsLimit = Number(binding.config.requestsPerSecond ?? 250);
      const burstLimit = Number(binding.config.burstSize ?? 500);
      const rejectCode = Number(binding.config.statusCode ?? 429);
      if (simulatedBurst > burstLimit) {
        steps.push({
          id: `step-mw-${binding.id}`,
          stage: 'Middleware Chain',
          title: `${pluginName} — Blocked`,
          status: 'block',
          durationMs: stepLatency,
          summary: `Simulated burst ${simulatedBurst} r/s exceeded token bucket capacity (${burstLimit}).`,
          details: { rpsLimit, burstLimit, keyBy: binding.config.keyBy },
        });
        return {
          requestId,
          timestamp: new Date().toISOString(),
          outcomeStatus: rejectCode,
          outcomeLabel: `${rejectCode} Too Many Requests`,
          totalLatencyMs,
          matchedRouteId: matchedRoute.id,
          failoverTriggered: false,
          mutatedHeaders,
          steps,
        };
      }
      steps.push({
        id: `step-mw-${binding.id}`,
        stage: 'Middleware Chain',
        title: `${pluginName} — Allowed`,
        status: 'pass',
        durationMs: stepLatency,
        summary: `Token consumed for key "${String(binding.config.keyBy ?? 'client_ip')}" (${rpsLimit} r/s cap).`,
        details: binding.config,
      });
    } else if (binding.pluginId === 'jwt-auth') {
      const token = req.authToken.trim();
      const permissive = Boolean(binding.config.allowMissingInDev);
      if (!token && !permissive) {
        steps.push({
          id: `step-mw-${binding.id}`,
          stage: 'Middleware Chain',
          title: `${pluginName} — Rejected`,
          status: 'block',
          durationMs: stepLatency,
          summary: `Missing Bearer token in ${String(binding.config.headerName ?? 'Authorization')} header.`,
          details: { issuer: binding.config.issuer, audience: binding.config.audience },
        });
        return {
          requestId,
          timestamp: new Date().toISOString(),
          outcomeStatus: 401,
          outcomeLabel: '401 Unauthorized (JWT Missing)',
          totalLatencyMs,
          matchedRouteId: matchedRoute.id,
          failoverTriggered: false,
          mutatedHeaders,
          steps,
        };
      }
      if (token.toLowerCase().includes('invalid')) {
        steps.push({
          id: `step-mw-${binding.id}`,
          stage: 'Middleware Chain',
          title: `${pluginName} — Invalid Signature`,
          status: 'block',
          durationMs: stepLatency,
          summary: 'JWT signature verification failed against OIDC JWKS.',
          details: { issuer: binding.config.issuer },
        });
        return {
          requestId,
          timestamp: new Date().toISOString(),
          outcomeStatus: 403,
          outcomeLabel: '403 Forbidden (Invalid JWT)',
          totalLatencyMs,
          matchedRouteId: matchedRoute.id,
          failoverTriggered: false,
          mutatedHeaders,
          steps,
        };
      }
      mutatedHeaders['X-Authenticated-Audience'] = String(binding.config.audience ?? 'api');
      steps.push({
        id: `step-mw-${binding.id}`,
        stage: 'Middleware Chain',
        title: `${pluginName} — Verified`,
        status: 'mutate',
        durationMs: stepLatency,
        summary: `Validated claim audience "${String(binding.config.audience)}" and injected identity header.`,
        details: { scope: binding.config.requiredScope },
      });
    } else if (binding.pluginId === 'mtls-enforce') {
      if (binding.config.requireClientCert && !req.clientCertPresent) {
        steps.push({
          id: `step-mw-${binding.id}`,
          stage: 'Middleware Chain',
          title: `${pluginName} — Denied`,
          status: 'block',
          durationMs: stepLatency,
          summary: 'Client X.509 certificate absent; SPIFFE identity could not be verified.',
          details: binding.config,
        });
        return {
          requestId,
          timestamp: new Date().toISOString(),
          outcomeStatus: 403,
          outcomeLabel: '403 mTLS Identity Required',
          totalLatencyMs,
          matchedRouteId: matchedRoute.id,
          failoverTriggered: false,
          mutatedHeaders,
          steps,
        };
      }
      if (binding.config.forwardClientCertHeader) {
        mutatedHeaders['X-Forwarded-Client-Cert'] = `By=${String(binding.config.allowedSpiffePrefix ?? 'spiffe://prod')}`;
      }
      steps.push({
        id: `step-mw-${binding.id}`,
        stage: 'Middleware Chain',
        title: `${pluginName} — Verified`,
        status: 'mutate',
        durationMs: stepLatency,
        summary: `Client cert matched trust domain ${String(binding.config.allowedSpiffePrefix ?? 'spiffe://')}.`,
        details: binding.config,
      });
    } else if (binding.pluginId === 'waf-ruleset') {
      const combinedInput = `${req.path} ${req.payloadSample} ${JSON.stringify(req.headers)}`.toLowerCase();
      const sqliHit =
        Boolean(binding.config.blockSqlInjection) &&
        (combinedInput.includes('union select') || combinedInput.includes("' or 1=1") || combinedInput.includes('drop table'));
      const xssHit =
        Boolean(binding.config.blockXss) &&
        (combinedInput.includes('<script') || combinedInput.includes('javascript:'));
      if (sqliHit || xssHit) {
        const mode = String(binding.config.mode ?? 'block');
        if (mode === 'block') {
          steps.push({
            id: `step-mw-${binding.id}`,
            stage: 'Middleware Chain',
            title: `${pluginName} — Attack Blocked`,
            status: 'block',
            durationMs: stepLatency,
            summary: `OWASP CRS Paranoia L${String(binding.config.paranoiaLevel ?? 2)} matched ${sqliHit ? 'SQL Injection' : 'XSS'} signature.`,
            details: { ruleMatched: sqliHit ? 'CRS-942100' : 'CRS-941100', mode },
          });
          return {
            requestId,
            timestamp: new Date().toISOString(),
            outcomeStatus: 403,
            outcomeLabel: '403 Blocked by WAF',
            totalLatencyMs,
            matchedRouteId: matchedRoute.id,
            failoverTriggered: false,
            mutatedHeaders,
            steps,
          };
        }
      }
      steps.push({
        id: `step-mw-${binding.id}`,
        stage: 'Middleware Chain',
        title: `${pluginName} — Clean`,
        status: 'pass',
        durationMs: stepLatency,
        summary: `Inspected request against OWASP Paranoia Level ${String(binding.config.paranoiaLevel ?? 2)}.`,
        details: binding.config,
      });
    } else if (binding.pluginId === 'header-transform') {
      const addKey = String(binding.config.addHeaderKey ?? '');
      const addVal = String(binding.config.addHeaderValue ?? '');
      if (addKey) mutatedHeaders[addKey] = addVal;
      const stripList = String(binding.config.stripHeaders ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      stripList.forEach((k) => {
        delete mutatedHeaders[k];
      });
      steps.push({
        id: `step-mw-${binding.id}`,
        stage: 'Middleware Chain',
        title: `${pluginName} — Headers Mutated`,
        status: 'mutate',
        durationMs: stepLatency,
        summary: `Injected ${addKey || 'headers'} and stripped [${stripList.join(', ') || 'none'}].`,
        details: { added: addKey ? { [addKey]: addVal } : {}, stripped: stripList },
      });
    } else if (binding.pluginId === 'cors') {
      mutatedHeaders['Access-Control-Allow-Origin'] = String(binding.config.allowedOrigins ?? '*');
      steps.push({
        id: `step-mw-${binding.id}`,
        stage: 'Middleware Chain',
        title: `${pluginName} — CORS Applied`,
        status: 'mutate',
        durationMs: stepLatency,
        summary: `Attached CORS allow-origin policies (max-age ${String(binding.config.maxAgeSeconds ?? 3600)}s).`,
        details: binding.config,
      });
    } else if (binding.pluginId === 'circuit-breaker') {
      hasAutoFailoverMiddleware = Boolean(binding.config.autoFailover ?? true);
      steps.push({
        id: `step-mw-${binding.id}`,
        stage: 'Middleware Chain',
        title: `${pluginName} — Armed`,
        status: 'pass',
        durationMs: stepLatency,
        summary: `Threshold ${String(binding.config.consecutiveErrors ?? 3)} consecutive 5xx; auto-failover ${hasAutoFailoverMiddleware ? 'enabled' : 'disabled'}.`,
        details: binding.config,
      });
    } else {
      // Custom hot-registered plugin execution!
      mutatedHeaders[`X-Plugin-${binding.pluginId}`] = 'executed';
      steps.push({
        id: `step-mw-${binding.id}`,
        stage: 'Middleware Chain',
        title: `${pluginName} (Custom Plugin) — Executed`,
        status: 'mutate',
        durationMs: stepLatency,
        summary: `Evaluated custom schema plugin "${binding.pluginId}" with ${Object.keys(binding.config).length} parameters.`,
        details: binding.config,
      });
    }
  }

  // Stage 5: Load Balancer Selection & Chaos Failover
  const primaryUpstreamId = pickWeightedTarget(matchedRoute, rrCounter * 17 + simpleHash(req.path));
  let selectedUpstream = primaryUpstreamId ? ir.upstreams[primaryUpstreamId] : undefined;
  let failoverTriggered = false;
  let trippedCircuitBreakerUpstreamId: string | undefined;

  if (!selectedUpstream) {
    steps.push({
      id: 'step-lb',
      stage: 'Load Balancer',
      title: 'No valid upstream pool configured',
      status: 'fail',
      durationMs: 1,
      summary: 'Route targets point to missing upstream pools.',
      details: {},
    });
    return {
      requestId,
      timestamp: new Date().toISOString(),
      outcomeStatus: 502,
      outcomeLabel: '502 Bad Gateway',
      totalLatencyMs: totalLatencyMs + 1,
      matchedRouteId: matchedRoute.id,
      failoverTriggered: false,
      mutatedHeaders,
      steps,
    };
  }

  const isPrimaryChaos503 = Boolean(chaos.force503Upstreams[selectedUpstream.id]);
  const primaryEndpoint = selectEndpoint(selectedUpstream, req, rrCounter, chaos.droppedRegion);

  if (isPrimaryChaos503 || !primaryEndpoint || selectedUpstream.circuitBreaker.state === 'open') {
    trippedCircuitBreakerUpstreamId = selectedUpstream.id;
    const policy = matchedRoute.policyId ? ir.policies[matchedRoute.policyId] : undefined;
    const candidateFailoverId =
      policy?.failoverUpstreamId ??
      matchedRoute.targets.find((t) => t.upstreamId !== selectedUpstream?.id && !chaos.force503Upstreams[t.upstreamId])?.upstreamId;

    const failoverPool = candidateFailoverId ? ir.upstreams[candidateFailoverId] : undefined;
    const failoverEp = failoverPool
      ? selectEndpoint(failoverPool, req, rrCounter, chaos.droppedRegion)
      : undefined;

    if ((hasAutoFailoverMiddleware || policy?.failoverUpstreamId) && failoverPool && failoverEp && !chaos.force503Upstreams[failoverPool.id]) {
      failoverTriggered = true;
      totalLatencyMs += 4;
      steps.push({
        id: 'step-lb',
        stage: 'Load Balancer',
        title: `Circuit Tripped on "${selectedUpstream.name}" → Rerouted to "${failoverPool.name}"`,
        status: 'reroute',
        durationMs: 4,
        summary: `Upstream "${selectedUpstream.name}" returned injected 503 / unhealthy state; automatic failover selected ${failoverEp.address}:${failoverEp.port} (${failoverEp.region}).`,
        details: {
          trippedPool: selectedUpstream.name,
          failoverPool: failoverPool.name,
          algorithm: failoverPool.lbAlgorithm,
          endpoint: `${failoverEp.address}:${failoverEp.port}`,
        },
      });
      selectedUpstream = failoverPool;
    } else {
      totalLatencyMs += 5;
      steps.push({
        id: 'step-lb',
        stage: 'Load Balancer',
        title: `Upstream "${selectedUpstream.name}" Unavailable (503)`,
        status: 'fail',
        durationMs: 5,
        summary: isPrimaryChaos503
          ? 'Chaos 503 fault tripped circuit breaker; no healthy failover pool available.'
          : 'Zero healthy endpoints remaining in pool.',
        details: { upstream: selectedUpstream.name, chaos503: isPrimaryChaos503 },
      });
      return {
        requestId,
        timestamp: new Date().toISOString(),
        outcomeStatus: 503,
        outcomeLabel: '503 Service Unavailable (Circuit Open)',
        totalLatencyMs,
        matchedRouteId: matchedRoute.id,
        selectedUpstreamId: selectedUpstream.id,
        trippedCircuitBreakerUpstreamId,
        failoverTriggered: false,
        mutatedHeaders,
        steps,
      };
    }
  } else {
    totalLatencyMs += 2;
    steps.push({
      id: 'step-lb',
      stage: 'Load Balancer',
      title: `Selected "${selectedUpstream.name}" via ${selectedUpstream.lbAlgorithm.replace('_', ' ')}`,
      status: 'pass',
      durationMs: 2,
      summary: `Picked endpoint ${primaryEndpoint.address}:${primaryEndpoint.port} in ${primaryEndpoint.region}.`,
      details: {
        pool: selectedUpstream.name,
        algorithm: selectedUpstream.lbAlgorithm,
        endpoint: `${primaryEndpoint.address}:${primaryEndpoint.port}`,
        region: primaryEndpoint.region,
      },
    });
  }

  // Stage 6: Upstream Target Execution
  const finalEndpoint = selectEndpoint(selectedUpstream, req, rrCounter, chaos.droppedRegion) ?? selectedUpstream.endpoints[0];
  const chaosSpike = chaos.latencySpikesMs[selectedUpstream.id] ?? 0;
  const upstreamDuration = (finalEndpoint?.baseLatencyMs ?? 15) + chaosSpike;
  totalLatencyMs += upstreamDuration;

  steps.push({
    id: 'step-upstream',
    stage: 'Upstream Target',
    title: `200 OK from ${selectedUpstream.name} (${finalEndpoint?.address ?? '10.0.0.1'}:${finalEndpoint?.port ?? 8080})`,
    status: chaosSpike > 0 ? 'mutate' : 'pass',
    durationMs: upstreamDuration,
    summary:
      chaosSpike > 0
        ? `Upstream responded with +${chaosSpike}ms chaos latency spike injected.`
        : `Upstream served response cleanly in ${upstreamDuration}ms.`,
    details: {
      upstreamId: selectedUpstream.id,
      endpoint: finalEndpoint ? `${finalEndpoint.address}:${finalEndpoint.port}` : 'n/a',
      region: finalEndpoint?.region ?? req.sourceRegion,
      chaosLatencySpikeMs: chaosSpike,
    },
  });

  return {
    requestId,
    timestamp: new Date().toISOString(),
    outcomeStatus: 200,
    outcomeLabel: failoverTriggered ? '200 OK (Failover Recovered)' : '200 OK',
    totalLatencyMs,
    matchedRouteId: matchedRoute.id,
    selectedUpstreamId: selectedUpstream.id,
    selectedEndpoint: finalEndpoint ? `${finalEndpoint.address}:${finalEndpoint.port}` : undefined,
    trippedCircuitBreakerUpstreamId,
    failoverTriggered,
    mutatedHeaders,
    steps,
  };
}
