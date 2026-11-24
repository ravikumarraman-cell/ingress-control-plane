import crypto from "node:crypto";
import {
  BedrockModel,
  FallbackStrategy,
  Message,
  Model,
  ModelRouter,
  RoutingCandidate,
  type BaseModelConfig,
  type ModelStreamEvent,
  type StreamOptions,
} from "@strands-agents/sdk";
import { GoogleModel } from "@strands-agents/sdk/models/google";
import { AnthropicModel } from "@strands-agents/sdk/models/anthropic";
import { detectConstrainedUseCasesFromText } from "../adoptionAgents.ts";
import { synthesizeDeterministicAgentOutput } from "../dagRunner.ts";
import type { DynamicAgentBlueprint, IngressRequest } from "../../src/shared/contracts.ts";

export type StrandsProviderKind = "google" | "bedrock" | "anthropic" | "openai" | "deterministic";

export interface ProviderMatrixEntry {
  provider: StrandsProviderKind;
  configured: boolean;
  defaultModelId: string;
  envVar: string;
  sdkClass: string;
}

export interface DeterministicModelConfig extends BaseModelConfig {
  mode?: "auto" | "blueprint" | "onboarding" | "troubleshoot" | "custom_eval";
  blueprint?: DynamicAgentBlueprint;
  request?: IngressRequest;
  resolvedPrompt?: string;
  consumedInputs?: Record<string, unknown>;
  fallbackText?: string;
  structuredFactory?: (params: {
    messages: Message[];
    toolResults: Record<string, unknown>[];
  }) => unknown;
}

function hasValidGeminiKey(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key !== "MY_GEMINI_API_KEY" && key.trim().length > 0);
}

function hasBedrockConfig(): boolean {
  return Boolean(
    process.env.AWS_BEARER_TOKEN_BEDROCK ||
      (process.env.AWS_REGION &&
        (process.env.AWS_ACCESS_KEY_ID || process.env.STRANDS_ENABLE_BEDROCK === "true"))
  );
}

function hasAnthropicKey(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return Boolean(key && key.trim().length > 0);
}

function hasOpenAiKey(): boolean {
  const key = process.env.OPENAI_API_KEY;
  return Boolean(key && key.trim().length > 0);
}

export function hasLiveLlmConfigured(): boolean {
  return hasValidGeminiKey() || hasBedrockConfig() || hasAnthropicKey() || hasOpenAiKey();
}

export function getProviderMatrix(): ProviderMatrixEntry[] {
  return [
    {
      provider: "google",
      configured: hasValidGeminiKey(),
      defaultModelId: process.env.STRANDS_GOOGLE_MODEL_ID || "gemini-4-hydrogen",
      envVar: "GEMINI_API_KEY",
      sdkClass: "GoogleModel (@strands-agents/sdk/models/google)",
    },
    {
      provider: "bedrock",
      configured: hasBedrockConfig(),
      defaultModelId:
        process.env.STRANDS_BEDROCK_MODEL_ID || "global.anthropic.claude-sonnet-4-6",
      envVar: "AWS_REGION / AWS_BEARER_TOKEN_BEDROCK",
      sdkClass: "BedrockModel (@strands-agents/sdk)",
    },
    {
      provider: "anthropic",
      configured: hasAnthropicKey(),
      defaultModelId: process.env.STRANDS_ANTHROPIC_MODEL_ID || "claude-sonnet-4-6",
      envVar: "ANTHROPIC_API_KEY",
      sdkClass: "AnthropicModel (@strands-agents/sdk/models/anthropic)",
    },
    {
      provider: "openai",
      configured: hasOpenAiKey(),
      defaultModelId: process.env.STRANDS_OPENAI_MODEL_ID || "gpt-5.4",
      envVar: "OPENAI_API_KEY",
      sdkClass: "OpenAIModel (@strands-agents/sdk/models/openai)",
    },
    {
      provider: "deterministic",
      configured: true,
      defaultModelId: "strands-deterministic-control-plane-v1",
      envVar: "Built-in offline fallback",
      sdkClass: "DeterministicControlPlaneModel (extends Strands Model)",
    },
  ];
}

