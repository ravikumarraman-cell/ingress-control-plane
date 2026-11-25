import { toYaml } from '../ir/storage';
import { Diagnostic, IngressIR, IngressRoute } from '../ir/types';
import { ProxyAdapter } from './types';

export const k8sGatewayAdapter: ProxyAdapter = {
  id: 'k8s-gateway',
  name: 'K8s Gateway API',
  vendor: 'Kubernetes SIG-Network v1.1',
  format: 'yaml',
  fileName: 'gateway-api-manifests.yaml',
  description: 'Compiles canonical IR into standard Gateway, HTTPRoute, and ExtensionRef YAML manifests.',
  capabilities: {
    supportsWeightedCanary: true,
    supportsGrpc: true,
    supportsMtls: true,
    supportsConsistentHash: false,
    supportsCustomPlugins: true,
  },
  compile(ir: IngressIR): string {
    const docs: string[] = [];

    const gatewayManifest = {
      apiVersion: 'gateway.networking.k8s.io/v1',
      kind: 'Gateway',
      metadata: {
        name: ir.clusterName,
        namespace: 'ingressos-system',
      },
      spec: {
        gatewayClassName: 'ingressos-envoy-gateway',
        listeners: Object.values(ir.listeners).map((lst) => ({
          name: lst.name,
          protocol: lst.protocol === 'GRPC' ? 'HTTPS' : lst.protocol,
          port: lst.port,
          hostname: lst.hostnames[0] ?? '*',
          ...(lst.tlsCertId
            ? {
                tls: {
                  mode: lst.tlsMode === 'passthrough' ? 'Passthrough' : 'Terminate',
                  certificateRefs: [
                    {
                      kind: 'Secret',
                      name: ir.certificates[lst.tlsCertId]?.name ?? lst.tlsCertId,
                    },
                  ],
                },
              }
            : {}),
        })),
      },
    };
    docs.push(toYaml(gatewayManifest));

    const activeRoutes = ir.routeOrder
      .map((id) => ir.routes[id])
      .filter((r): r is IngressRoute => Boolean(r) && r.enabled);

    for (const rt of activeRoutes) {
      const lst = ir.listeners[rt.listenerId];
      const isGrpc = lst?.protocol === 'GRPC';
      const policy = rt.policyId ? ir.policies[rt.policyId] : undefined;

      const routeManifest = {
        apiVersion: 'gateway.networking.k8s.io/v1',
        kind: isGrpc ? 'GRPCRoute' : 'HTTPRoute',
        metadata: {
          name: rt.name,
          namespace: 'ingressos-system',
        },
        spec: {
          parentRefs: [
            {
              name: ir.clusterName,
              sectionName: lst?.name ?? 'default',
            },
          ],
          hostnames: [rt.host],
          rules: [
            {
              matches: [
                isGrpc
                  ? {
                      method: {
                        service: rt.pathPrefix.replace(/^\//, ''),
                      },
                    }
                  : {
                      path: {
                        type:
                          rt.matchType === 'exact'
                            ? 'Exact'
                            : rt.matchType === 'regex'
                              ? 'RegularExpression'
                              : 'PathPrefix',
                        value: rt.pathPrefix,
                      },
                    },
              ],
              filters: rt.middlewares
                .filter((m) => m.enabled)
                .map((m) => ({
                  type: 'ExtensionRef',
                  extensionRef: {
                    group: 'policy.ingressos.io',
                    kind: 'MiddlewarePlugin',
                    name: `${rt.name}-${m.pluginId}`,
                  },
                })),
              ...(policy
                ? {
                    timeouts: {
                      request: `${policy.timeoutMs}ms`,
                    },
                  }
                : {}),
              backendRefs: rt.targets.map((t) => {
                const ups = ir.upstreams[t.upstreamId];
                return {
                  name: ups?.name ?? t.upstreamId,
                  port: ups?.endpoints[0]?.port ?? 8080,
                  weight: t.weight,
                };
              }),
            },
          ],
        },
      };
      docs.push(toYaml(routeManifest));
    }

    return docs.join('\n---\n');
  },
  validate(): Diagnostic[] {
    return [];
  },
};
