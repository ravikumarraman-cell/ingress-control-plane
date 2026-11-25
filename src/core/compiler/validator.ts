import { ChaosFaultConfig, Diagnostic, IngressIR, IngressRoute } from '../ir/types';

function matchesSan(hostname: string, san: string): boolean {
  if (san === hostname) return true;
  if (san.startsWith('*.')) {
    const suffix = san.slice(1); // ".example.com"
    return hostname.endsWith(suffix) && hostname.split('.').length >= san.split('.').length;
  }
  return false;
}

function normalizeWeightsTo100(targets: IngressRoute['targets']): IngressRoute['targets'] {
  if (targets.length === 0) return targets;
  const total = targets.reduce((acc, t) => acc + Math.max(0, t.weight), 0);
  if (total === 0) {
    const equal = Math.floor(100 / targets.length);
    const remainder = 100 - equal * targets.length;
    return targets.map((t, idx) => ({ ...t, weight: equal + (idx === 0 ? remainder : 0) }));
  }
  const scaled = targets.map((t) => Math.floor((Math.max(0, t.weight) / total) * 100));
  const diff = 100 - scaled.reduce((a, b) => a + b, 0);
  scaled[0] += diff;
  return targets.map((t, idx) => ({ ...t, weight: scaled[idx] }));
}