function extractConversationSignals(messages: Message[]): {
  allText: string;
  hasToolResultsSinceLastUserText: boolean;
  toolResults: Record<string, unknown>[];
} {
  const texts: string[] = [];
  const toolResults: Record<string, unknown>[] = [];
  let lastUserTextIdx = -1;
  let lastToolResultIdx = -1;

  messages.forEach((msg, idx) => {
    for (const block of msg.content) {
      if (block.type === "textBlock") {
        texts.push(block.text);
        if (msg.role === "user") lastUserTextIdx = idx;
      } else if (block.type === "toolResultBlock") {
        lastToolResultIdx = idx;
        for (const c of block.content) {
          if (c.type === "jsonBlock") {
            toolResults.push(c.json as Record<string, unknown>);
          } else if (c.type === "textBlock") {
            try {
              toolResults.push(JSON.parse(c.text) as Record<string, unknown>);
            } catch {
              toolResults.push({ text: c.text });
            }
          }
        }
      }
    }
  });

  return {
    allText: texts.join("\n"),
    hasToolResultsSinceLastUserText: lastToolResultIdx > lastUserTextIdx,
    toolResults,
  };
}

function buildToolCallInputForSpec(
  toolName: string,
  req?: IngressRequest
): Record<string, unknown> {
  const env = req?.environment ?? "prod";
  const exposure = req?.exposure ?? "external";
  const hostname = req?.hostname ?? "api.corp.example.com";
  const pathPrefix = req?.pathPrefix ?? "/v1";
  const tlsProfile = req?.tlsProfile ?? "tls_1_3_strict";
  const backendPort = req?.backendPort ?? 8443;

  switch (toolName) {
    case "list_k8s_routes":
      return { environment: env, hostname };
    case "get_lb_config":
      return { environment: env, exposure, hostname };
    case "get_dns_records":
      return {
        hostname,
        dnsProvider: req?.dnsProvider ?? "infoblox",
        dnsRecordType: req?.dnsRecordType ?? "cname",
        exposure,
      };
    case "get_tls_certs":
      return {
        hostname,
        environment: env,
        exposure,
        tlsProfile,
        originCertReady: req?.originCertReady ?? true,
      };
    case "evaluate_opa_policies":
      return {
        environment: env,
        exposure,
        tlsProfile,
        hostname,
        backendPort,
        ticketRef: req?.ticketRef ?? null,
      };
    case "check_route_collisions":
      return { hostname, pathPrefix, environment: env };
    default:
      return {};
  }
}

/**
 * Deterministic Strands `Model` implementation allowing full Strands `Agent`,
 * `createHarness()`, `Graph`, `InterventionHandler`, `Tool`, and `StructuredOutput` loops
 * to execute safely with zero network calls when live provider API keys are absent or fail over.
 */
export class DeterministicControlPlaneModel extends Model<DeterministicModelConfig> {
  private config: DeterministicModelConfig;

  constructor(config: DeterministicModelConfig = {}) {
    super();
    this.config = {
      modelId: config.modelId ?? "strands-deterministic-control-plane-v1",
      ...config,
    };
  }

  override updateConfig(modelConfig: DeterministicModelConfig): void {
    this.config = { ...this.config, ...modelConfig };
  }

  override getConfig(): DeterministicModelConfig {
    return { ...this.config };
  }

