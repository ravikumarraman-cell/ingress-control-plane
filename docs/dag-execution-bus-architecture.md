# DAG Execution Bus & Structured Output Chaining Architecture

This document illustrates how the **Ingress Control Plane** orchestrates dynamic read-only agents (`DynamicAgentBlueprint`), enforces strict security boundaries (`sa-ingress-readonly`), schedules dependency waves topologically, routes typed JSON payloads across the **Shared Context Bus**, and propagates safety vetoes in real time.

---

## 1. End-to-End DAG Execution Bus Diagram

```mermaid
flowchart TB
    subgraph UI["Frontend Studio & Live Observability"]
        Studio["AgentStudioBuilder.tsx\nAuthor blueprint · dependsOn · {{upstream.*}} chips · outputSchema"]
        Diagram["LiveAgentFlowDiagram.tsx\n5-Stage Pipeline + SVG Bezier DAG Connectors + Animated Data Dots"]
        Drawer["AgentHandoffDrawer.tsx\nConsumed Inputs · Resolved Prompt · Produced JSON · Audit SHA-256"]
        Studio -->|POST /api/v1/agents/blueprints| API
        Studio -->|POST /api/v1/workflows/:id/assign-agent| API
        Diagram -->|Click Node / Trace| Drawer
    end

    subgraph API_SEC["REST API & Static Guardrails (server.ts · server/dagEngine.ts)"]
        API["Express Control Plane API"]
        SecCheck{"assertReadOnlyBlueprintSecurity\nServiceAccount === sa-ingress-readonly?\nZero write tools (kubectl_apply, etc.)?"}
        DagCheck{"validateAgentDag (DFS + Stage Order)\n1. No self-loops / cycles (A -> B -> A)\n2. No backward cross-stage deps\n3. Max 4 dynamic agents / workflow"}
        API --> SecCheck
        SecCheck -->|Write / Executor Violation| Reject400["HTTP 400 DagValidationError"]
        SecCheck -->|Read-Only Verified| DagCheck
        DagCheck -->|Cycle or Invalid Stage| Reject400
        DagCheck -->|Valid Acyclic DAG| Store["Persisted Store (store.ts)\ndynamicAgentBlueprints"]
    end

    subgraph EXEC_BUS["Runtime DAG Execution Bus (server/agents.ts · server/dagRunner.ts)"]
        direction TB
        Intake["PRE_INTAKE\nIngressIntakeAgent · SupervisorAgent"]
        Bus[("sharedContextBus\nRecord<agentName, AgentStructuredOutput>\n{ summary, data, riskDelta, vetoTriggered, confidence }")]

        subgraph PhaseA["PHASE_A_PARALLEL (sa-ingress-readonly)"]
            direction LR
            CoreA["Core Parallel Workers\nDiscoveryAgent · PolicyAgent · ImpactAgent"]
            WavesA["topologicalSortStageAgents (Kahn's Algorithm)\nWave 0 -> Wave 1 -> ... via Promise.all"]
            CoreA -->|Publish typed outputs| Bus
            WavesA <-->|Read upstream / Write data| Bus
        end

        SupSpawn{"Supervisor Autonomous Spawner\n(prod + external + collision/warning)"}
        PhaseA --> SupSpawn
        SupSpawn -->|Spawns bounded 2-agent chain| WavesA

        subgraph PhaseB["PHASE_B_SEQUENTIAL"]
            direction LR
            WavesB["topologicalSortStageAgents\nChained Planners (e.g. CanaryWeightPlannerAgent)"]
            CoreB["ChangePlanAgent · ValidationRollbackAgent"]
            WavesB <-->|Read Phase A + Wave deps| Bus
            WavesB --> CoreB
        end

        HITL["HITLApprovalGate (Four-Eyes + HMAC + ETag Lock)\nForced if canForceApproval or riskDelta ELEVATE_*"]
        PostVerify["POST_VERIFY\nExecutionAgent · Post-Deploy Dynamic Verifiers"]

        Intake --> PhaseA
        PhaseA --> PhaseB
        PhaseB --> HITL
        HITL -->|Verified Signature + Live ETag Match| PostVerify
        PostVerify <-->|Publish verification telemetry| Bus
    end

    subgraph RUNNER["Per-Node Execution & Fault Propagation (executeStageDynamicAgents)"]
        CheckDep{"Any upstream in dependsOn\nvetoed or failed?"}
        Interp["interpolateUpstreamPrompt\nResolve {{upstream.<agent>.<field>}}\n(primitives, booleans, dot-paths, JSON arrays)"]
        ExecMode{"GEMINI_API_KEY configured?"}
        Gemini["Gemini JSON Schema Mode\ngemini-4-hydrogen (ThinkingLevel.LOW)\nbuildGeminiResponseSchema(outputSchema)"]
        Fallback["Deterministic Offline Synthesizer\nsynthesizeDeterministicAgentOutput"]
        ValidateOut["validateStructuredOutput\nCheck required keys & primitive/array/object types"]
        Skip["Mark SKIPPED_UPSTREAM_FAILED\nDownstream executor never called\nIndependent siblings still complete"]
        Audit[("Hash-Chained Audit Log\nDYNAMIC_AGENT_ASSIGNED\nAGENT_HANDOFF (SHA-256)\n+ SSE workflow_update")]

        CheckDep -->|Yes| Skip
        CheckDep -->|No| Interp
        Interp -->|MissingUpstreamFieldError| Skip
        Interp -->|Resolved Prompt + consumedInputs| ExecMode
        ExecMode -->|Yes| Gemini
        ExecMode -->|No / Fallback| Fallback
        Gemini --> ValidateOut
        Fallback --> ValidateOut
        ValidateOut -->|Write to sharedContextBus| Audit
        Skip --> Audit
    end

    Store --> EXEC_BUS
    WavesA -.-> RUNNER
    WavesB -.-> RUNNER
    Audit -->|SSE Stream| Diagram
```

