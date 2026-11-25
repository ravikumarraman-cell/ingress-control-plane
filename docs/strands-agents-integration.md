# Strands Agents SDK & Harness Integration Guide

This document explains in detail how [`@strands-agents/sdk`](https://github.com/strands-agents/sdk-typescript) (`^1.26.0`) and `@strands-agents/harness` (`^0.5.0`) are integrated into the **Ingress Control Plane**, maps every Strands primitive currently in active use, and catalogs remaining SDK and Harness capabilities that can still be adopted.

> For the original pre-implementation feasibility assessment, see [`docs/strands-agents-evaluation.md`](./strands-agents-evaluation.md).

---

## 1. Architectural Overview

The Ingress Control Plane runs Strands **in-process** inside the Express/Node.js backend (`server.ts` and `server/strands/*`). Strands powers the **agent runtime** (model routing, tool execution, guardrails, steering, multi-agent graph execution, structured output, sessions, memory, and OpenTelemetry tracing), while domain-specific **control-plane invariants** (topological DAG validation, SHA-256 ETag anti-drift TOCTOU locking, HMAC approval signatures, hash-chained audit logs, and deterministic YAML/HCL artifact generation) remain enforced in deterministic application code.

```text
+-----------------------------------------------------------------------------------+
| Express API & Control Plane (server.ts)                                           |
|  - /api/v1/workflows, /decision, /revise, /onboarding/assess, /troubleshoot       |
|  - /api/v1/strands/telemetry, /providers, /evals/run, /workflows/:id/strands-session
+-----------------------------------------+-----------------------------------------+
                                          |
          +-------------------------------+-------------------------------+
          v                               v                               v
+-------------------+         +-----------------------+       +---------------------+
| Strands Harness   |         | Strands Multi-Agent   |       | Strands Agent       |
| createHarness()   |         | Graph (DAG Nodes)     |       | new Agent()         |
| - Intake (AI)     |         | - Intake -> Supervisor|       | - Dynamic DAG       |
| - Onboarding      |         | - Phase A Parallel    |       |   Blueprints        |
| - Troubleshooting |         | - Phase B Planning    |       | - Custom Agents     |
+---------+---------+         +-----------+-----------+       +----------+----------+
          |                               |                              |
          +-------------------------------+------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
| Shared Strands Runtime Layer (server/strands/)                                    |
|  - ModelRouter + FallbackStrategy (Google, Bedrock, Anthropic, OpenAI, Offline)   |
|  - @tool definitions (6 sa-ingress-readonly tools + vended httpRequest + MCP)     |
|  - InterventionHandlers (Secret/TLS Guardrail, ReadOnly Isolation, HITL)          |
|  - SteeringHandler + ToolLedgerProvider                                           |
|  - SessionManager (LocalFileStorage / InMemoryStorage) & MemoryManager            |
|  - OpenTelemetry (setupTracer / setupMeter) & Control-Plane Evals                 |
+-----------------------------------------------------------------------------------+
```

### Module Inventory (`server/strands/`)

| File | Responsibility |
| --- | --- |
| `server/strands/index.ts` | Barrel export for all Strands runtime modules. |
| `server/strands/modelProvider.ts` | Multi-provider `ModelRouter`, `FallbackStrategy`, `RoutingCandidate`s (`GoogleModel`, `BedrockModel`, `AnthropicModel`, `OpenAIModel`), and `DeterministicControlPlaneModel` (offline Strands `Model` subclass). |
| `server/strands/tools.ts` | Six read-only `tool()` definitions scoped to `sa-ingress-readonly`, `syntheticProbeHttpTool` wrapping `@strands-agents/sdk/vended-tools/http-request`, and `STRANDS_MCP_SERVERS` loader. |
| `server/strands/guardrailsAndSteering.ts` | `SecretAndTlsGuardrailIntervention`, `ReadOnlyIsolationIntervention`, `IngressSteeringHandler` (with `ToolLedgerProvider`), and `createHitlApprovalIntervention()` (`HumanInTheLoop`). |
| `server/strands/corePipelineGraph.ts` | Native Strands `Graph` orchestrating `IngressIntakeAgent -> SupervisorAgent -> Phase A Parallel -> ChangePlanningAgent -> ValidationRollbackAgent`. |
| `server/strands/sessionMemoryTelemetry.ts` | `SessionManager`, `MemoryManager` (`FileMemoryStore`), `LocalFileStorage` / `InMemoryStorage`, `setupTracer`/`setupMeter`, `InvokeLimits`, telemetry history, and `runControlPlaneEvals()`. |

---

## 2. How Strands Agents Is Integrated & Used

### 2.1 Agent Harness & Direct Agent Loops
Strands is invoked in two patterns depending on the lifecycle need:

1. **`createHarness()` (`@strands-agents/harness`)** — used for top-level conversational/analytical copilots:
   - **`IngressIntakeAgent`** (`parseNaturalLanguageIngressRequest` in `server/agents.ts`): Parses natural-language ingress requests into strict `IngressRequest` payloads via `structuredOutputSchema`, with `builtinTools: []`, `builtinPlugins: []`, `skills: false`, `session: false`, `memory: false`, `contextManager: false`, and an explicit `15s` `AbortSignal.timeout`.
   - **`GuidedOnboardingAgent`** (`assessOnboardingAndPreflight` in `server/adoptionAgents.ts`): Summarizes top-10 onboarding blocker checks into plain-English developer guidance with a `3.5s` `AbortSignal.timeout`.
   - **`TroubleshootingAgent`** (`diagnoseWorkflowFailure` in `server/adoptionAgents.ts`): Classifies failure logs/errors/diffs into structured root causes and remediation steps with `MemoryManager` attached.
2. **`new Agent()` (`@strands-agents/sdk`)** — used for scoped pipeline workers and dynamic user-defined agents:
   - **Dynamic DAG Blueprints** (`runBlueprintWithStrands` in `server/dagRunner.ts`): Instantiates a per-blueprint `Agent` with `DefaultModelRetryStrategy({ maxAttempts: 2 })`, blueprint-specific `allowedTools`, `ReadOnlyIsolationIntervention`, and dynamic Zod `structuredOutputSchema`.
   - **Inline Custom Agents** (`runCustomAgentWithStrands` in `server/agents.ts`): Executes operator-provided custom advisory instructions with read-only tools and `140`-character advisory summaries.
   - **Core Pipeline Graph Nodes** (`executeCorePipelineWithStrandsGraph` in `server/strands/corePipelineGraph.ts`): Constructs one `Agent` per enabled core stage (`IngressIntakeAgent`, `SupervisorAgent`, `DiscoveryInventoryAgent`, `PolicyComplianceAgent`, `ImpactAnalysisAgent`, `CostEstimationAgent`, `SecurityPostureAgent`, `ChangePlanningAgent`, `ValidationRollbackAgent`).

All invocations enforce `InvokeLimits` (`DEFAULT_CONTROL_PLANE_LIMITS`: 6 turns, 16,000 total tokens, 4,000 output tokens, 3 structured output attempts; `DEFAULT_GRAPH_LIMITS`: 40 turns, 100,000 total tokens, 25,000 output tokens, 6 structured output attempts).

### 2.2 Multi-Agent Graph (`Graph`)
`executeCorePipelineWithStrandsGraph()` (`server/strands/corePipelineGraph.ts`) builds a directed acyclic Strands `Graph` with `maxConcurrency: 5`, `maxSteps: 16`, and `nodeTimeout: 10_000`:

- **Entry**: `IngressIntakeAgent` -> `SupervisorAgent`
- **Phase A Fan-Out**: `SupervisorAgent` -> enabled Phase A nodes (`DiscoveryInventoryAgent`, `PolicyComplianceAgent`, `ImpactAnalysisAgent`, `CostEstimationAgent`, `SecurityPostureAgent`)
- **Phase B Sequential Fan-In**: All enabled Phase A nodes -> `ChangePlanningAgent` -> `ValidationRollbackAgent`
- Node durations and text outputs are extracted from `MultiAgentResult` (`buildCoreTracesFromGraphResult`) to populate `WorkflowRun.agentTraces`.

### 2.3 Model Portability, Routing & Offline Fallback
`createControlPlaneModelRouter()` (`server/strands/modelProvider.ts`) constructs a Strands `ModelRouter` using `FallbackStrategy` and ordered `RoutingCandidate`s based on environment variables and `STRANDS_MODEL_PROVIDER`:

| Provider | SDK Class | Env Configuration | Default Model |
| --- | --- | --- | --- |
| Google Gemini | `GoogleModel` (`@strands-agents/sdk/models/google`) | `GEMINI_API_KEY` | `gemini-4-hydrogen` (`STRANDS_GOOGLE_MODEL_ID`) |
| Amazon Bedrock | `BedrockModel` (`@strands-agents/sdk`) | `AWS_REGION` + `AWS_ACCESS_KEY_ID` or `AWS_BEARER_TOKEN_BEDROCK` | `global.anthropic.claude-sonnet-4-6` (`STRANDS_BEDROCK_MODEL_ID`) |
| Anthropic | `AnthropicModel` (`@strands-agents/sdk/models/anthropic`) | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` (`STRANDS_ANTHROPIC_MODEL_ID`) |
| OpenAI | `OpenAIModel` (`@strands-agents/sdk/models/openai`, lazy dynamic import) | `OPENAI_API_KEY` | `gpt-5.4` (`STRANDS_OPENAI_MODEL_ID`) |
| Offline / Deterministic | `DeterministicControlPlaneModel` (extends Strands `Model`) | Built-in fallback (`allowDeterministicFallback: true`) | `strands-deterministic-control-plane-v1` |

`DeterministicControlPlaneModel` implements Strands' streaming `async *stream(messages, options)` contract (`modelMessageStartEvent`, `toolUseStart`, `toolUseInputDelta`, `modelContentBlockStopEvent`, `modelMessageStopEvent`, `modelMetadataEvent`). This enables the full Strands tool-calling, intervention, structured-output, and telemetry loops to run deterministically with zero external API keys during offline development and automated tests.

### 2.4 Tools, Vended Tools & MCP
`server/strands/tools.ts` defines typed Zod-validated Strands tools via `tool()`:

- **6 Read-Only Control-Plane Tools (`sa-ingress-readonly`)**:
  - `list_k8s_routes`: Reads live `HTTPRoute` inventory and current `liveStateEtag`.
  - `get_lb_config`: Inspects gateway bindings, IP pool boundaries, WAF defaults, and canary weights.
  - `get_dns_records`: Checks Infoblox / Cloud DNS delegation and CNAME vs. bare A-record eligibility.
  - `get_tls_certs`: Evaluates TLS 1.3 vs. 1.2 posture, wildcard restrictions, SAN coverage, and expiry window.
  - `evaluate_opa_policies`: Evaluates enabled `CustomPolicyRule`s and baseline prod TLS controls.
  - `check_route_collisions`: Detects exact hostname/path overlaps or same-host route neighbors.
- **Vended HTTP Probe Tool**: `syntheticProbeHttpTool` wraps `@strands-agents/sdk/vended-tools/http-request` (`httpRequest`) with scheme validation (`http:`/`https:` only) and attaches to `TroubleshootingAgent`.
- **Optional MCP Server Integration**: `getConfiguredMcpServers()` parses `STRANDS_MCP_SERVERS` JSON and passes `mcpServers` directly into `createHarness({ mcpServers })` for `IngressIntakeAgent`, `GuidedOnboardingAgent`, and `TroubleshootingAgent`.

### 2.5 Guardrails, Steering & HITL Interventions
Implemented in `server/strands/guardrailsAndSteering.ts` using Strands' `InterventionHandler` and `InterventionActions` (`proceed`, `guide`, `deny`):

- **`SecretAndTlsGuardrailIntervention`** (`onError: "deny"`):
  - `beforeInvocation`: Scans all message text via `containsEmbeddedSecret()` and denies invocations containing private keys, bearer tokens, or API keys.
  - `beforeToolCall`: Blocks tool arguments containing secret material, and emits `InterventionActions.guide(...)` if `get_tls_certs` or `evaluate_opa_policies` is called on external `prod` without `tls_1_3_strict`.
  - `afterModelCall`: Scans assistant outputs for secret leakage and steers the model to redact credentials.
- **`ReadOnlyIsolationIntervention`** (`onError: "deny"`):
  - `beforeInvocation`: Blocks execution if `serviceAccount` is in `FORBIDDEN_SERVICE_ACCOUNTS`.
  - `beforeToolCall`: Permits only `strands_structured_output` and explicitly allowlisted read-only tools from `READ_ONLY_TOOL_CATALOG`, rejecting any write tool (e.g. `kubectl_apply`).
- **`IngressSteeringHandler`** (extends `SteeringHandler` with `ToolLedgerProvider({ maxEntries: 50 })`):
  - `beforeToolCall`: Appends Four-Eyes RBAC and TOCTOU ETag steering context when inspecting `prod` routes.
  - `afterModelCall`: Steers away from `0.0.0.0/0` firewall openings, Four-Eyes RBAC bypasses, or permanent WAF disables.
- **`createHitlApprovalIntervention()`**: Provides a Strands vended `HumanInTheLoop` intervention (`@strands-agents/sdk/vended-interventions/hitl`) for future agents that own approved write tools. It is intentionally not attached to the current read-only core graph; its approval boundary is the application workflow gate.

### 2.6 Structured Output
- **Static Zod Schemas**: `NaturalLanguageIntakeOutputSchema` (`server/agents.ts`) and `TroubleshootOutputSchema` (`server/adoptionAgents.ts`) passed via `structuredOutputSchema`.
- **Dynamic Runtime Zod Compilation**: `buildStrandsOutputZodSchema()` (`server/dagRunner.ts`) compiles user-defined `OutputFieldDefinition[]` (`string`, `number`, `boolean`, `string[]`, `object`, required/optional) into live Zod schemas for `agent.invoke(..., { structuredOutputSchema })`, then cross-validates through `validateStructuredOutput()`.

### 2.7 Sessions, Storage & Memory
Implemented in `server/strands/sessionMemoryTelemetry.ts`:

- **Storage Backend**: `createControlPlaneStorage()` selects `InMemoryStorage` under `VITEST` for hermetic test runs and `LocalFileStorage` (`data/strands/sessions` and `data/strands/memory`) in dev/production.
- **Sessions (`SessionManager`)**: `createWorkflowSessionManager(sessionId)` configures `saveLatestOn: "invocation"` and `multiAgentSaveLatestOn: "node"`, attached to the core `Graph` (`corePipelineGraph.ts`) so each workflow (`adk-sess-...`) checkpoints graph node state.
- **Cross-Session Memory (`MemoryManager` + `FileMemoryStore`)**: `getControlPlaneMemoryManager()` initializes a `FileMemoryStore` (`ingress-control-plane-memory`) attached to `TroubleshootingAgent`, persisting root-cause findings via `memoryManager.add(...)` after diagnoses.

### 2.8 Observability, Telemetry & Evals
- **OpenTelemetry (`@strands-agents/sdk/telemetry`)**: `ensureStrandsTelemetryInitialized()` calls `setupTracer` and `setupMeter` on Express startup (`createApp()`), enabling OTLP export when `OTEL_EXPORTER_OTLP_ENDPOINT` is configured.
- **Control-Plane Telemetry Store & APIs**:
  - `recordStrandsAgentResult()` captures `stopReason`, duration, cycle count, token usage, tool call count, and trace span counts for every Harness, Agent, and Graph run.
  - Exposed via `GET /api/v1/strands/telemetry`, `GET /api/v1/strands/providers`, and `GET /api/v1/workflows/:workflowId/strands-session`.
- **Automated Evals**:
  - `runControlPlaneEvals()` (`POST /api/v1/strands/evals/run`) runs 4 live Strands assertions (`STRANDS-EVAL-01` secret guardrail, `STRANDS-EVAL-02` read-only tool + Zod structured output + session snapshot, `STRANDS-EVAL-03` DAG cycle rejection, `STRANDS-EVAL-04` ETag determinism + TLS 1.3 + SHA-256 audit chain).
  - Verified by `server/__tests__/strandsIntegration.test.ts` alongside `agentDag.test.ts` and `adoptionAgents.test.ts`.

### 2.9 Reuse Boundaries

Prefer the installed Strands primitives for agent lifecycle and coordination:
`Agent`/`createHarness`, `Graph` for the fixed core pipeline, `tool()` with Zod
schemas, `structuredOutputSchema`, model routing, interventions, session/memory
managers, retry strategies, and telemetry. Do not introduce a separate agent base
class or hand-written model/tool loop.

Keep application code for deterministic control-plane contracts Strands should not
decide: dynamic blueprint validation and stage ordering, upstream output
interpolation, veto/failure propagation, audit linkage, approval signatures,
ETag drift checks, and workflow HTTP state. The dynamic runner's wave scheduling
is currently coupled to these semantics; replace it with a Strands graph only if
the replacement preserves per-agent inputs/outputs, dependency failures, vetoes,
and audit records under tests.

The core analysis graph is strictly read-only, so it uses
`ReadOnlyIsolationIntervention` rather than the vended mutating-tool HITL
intervention. Human approval remains the workflow-level approval gate; a future
execution agent can use Strands HITL when it actually owns approved write tools.

Memory injection remains disabled for troubleshooting because the shared memory
store is not yet scoped by tenant/workflow authorization. Use filtered Strands
memory retrieval only after that isolation boundary is defined; do not enable
global automatic injection.

The separate `backend/` foundation is not imported by the active Express runtime.
Do not extend it as a parallel orchestration stack; decide separately whether to
integrate or retire those standalone abstractions.

---

## 3. Summary Matrix: Used vs. Partial vs. Available

| Capability Area | Currently Used | Partially Wired / Caveats | Available in Installed SDK/Harness (Not Yet Used) |
| --- | --- | --- | --- |
| **Agent Runtime** | `Agent`, `createHarness()`, `InvokeLimits`, `DefaultModelRetryStrategy`, `AbortSignal` | `createHarness` disables `builtinTools`, `builtinPlugins`, `skills`, `contextManager`. | `AgentSpec`, `defineHarnessAgentConfig`, `makeProgrammaticToolCaller`, `DEFAULT_PROGRAMMATIC_TOOL_CALLER_DESCRIPTION` |
| **Multi-Agent** | `Graph`, `MultiAgentResult` (core pipeline fan-out/fan-in) | Core `Graph` nodes use `DeterministicControlPlaneModel` directly rather than `createControlPlaneModelRouter`. | `Swarm`, `makeSubagent`, `@strands-agents/sdk/vended-tools/swarm`, `vended-tools/graph`, `vended-tools/subagent` |
| **Models & Routing** | `ModelRouter`, `FallbackStrategy`, `RoutingCandidate`, `GoogleModel`, `BedrockModel`, `AnthropicModel`, `OpenAIModel`, custom `Model` (`DeterministicControlPlaneModel`) | — | `ClassifierStrategy`, `VercelModel` (`@strands-agents/sdk/models/vercel`), `DecisionModel`, `DecisionsAPIDecisionModel`, `TypeSafeDecisionModel` |
| **Tools & MCP** | 6 custom `tool()` definitions, `httpRequest` (`vended-tools/http-request`), `getConfiguredMcpServers()` on `createHarness` | `syntheticProbeHttpTool` is only attached to `TroubleshootingAgent`, not `ExecutionAgent` canary verification; `McpClient` is not directly mounted on `Agent` nodes. | `vended-tools/mcp-router`, `web-fetch`, `read`, `write`, `edit`, `bash`/`shell`, `stop`, `handoff-to-user`, `a2a-client` |
| **Guardrails & HITL** | Custom `InterventionHandler`s (`SecretAndTlsGuardrailIntervention`, `ReadOnlyIsolationIntervention`), `SteeringHandler` + `ToolLedgerProvider`; exported `HumanInTheLoop` factory for future write agents | Workflow pause/resume (`AWAITING_APPROVAL` -> `/decision`) is controlled by `server/agents.ts`; native Strands interrupt/resume is not wired. | `InterruptEvent` / `InterruptResponseContent` checkpoint resume, Cedar policy intervention (`@strands-agents/sdk/vended-interventions/cedar`), `dogwood` |
| **Sessions & Memory** | `SessionManager` (`LocalFileStorage` / `InMemoryStorage`), `MemoryManager` + `FileMemoryStore` | `MemoryManager` sets `injection: false` and only calls `.add()`, not `.search()` during troubleshooting; `SessionManager` is not wired on `createHarness` calls (`session: false`). | `injection: true` automatic memory recall, `SlidingWindowConversationManager`, `SummarizingConversationManager`, `S3Storage` (`session/s3-storage`), `BedrockKnowledgeBase` (`vended-memory-stores/bedrock-knowledge-base`), BM25/QMD/Bedrock embedding search (`storage/search/*`) |
| **Context & Plugins** | — | Disabled in `createHarness` (`skills: false`, `builtinPlugins: []`, `contextManager: false`). | `vended-plugins/skills`, `vended-plugins/context-offloader`, `vended-plugins/context-injector`, `vended-plugins/goal`, `vended-plugins/todos` |
| **Streaming & A2A** | Internal `Model.stream()` yielding `ModelStreamEvent` | Backend `agent.invoke()` awaits completion; UI updates via coarse `workflow_update` SSE events only. | `agent.stream()` (`ModelStreamUpdateEvent`, `ToolStreamUpdateEvent`, `ContentBlockEvent`) streamed to browser SSE; `@strands-agents/sdk/a2a` & `a2a/express` |
| **Sandboxing** | — | Dry-run validation (`ValidationRollbackAgent`) runs in-process string/schema checks instead of sandboxed CLI validation. | `PosixShellSandbox`, `@strands-agents/sdk/sandbox`, `sandbox/docker`, `sandbox/ssh` |

---

## 4. What Can Still Be Used (High-Value Expansion Opportunities)

1. **Live Model Routing on Core Pipeline Graph Nodes**
   - *Current*: `corePipelineGraph.ts` constructs node agents with `new DeterministicControlPlaneModel(...)`.
   - *Upgrade*: Pass `createControlPlaneModelRouter({ allowDeterministicFallback: true })` into `PolicyComplianceAgent`, `ImpactAnalysisAgent`, and `ValidationRollbackAgent` when deeper semantic analysis of justifications or custom rules is desired.

2. **Automatic Troubleshooting Memory Recall (`MemoryManager`)**
   - *Current*: `TroubleshootingAgent` writes incidents with `memoryManager.add(...)`, while `injection: false` disables automatic prompt injection.
   - *Upgrade*: Enable `injection: true` (or invoke `memoryManager.search(...)` before diagnosis) and pair `FileMemoryStore` with `@strands-agents/sdk/storage/search/bm25` or `@strands-agents/sdk/storage/embeddings/bedrock` so recurring HTTP 522, Infoblox CNAME, or TLS SAN incidents immediately surface historical fixes.

3. **Native Strands Interrupt/Resume for HITL Approvals**
   - *Current*: `PendingApprovalsPanel` (`POST /api/v1/workflows/:workflowId/decision`) resumes workflows via `server/agents.ts` state transitions.
   - *Upgrade*: Persist `SessionManager` state on `InterruptEvent` from `HumanInTheLoop` and resume the paused Strands agent directly with `InterruptResponseContent` upon signed operator approval, unifying execution-phase `ExecutionAgent` tools (`kubectl` / `gitops` / `synthetic_probe_http`) under Strands' native interrupt protocol.

4. **Real-Time Token & Tool Streaming Over SSE**
   - *Current*: `useWorkflowStream.ts` subscribes to `/api/v1/workflows/events` for coarse status transitions (`workflow_update`).
   - *Upgrade*: Switch `GuidedOnboardingAgent`, `TroubleshootingAgent`, and `SupervisorRevisePanel` from `.invoke()` to `agent.stream()` and forward `ModelStreamUpdateEvent` / `ToolStreamUpdateEvent` chunks over SSE so operators see live tool calls and streaming reasoning in the UI.

5. **Cedar Policy Intervention (`@strands-agents/sdk/vended-interventions/cedar`)**
   - *Current*: Corporate policy controls are evaluated in TypeScript (`evaluatePolicies()` and `CustomPolicyRule` switch logic).
   - *Upgrade*: Express `CustomPolicyRule`s and Four-Eyes RBAC constraints as Cedar policies evaluated via Strands' `cedar` intervention handler for formal, auditable authorization decisions.

6. **Sandboxed Dry-Run Validation (`PosixShellSandbox` / `sandbox/docker`)**
   - *Current*: `ValidationRollbackAgent` performs in-process validation without shelling out to real cluster CLIs.
   - *Upgrade*: Run `kubectl apply --dry-run=server`, `terraform validate`, or `opa eval` inside `@strands-agents/sdk/sandbox` (`PosixShellSandbox` or `sandbox/docker`) with strict read-only mounts and timeout bounds.

7. **Context Management & Supervisor Revision Loops**
   - *Current*: `reviseWorkflowWithAgentFeedback()` re-plans workflows statelessly per revision.
   - *Upgrade*: Attach `SessionManager` + `SummarizingConversationManager` (or `SlidingWindowConversationManager`) and `@strands-agents/sdk/vended-plugins/context-offloader` to multi-iteration `SupervisorAgent` revision sessions so feedback across iterations 1..5 is preserved without overflowing context windows.

8. **Autonomous `Swarm` & Harness `Todos` / `Skills` for Deep Diagnostics**
   - *Current*: `TroubleshootingAgent` runs as a single-harness step and `skills`/`todos` plugins are disabled.
   - *Upgrade*: For complex multi-domain outages (DNS + TLS + WAF + Canary probe failures), orchestrate specialist agents (`DnsDiagAgent`, `CertDiagAgent`, `WafDiagAgent`) via Strands `Swarm` or `vended-tools/subagent`, and use `@strands-agents/sdk/vended-plugins/todos` + `skills` to track multi-step diagnostic checklists.

9. **Real Synthetic Probes in `ExecutionAgent` via `syntheticProbeHttpTool`**
   - *Current*: `syntheticProbeHttpTool` (`httpRequest`) is registered on `TroubleshootingAgent`, while `ExecutionAgent` canary/post-apply verification simulates probe results.
   - *Upgrade*: Invoke `syntheticProbeHttpTool` against non-simulated target health endpoints during canary promotion and post-apply verification, automatically feeding HTTP status and latency into deterministic rollback triggers.

10. **A2A Protocol & Durable S3 Session Storage for Multi-Replica Scale**
    - *Current*: Sessions and state are stored on local disk (`LocalFileStorage` under `data/strands/`).
    - *Upgrade*: Use `@strands-agents/sdk/session/s3-storage` (or shared database storage) for horizontal scaling across multiple Cloud Run replicas, and expose read-only discovery/onboarding capabilities via `@strands-agents/sdk/a2a/express` (`a2a/express`) for external platform bots.

---

## 5. Intentional Control-Plane Boundaries (Keep Custom)

Consistent with `docs/strands-agents-evaluation.md`, the following responsibilities remain deterministic control-plane code outside LLM/agent discretion:

- **DAG Cycle & Interpolation Engine (`server/dagEngine.ts`)**: Deterministic topological sorting, stage ordering, and `{{upstream.AgentName.field}}` interpolation.
- **Four-Eyes RBAC & HMAC Approval Signing (`server/store.ts`, `server/agents.ts`)**: Cryptographic approval seals (`signApprovalPayload`, `verifyApprovalSignature`) and HTTP `403` self-approval enforcement on `prod`/`HIGH` blast-radius changes.
- **TOCTOU ETag Locking (`computeStateEtag`)**: SHA-256 cluster state locking with HTTP `409` `DRIFT_ABORTED` guards.
- **Hash-Chained Audit Ledger (`verifyAuditChain`)**: Tamper-evident `prevEventHash -> eventHash` sequence across all human, agent, and system actions.
- **Canary Rollout State Machine & Rollback Plans**: Deterministic step promotion (`promoteCanaryStep`) and sub-45s rollback execution (`executeManualRollback`).
