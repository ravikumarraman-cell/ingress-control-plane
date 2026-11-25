import { toYaml } from '../ir/storage';
import { Diagnostic, IngressIR, IngressRoute } from '../ir/types';
import { ProxyAdapter } from './types';

export const traefikAdapter: ProxyAdapter = {
  id: 'traefik-yaml',
  name: 'Traefik YAML',
  vendor: 'Traefik Proxy v3',
  format: 'yaml',
  fileName: 'traefik-dynamic.yaml',
  description: 'Compiles canonical IR into Traefik dynamic configuration (routers, weighted services, middlewares).',
  capabilities: {
    supportsWeightedCanary: true,
    supportsGrpc: true,
    supportsMtls: true,
    supportsConsistentHash: false,
    supportsCustomPlugins: true,
  },
  compile(ir: IngressIR): string {
    const routers: Record<string, unknown> = {};
    const services: Record<string, unknown> = {};
    const middlewares: Record<string, unknown> = {};

    const activeRoutes = ir.routeOrder
      .map((id) => ir.routes[id])
      .filter((r): r is IngressRoute => Boolean(r) && r.enabled);

    for (const ups of Object.values(ir.upstreams)) {
      services[ups.name] = {
        loadBalancer: {
          healthCheck: { path: ups.healthCheckPath, interval: '10s' },
          servers: ups.endpoints.map((ep) => ({
            url: `http://${ep.address}:${ep.port}`,
          })),
        },
      };
    }

    for (const rt of activeRoutes) {
      const lst = ir.listeners[rt.listenerId];
      const pathRule =
        rt.matchType === 'exact'
          ? `Path(\`${rt.pathPrefix}\`)`
          : rt.matchType === 'regex'
            ? `PathRegexp(\`${rt.pathPrefix}\`)`
            : `PathPrefix(\`${rt.pathPrefix}\`)`;

      const mwRefs: string[] = [];
      for (const mw of rt.middlewares) {
        if (!mw.enabled) continue;
        const mwKey = `${rt.name}-${mw.pluginId}`;
        mwRefs.push(mwKey);
        if (mw.pluginId === 'rate-limit') {
          middlewares[mwKey] = {
            rateLimit: {
              average: mw.config.requestsPerSecond ?? 250,
              burst: mw.config.burstSize ?? 500,
            },
          };
        } else if (mw.pluginId === 'cors') {
          middlewares[mwKey] = {
            headers: {
              accessControlAllowOriginList: String(mw.config.allowedOrigins ?? '*').split(','),
              accessControlMaxAge: mw.config.maxAgeSeconds ?? 3600,
            },
          };
        } else {
          middlewares[mwKey] = {
            plugin: {
              [mw.pluginId]: mw.config,
            },
          };
        }
      }

      let serviceName = ir.upstreams[rt.targets[0]?.upstreamId ?? '']?.name ?? 'default';
      if (rt.targets.length > 1) {
        serviceName = `${rt.name}-weighted`;
        services[serviceName] = {
          weighted: {
            services: rt.targets.map((t) => ({
              name: ir.upstreams[t.upstreamId]?.name ?? t.upstreamId,
              weight: t.weight,
            })),
          },
        };
      }

      routers[rt.name] = {
        entryPoints: [lst?.name ?? 'websecure'],
        rule: `Host(\`${rt.host}\`) && ${pathRule}`,
        priority: rt.priority,
        service: serviceName,
        ...(mwRefs.length > 0 ? { middlewares: mwRefs } : {}),
        ...(lst?.tlsCertId ? { tls: {} } : {}),
      };
    }

    const certificates = Object.values(ir.certificates).map((c) => ({
      certFile: `/certs/${c.name}.crt`,
      keyFile: `/certs/${c.name}.key`,
    }));

    return toYaml({
      http: {
        routers,
        services,
        middlewares,
      },
      tls: {
        certificates,
      },
    });
  },
  validate(ir: IngressIR): Diagnostic[] {
    const diags: Diagnostic[] = [];
    for (const ups of Object.values(ir.upstreams)) {
      if (ups.lbAlgorithm === 'consistent_hash') {
        diags.push({
          id: `diag-traefik-hash-${ups.id}`,
          severity: 'warning',
          category: 'adapter-capability',
          entityType: 'upstream',
          entityId: ups.id,
          message: `Traefik adapter falls back from consistent_hash to cookie sticky sessions on "${ups.name}"`,
          detail: 'Traefik dynamic YAML does not support header ring-hash natively without sticky cookies.',
        });
      }
    }
    return diags;
  },
};
