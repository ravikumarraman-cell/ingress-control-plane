import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import {
  ConstrainedUseCaseSchema,
  CORE_AGENT_OUTPUT_FIELDS,
  CORE_AGENT_STAGE_MAP,
  CreateDynamicAgentBlueprintInputSchema,
  DnsProviderSchema,
  DnsRecordTypeSchema,
  ExecutionModeSchema,
  IngressRequestSchema,
  OnboardingAssessmentInputSchema,
  READ_ONLY_TOOL_CATALOG,
  type WorkflowRun,
} from "./src/shared/contracts.ts";
import {
  assignAgentToWorkflow,
  createAndPlanWorkflow,
  DagValidationError,
  executeManualRollback,
  parseNaturalLanguageIngressRequest,
  processApprovalAndExecute,
  promoteCanaryStep,
  reviseWorkflowWithAgentFeedback,
  runValidationGates,
  updateRolloutCompanionMilestone,
} from "./server/agents.ts";
import {
  assessOnboardingAndPreflight,
  diagnoseWorkflowFailure,
} from "./server/adoptionAgents.ts";
import { assertReadOnlyBlueprintSecurity } from "./server/dagEngine.ts";
import { store, verifyAuditChain } from "./server/store.ts";

dotenv.config();

// SSE Client Registry + Last-Event-ID Replay Buffer (V1-SSE-01)
type SseClient = { id: string; res: Response };
type BufferedSseEvent = { id: number; payload: string };
const sseClients = new Set<SseClient>();
const sseHistory: BufferedSseEvent[] = [];
let sseEventCounter = 0;

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

function broadcastWorkflowEvent(eventType: string, workflow: WorkflowRun): void {
  sseEventCounter += 1;
  const payload = JSON.stringify({
    eventType,
    workflowId: workflow.workflowId,
    status: workflow.status,
    currentStateEtag: workflow.currentStateEtag,
    liveStateEtag: store.getLiveEtag(),
    updatedAt: workflow.updatedAt,
  });
  sseHistory.push({ id: sseEventCounter, payload });
  if (sseHistory.length > 100) sseHistory.shift();

  for (const client of sseClients) {
    client.res.write(`id: ${sseEventCounter}\n`);
    client.res.write(`event: workflow_update\n`);
    client.res.write(`data: ${payload}\n\n`);
  }
}

function getOperatorFromHeaders(req: Request): {
  operatorId: string;
  roles: string[];
} {
  const rawId = req.header("x-operator-id");
  const rawRoles = req.header("x-operator-roles");
  const operatorId =
    rawId && rawId.trim().length >= 3 ? rawId.trim() : "ravikumar.raman@gmail.com";
  const roles = rawRoles
    ? rawRoles
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean)
    : ["net-approver", "platform-sre-lead"];
  return { operatorId, roles };
}

// SSE Event Stream
app.get("/api/v1/workflows/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const client: SseClient = { id: crypto.randomUUID(), res };
  sseClients.add(client);

  res.write(
    `event: connected\ndata: ${JSON.stringify({ liveStateEtag: store.getLiveEtag() })}\n\n`
  );

  const lastIdRaw = req.header("last-event-id");
  const lastId = lastIdRaw ? Number.parseInt(lastIdRaw, 10) : NaN;
  if (Number.isFinite(lastId)) {
    for (const ev of sseHistory) {
      if (ev.id > lastId) {
        res.write(`id: ${ev.id}\n`);
        res.write(`event: workflow_update\n`);
        res.write(`data: ${ev.payload}\n\n`);
      }
    }
  }

  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 25_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
  });
});

// Control Plane Overview & Routes
app.get("/api/v1/routes", (_req: Request, res: Response) => {
  const state = store.getState();
  res.json({
    liveStateEtag: store.getLiveEtag(),
    driftCounter: state.driftCounter,
    routes: state.routes,
  });
});

