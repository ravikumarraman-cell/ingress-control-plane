import crypto from "node:crypto";
import path from "node:path";
import {
  Agent,
  AgentMetrics,
  AgentTrace,
  MemoryManager,
  SessionManager,
  type AgentResult,
  type InvokeLimits,
} from "@strands-agents/sdk";
import { InMemoryStorage, LocalFileStorage, type Storage } from "@strands-agents/sdk/storage";
import { setupMeter, setupTracer } from "@strands-agents/sdk/telemetry";
import { FileMemoryStore } from "@strands-agents/sdk/vended-memory-stores/file-memory-store";
import { z } from "zod";
import { containsEmbeddedSecret, IngressRequestSchema } from "../../src/shared/contracts.ts";
import { validateAgentDag } from "../dagEngine.ts";
import { store, verifyAuditChain } from "../store.ts";
import {
  ReadOnlyIsolationIntervention,
  SecretAndTlsGuardrailIntervention,
} from "./guardrailsAndSteering.ts";
import {
  DeterministicControlPlaneModel,
  getProviderMatrix,
  type ProviderMatrixEntry,
} from "./modelProvider.ts";
import {
  createMcpClientDescriptorSummary,
  getAllReadOnlyStrandsTools,
  listK8sRoutesTool,
} from "./tools.ts";

let telemetryInitialized = false;

export function ensureStrandsTelemetryInitialized(): {
  otlpEnabled: boolean;
  serviceName: string;
} {
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!telemetryInitialized) {
    telemetryInitialized = true;
    try {
      if (otlpEndpoint) {
        setupTracer({ exporters: { otlp: true } });
        setupMeter({ exporters: { otlp: true } });
      } else {
        setupTracer({ exporters: {} });
        setupMeter({ exporters: {} });
      }
    } catch {
      // Telemetry setup is non-fatal in constrained test environments
    }
  }
  return {
    otlpEnabled: Boolean(otlpEndpoint),
    serviceName: process.env.OTEL_SERVICE_NAME || "ingress-control-plane-strands",
  };
}

/**
 * Storage factory: uses in-memory storage during Vitest runs to keep test execution hermetic,
 * and durable `LocalFileStorage` in dev/production under `data/strands/`.
 */
export function createControlPlaneStorage(subDir = "sessions"): Storage {
  if (process.env.VITEST) {
    return new InMemoryStorage();
  }
  return new LocalFileStorage(path.resolve(process.cwd(), "data", "strands", subDir));
}

const sessionStorage = createControlPlaneStorage("sessions");

export function createWorkflowSessionManager(sessionId: string): SessionManager {
  return new SessionManager({
    sessionId,
    storage: sessionStorage,
    saveLatestOn: "invocation",
    multiAgentSaveLatestOn: "node",
  });
}

let sharedMemoryManager: MemoryManager | null = null;

export function getControlPlaneMemoryManager(): MemoryManager {
  if (!sharedMemoryManager) {
    const memoryStorage = createControlPlaneStorage("memory");
    const memoryStore = new FileMemoryStore({
      name: "ingress-control-plane-memory",
      description:
        "Cross-session knowledge store for ingress troubleshooting diagnoses, onboarding blockers, and rollout lessons.",
      storage: memoryStorage,
      extraction: false,
    });
    sharedMemoryManager = new MemoryManager({
      stores: [memoryStore],
      injection: false,
      searchToolConfig: { name: "search_ingress_memory" },
    });
  }
  return sharedMemoryManager;
}

export interface StrandsInvocationTelemetryRecord {
  recordId: string;
  agentName: string;
  workflowId?: string;
  sessionId?: string;
  stopReason: string;
  durationMs: number;
  totalCycles: number;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  toolCallsCount: number;
  traceCount: number;
  recordedAt: string;
}

const telemetryHistory: StrandsInvocationTelemetryRecord[] = [];
const MAX_TELEMETRY_RECORDS = 100;

