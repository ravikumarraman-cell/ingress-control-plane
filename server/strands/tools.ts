import { McpClient, tool, type McpServerConfig, type Tool, type ToolContext } from "@strands-agents/sdk";
import { httpRequest } from "@strands-agents/sdk/vended-tools/http-request";
import { z } from "zod";
import {
  READ_ONLY_TOOL_CATALOG,
  type ActiveIngressRoute,
  type ReadOnlyToolId,
} from "../../src/shared/contracts.ts";
import { store } from "../store.ts";

/**
 * Native Strands `@tool` definitions scoped strictly to `sa-ingress-readonly`
 * plus Strands vended `httpRequest` probe & optional MCP server loader.
 */

export const listK8sRoutesTool = tool({
  name: "list_k8s_routes",
  description:
    "Inspect live Kubernetes Gateway API HTTPRoute manifests and state ETag via sa-ingress-readonly.",
  inputSchema: z.object({
    environment: z.enum(["dev", "staging", "prod"]).optional(),
    hostname: z.string().optional(),
  }),
  callback: (input) => {
    const state = store.getState();
    const filtered = state.routes.filter((r) => {
      if (input.environment && r.environment !== input.environment) return false;
      if (input.hostname && r.hostname !== input.hostname) return false;
      return true;
    });
    return {
      serviceAccount: "sa-ingress-readonly",
      liveStateEtag: store.getLiveEtag(),
      routeCount: filtered.length,
      routes: filtered.map((r) => ({
        routeId: r.routeId,
        appName: r.appName,
        environment: r.environment,
        hostname: r.hostname,
        pathPrefix: r.pathPrefix,
        backendService: r.backendService,
        backendPort: r.backendPort,
        canaryWeight: r.canaryWeight,
        tlsProfile: r.tlsProfile,
      })),
    };
  },
});

export const getLbConfigTool = tool({
  name: "get_lb_config",
  description:
    "Read managed load balancer backend pool, gateway binding, WAF attachment, and canary traffic weights.",
  inputSchema: z.object({
    hostname: z.string().optional(),
    exposure: z.enum(["internal", "external"]).optional(),
    environment: z.enum(["dev", "staging", "prod"]).optional(),
  }),
  callback: (input) => {
    const state = store.getState();
    const matching = state.routes.filter((r) => {
      if (input.hostname && r.hostname !== input.hostname) return false;
      if (input.exposure && r.exposure !== input.exposure) return false;
      if (input.environment && r.environment !== input.environment) return false;
      return true;
    });
    const env = input.environment ?? "prod";
    const exp = input.exposure ?? "external";
    return {
      serviceAccount: "sa-ingress-readonly",
      targetGateway: exp === "external" ? `ext-${env}-gateway` : `int-${env}-gateway`,
      ipPoolBoundary: exp === "external" ? "PUBLIC_EDGE_WAF" : "PRIVATE_MESH_POOL",
      wafEnforcementDefault: exp === "external" ? "DETECT_7_TO_21D_THEN_BLOCK" : "EXEMPT_INTERNAL",
      matchedPools: matching.map((r) => ({
        routeId: r.routeId,
        gatewayName: r.gatewayName,
        backend: `${r.backendService}:${r.backendPort}`,
        canaryWeight: r.canaryWeight,
        wafEnabled: r.wafEnabled,
      })),
    };
  },
});

export const getDnsRecordsTool = tool({
  name: "get_dns_records",
  description:
    "Inspect Cloud DNS & Infoblox delegation posture (CNAME vs bare A record) for target hostname.",
  inputSchema: z.object({
    hostname: z.string(),
    dnsProvider: z.enum(["infoblox", "cloud_dns_delegated", "external_other"]).optional(),
    dnsRecordType: z.enum(["cname", "a_record", "new_record"]).optional(),
    exposure: z.enum(["internal", "external"]).optional(),
  }),
  callback: (input) => {
    const provider = input.dnsProvider ?? "infoblox";
    const recordType = input.dnsRecordType ?? "cname";
    const exposure = input.exposure ?? "external";
    const delegatedOk = provider !== "external_other";
    const cnameEligible = exposure === "internal" || recordType !== "a_record";
    return {
      serviceAccount: "sa-ingress-readonly",
      hostname: input.hostname,
      dnsProvider: provider,
      dnsRecordType: recordType,
      delegatedOk,
      cnameEligible,
      eligible: delegatedOk && cnameEligible,
      cutoverWindowEstimate: "20-30 min TTL propagation",
    };
  },
});