// Simulate Out-of-Band Infrastructure Drift (TOCTOU test harness)
app.post("/api/v1/infra/simulate-drift", (req: Request, res: Response) => {
  const { operatorId } = getOperatorFromHeaders(req);
  const state = store.getState();
  state.driftCounter += 1;
  const targetRoute = state.routes[1] ?? state.routes[0];
  if (targetRoute) {
    targetRoute.revisionNote = `out-of-band-hotfix-${state.driftCounter}`;
    targetRoute.updatedAt = new Date().toISOString();
  }
  const newEtag = store.getLiveEtag();
  store.addAuditEvent({
    workflowId: state.workflows[0]?.workflowId ?? crypto.randomUUID(),
    actorId: operatorId,
    actorType: "SYSTEM",
    eventType: "OUT_OF_BAND_INFRA_MUTATION",
    payload: {
      routeId: targetRoute?.routeId,
      revisionNote: targetRoute?.revisionNote,
      newLiveStateEtag: newEtag,
    },
  });
  store.commit();

  if (state.workflows[0]) {
    broadcastWorkflowEvent("INFRA_DRIFT", state.workflows[0]);
  }
  res.json({ liveStateEtag: newEtag, driftCounter: state.driftCounter, route: targetRoute });
});

// List Workflows
app.get("/api/v1/workflows", (_req: Request, res: Response) => {
  const state = store.getState();
  res.json({
    liveStateEtag: store.getLiveEtag(),
    workflows: state.workflows,
  });
});

// Get Workflow Detail
app.get("/api/v1/workflows/:workflowId", (req: Request, res: Response) => {
  const state = store.getState();
  const wf = state.workflows.find((w) => w.workflowId === req.params.workflowId);
  if (!wf) {
    res.status(404).json({ error: "Workflow not found." });
    return;
  }
  res.json({
    liveStateEtag: store.getLiveEtag(),
    workflow: wf,
  });
});

const PipelineConfigSchema = z
  .object({
    hitlPolicy: z.enum(["always", "prod_or_high", "auto_low_risk"]).optional(),
    enabledAgents: z.array(z.string()).optional(),
    customAgents: z
      .array(
        z.object({
          agentName: z.string().min(2).max(64),
          instruction: z.string().min(4).max(300),
          accessMode: z.enum(["READ_ONLY", "NONE"]).default("READ_ONLY"),
        })
      )
      .optional(),
    canarySteps: z.array(z.number().int().min(1).max(100)).optional(),
    maxSupervisorIterations: z.number().int().min(1).max(10).optional(),
    customInstructions: z.string().max(500).optional(),
  })
  .optional();

const CreateWorkflowBodySchema = z.discriminatedUnion("intakeMode", [
  z.object({
    intakeMode: z.literal("ai"),
    naturalLanguagePrompt: z.string().min(10).max(2000),
    ticketRef: z.string().max(64).nullable().optional(),
    executionMode: ExecutionModeSchema.default("gitops_pr_v2"),
    pipelineConfig: PipelineConfigSchema,
  }),
  z.object({
    intakeMode: z.literal("structured"),
    executionMode: ExecutionModeSchema.default("gitops_pr_v2"),
    pipelineConfig: PipelineConfigSchema,
    request: z.object({
      ticketRef: z.string().max(64).nullable().optional(),
      appName: z.string(),
      environment: z.enum(["dev", "staging", "prod"]),
      hostname: z.string(),
      pathPrefix: z.string(),
      backendService: z.string(),
      backendPort: z.number().int(),
      exposure: z.enum(["internal", "external"]),
      tlsProfile: z.enum(["tls_1_3_strict", "tls_1_2_compat", "mtls_internal"]),
      rawJustification: z.string(),
      dnsProvider: DnsProviderSchema.optional(),
      dnsRecordType: DnsRecordTypeSchema.optional(),
      healthCheckPath: z.string().max(120).optional(),
      originCertReady: z.boolean().optional(),
      cloudflareAllowlisted: z.boolean().optional(),
      useCaseFlags: z.array(ConstrainedUseCaseSchema).optional(),
    }),
  }),
]);

