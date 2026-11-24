import {
  InterventionActions,
  InterventionHandler,
  Message,
  TextBlock,
  type AfterModelCallEvent,
  type BeforeInvocationEvent,
  type BeforeToolCallEvent,
} from "@strands-agents/sdk";
import { HumanInTheLoop } from "@strands-agents/sdk/vended-interventions/hitl";
import {
  SteeringHandler,
  ToolLedgerProvider,
} from "@strands-agents/sdk/vended-interventions/steering";
import {
  containsEmbeddedSecret,
  READ_ONLY_TOOL_CATALOG,
} from "../../src/shared/contracts.ts";
import {
  FORBIDDEN_SERVICE_ACCOUNTS,
  FORBIDDEN_WRITE_TOOLS,
} from "../dagEngine.ts";

const READ_ONLY_TOOL_NAMES = new Set<string>(READ_ONLY_TOOL_CATALOG.map((t) => t.id));
const STRUCTURED_OUTPUT_INTERNAL_TOOL = "strands_structured_output";

function extractTextFromMessages(messages: readonly Message[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === "textBlock") {
        parts.push(block.text);
      }
    }
  }
  return parts.join("\n");
}

/**
 * Strands InterventionHandler enforcing V1-SEC-01 secret & TLS guardrails
 * across invocation input, tool parameters, and model outputs.
 */
export class SecretAndTlsGuardrailIntervention extends InterventionHandler {
  readonly name = "ingress-control-plane:secret-tls-guardrail";
  override readonly onError = "deny" as const;

  override beforeInvocation(event: BeforeInvocationEvent) {
    const combinedText = extractTextFromMessages(event.messages);
    if (containsEmbeddedSecret(combinedText)) {
      return InterventionActions.deny(
        "Guardrail blocked invocation: input contains prohibited secret, bearer token, or private key material."
      );
    }
    return InterventionActions.proceed({ reason: "No secret patterns in invocation messages" });
  }

  override beforeToolCall(event: BeforeToolCallEvent) {
    const serialized = JSON.stringify(event.toolUse.input ?? {});
    if (containsEmbeddedSecret(serialized)) {
      return InterventionActions.deny(
        `Guardrail blocked tool "${event.toolUse.name}": arguments contain prohibited secret material.`
      );
    }

    if (event.toolUse.name === "get_tls_certs" || event.toolUse.name === "evaluate_opa_policies") {
      const input = (event.toolUse.input ?? {}) as Record<string, unknown>;
      if (
        input.environment === "prod" &&
        input.exposure === "external" &&
        input.tlsProfile &&
        input.tlsProfile !== "tls_1_3_strict"
      ) {
        return InterventionActions.guide(
          "External production ingress strictly requires tls_1_3_strict. Re-evaluate with tls_1_3_strict.",
          { reason: "External prod TLS 1.3 steering" }
        );
      }
    }

    return InterventionActions.proceed();
  }

  override afterModelCall(event: AfterModelCallEvent) {
    const message = event.stopData?.message;
    if (!message) return InterventionActions.proceed();
    const outText = extractTextFromMessages([message]);
    if (containsEmbeddedSecret(outText)) {
      return InterventionActions.guide(
        "Your response contained sensitive credential-like material. Redact all keys/tokens immediately.",
        { reason: "Model output secret leakage guardrail" }
      );
    }
    return InterventionActions.proceed();
  }
}

/**
 * Strands InterventionHandler enforcing strict `sa-ingress-readonly` least-privilege
 * isolation at runtime on dynamic & specialist agents.
 */
export class ReadOnlyIsolationIntervention extends InterventionHandler {
  readonly name: string;
  override readonly onError = "deny" as const;
  private readonly allowedTools: Set<string>;
  private readonly serviceAccount: string;

  constructor(params: {
    agentName: string;
    allowedTools: readonly string[];
    serviceAccount?: string;
  }) {
    super();
    this.name = `ingress-control-plane:readonly-isolation:${params.agentName}`;
    this.allowedTools = new Set([...params.allowedTools, STRUCTURED_OUTPUT_INTERNAL_TOOL]);
    this.serviceAccount = params.serviceAccount ?? "sa-ingress-readonly";
  }

  override beforeInvocation() {
    if (FORBIDDEN_SERVICE_ACCOUNTS.has(this.serviceAccount)) {
      return InterventionActions.deny(
        `Privilege escalation blocked: service account "${this.serviceAccount}" cannot execute read-only specialist agents.`
      );
    }
    return InterventionActions.proceed();
  }

  override beforeToolCall(event: BeforeToolCallEvent) {
    const toolName = event.toolUse.name;
    if (toolName === STRUCTURED_OUTPUT_INTERNAL_TOOL) {
      return InterventionActions.proceed();
    }
    if (FORBIDDEN_WRITE_TOOLS.has(toolName) || !READ_ONLY_TOOL_NAMES.has(toolName)) {
      return InterventionActions.deny(
        `Security policy violation: tool "${toolName}" is prohibited under sa-ingress-readonly.`
      );
    }
    if (!this.allowedTools.has(toolName)) {
      return InterventionActions.deny(
        `Tool "${toolName}" is not in agent allowlist [${Array.from(this.allowedTools).join(", ")}].`
      );
    }
    return InterventionActions.proceed();
  }
}

/**
 * Strands SteeringHandler backed by ToolLedgerProvider providing just-in-time
 * architectural guidance (Four-Eyes RBAC + 7-21d WAF Detect-to-Block + Scoped Cloudflare CIDRs).
 */
export class IngressSteeringHandler extends SteeringHandler {
  override readonly name = "ingress-control-plane:steering";
  readonly ledger: ToolLedgerProvider;

  constructor() {
    const ledger = new ToolLedgerProvider({ maxEntries: 50 });
    super({ contextProviders: [ledger] });
    this.ledger = ledger;
  }

  override beforeToolCall(event: BeforeToolCallEvent) {
    const input = (event.toolUse.input ?? {}) as Record<string, unknown>;
    if (event.toolUse.name === "list_k8s_routes" && input.environment === "prod") {
      return InterventionActions.proceed({
        reason: "Steering note: production changes require Four-Eyes RBAC review & TOCTOU ETag lock.",
      });
    }
    return InterventionActions.proceed();
  }

  override afterModelCall(event: AfterModelCallEvent) {
    const msg = event.stopData?.message;
    if (!msg) return InterventionActions.proceed();
    const text = msg.content
      .filter((b): b is TextBlock => b.type === "textBlock")
      .map((b) => b.text)
      .join(" ")
      .toLowerCase();

    if (text.includes("0.0.0.0/0") || text.includes("bypass four-eyes") || text.includes("disable waf permanently")) {
      return InterventionActions.guide(
        "Reject 0.0.0.0/0 firewall rules, Four-Eyes RBAC bypasses, or permanent WAF disables. Use scoped Cloudflare CIDRs and 7-21d WAF Detect-to-Block.",
        { reason: "Steering security baseline enforcement" }
      );
    }
    return InterventionActions.proceed();
  }
}

/**
 * Creates a Strands native HumanInTheLoop intervention handler for execution-phase tools,
 * allowing read-only inspection & structured output freely while interrupting before mutating calls.
 */
export function createHitlApprovalIntervention(): HumanInTheLoop {
  return new HumanInTheLoop({
    allowedTools: [
      ...READ_ONLY_TOOL_CATALOG.map((t) => t.id),
      STRUCTURED_OUTPUT_INTERNAL_TOOL,
      "synthetic_probe_http",
    ],
  });
}