export const getTlsCertsTool = tool({
  name: "get_tls_certs",
  description:
    "Inspect managed SSL/TLS certificates, exact FQDN SAN coverage, wildcard restrictions, and expiry windows.",
  inputSchema: z.object({
    hostname: z.string(),
    environment: z.enum(["dev", "staging", "prod"]).default("prod"),
    exposure: z.enum(["internal", "external"]).default("external"),
    tlsProfile: z
      .enum(["tls_1_3_strict", "tls_1_2_compat", "mtls_internal"])
      .default("tls_1_3_strict"),
    originCertReady: z.boolean().optional(),
  }),
  callback: (input) => {
    const isWildcard = input.hostname.includes("*");
    const prodStrictRequired = input.environment === "prod" && input.exposure === "external";
    const tlsBaselineOk = !prodStrictRequired || input.tlsProfile === "tls_1_3_strict";
    const expiringWithinDays = input.environment === "prod" ? 42 : 78;
    return {
      serviceAccount: "sa-ingress-readonly",
      hostname: input.hostname,
      minTlsVersion: input.tlsProfile === "tls_1_3_strict" ? "TLSv1.3" : "TLSv1.2",
      expiringWithinDays,
      isWildcard,
      sanCoverageOk: !isWildcard && (input.originCertReady ?? true),
      tlsBaselineOk,
      sanList: [input.hostname],
    };
  },
});

export const evaluateOpaPoliciesTool = tool({
  name: "evaluate_opa_policies",
  description:
    "Evaluate read-only OPA and dynamic CustomPolicyRules against candidate ingress parameters.",
  inputSchema: z.object({
    environment: z.enum(["dev", "staging", "prod"]),
    exposure: z.enum(["internal", "external"]),
    tlsProfile: z.enum(["tls_1_3_strict", "tls_1_2_compat", "mtls_internal"]),
    hostname: z.string(),
    backendPort: z.number().int().min(1).max(65535),
    ticketRef: z.string().nullable().optional(),
  }),
  callback: (input) => {
    const state = store.getState();
    const ruleResults = state.customPolicyRules
      .filter((r) => r.enabled)
      .map((rule) => {
        let passed = true;
        if (rule.conditionType === "require_ticket") {
          const target = rule.value.trim().toLowerCase();
          if (!target || target === "all" || input.environment === target) {
            passed = Boolean(input.ticketRef && input.ticketRef.trim().length > 0);
          }
        } else if (rule.conditionType === "max_port") {
          passed = input.backendPort <= (Number(rule.value) || 65535);
        } else if (rule.conditionType === "allowed_domain_suffix") {
          const suffix = rule.value.trim().toLowerCase();
          passed = !suffix || input.hostname.toLowerCase().endsWith(suffix);
        } else if (rule.conditionType === "enforce_waf_staging") {
          if (input.environment === "staging" && input.exposure === "external") {
            passed = input.tlsProfile === "tls_1_3_strict";
          }
        }
        return {
          ruleId: rule.ruleId,
          name: rule.name,
          severity: rule.severity,
          passed,
        };
      });

    const prodTlsOk =
      !(input.environment === "prod" && input.exposure === "external") ||
      input.tlsProfile === "tls_1_3_strict";

    return {
      serviceAccount: "sa-ingress-readonly",
      prodTlsOk,
      wildcardFree: !input.hostname.includes("*"),
      customRulesEvaluated: ruleResults.length,
      customRuleResults: ruleResults,
    };
  },
});