export function recordStrandsAgentResult(params: {
  agentName: string;
  workflowId?: string;
  sessionId?: string;
  result: Pick<AgentResult, "stopReason" | "metrics" | "traces">;
}): StrandsInvocationTelemetryRecord {
  const metrics: AgentMetrics | undefined = params.result.metrics;
  const traces: AgentTrace[] = params.result.traces ?? [];
  const totalToolCalls = metrics
    ? Object.values(metrics.toolMetrics).reduce((acc, m) => acc + m.callCount, 0)
    : 0;

  const entry: StrandsInvocationTelemetryRecord = {
    recordId: crypto.randomUUID(),
    agentName: params.agentName,
    workflowId: params.workflowId,
    sessionId: params.sessionId,
    stopReason: params.result.stopReason,
    durationMs: metrics?.totalDuration ?? 0,
    totalCycles: metrics?.cycleCount ?? 1,
    tokenUsage: {
      inputTokens: metrics?.accumulatedUsage.inputTokens ?? 0,
      outputTokens: metrics?.accumulatedUsage.outputTokens ?? 0,
      totalTokens: metrics?.accumulatedUsage.totalTokens ?? 0,
    },
    toolCallsCount: totalToolCalls,
    traceCount: traces.length,
    recordedAt: new Date().toISOString(),
  };

  telemetryHistory.unshift(entry);
  if (telemetryHistory.length > MAX_TELEMETRY_RECORDS) {
    telemetryHistory.length = MAX_TELEMETRY_RECORDS;
  }
  return entry;
}

export function getStrandsTelemetrySnapshot(): {
  sdkVersion: string;
  harnessVersion: string;
  telemetryConfig: { otlpEnabled: boolean; serviceName: string };
  providers: ProviderMatrixEntry[];
  mcp: { configured: boolean; serverNames: string[]; sdkClassAvailable: boolean };
  recentInvocations: StrandsInvocationTelemetryRecord[];
  aggregates: {
    totalInvocations: number;
    totalTokens: number;
    totalToolCalls: number;
    avgDurationMs: number;
  };
} {
  const telemetryConfig = ensureStrandsTelemetryInitialized();
  const totalInvocations = telemetryHistory.length;
  const totalTokens = telemetryHistory.reduce((acc, r) => acc + r.tokenUsage.totalTokens, 0);
  const totalToolCalls = telemetryHistory.reduce((acc, r) => acc + r.toolCallsCount, 0);
  const avgDurationMs =
    totalInvocations > 0
      ? Math.round(telemetryHistory.reduce((acc, r) => acc + r.durationMs, 0) / totalInvocations)
      : 0;

  return {
    sdkVersion: "@strands-agents/sdk@^1.26.0",
    harnessVersion: "@strands-agents/harness@^0.5.0",
    telemetryConfig,
    providers: getProviderMatrix(),
    mcp: createMcpClientDescriptorSummary(),
    recentInvocations: telemetryHistory.slice(0, 25),
    aggregates: {
      totalInvocations,
      totalTokens,
      totalToolCalls,
      avgDurationMs,
    },
  };
}

export const DEFAULT_CONTROL_PLANE_LIMITS: InvokeLimits = {
  turns: 6,
  totalTokens: 16_000,
  outputTokens: 4_000,
  structuredOutputAttempts: 3,
};

export const DEFAULT_GRAPH_LIMITS: InvokeLimits = {
  turns: 40,
  totalTokens: 100_000,
  outputTokens: 25_000,
  structuredOutputAttempts: 6,
};

export interface StrandsEvalCaseResult {
  evalId: string;
  name: string;
  passed: boolean;
  detail: string;
  durationMs: number;
}

/**
 * Executes Strands-native Agent/Guardrail/Session/DAG evaluations cleanly using live Strands primitives.
 */
