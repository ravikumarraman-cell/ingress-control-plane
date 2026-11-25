export type ProtocolType = 'HTTP' | 'HTTPS' | 'GRPC';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | '*';

export type EdgeRegion = 'us-east' | 'eu-central' | 'ap-south';

export type LoadBalancerAlgorithm = 'round_robin' | 'least_conn' | 'consistent_hash';

export type CircuitBreakerState = 'closed' | 'half_open' | 'open';

export interface GatewayListener {
  id: string;
  name: string;
  protocol: ProtocolType;
  port: number;
  hostnames: string[];
  tlsCertId?: string;
  tlsMode?: 'terminate' | 'passthrough' | 'mutual';
}

export interface RouteMiddlewareBinding {
  id: string;
  pluginId: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface WeightedTarget {
  upstreamId: string;
  weight: number;
  label?: string;
}

export interface IngressRoute {
  id: string;
  name: string;
  listenerId: string;
  host: string;
  pathPrefix: string;
  matchType: 'prefix' | 'exact' | 'regex';
  methods: HttpMethod[];
  priority: number;
  middlewares: RouteMiddlewareBinding[];
  targets: WeightedTarget[];
  policyId?: string;
  enabled: boolean;
}

export interface UpstreamEndpoint {
  id: string;
  address: string;
  port: number;
  region: EdgeRegion;
  healthy: boolean;
  activeConnections: number;
  baseLatencyMs: number;
}

export interface UpstreamPool {
  id: string;
  name: string;
  lbAlgorithm: LoadBalancerAlgorithm;
  hashHeader?: string;
  endpoints: UpstreamEndpoint[];
  healthCheckPath: string;
  circuitBreaker: {
    maxErrors: number;
    resetTimeoutMs: number;
    state: CircuitBreakerState;
  };
}

export interface TrafficPolicy {
  id: string;
  name: string;
  timeoutMs: number;
  retries: number;
  retryOn: string[];
  failoverUpstreamId?: string;
}

export interface TlsCertificate {
  id: string;
  name: string;
  commonName: string;
  sans: string[];
  issuer: string;
  notBefore: string;
  notAfter: string;
  algorithm: 'ECDSA-P256' | 'RSA-2048' | 'Ed25519';
  managed: boolean;
}

export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  title?: string;
  description?: string;
  default?: unknown;
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
}

export interface PluginJsonSchema {
  type: 'object';
  title?: string;
  description?: string;
  required?: string[];
  properties: Record<string, JsonSchemaProperty>;
}

export interface MiddlewarePlugin {
  id: string;
  name: string;
  category: 'security' | 'traffic' | 'transform' | 'resilience' | 'custom';
  description: string;
  builtIn: boolean;
  schema: PluginJsonSchema;
  defaultConfig: Record<string, unknown>;
}

export interface IngressIR {
  version: string;
  clusterName: string;
  listeners: Record<string, GatewayListener>;
  routes: Record<string, IngressRoute>;
  upstreams: Record<string, UpstreamPool>;
  policies: Record<string, TrafficPolicy>;
  certificates: Record<string, TlsCertificate>;
  plugins: Record<string, MiddlewarePlugin>;
  routeOrder: string[];
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export type DiagnosticCategory =
  | 'route-conflict'
  | 'broken-reference'
  | 'tls-expiry'
  | 'weight-anomaly'
  | 'adapter-capability'
  | 'policy-guard';

export interface Diagnostic {
  id: string;
  severity: DiagnosticSeverity;
  category: DiagnosticCategory;
  entityType: 'listener' | 'route' | 'upstream' | 'certificate' | 'policy' | 'plugin';
  entityId: string;
  message: string;
  detail: string;
  autoFixLabel?: string;
  autoFix?: (ir: IngressIR) => IngressIR;
}

export interface RegionalNodeState {
  region: EdgeRegion;
  label: string;
  status: 'synced' | 'drifted' | 'syncing' | 'degraded';
  activeHash: string;
  syncLatencyMs: number;
  lastSyncedAt: string;
  activeConnections: number;
  rps: number;
}

export interface ConfigSnapshot {
  id: string;
  hash: string;
  label: string;
  timestamp: string;
  ir: IngressIR;
}

export interface ChaosFaultConfig {
  force503Upstreams: Record<string, boolean>;
  latencySpikesMs: Record<string, number>;
  forceExpiredCerts: Record<string, boolean>;
  droppedRegion?: EdgeRegion | null;
}

export interface TelemetryPoint {
  ts: number;
  rps: number;
  p99Ms: number;
  errorRate: number;
}