  override async *stream(
    messages: Message[],
    options?: StreamOptions
  ): AsyncIterable<ModelStreamEvent> {
    const startMs = Date.now();
    const { allText, hasToolResultsSinceLastUserText, toolResults } =
      extractConversationSignals(messages);

    const toolSpecs = options?.toolSpecs ?? [];
    const structuredTool = toolSpecs.find((t) => t.name === "strands_structured_output");
    const nonInternalTools = toolSpecs.filter((t) => t.name !== "strands_structured_output");
    const forcedStructured =
      typeof options?.toolChoice === "object" &&
      options.toolChoice !== null &&
      "tool" in options.toolChoice &&
      options.toolChoice.tool?.name === "strands_structured_output";

    yield { type: "modelMessageStartEvent", role: "assistant" };

    // Step 1: Exercise real Strands tool call loop once for read-only ingress tools when available
    if (!forcedStructured && !hasToolResultsSinceLastUserText && nonInternalTools.length > 0) {
      const preferredTool = nonInternalTools[0]!;
      const toolUseId = `call_${crypto.randomUUID().slice(0, 12)}`;
      const toolInput = buildToolCallInputForSpec(preferredTool.name, this.config.request);
      yield {
        type: "modelContentBlockStartEvent",
        start: {
          type: "toolUseStart",
          name: preferredTool.name,
          toolUseId,
        },
      };
      yield {
        type: "modelContentBlockDeltaEvent",
        delta: {
          type: "toolUseInputDelta",
          input: JSON.stringify(toolInput),
        },
      };
      yield { type: "modelContentBlockStopEvent" };
      yield { type: "modelMessageStopEvent", stopReason: "toolUse" };
      yield {
        type: "modelMetadataEvent",
        usage: { inputTokens: 48, outputTokens: 24, totalTokens: 72 },
        metrics: { latencyMs: Math.max(1, Date.now() - startMs) },
      };
      return;
    }

    // Step 2: Emit structured output tool call when structuredOutputSchema is requested
    if (structuredTool || options?.structuredOutputSchema) {
      let payload: unknown;
      if (this.config.structuredFactory) {
        payload = this.config.structuredFactory({ messages, toolResults });
      } else if (this.config.blueprint && this.config.request) {
        payload = synthesizeDeterministicAgentOutput({
          blueprint: this.config.blueprint,
          resolvedPrompt: this.config.resolvedPrompt ?? this.config.blueprint.taskTemplate,
          consumedInputs: this.config.consumedInputs ?? {},
          request: this.config.request,
        });
      } else if (this.config.mode === "troubleshoot") {
        payload = {
          category: detectConstrainedUseCasesFromText(allText).length > 0 ? "UNSUPPORTED" : "POLICY",
          rootCause: "Evaluated ingress telemetry signals deterministically via Strands control-plane loop.",
          plainEnglishExplanation:
            "Review policy controls and prerequisite checks before promoting traffic.",
          nextActions: [
            "Verify Infoblox CNAME delegation and origin /healthz HTTP 200 readiness.",
            "Confirm tls_1_3_strict and scoped Cloudflare CIDR allowlist.",
          ],
        };
      } else {
        payload = {
          summary: "Deterministic Strands agent step completed cleanly.",
          data: { verified: true, toolEvidenceCount: toolResults.length },
          riskDelta: "NONE",
          vetoTriggered: false,
          confidence: 0.95,
        };
      }

      const toolUseId = `so_${crypto.randomUUID().slice(0, 12)}`;
      const jsonInput = JSON.stringify(payload);
      yield {
        type: "modelContentBlockStartEvent",
        start: {
          type: "toolUseStart",
          name: "strands_structured_output",
          toolUseId,
        },
      };
      yield {
        type: "modelContentBlockDeltaEvent",
        delta: {
          type: "toolUseInputDelta",
          input: jsonInput,
        },
      };
      yield { type: "modelContentBlockStopEvent" };
      yield { type: "modelMessageStopEvent", stopReason: "toolUse" };
      yield {
        type: "modelMetadataEvent",
        usage: { inputTokens: 92, outputTokens: 64, totalTokens: 156 },
        metrics: { latencyMs: Math.max(1, Date.now() - startMs) },
      };
      return;
    }

    // Step 3: Plain text completion
    const responseText =
      this.config.fallbackText ??
      `Strands Control Plane deterministic analysis complete (${toolResults.length} read-only tool observation(s)).`;

    yield { type: "modelContentBlockStartEvent" };
    yield {
      type: "modelContentBlockDeltaEvent",
      delta: { type: "textDelta", text: responseText },
    };
    yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: "endTurn" };
    yield {
      type: "modelMetadataEvent",
      usage: { inputTokens: 60, outputTokens: 32, totalTokens: 92 },
      metrics: { latencyMs: Math.max(1, Date.now() - startMs) },
    };
  }
}

export interface CreateModelRouterOptions {
  allowDeterministicFallback?: boolean;
  deterministicConfig?: DeterministicModelConfig;
  preferredProvider?: StrandsProviderKind;
}

/**
 * Builds an ordered list of Strands RoutingCandidates based on configured env credentials,
 * honoring `STRANDS_MODEL_PROVIDER` preference and appending DeterministicControlPlaneModel
 * when fallback is permitted.
 */