export async function runControlPlaneEvals(): Promise<{
  passedCount: number;
  totalCount: number;
  allPassed: boolean;
  evaluatedAt: string;
  cases: StrandsEvalCaseResult[];
}> {
  const cases: StrandsEvalCaseResult[] = [];
  const evalSessionId = `strands-eval-${crypto.randomUUID().slice(0, 8)}`;

  // Eval 1: Secret guardrail via Strands SecretAndTlsGuardrailIntervention
  {
    const t0 = Date.now();
    const guardrailAgent = new Agent({
      id: "eval-secret-guardrail",
      name: "EvalSecretGuardrailAgent",
      printer: false,
      model: new DeterministicControlPlaneModel(),
      interventions: [new SecretAndTlsGuardrailIntervention()],
      tools: [listK8sRoutesTool],
    });
    const res = await guardrailAgent.invoke("Analyze route with api_key=sk_live_secret_token_1234567890", {
      limits: DEFAULT_CONTROL_PLANE_LIMITS,
    });
    const text = res.lastMessage.content
      .filter((b) => b.type === "textBlock")
      .map((b) => b.text)
      .join(" ");
    const blocked =
      containsEmbeddedSecret("api_key=sk_live_secret_token_1234567890") &&
      text.toLowerCase().includes("guardrail blocked");
    cases.push({
      evalId: "STRANDS-EVAL-01",
      name: "Secret & Credential Intervention Guardrail",
      passed: blocked,
      detail: blocked
        ? `SecretAndTlsGuardrailIntervention blocked credential invocation (${res.stopReason}).`
        : `Expected guardrail cancellation, got: ${text}`,
      durationMs: Date.now() - t0,
    });
  }

  // Eval 2: Read-only isolation enforcement + native Zod structured output + SessionManager snapshot
  {
    const t0 = Date.now();
    const EvalSchema = z.object({
      summary: z.string(),
      data: z.object({ verified: z.boolean() }),
      riskDelta: z.enum(["NONE", "ELEVATE_MEDIUM", "ELEVATE_HIGH"]),
      vetoTriggered: z.boolean(),
      confidence: z.number(),
    });
    const sessionManager = createWorkflowSessionManager(evalSessionId);
    const agent = new Agent({
      id: "eval-structured-readonly",
      name: "EvalReadOnlyAgent",
      printer: false,
      model: new DeterministicControlPlaneModel(),
      tools: getAllReadOnlyStrandsTools(),
      sessionManager,
      interventions: [
        new SecretAndTlsGuardrailIntervention(),
        new ReadOnlyIsolationIntervention({
          agentName: "EvalReadOnlyAgent",
          allowedTools: ["list_k8s_routes"],
        }),
      ],
    });
    const res = await agent.invoke("Verify active routes and return structured output.", {
      structuredOutputSchema: EvalSchema,
      limits: DEFAULT_CONTROL_PLANE_LIMITS,
    });
    const so = res.structuredOutput as z.infer<typeof EvalSchema> | undefined;
    const passed = Boolean(so?.data?.verified && (res.traces?.length ?? 0) > 0);
    cases.push({
      evalId: "STRANDS-EVAL-02",
      name: "Read-Only Tool Execution + Zod StructuredOutput + Session Snapshot",
      passed,
      detail: passed
        ? `Executed read-only Strands tool & structured output across ${res.traces?.length ?? 0} trace spans.`
        : "Structured output or Strands traces missing.",
      durationMs: Date.now() - t0,
    });
  }

  // Eval 3: Topological DAG cycle & forbidden write-tool rejection
  {
    const t0 = Date.now();
    let cycleBlocked = false;
    try {
      validateAgentDag([
        {
          name: "CycleEvalA",
          hookStage: "PHASE_A_PARALLEL",
          dependsOn: ["CycleEvalA"],
          allowedTools: ["list_k8s_routes"],
        },
      ]);
    } catch {
      cycleBlocked = true;
    }
    cases.push({
      evalId: "STRANDS-EVAL-03",
      name: "DAG Cycle Detection & Least-Privilege Verification",
      passed: cycleBlocked,
      detail: cycleBlocked
        ? "Cycle detection rejected self-referential DAG cleanly."
        : "DAG validator failed to reject cycle.",
      durationMs: Date.now() - t0,
    });
  }

  // Eval 4: ETag determinism, external prod TLS 1.3 baseline & SHA-256 Audit Chain
  {
    const t0 = Date.now();
    const etagA = store.getLiveEtag();
    const etagB = store.getLiveEtag();
    const tlsBlocked = !IngressRequestSchema.safeParse({
      requestId: crypto.randomUUID(),
      requesterId: "eval@corp.example.com",
      appName: "eval-app",
      environment: "prod",
      hostname: "eval.corp.example.com",
      pathPrefix: "/api",
      backendService: "eval-svc",
      backendPort: 8443,
      exposure: "external",
      tlsProfile: "tls_1_2_compat",
      rawJustification: "Verify TLS 1.3 strict enforcement on external prod.",
    }).success;
    const audit = verifyAuditChain(store.getState().auditEvents);
    const passed = etagA === etagB && tlsBlocked && audit.valid;
    cases.push({
      evalId: "STRANDS-EVAL-04",
      name: "ETag Determinism + External Prod TLS 1.3 + Audit Chain",
      passed,
      detail: `ETag match=${etagA === etagB}, TLS1.3 enforced=${tlsBlocked}, Audit valid=${audit.valid} (${audit.checkedCount} events).`,
      durationMs: Date.now() - t0,
    });
  }

  return {
    passedCount: cases.filter((c) => c.passed).length,
    totalCount: cases.length,
    allPassed: cases.every((c) => c.passed),
    evaluatedAt: new Date().toISOString(),
    cases,
  };
}