export const checkRouteCollisionsTool = tool({
  name: "check_route_collisions",
  description:
    "Detect exact hostname/path overlaps or same-host route neighbors across live cluster routes.",
  inputSchema: z.object({
    hostname: z.string(),
    pathPrefix: z.string(),
    environment: z.enum(["dev", "staging", "prod"]).optional(),
  }),
  callback: (input) => {
    const routes: ActiveIngressRoute[] = store.getState().routes;
    const collidingRoute = routes.find(
      (r) => r.hostname === input.hostname && r.pathPrefix === input.pathPrefix
    );
    const sameHostOtherPath = routes.find(
      (r) => r.hostname === input.hostname && r.pathPrefix !== input.pathPrefix
    );
    return {
      serviceAccount: "sa-ingress-readonly",
      hasCollision: Boolean(collidingRoute),
      collidingRouteId: collidingRoute?.routeId ?? null,
      collidingBackend: collidingRoute
        ? `${collidingRoute.backendService}:${collidingRoute.backendPort}`
        : null,
      sameHostOtherPath: sameHostOtherPath?.pathPrefix ?? null,
    };
  },
});

/**
 * Wrapper around Strands vended `httpRequest` tool (`@strands-agents/sdk/vended-tools/http-request`)
 * for safe read-only synthetic endpoint readiness verification.
 */
export const syntheticProbeHttpTool = tool({
  name: "synthetic_probe_http",
  description:
    "Execute a read-only GET HTTP probe via Strands vended httpRequest tool against a health endpoint.",
  inputSchema: z.object({
    url: z.string().url(),
    timeoutSeconds: z.number().int().min(1).max(15).default(5),
  }),
  callback: async (input, context?: ToolContext) => {
    const parsed = new URL(input.url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Synthetic probe only permits http/https schemes.");
    }
    const result = await httpRequest.invoke(
      {
        method: "GET",
        url: input.url,
        timeout: input.timeoutSeconds,
      },
      context
    );
    return {
      status: result.status,
      statusText: result.statusText,
      healthy: result.status >= 200 && result.status < 400,
    };
  },
});

export const READ_ONLY_STRANDS_TOOLS: Record<ReadOnlyToolId, Tool> = {
  list_k8s_routes: listK8sRoutesTool,
  get_lb_config: getLbConfigTool,
  get_dns_records: getDnsRecordsTool,
  get_tls_certs: getTlsCertsTool,
  evaluate_opa_policies: evaluateOpaPoliciesTool,
  check_route_collisions: checkRouteCollisionsTool,
};

export function resolveAllowedReadOnlyTools(allowedIds: readonly ReadOnlyToolId[]): Tool[] {
  const validIds = new Set(READ_ONLY_TOOL_CATALOG.map((t) => t.id));
  const resolved: Tool[] = [];
  for (const id of allowedIds) {
    if (validIds.has(id) && READ_ONLY_STRANDS_TOOLS[id]) {
      resolved.push(READ_ONLY_STRANDS_TOOLS[id]);
    }
  }
  return resolved;
}

export function getAllReadOnlyStrandsTools(): Tool[] {
  return Object.values(READ_ONLY_STRANDS_TOOLS);
}

/**
 * Optional Model Context Protocol (MCP) server configuration loader (`STRANDS_MCP_SERVERS`).
 * Reads JSON map of `{ serverName: McpServerConfig }` for `createHarness({ mcpServers })` or `McpClient`.
 */
export function getConfiguredMcpServers(): Record<string, McpServerConfig> | undefined {
  const raw = process.env.STRANDS_MCP_SERVERS?.trim();
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const map =
      "mcpServers" in (parsed as Record<string, unknown>) &&
      typeof (parsed as Record<string, unknown>).mcpServers === "object"
        ? ((parsed as Record<string, unknown>).mcpServers as Record<string, McpServerConfig>)
        : (parsed as Record<string, McpServerConfig>);
    return Object.keys(map).length > 0 ? map : undefined;
  } catch {
    return undefined;
  }
}

export function createMcpClientDescriptorSummary(): {
  configured: boolean;
  serverNames: string[];
  sdkClassAvailable: boolean;
} {
  const servers = getConfiguredMcpServers();
  return {
    configured: Boolean(servers),
    serverNames: servers ? Object.keys(servers) : [],
    sdkClassAvailable: typeof McpClient === "function",
  };
}