export async function createControlPlaneModelRouter(
  options: CreateModelRouterOptions = {}
): Promise<ModelRouter | Model> {
  const allowFallback = options.allowDeterministicFallback ?? true;
  const preferred =
    options.preferredProvider ??
    (process.env.STRANDS_MODEL_PROVIDER?.toLowerCase() as StrandsProviderKind | undefined);

  const liveCandidates: RoutingCandidate[] = [];

  const pushGoogle = () => {
    if (!hasValidGeminiKey()) return;
    const model = new GoogleModel({
      apiKey: process.env.GEMINI_API_KEY!,
      modelId: process.env.STRANDS_GOOGLE_MODEL_ID || "gemini-4-hydrogen",
      params: { temperature: 0.1 },
    });
    liveCandidates.push(
      new RoutingCandidate({
        model,
        name: "google-gemini",
        description: "Google Gemini via Strands GoogleModel",
        metadata: { provider: "google", modelId: model.modelId },
      })
    );
  };

  const pushBedrock = () => {
    if (!hasBedrockConfig()) return;
    const model = new BedrockModel({
      region: process.env.AWS_REGION || "us-east-1",
      modelId:
        process.env.STRANDS_BEDROCK_MODEL_ID || "global.anthropic.claude-sonnet-4-6",
      ...(process.env.AWS_BEARER_TOKEN_BEDROCK
        ? { apiKey: process.env.AWS_BEARER_TOKEN_BEDROCK }
        : {}),
      temperature: 0.1,
    });
    liveCandidates.push(
      new RoutingCandidate({
        model,
        name: "aws-bedrock",
        description: "Amazon Bedrock via Strands BedrockModel",
        metadata: { provider: "bedrock", modelId: model.modelId ?? "bedrock-claude" },
      })
    );
  };

  const pushAnthropic = () => {
    if (!hasAnthropicKey()) return;
    const model = new AnthropicModel({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      modelId: process.env.STRANDS_ANTHROPIC_MODEL_ID || "claude-sonnet-4-6",
      temperature: 0.1,
    });
    liveCandidates.push(
      new RoutingCandidate({
        model,
        name: "anthropic-claude",
        description: "Anthropic Claude via Strands AnthropicModel",
        metadata: { provider: "anthropic", modelId: model.modelId ?? "claude-sonnet-4-6" },
      })
    );
  };

  const pushOpenAi = async () => {
    if (!hasOpenAiKey()) return;
    try {
      const mod = await import("@strands-agents/sdk/models/openai");
      const model = new mod.OpenAIModel({
        apiKey: process.env.OPENAI_API_KEY!,
        modelId: process.env.STRANDS_OPENAI_MODEL_ID || "gpt-5.4",
      });
      liveCandidates.push(
        new RoutingCandidate({
          model,
          name: "openai-gpt",
          description: "OpenAI via Strands OpenAIModel",
          metadata: { provider: "openai", modelId: model.modelId ?? "gpt-5.4" },
        })
      );
    } catch {
      // Optional openai peer package not installed; safely skip
    }
  };

  // Register preferred provider first, followed by remaining live providers
  if (preferred === "bedrock") {
    pushBedrock();
    pushGoogle();
    pushAnthropic();
    await pushOpenAi();
  } else if (preferred === "anthropic") {
    pushAnthropic();
    pushGoogle();
    pushBedrock();
    await pushOpenAi();
  } else if (preferred === "openai") {
    await pushOpenAi();
    pushGoogle();
    pushBedrock();
    pushAnthropic();
  } else if (preferred === "deterministic" && allowFallback) {
    return new DeterministicControlPlaneModel(options.deterministicConfig);
  } else {
    pushGoogle();
    pushBedrock();
    pushAnthropic();
    await pushOpenAi();
  }

  if (liveCandidates.length === 0) {
    if (!allowFallback) {
      throw new Error(
        "No live LLM provider is configured (GEMINI_API_KEY, AWS Bedrock, ANTHROPIC_API_KEY, or OPENAI_API_KEY). Configure a provider secret or switch to Structured Schema mode."
      );
    }
    const fallbackModel = new DeterministicControlPlaneModel(options.deterministicConfig);
    return new ModelRouter(
      [
        new RoutingCandidate({
          model: fallbackModel,
          name: "deterministic-control-plane",
          description: "Zero-latency offline deterministic control plane model",
          metadata: { provider: "deterministic" },
        }),
      ],
      { strategy: new FallbackStrategy(), maxSwitches: 1 }
    );
  }

  const allCandidates = [...liveCandidates];
  if (allowFallback) {
    const fallbackModel = new DeterministicControlPlaneModel(options.deterministicConfig);
    allCandidates.push(
      new RoutingCandidate({
        model: fallbackModel,
        name: "deterministic-fallback",
        description: "Deterministic fallback when upstream LLM is unreachable",
        metadata: { provider: "deterministic" },
      })
    );
  }

  return new ModelRouter(allCandidates, {
    strategy: new FallbackStrategy(),
    maxSwitches: allCandidates.length,
  });
}