export function validateIR(
  ir: IngressIR,
  chaos?: ChaosFaultConfig,
  referenceNow: Date = new Date('2026-11-25T07:30:00Z')
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const routes = ir.routeOrder
    .map((id) => ir.routes[id])
    .filter((r): r is IngressRoute => Boolean(r));

  // 1. Certificate checks (Expiry & SAN coverage)
  for (const cert of Object.values(ir.certificates)) {
    const forcedExpired = Boolean(chaos?.forceExpiredCerts[cert.id]);
    const expDate = new Date(cert.notAfter);
    const daysRemaining = forcedExpired
      ? -12
      : Math.ceil((expDate.getTime() - referenceNow.getTime()) / (1000 * 60 * 60 * 24));

    if (daysRemaining <= 0) {
      diagnostics.push({
        id: `diag-cert-expired-${cert.id}`,
        severity: 'error',
        category: 'tls-expiry',
        entityType: 'certificate',
        entityId: cert.id,
        message: `Certificate "${cert.name}" is expired (${forcedExpired ? 'chaos fault injected' : cert.notAfter.slice(0, 10)})`,
        detail: `TLS handshakes for ${cert.commonName} will fail until renewed or rotated.`,
        autoFixLabel: 'Renew 365d Managed Cert',
        autoFix: (curr) => {
          const existing = curr.certificates[cert.id];
          if (!existing) return curr;
          const renewed = new Date(referenceNow.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
          return {
            ...curr,
            certificates: {
              ...curr.certificates,
              [cert.id]: {
                ...existing,
                notBefore: referenceNow.toISOString(),
                notAfter: renewed,
                managed: true,
              },
            },
          };
        },
      });
    } else if (daysRemaining <= 30) {
      diagnostics.push({
        id: `diag-cert-expiring-${cert.id}`,
        severity: 'warning',
        category: 'tls-expiry',
        entityType: 'certificate',
        entityId: cert.id,
        message: `Certificate "${cert.name}" expires in ${daysRemaining} days`,
        detail: `Subject ${cert.commonName} expires ${cert.notAfter.slice(0, 10)}. Rotate before expiry.`,
        autoFixLabel: 'Renew 365d Managed Cert',
        autoFix: (curr) => {
          const existing = curr.certificates[cert.id];
          if (!existing) return curr;
          const renewed = new Date(referenceNow.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
          return {
            ...curr,
            certificates: {
              ...curr.certificates,
              [cert.id]: {
                ...existing,
                notAfter: renewed,
                managed: true,
              },
            },
          };
        },
      });
    }
  }

  // 2. Listener reference & SAN checks
  for (const listener of Object.values(ir.listeners)) {
    if ((listener.protocol === 'HTTPS' || listener.protocol === 'GRPC') && listener.tlsCertId) {
      const cert = ir.certificates[listener.tlsCertId];
      if (!cert) {
        const firstCertId = Object.keys(ir.certificates)[0];
        diagnostics.push({
          id: `diag-lst-missing-cert-${listener.id}`,
          severity: 'error',
          category: 'broken-reference',
          entityType: 'listener',
          entityId: listener.id,
          message: `Listener "${listener.name}" references missing TLS certificate "${listener.tlsCertId}"`,
          detail: 'Attach an active TLS certificate to restore encrypted termination.',
          autoFixLabel: firstCertId ? 'Bind Available Certificate' : undefined,
          autoFix: firstCertId
            ? (curr) => ({
                ...curr,
                listeners: {
                  ...curr.listeners,
                  [listener.id]: { ...curr.listeners[listener.id], tlsCertId: firstCertId },
                },
              })
            : undefined,
        });
      } else {
        for (const host of listener.hostnames) {
          const covered = cert.sans.some((san) => matchesSan(host, san)) || matchesSan(host, cert.commonName);
          if (!covered) {
            diagnostics.push({
              id: `diag-lst-san-${listener.id}-${host}`,
              severity: 'warning',
              category: 'tls-expiry',
              entityType: 'listener',
              entityId: listener.id,
              message: `Hostname "${host}" on listener "${listener.name}" is missing from certificate SANs`,
              detail: `Certificate "${cert.name}" covers [${cert.sans.join(', ')}]. Browsers will raise SAN mismatch.`,
              autoFixLabel: `Add ${host} to SANs`,
              autoFix: (curr) => {
                const targetCert = curr.certificates[cert.id];
                if (!targetCert) return curr;
                return {
                  ...curr,
                  certificates: {
                    ...curr.certificates,
                    [cert.id]: {
                      ...targetCert,
                      sans: Array.from(new Set([...targetCert.sans, host])),
                    },
                  },
                };
              },
            });
          }
        }
      }
    }
  }

  // 3. Route validation: references, weights, middleware bindings
  for (const route of routes) {
    if (!ir.listeners[route.listenerId]) {
      const fallbackListenerId = Object.keys(ir.listeners)[0];
      diagnostics.push({
        id: `diag-rt-missing-lst-${route.id}`,
        severity: 'error',
        category: 'broken-reference',
        entityType: 'route',
        entityId: route.id,
        message: `Route "${route.name}" references missing listener "${route.listenerId}"`,
        detail: 'Route will be orphaned and unreachable from edge ports.',
        autoFixLabel: fallbackListenerId ? 'Bind Primary Listener' : undefined,
        autoFix: fallbackListenerId
          ? (curr) => ({
              ...curr,
              routes: {
                ...curr.routes,
                [route.id]: { ...curr.routes[route.id], listenerId: fallbackListenerId },
              },
            })
          : undefined,
      });
    }

    if (route.policyId && !ir.policies[route.policyId]) {
      diagnostics.push({
        id: `diag-rt-missing-pol-${route.id}`,
        severity: 'warning',
        category: 'broken-reference',
        entityType: 'route',
        entityId: route.id,
        message: `Route "${route.name}" references missing policy "${route.policyId}"`,
        detail: 'Timeout and retry settings fall back to proxy defaults.',
        autoFixLabel: 'Clear Broken Policy Link',
        autoFix: (curr) => ({
          ...curr,
          routes: {
            ...curr.routes,
            [route.id]: { ...curr.routes[route.id], policyId: undefined },
          },
        }),
      });
    }

    const brokenTargets = route.targets.filter((t) => !ir.upstreams[t.upstreamId]);
    if (brokenTargets.length > 0) {
      diagnostics.push({
        id: `diag-rt-broken-ups-${route.id}`,
        severity: 'error',
        category: 'broken-reference',
        entityType: 'route',
        entityId: route.id,
        message: `Route "${route.name}" targets missing upstream pool (${brokenTargets.map((b) => b.upstreamId).join(', ')})`,
        detail: 'Requests matched to this route will return 502 Bad Gateway.',
        autoFixLabel: 'Prune Broken Targets',
        autoFix: (curr) => {
          const valid = curr.routes[route.id].targets.filter((t) => Boolean(curr.upstreams[t.upstreamId]));
          const firstUpstream = Object.keys(curr.upstreams)[0];
          const nextTargets =
            valid.length > 0
              ? normalizeWeightsTo100(valid)
              : firstUpstream
                ? [{ upstreamId: firstUpstream, weight: 100, label: 'Fallback' }]
                : [];
          return {
            ...curr,
            routes: {
              ...curr.routes,
              [route.id]: { ...curr.routes[route.id], targets: nextTargets },
            },
          };
        },
      });
    }

    if (route.targets.length === 0) {
      const firstUps = Object.keys(ir.upstreams)[0];
      diagnostics.push({
        id: `diag-rt-empty-targets-${route.id}`,
        severity: 'error',
        category: 'broken-reference',
        entityType: 'route',
        entityId: route.id,
        message: `Route "${route.name}" has zero upstream targets`,
        detail: 'Assign at least one upstream pool to serve traffic.',
        autoFixLabel: firstUps ? 'Attach Primary Upstream' : undefined,
        autoFix: firstUps
          ? (curr) => ({
              ...curr,
              routes: {
                ...curr.routes,
                [route.id]: {
                  ...curr.routes[route.id],
                  targets: [{ upstreamId: firstUps, weight: 100, label: 'Primary' }],
                },
              },
            })
          : undefined,
      });
    } else {
      const weightSum = route.targets.reduce((sum, t) => sum + t.weight, 0);
      if (weightSum !== 100) {
        diagnostics.push({
          id: `diag-rt-weight-${route.id}`,
          severity: route.enabled ? 'error' : 'warning',
          category: 'weight-anomaly',
          entityType: 'route',
          entityId: route.id,
          message: `Canary weights on "${route.name}" sum to ${weightSum}% (expected 100%)`,
          detail: 'Traffic split percentages must equal 100% for deterministic proxy compilation.',
          autoFixLabel: 'Normalize Weights to 100%',
          autoFix: (curr) => ({
            ...curr,
            routes: {
              ...curr.routes,
              [route.id]: {
                ...curr.routes[route.id],
                targets: normalizeWeightsTo100(curr.routes[route.id].targets),
              },
            },
          }),
        });
      }
    }

    for (const mw of route.middlewares) {
      if (!ir.plugins[mw.pluginId]) {
        diagnostics.push({
          id: `diag-rt-missing-plugin-${route.id}-${mw.id}`,
          severity: 'error',
          category: 'broken-reference',
          entityType: 'route',
          entityId: route.id,
          message: `Route "${route.name}" binds unregistered plugin "${mw.pluginId}"`,
          detail: 'Middleware chain cannot compile an unknown plugin schema.',
          autoFixLabel: 'Remove Unregistered Plugin',
          autoFix: (curr) => ({
            ...curr,
            routes: {
              ...curr.routes,
              [route.id]: {
                ...curr.routes[route.id],
                middlewares: curr.routes[route.id].middlewares.filter((m) => m.id !== mw.id),
              },
            },
          }),
        });
      }
    }
  }

  // 4. Route conflict detection (exact duplicates & prefix shadowing)
  for (let i = 0; i < routes.length; i++) {
    const a = routes[i];
    if (!a.enabled) continue;
    for (let j = i + 1; j < routes.length; j++) {
      const b = routes[j];
      if (!b.enabled) continue;
      if (a.listenerId !== b.listenerId || a.host !== b.host) continue;

      const methodOverlap =
        a.methods.includes('*') ||
        b.methods.includes('*') ||
        a.methods.some((m) => b.methods.includes(m));
      if (!methodOverlap) continue;

      if (a.pathPrefix === b.pathPrefix && a.matchType === b.matchType) {
        diagnostics.push({
          id: `diag-conflict-dup-${a.id}-${b.id}`,
          severity: 'error',
          category: 'route-conflict',
          entityType: 'route',
          entityId: b.id,
          message: `Route conflict: "${b.name}" duplicates ${a.host}${a.pathPrefix} from "${a.name}"`,
          detail: 'Two enabled routes on the same listener share identical host, path, and method matchers.',
          autoFixLabel: `Disable "${b.name}"`,
          autoFix: (curr) => ({
            ...curr,
            routes: {
              ...curr.routes,
              [b.id]: { ...curr.routes[b.id], enabled: false },
            },
          }),
        });
      } else if (
        a.matchType === 'prefix' &&
        b.matchType === 'prefix' &&
        (b.pathPrefix.startsWith(a.pathPrefix) || a.pathPrefix.startsWith(b.pathPrefix))
      ) {
        const broader = a.pathPrefix.length < b.pathPrefix.length ? a : b;
        const specific = broader.id === a.id ? b : a;
        if (broader.priority >= specific.priority) {
          diagnostics.push({
            id: `diag-conflict-shadow-${broader.id}-${specific.id}`,
            severity: 'warning',
            category: 'route-conflict',
            entityType: 'route',
            entityId: specific.id,
            message: `Prefix shadow: "${broader.name}" (${broader.pathPrefix}, p=${broader.priority}) shadows "${specific.name}" (${specific.pathPrefix}, p=${specific.priority})`,
            detail: 'Broader prefix has equal or higher priority and will intercept traffic before the specific route.',
            autoFixLabel: 'Raise Specific Route Priority',
            autoFix: (curr) => ({
              ...curr,
              routes: {
                ...curr.routes,
                [specific.id]: {
                  ...curr.routes[specific.id],
                  priority: curr.routes[broader.id].priority + 20,
                },
              },
            }),
          });
        }
      }
    }
  }

  // 5. Upstream pool health & policy checks
  for (const upstream of Object.values(ir.upstreams)) {
    const healthyCount = upstream.endpoints.filter((ep) => ep.healthy).length;
    const isChaos503 = Boolean(chaos?.force503Upstreams[upstream.id]);
    if (healthyCount === 0 || isChaos503 || upstream.circuitBreaker.state === 'open') {
      diagnostics.push({
        id: `diag-ups-unhealthy-${upstream.id}`,
        severity: 'error',
        category: 'policy-guard',
        entityType: 'upstream',
        entityId: upstream.id,
        message: `Upstream "${upstream.name}" is ${isChaos503 ? 'failing (Chaos 503 active)' : 'degraded (0 healthy endpoints)'}`,
        detail: 'Circuit breaker will trip and divert traffic to failover pools if configured.',
        autoFixLabel: isChaos503 ? undefined : 'Restore Endpoint Health',
        autoFix: isChaos503
          ? undefined
          : (curr) => ({
              ...curr,
              upstreams: {
                ...curr.upstreams,
                [upstream.id]: {
                  ...curr.upstreams[upstream.id],
                  circuitBreaker: { ...curr.upstreams[upstream.id].circuitBreaker, state: 'closed' },
                  endpoints: curr.upstreams[upstream.id].endpoints.map((ep) => ({ ...ep, healthy: true })),
                },
              },
            }),
      });
    }
  }

  for (const policy of Object.values(ir.policies)) {
    if (policy.failoverUpstreamId && !ir.upstreams[policy.failoverUpstreamId]) {
      diagnostics.push({
        id: `diag-pol-failover-${policy.id}`,
        severity: 'warning',
        category: 'broken-reference',
        entityType: 'policy',
        entityId: policy.id,
        message: `Policy "${policy.name}" references missing failover upstream "${policy.failoverUpstreamId}"`,
        detail: 'Circuit breaker failover cannot reroute to an undefined upstream pool.',
        autoFixLabel: 'Clear Failover Reference',
        autoFix: (curr) => ({
          ...curr,
          policies: {
            ...curr.policies,
            [policy.id]: { ...curr.policies[policy.id], failoverUpstreamId: undefined },
          },
        }),
      });
    }
  }

  return diagnostics;
}
