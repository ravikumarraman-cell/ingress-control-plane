import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import {
  ExecutionModeSchema,
  IngressRequestSchema,
  type WorkflowRun,
} from "./src/shared/contracts.ts";
import {
  createAndPlanWorkflow,
  parseNaturalLanguageIngressRequest,
  processApprovalAndExecute,
} from "./server/agents.ts";
import { store, verifyAuditChain } from "./server/store.ts";

dotenv.config();

const app = express();
app.use(express.json({ limit: "1mb" }));

// SSE Client Registry
type SseClient = { id: string; res: Response };
const sseClients = new Set<SseClient>();
let sseEventCounter = 0;

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

const CreateWorkflowBodySchema = z.discriminatedUnion("intakeMode", [
  z.object({
    intakeMode: z.literal("ai"),
    naturalLanguagePrompt: z.string().min(10).max(2000),
    ticketRef: z.string().max(64).nullable().optional(),
    executionMode: ExecutionModeSchema.default("gitops_pr_v2"),
  }),
  z.object({
    intakeMode: z.literal("structured"),
    executionMode: ExecutionModeSchema.default("gitops_pr_v2"),
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

// Stored Architecture Specification Document
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

startServer();