// Create Workflow (Intake -> Phase A Parallel -> Phase B Sequential -> HITL Interrupt)
app.post("/api/v1/workflows", async (req: Request, res: Response) => {
  const { operatorId } = getOperatorFromHeaders(req);
  const parsedBody = CreateWorkflowBodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(422).json({
      error: parsedBody.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    });
    return;
  }

  try {
    let ingressRequest;
    if (parsedBody.data.intakeMode === "ai") {
      ingressRequest = await parseNaturalLanguageIngressRequest({
        naturalLanguagePrompt: parsedBody.data.naturalLanguagePrompt,
        requesterId: operatorId,
        ticketRef: parsedBody.data.ticketRef ?? null,
      });
    } else {
      const validated = IngressRequestSchema.safeParse({
        requestId: crypto.randomUUID(),
        requesterId: operatorId,
        ...parsedBody.data.request,
      });
      if (!validated.success) {
        res.status(422).json({
          error: validated.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        });
        return;
      }
      ingressRequest = validated.data;
    }

    const workflow = await createAndPlanWorkflow({
      request: ingressRequest,
      executionMode: parsedBody.data.executionMode,
      pipelineConfig: parsedBody.data.pipelineConfig,
      onEvent: broadcastWorkflowEvent,
    });

    res.status(201).json({
      liveStateEtag: store.getLiveEtag(),
      workflow,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to process workflow intake.";
    res.status(400).json({ error: message });
  }
});

// Re-Plan Drifted or Rejected Workflow against current Live ETag
app.post("/api/v1/workflows/:workflowId/replan", async (req: Request, res: Response) => {
  const state = store.getState();
  const existing = state.workflows.find((w) => w.workflowId === req.params.workflowId);
  if (!existing) {
    res.status(404).json({ error: "Workflow not found." });
    return;
  }
  try {
    const replanned = await createAndPlanWorkflow({
      request: {
        ...existing.ingressRequest,
        requestId: crypto.randomUUID(),
      },
      executionMode: existing.executionMode,
      pipelineConfig: existing.pipelineConfig,
      onEvent: broadcastWorkflowEvent,
    });
    res.status(201).json({
      liveStateEtag: store.getLiveEtag(),
      workflow: replanned,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Re-plan failed.";
    res.status(400).json({ error: message });
  }
});

// Flexible Supervisor Revision Loop (Re-run agents with operator feedback)
const ReviseBodySchema = z.object({
  feedbackInstruction: z.string().min(4).max(500),
  pipelineConfig: PipelineConfigSchema,
  patchRequest: z
    .object({
      backendPort: z.number().int().min(1).max(65535).optional(),
      backendService: z.string().optional(),
      tlsProfile: z.enum(["tls_1_3_strict", "tls_1_2_compat", "mtls_internal"]).optional(),
      pathPrefix: z.string().optional(),
    })
    .optional(),
});

app.post("/api/v1/workflows/:workflowId/revise", async (req: Request, res: Response) => {
  const { operatorId } = getOperatorFromHeaders(req);
  const parsed = ReviseBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  try {
    const revised = await reviseWorkflowWithAgentFeedback({
      workflowId: req.params.workflowId,
      actorId: operatorId,
      feedbackInstruction: parsed.data.feedbackInstruction,
      pipelineConfig: parsed.data.pipelineConfig,
      patchRequest: parsed.data.patchRequest,
      onEvent: broadcastWorkflowEvent,
    });
    res.json({
      liveStateEtag: store.getLiveEtag(),
      workflow: revised,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to revise workflow.";
    res.status(400).json({ error: message });
  }
});

// Promote Progressive Canary Stage (v3)
app.post("/api/v1/workflows/:workflowId/canary/promote", (req: Request, res: Response) => {
  const { operatorId } = getOperatorFromHeaders(req);
  const simulateFailure = Boolean(req.body?.simulateProbeFailure);
  try {
    const updated = promoteCanaryStep({
      workflowId: req.params.workflowId,
      actorId: operatorId,
      simulateProbeFailure: simulateFailure,
      onEvent: broadcastWorkflowEvent,
    });
    res.json({
      liveStateEtag: store.getLiveEtag(),
      workflow: updated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to promote canary.";
    res.status(400).json({ error: message });
  }
});

// Manual Instant Deterministic Rollback (v3)
app.post("/api/v1/workflows/:workflowId/rollback", (req: Request, res: Response) => {
  const { operatorId } = getOperatorFromHeaders(req);
  const reason =
    typeof req.body?.reason === "string" && req.body.reason.trim().length > 0
      ? req.body.reason.trim()
      : "Operator triggered instant deterministic rollback.";
  try {
    const updated = executeManualRollback({
      workflowId: req.params.workflowId,
      actorId: operatorId,
      reason,
      onEvent: broadcastWorkflowEvent,
    });
    res.json({
      liveStateEtag: store.getLiveEtag(),
      workflow: updated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to trigger rollback.";
    res.status(400).json({ error: message });
  }
});

const DecisionBodySchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  rationale: z.string().min(12, "Reviewer rationale must be at least 12 characters.").max(1000),
  simulateProbeFailure: z.boolean().optional().default(false),
});

// Approve / Reject Workflow at HITL Gate
app.post("/api/v1/workflows/:workflowId/decision", (req: Request, res: Response) => {
  const { operatorId, roles } = getOperatorFromHeaders(req);
  const parsed = DecisionBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({
      error: parsed.error.issues.map((i) => i.message).join("; "),
    });
    return;
  }

  try {
    const result = processApprovalAndExecute({
      workflowId: req.params.workflowId,
      decision: parsed.data.decision,
      reviewerId: operatorId,
      reviewerRoles: roles,
      rationale: parsed.data.rationale,
      simulateProbeFailure: parsed.data.simulateProbeFailure,
      onEvent: broadcastWorkflowEvent,
    });
    res.status(result.httpStatus).json({
      liveStateEtag: store.getLiveEtag(),
      workflow: result.workflow,
      error: result.error ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to process approval.";
    res.status(404).json({ error: message });
  }
});

// Audit Log & Cryptographic Chain Verification
app.get("/api/v1/audit-log", (_req: Request, res: Response) => {
  const state = store.getState();
  const verification = verifyAuditChain(state.auditEvents);
  res.json({
    events: state.auditEvents.slice().reverse(),
    verification,
  });
});

app.get("/api/v1/audit-log/verify", (_req: Request, res: Response) => {
  const state = store.getState();
  res.json(verifyAuditChain(state.auditEvents));
});

// Dynamic Custom Policy Rules Registry
app.get("/api/v1/policies", (_req: Request, res: Response) => {
  res.json({ rules: store.getState().customPolicyRules });
});

const CreatePolicySchema = z.object({
  name: z.string().min(3).max(80),
  description: z.string().min(4).max(240),
  conditionType: z.enum([
    "require_ticket",
    "max_port",
    "allowed_domain_suffix",
    "enforce_waf_staging",
  ]),
  value: z.string().max(120),
  severity: z.enum(["WARN", "BLOCK"]),
});

app.post("/api/v1/policies", (req: Request, res: Response) => {
  const parsed = CreatePolicySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  const state = store.getState();
  const rule = {
    ruleId: `CUSTOM-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
    ...parsed.data,
    enabled: true,
  };
  state.customPolicyRules.push(rule);
  store.commit();
  res.status(201).json({ rule, rules: state.customPolicyRules });
});

app.patch("/api/v1/policies/:ruleId", (req: Request, res: Response) => {
  const state = store.getState();
  const rule = state.customPolicyRules.find((r) => r.ruleId === req.params.ruleId);
  if (!rule) {
    res.status(404).json({ error: "Policy rule not found." });
    return;
  }
  if (typeof req.body?.enabled === "boolean") {
    rule.enabled = req.body.enabled;
  }
  if (req.body?.severity === "WARN" || req.body?.severity === "BLOCK") {
    rule.severity = req.body.severity;
  }
  store.commit();
  res.json({ rule, rules: state.customPolicyRules });
});

app.delete("/api/v1/policies/:ruleId", (req: Request, res: Response) => {
  const state = store.getState();
  state.customPolicyRules = state.customPolicyRules.filter((r) => r.ruleId !== req.params.ruleId);
  store.commit();
  res.json({ rules: state.customPolicyRules });
});

// Live Validation Gate Runner
app.post("/api/v1/validation/run", (_req: Request, res: Response) => {
  const results = runValidationGates();
  res.json({ results });
});

// Stored Architecture Specification, Plan & Progress Documents
app.get("/api/v1/architecture", (_req: Request, res: Response) => {
  res.json(store.getArchitectureDoc());
});

const SaveArchSchema = z.object({
  markdown: z.string().min(50, "Architecture document cannot be empty."),
});

app.put("/api/v1/architecture", (req: Request, res: Response) => {
  const parsed = SaveArchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  const updated = store.saveArchitectureDoc(parsed.data.markdown);
  res.json(updated);
});

app.put("/api/v1/implementation-plan", (req: Request, res: Response) => {
  const parsed = SaveArchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  const updated = store.saveImplementationPlan(parsed.data.markdown);
  res.json(updated);
});

app.put("/api/v1/implementation-progress", (req: Request, res: Response) => {
  const parsed = SaveArchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  const updated = store.saveImplementationProgress(parsed.data.markdown);
  res.json(updated);
});

// Dynamic Agent Blueprints & Runtime Task Router Endpoints
app.get("/api/v1/agents/blueprints", (_req: Request, res: Response) => {
  res.json({
    blueprints: store.listBlueprints(),
    coreAgentCatalog: {
      stages: CORE_AGENT_STAGE_MAP,
      outputs: CORE_AGENT_OUTPUT_FIELDS,
    },
    readOnlyToolCatalog: READ_ONLY_TOOL_CATALOG,
  });
});

app.post("/api/v1/agents/blueprints", (req: Request, res: Response) => {
  try {
    // Check read-only & executor restrictions explicitly first so security errors return 400 with clear code
    if (req.body && typeof req.body === "object") {
      assertReadOnlyBlueprintSecurity({
        name: typeof req.body.name === "string" ? req.body.name : "CustomAgent",
        allowedTools: Array.isArray(req.body.allowedTools) ? req.body.allowedTools : [],
        serviceAccount:
          typeof req.body.serviceAccount === "string" ? req.body.serviceAccount : undefined,
      });
    }

    const parsed = CreateDynamicAgentBlueprintInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        code: "INVALID_BLUEPRINT_SCHEMA",
      });
      return;
    }

    const blueprint = store.createBlueprint(parsed.data);
    res.status(201).json({
      blueprint,
      blueprints: store.listBlueprints(),
    });
  } catch (err) {
    if (err instanceof DagValidationError) {
      res.status(400).json({ error: err.message, code: err.code });
      return;
    }
    const message = err instanceof Error ? err.message : "Failed to create agent blueprint.";
    res.status(400).json({ error: message });
  }
});

app.patch("/api/v1/agents/blueprints/:agentId", (req: Request, res: Response) => {
  try {
    if (req.body && typeof req.body === "object" && (req.body.allowedTools || req.body.serviceAccount)) {
      assertReadOnlyBlueprintSecurity({
        name: typeof req.body.name === "string" ? req.body.name : req.params.agentId,
        allowedTools: Array.isArray(req.body.allowedTools) ? req.body.allowedTools : [],
        serviceAccount:
          typeof req.body.serviceAccount === "string" ? req.body.serviceAccount : undefined,
      });
    }
    const updated = store.updateBlueprint(req.params.agentId, req.body ?? {});
    if (!updated) {
      res.status(404).json({ error: "Agent blueprint not found." });
      return;
    }
    res.json({
      blueprint: updated,
      blueprints: store.listBlueprints(),
    });
  } catch (err) {
    if (err instanceof DagValidationError) {
      res.status(400).json({ error: err.message, code: err.code });
      return;
    }
    const message = err instanceof Error ? err.message : "Failed to update agent blueprint.";
    res.status(400).json({ error: message });
  }
});

app.delete("/api/v1/agents/blueprints/:agentId", (req: Request, res: Response) => {
  const removed = store.deleteBlueprint(req.params.agentId);
  if (!removed) {
    res.status(404).json({ error: "Agent blueprint not found." });
    return;
  }
  res.json({
    deletedAgentId: req.params.agentId,
    blueprints: store.listBlueprints(),
  });
});

const AssignAgentBodySchema = z
  .object({
    blueprintId: z.string().min(1).optional(),
    adHocBlueprint: CreateDynamicAgentBlueprintInputSchema.optional(),
    saveToRoster: z.boolean().optional().default(false),
  })
  .refine((v) => Boolean(v.blueprintId || v.adHocBlueprint), {
    message: "Provide either blueprintId or adHocBlueprint.",
  });

app.post("/api/v1/workflows/:workflowId/assign-agent", async (req: Request, res: Response) => {
  const { operatorId } = getOperatorFromHeaders(req);
  try {
    if (req.body?.adHocBlueprint && typeof req.body.adHocBlueprint === "object") {
      assertReadOnlyBlueprintSecurity({
        name:
          typeof req.body.adHocBlueprint.name === "string"
            ? req.body.adHocBlueprint.name
            : "AdHocAgent",
        allowedTools: Array.isArray(req.body.adHocBlueprint.allowedTools)
          ? req.body.adHocBlueprint.allowedTools
          : [],
        serviceAccount:
          typeof req.body.adHocBlueprint.serviceAccount === "string"
            ? req.body.adHocBlueprint.serviceAccount
            : undefined,
      });
    }

    const parsed = AssignAgentBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        code: "INVALID_ASSIGN_REQUEST",
      });
      return;
    }

    let blueprintId = parsed.data.blueprintId;
    if (!blueprintId && parsed.data.adHocBlueprint && parsed.data.saveToRoster) {
      const created = store.createBlueprint(parsed.data.adHocBlueprint);
      blueprintId = created.agentId;
    }

    const workflow = await assignAgentToWorkflow({
      workflowId: req.params.workflowId,
      actorId: operatorId,
      blueprintId,
      adHocBlueprint: blueprintId ? undefined : parsed.data.adHocBlueprint,
      onEvent: broadcastWorkflowEvent,
    });

    res.json({
      liveStateEtag: store.getLiveEtag(),
      workflow,
    });
  } catch (err) {
    if (err instanceof DagValidationError) {
      res.status(400).json({ error: err.message, code: err.code });
      return;
    }
    const message = err instanceof Error ? err.message : "Failed to assign agent to workflow.";
    const status = message.toLowerCase().includes("not found") ? 404 : 400;
    res.status(status).json({ error: message });
  }
});

// Guided Onboarding, Pre-Flight Checker, Policy-Aware Starter Configs & Ticket Prefill
app.post("/api/v1/onboarding/assess", async (req: Request, res: Response) => {
  const parsed = OnboardingAssessmentInputSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(422).json({
      error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    });
    return;
  }
  try {
    const assessment = await assessOnboardingAndPreflight({
      input: parsed.data,
      existingRoutes: store.getState().routes,
    });
    res.json({ assessment });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Onboarding assessment failed.";
    res.status(400).json({ error: message });
  }
});

const TroubleshootBodySchema = z.object({
  errorText: z.string().max(4000).optional(),
  logs: z.string().max(4000).optional(),
  configDiff: z.string().max(4000).optional(),
});

// TroubleshootingAgent for specific workflow
app.post("/api/v1/workflows/:workflowId/troubleshoot", async (req: Request, res: Response) => {
  const state = store.getState();
  const workflow = state.workflows.find((w) => w.workflowId === req.params.workflowId);
  if (!workflow) {
    res.status(404).json({ error: "Workflow not found." });
    return;
  }
  const parsed = TroubleshootBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(422).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  const diagnosis = await diagnoseWorkflowFailure({
    workflow,
    errorText: parsed.data.errorText,
    logs: parsed.data.logs,
    configDiff: parsed.data.configDiff,
  });
  res.json({ diagnosis });
});

// Standalone TroubleshootingAgent for pasted error/logs/diffs
app.post("/api/v1/troubleshoot", async (req: Request, res: Response) => {
  const parsed = TroubleshootBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(422).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  const diagnosis = await diagnoseWorkflowFailure({
    workflow: null,
    errorText: parsed.data.errorText,
    logs: parsed.data.logs,
    configDiff: parsed.data.configDiff,
  });
  res.json({ diagnosis });
});

const RolloutStepBodySchema = z.object({
  stepId: z.enum([
    "PROVISIONING",
    "DNS_CUTOVER",
    "WAF_LOG_TUNING",
    "FALSE_POSITIVE_AUDIT",
    "WAF_BLOCK_MODE",
  ]),
  status: z.enum(["ACTIVE", "COMPLETED"]),
});

// Rollout Companion Agent milestone tracker (DNS Cutover + 7-21d WAF Log -> Block)
app.patch("/api/v1/workflows/:workflowId/rollout-step", (req: Request, res: Response) => {
  const { operatorId } = getOperatorFromHeaders(req);
  const parsed = RolloutStepBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(422).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  try {
    const workflow = updateRolloutCompanionMilestone({
      workflowId: req.params.workflowId,
      stepId: parsed.data.stepId,
      status: parsed.data.status,
      actorId: operatorId,
      onEvent: broadcastWorkflowEvent,
    });
    res.json({
      liveStateEtag: store.getLiveEtag(),
      workflow,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update rollout milestone.";
    const status = message.toLowerCase().includes("not found") ? 404 : 400;
    res.status(status).json({ error: message });
  }
});

return app;
}

const app = createApp();

async function startServer() {
  const port = 3000;
  const isProd = process.env.NODE_ENV === "production";

  if (!isProd) {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      const indexHtml = path.join(distDir, "index.html");
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send("Build output not found.");
      }
    });
  }

  app.listen(port, "0.0.0.0", () => {
    console.log(`Ingress Control Plane listening on http://0.0.0.0:${port}`);
  });
}

if (!process.env.VITEST) {
  startServer();
}