---

## 2. Shared Context Bus & Interpolation Flow (ASCII View)

```text
  Upstream Agents (Phase A / Earlier Wave)
  ┌──────────────────────────────┐     ┌───────────────────────────────┐
  │ TLSInspectorAgent            │     │ ImpactAgent                   │
  │ data: {                      │     │ data: {                       │
  │   minTlsVersion: "TLSv1.3",  │     │   blastRadius: "MEDIUM",      │
  │   expiringWithinDays: 9,     │     │   hasCollision: false         │
  │   sanList: ["api.corp.com"]  │     │ }                             │
  │ }                            │     └───────────────┬───────────────┘
  └──────────────┬───────────────┘                     │
                 │                                     │
                 ▼                                     ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │                    sharedContextBus[agentName]                      │
  │  Typed AgentStructuredOutput Envelopes + Core Agent Alias Lookup    │
  └──────────────────────────────────┬──────────────────────────────────┘
                                     │
         interpolateUpstreamPrompt() │ resolves {{upstream.<agent>.<field>}}
                                     ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ CanaryWeightPlannerAgent (PHASE_B_SEQUENTIAL)                       │
  │ taskTemplate: "Plan canary given expiry={{upstream.TLSInspectorAgent│
  │                .expiringWithinDays}}d & risk={{upstream.ImpactAgent │
  │                .blastRadius}}"                                      │
  │ resolvedTaskPrompt: "Plan canary given expiry=9d & risk=MEDIUM"     │
  │                                                                     │
  │ Output Schema Validated -> { recommendedCanaryPercent: 10, ... }    │
  └──────────────────────────────────┬──────────────────────────────────┘
                                     │
                                     ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ SHA-256 Audit Chain (AGENT_HANDOFF) + SSE Broadcast -> UI Drawer    │
  └─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Veto & Fault Propagation Semantics

When an upstream node returns `vetoTriggered: true` (or violates `validateStructuredOutput` / `MissingUpstreamFieldError`):

1. **Downstream Halt:** Any downstream blueprint listing the vetoed node in `dependsOn` is immediately transitioned to `SKIPPED_UPSTREAM_FAILED` — its LLM/tool executor is **never invoked**.
2. **Sibling Isolation:** Independent parallel branches in the same `WorkflowHookStage` wave continue executing via `Promise.all`.
3. **Human Gate Escalation:** If a dynamic node sets `riskDelta: "ELEVATE_HIGH"` or `canForceApproval: true`, the workflow automatically pauses at `HITLApprovalGate` even when `hitlPolicy` is set to `auto_low_risk`.

---

## 4. Implementation Module Map

| Layer | File | Responsibility |
| :--- | :--- | :--- |
| **Contracts** | `src/shared/contracts.ts` | `WorkflowHookStage`, `ReadOnlyToolId`, `OutputFieldDefinition`, `AgentStructuredOutput`, `DynamicAgentBlueprint`, `DynamicTaskAssignment`, `WorkflowRun` extensions |
| **Pure DAG Engine** | `server/dagEngine.ts` | Read-only security assertions, DFS cycle detection, stage-order checks, Kahn's topological wave sorting, dot-path prompt interpolation, schema validation |
| **Stage Runner** | `server/dagRunner.ts` | Concurrent wave execution (`Promise.all`), veto propagation, Gemini JSON Schema mode + deterministic fallback, Supervisor autonomous 2-agent spawning |
| **Store & Orchestrator** | `server/store.ts`, `server/agents.ts` | Default chained blueprints (`TLSInspectorAgent` → `CanaryWeightPlannerAgent`), `assignAgentToWorkflow`, revision preservation, SHA-256 `AGENT_HANDOFF` audit events |
| **REST API & Client** | `server.ts`, `src/lib/api.ts` | Blueprint CRUD (`/api/v1/agents/blueprints`), runtime workflow hooking (`/api/v1/workflows/:workflowId/assign-agent`), `createApp()` factory |
| **Frontend UI** | `src/components/agents/AgentStudioBuilder.tsx`, `src/components/agents/AgentHandoffDrawer.tsx`, `src/components/LiveAgentFlowDiagram.tsx` | Authoring studio, clickable `{{upstream.*}}` chips, live SVG Bezier DAG connectors with animated data particles, and handoff telemetry drawer |
| **Tests** | `server/__tests__/agentDag.test.ts` | 12 Vitest unit & integration specs covering cycles, waves, interpolation, schema checks, veto propagation, and REST endpoints |
