import { Diagnostic, IngressIR, IngressRoute, LoadBalancerAlgorithm } from '../ir/types';
import { ProxyAdapter } from './types';

function mapEnvoyLbPolicy(algo: LoadBalancerAlgorithm): string {
  switch (algo) {
    case 'least_conn':
      return 'LEAST_REQUEST';
    case 'consistent_hash':
      return 'RING_HASH';
    case 'round_robin':
    default:
      return 'ROUND_ROBIN';
  }
}

export const envoyAdapter: ProxyAdapter = {
  id: 'envoy-xds',
  name: 'Envoy xDS',
  vendor: 'CNCF Envoy Proxy v1.31',
  format: 'json',
  fileName: 'envoy-xds-snapshot.json',
  description: 'Compiles canonical IR into Envoy static_resources / xDS RouteConfiguration JSON.',
  capabilities: {
    supportsWeightedCanary: true,
    supportsGrpc: true,
    supportsMtls: true,
    supportsConsistentHash: true,
    supportsCustomPlugins: true,
  },
  compile(ir: IngressIR): string {
    const routesList = ir.routeOrder
      .map((id) => ir.routes[id])
      .filter((r): r is IngressRoute => Boolean(r) && r.enabled);

    const listeners = Object.values(ir.listeners).map((lst) => {
      const lstRoutes = routesList
        .filter((r) => r.listenerId === lst.id)
        .sort((a, b) => b.priority - a.priority);

      const hostsMap = new Map<string, IngressRoute[]>();
      for (const rt of lstRoutes) {
        const list = hostsMap.get(rt.host) ?? [];
        list.push(rt);
        hostsMap.set(rt.host, list);
      }

      const virtualHosts = Array.from(hostsMap.entries()).map(([host, hostRoutes]) => ({
        name: `${lst.name}_${host.replace(/[^a-zA-Z0-9]/g, '_')}`,
        domains: [host],
        routes: hostRoutes.map((rt) => {
          const policy = rt.policyId ? ir.policies[rt.policyId] : undefined;
          const matchObj: Record<string, unknown> =
            rt.matchType === 'exact'
              ? { path: rt.pathPrefix }
              : rt.matchType === 'regex'
                ? { safe_regex: { google_re2: {}, regex: rt.pathPrefix } }
                : { prefix: rt.pathPrefix };

          if (!rt.methods.includes('*')) {
            matchObj.headers = [
              {
                name: ':method',
                string_match: { safe_regex: { regex: `^(${rt.methods.join('|')})$` } },
              },
            ];
          }

          const typedPerFilterConfig: Record<string, unknown> = {};
          for (const mw of rt.middlewares) {
            if (!mw.enabled) continue;
            const plugin = ir.plugins[mw.pluginId];
            typedPerFilterConfig[`ingressos.middleware.${mw.pluginId}`] = {
              '@type': 'type.googleapis.com/ingressos.ext.v1.PluginConfig',
              plugin_name: plugin?.name ?? mw.pluginId,
              custom: plugin ? !plugin.builtIn : false,
              settings: mw.config,
            };
          }

          return {
            name: rt.name,
            match: matchObj,
            route: {
              timeout: policy ? `${(policy.timeoutMs / 1000).toFixed(2)}s` : '5.00s',
              retry_policy:
                policy && policy.retries > 0
                  ? {
                      retry_on: policy.retryOn.join(',') || '5xx',
                      num_retries: policy.retries,
                    }
                  : undefined,
              weighted_clusters: {
                clusters: rt.targets.map((t) => ({
                  name: ir.upstreams[t.upstreamId]?.name ?? t.upstreamId,
                  weight: t.weight,
                })),
              },
            },
            ...(Object.keys(typedPerFilterConfig).length > 0
              ? { typed_per_filter_config: typedPerFilterConfig }
              : {}),
          };
        }),
      }));

      const cert = lst.tlsCertId ? ir.certificates[lst.tlsCertId] : undefined;

      return {
        name: lst.name,
        address: {
          socket_address: {
            address: '0.0.0.0',
            port_value: lst.port,
          },
        },
        filter_chains: [
          {
            ...(cert
              ? {
                  transport_socket: {
                    name: 'envoy.transport_sockets.tls',
                    typed_config: {
                      '@type': 'type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext',
                      require_client_certificate: lst.tlsMode === 'mutual',
                      common_tls_context: {
                        tls_certificates: [
                          {
                            certificate_chain: { filename: `/etc/ingressos/certs/${cert.name}.crt` },
                            private_key: { filename: `/etc/ingressos/certs/${cert.name}.key` },
                          },
                        ],
                      },
                    },
                  },
                }
              : {}),
            filters: [
              {
                name: 'envoy.filters.network.http_connection_manager',
                typed_config: {
                  '@type': 'type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager',
                  stat_prefix: lst.name,
                  codec_type: lst.protocol === 'GRPC' ? 'HTTP2' : 'AUTO',
                  route_config: {
                    name: `${lst.name}_routes`,
                    virtual_hosts: virtualHosts,
                  },
                  http_filters: [{ name: 'envoy.filters.http.router' }],
                },
              },
            ],
          },
        ],
      };
    });

    const clusters = Object.values(ir.upstreams).map((ups) => ({
      name: ups.name,
      connect_timeout: '1.5s',
      type: 'STRICT_DNS',
      lb_policy: mapEnvoyLbPolicy(ups.lbAlgorithm),
      ...(ups.lbAlgorithm === 'consistent_hash' && ups.hashHeader
        ? {
            ring_hash_lb_config: { minimum_ring_size: 1024 },
          }
        : {}),
      outlier_detection: {
        consecutive_5xx: ups.circuitBreaker.maxErrors,
        base_ejection_time: `${Math.round(ups.circuitBreaker.resetTimeoutMs / 1000)}s`,
      },
      load_assignment: {
        cluster_name: ups.name,
        endpoints: [
          {
            lb_endpoints: ups.endpoints.map((ep) => ({
              health_status: ep.healthy ? 'HEALTHY' : 'UNHEALTHY',
              endpoint: {
                address: {
                  socket_address: {
                    address: ep.address,
                    port_value: ep.port,
                  },
                },
              },
            })),
          },
        ],
      },
    }));

    return JSON.stringify(
      {
        node: { id: ir.clusterName, cluster: ir.clusterName },
        static_resources: {
          listeners,
          clusters,
        },
      },
      null,
      2
    );
  },
  validate(): Diagnostic[] {
    return [];
  },
};
