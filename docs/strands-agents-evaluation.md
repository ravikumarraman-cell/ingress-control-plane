# Strands Agents Evaluation

Evaluation of adopting [Strands Agents](https://github.com/strands-agents/harness-sdk) (TypeScript SDK `@strands-agents/sdk`) in the ingress control plane.

## Summary

Adopt Strands selectively as the **agent runtime**. Do not let it replace the control plane (DAG validation, approvals, audit, rollout).

Strands is an open-source SDK for Python and TypeScript. It provides an agent loop, tools, MCP, structured output, hooks, guardrails, sessions, tracing and evals, and supports Bedrock, Anthropic, OpenAI and Gemini. It runs in-process with no hosted control plane.

> Based on the Strands README and a review of `server/`; SDK API details should be verified against the official docs before implementation.

## Where it helps

| Area | Today | With Strands |
|---|---|---|
| Model calls in `server/agents.ts` | Hard-coded to `@google/genai` | Model-agnostic providers; swap or mix models per agent without rewrites. |
| Agent loop, retries, prompt wiring | Custom code | Built-in loop with turn limits, token budgets, cancellation, stop reasons. |
| Structured output (`validateStructuredOutput` in `server/dagEngine.ts`) | Custom validator | Native Zod-based structured output; existing Zod schemas carry over. |
| Read-only tool allowlist (`ReadOnlyToolIdSchema`, `assertReadOnlyBlueprintSecurity`) | Custom checks | Typed tools and MCP connections (Kubernetes, Terraform, Git, observability); hooks can intercept/block tool calls. |
| Safety and policy | Custom policy rules | Guardrails and steering as an additional layer alongside the policy engine. |
| Observability and audit (`AgentStepTrace`) | Custom traces | Built-in tracing that can feed the hash-chained audit log. |
| Handoffs and supervisor-spawned agents (`server/dagRunner.ts`) | Custom | Multi-agent patterns (swarm, graph, agents-as-tools) could simplify spawned chains. |
| Onboarding/troubleshooting copilots | Custom | Sessions and memory for conversational state. |
| Testing | vitest only | Evals SDK to score output quality (change-plan accuracy, blast-radius scoring). |

## Keep as custom (differentiators)

- DAG validation, topological sort, cycle detection and upstream interpolation in `server/dagEngine.ts`.
- Approval signing, hash-chained audit log and plan digests in `server/store.ts`.
- Blast-radius scoring, canary rollout and route YAML generation.

## Recommended path

1. Pilot: replace the Gemini call in one agent executor in `server/dagRunner.ts` with a Strands `Agent`. Keep the DAG engine as orchestrator; each node runs a Strands agent.
2. Map read-only tools to Strands tools or MCP.
3. Use hooks to emit `AgentStepTrace` and audit events.
4. Add evals once agents are stable.

## Risks

- The SDK is new and evolving quickly; pin versions.
- Added dependency footprint; check Node version requirements.
- Avoid two competing orchestration layers (our DAG engine and Strands graph patterns).
