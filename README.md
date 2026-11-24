# Governed Multi-Agent Networking Ingress Control Plane

> **Safe, human-approved automation for Kubernetes Gateway API & Cloud Edge Ingress.**  
> Turn plain-English or structured networking requests into policy-checked YAML/Terraform plans—complete with live cluster drift locks, four-eyes human sign-off, instant deterministic rollbacks, and a tamper-evident audit log.

---

For the proposed path from simulated workflows to certified AWS, Azure and
Google Cloud ingress integrations, see the
[Multi-Cloud Ingress Direction and Implementation Plan](docs/multi-cloud-ingress/plan.md).

**Current maturity:** This is a governance/simulation prototype, not a certified
production multi-cloud ingress platform. The research-backed
[Ingress Operating Core](docs/multi-cloud-ingress/core-architecture.md) explains
the proposed agent coordination, durable execution, conditional human approval
and real verification architecture. Its
[extension contract](docs/multi-cloud-ingress/extension-contract.md) and
[primary-source evidence](docs/multi-cloud-ingress/research.md) describe how to
extend it safely. These recommendations are not implemented or deployment-approved.

## Why This Project Exists (In Plain English)

Making networking or ingress changes in production (`HTTPRoute` rules, TLS certificates, WAF policies, canary weights) is famously risky. One wrong hostname, missing TLS rule, or stale change can take down customer traffic.

At the same time, giving an AI agent direct `kubectl apply` or Terraform write access is unsafe.

This project solves that problem by putting **specialized AI and deterministic safety agents** inside a **governed control plane**:

1. **Read-only agents inspect first** — They check live routes, enforce TLS 1.3 / WAF security rules, and calculate Blast Radius without any write permissions.
2. **Every plan includes an undo button before approval** — The system builds clean YAML/Terraform diffs *and* a pre-computed `RollbackPlan` before any human is asked to approve.
3. **Humans hold the keys** — Production and high-risk changes pause at a **Human-in-the-Loop (HITL) Gate** that requires a second reviewer (**Four-Eyes Rule**) and signs an HMAC approval token.
4. **Anti-drift protection (TOCTOU lock)** — If someone manually edits the cluster while a request was waiting for approval, execution **safely aborts** instead of overwriting newer changes.
5. **Instant zero-AI rollback** — If post-deploy health probes fail (`HTTP 503`), the system reverts immediately using the pre-computed `RollbackPlan` without waiting for AI inference.

---

## How the Agents Work Together

You can watch all of these agents collaborate **in real time** on the **`Agent Flow`** (`/agents`) page in the app!

```text
  [1. IngressIntakeAgent]          Validates form / parses plain English (Gemini) & blocks secrets
             │
             ▼
  [2. SupervisorAgent]             Coordinates phases, saves checkpoints, enforces loop bounds
             │
     ┌───────┼───────────────┐     Phase A: Runs all 3 concurrently (Read-Only credentials)
     ▼       ▼               ▼
[Discovery] [Policy]     [Impact]
Snapshots    Checks       Detects route
live routes  TLS 1.3,     collisions &
& pins ETag  WAF, certs   Blast Radius
     │       │               │
     └───────┼───────────────┘     Phase B: Sequential Plan & Safety Net
             ▼
  [ChangePlanningAgent]            Generates HTTPRoute YAML, Terraform HCL & line diffs
             │
             ▼
  [ValidationRollbackAgent]        Runs dry-run & seals deterministic RollbackPlan + SHA-256 digest
             │
             ▼
  [HITLApprovalGate]               Pauses for authorized human reviewer (Four-Eyes + HMAC sign-off)
             │
             ▼
  [ExecutionAgent]                 Re-verifies ETag (aborts on drift), opens PR / canary & runs probes
```

| Step | Agent | Access Scope | What It Does |
| :--- | :--- | :--- | :--- |
| **01** | `IngressIntakeAgent` | None | Validates inputs (or parses natural language via Gemini) and immediately blocks any accidental private keys or API secrets. |
| **02** | `SupervisorAgent` | Checkpoint Only | Acts as air-traffic controller: fans out Phase A checks, waits for completion, coordinates Phase B, and manages durable checkpoints. |
| **03A** | `DiscoveryInventoryAgent` | `sa-ingress-readonly` | Snapshots live cluster routes & gateways and pins a SHA-256 `target_state_etag` fingerprint. |
| **03B** | `PolicyComplianceAgent` | `sa-ingress-readonly` | Enforces security controls: strict TLS 1.3 on external prod, WAF attachment, IP pool isolation, and non-wildcard certs. |
| **03C** | `ImpactAnalysisAgent` | `sa-ingress-readonly` | Checks for hostname/path overlaps and assigns a `LOW`, `MEDIUM`, or `HIGH` Blast Radius score. |
| **04** | `ChangePlanningAgent` | Read-Only Synthesis | Generates Kubernetes Gateway API `HTTPRoute` YAML, Terraform HCL, and unified line-by-line diffs. |
| **05** | `ValidationRollbackAgent` | Read-Only Validation | Runs dry-run validation, computes `planDigestSha256`, and seals a pre-computed `RollbackPlan`. |
| **06** | `HITLApprovalGate` | RBAC + HMAC | Freezes execution until a second authorized operator approves (or rejects) with a signed rationale. |
| **07** | `ExecutionAgent` | Gated Scoped Write | Unlocks write tools *only* after verifying the HMAC signature and confirming live cluster ETag parity; opens a GitOps PR or runs a gated canary + health probes. |

---

## Quick Start (Run Locally)

### Prerequisites
- **Node.js 22.12+ (22.x), 24.x, or 26+**, matching the installed Vitest toolchain.
- **npm**

### 1. Install Dependencies
```bash
npm install
```

The project `.npmrc` selects the corporate Artifactory registry and sets
`replace-registry-host=npmjs` to avoid duplicating its path in tarball URLs.
This does not switch to the public npm registry.

Strands Harness 0.5.x and SDK 1.26.x require `@google/genai` 2.x.
SDK 1.26.x also requires Express 5.x when Express is installed; keep
`@types/express` on 5.x as well. Preserve these compatible ranges rather than
bypassing peer checks with `--force` or `--legacy-peer-deps`.

The project also sets `before=2026-11-20T00:00:00Z`, a fixed dependency-resolution
cutoff that avoids the newer releases rejected by corporate package-age policy.
It is a snapshot, not a rolling minimum-age check. Advance it only after
checking corporate curation approval and validating the resulting dependency tree.
JFrog still enforces all download policies.

If a previous install or lockfile already selected blocked newer versions, run
`npm update` once to re-resolve the tree within the declared ranges and this
cutoff, without deleting the lockfile. Subsequent installs can use `npm install`.

The project enforces Node engine requirements so unsupported versions cannot
silently omit native tooling. If Rolldown reports a missing native binding after
an install with an older Node version, switch to a supported Node runtime first,
then run `npm install --include=optional` and retry `npm test`. Do not add the
WASM fallback or delete the lockfile as a first step.

`npm test` uses isolated in-memory workflow and Strands session stores, so
parallel test suites do not read or overwrite local persisted workflow state.

### 2. Optional: Enable Natural-Language AI Intake
Structured ingress forms, the live multi-agent diagram, approvals, drift locking, and audit logging all work out of the box with zero API keys.

If you also want to use **Natural Language (Gemini)** mode inside the **New Ingress Request** modal, create a `.env` file (see `.env.example`):

```bash
GEMINI_API_KEY="your-gemini-api-key"
```

### 3. Start the Control Plane
```bash
npm run dev
```

Open **`http://localhost:3000`** in your browser. The Express API + Vite React UI both run on port `3000`, with live Server-Sent Events (SSE) connected automatically.

---

## How to Use the App (Step-by-Step Guide)

### 1. Explore the Live Multi-Agent Diagram (`/agents`)
- Click **Agent Flow** in the left sidebar.
- Pick any existing workflow from the dropdown—or click **Run Live Staging Demo** to dispatch a real workflow and watch the diagram update over SSE in real time.
- Click **Walk Through Step-by-Step** to replay how a request travels from Intake through Parallel Inspection, Sequential Planning, Human Gate, and Execution.
- Click **any agent card** on the canvas to read a plain-English explanation of what it receives, what security boundary protects it, what it outputs, and its live trace data.

### 2. Submit a New Ingress Change Request
- Click **New Ingress Request** in the top-right header.
- Choose **Structured Schema** (or **Natural Language (Gemini)** if `GEMINI_API_KEY` is configured).
- Pick an execution mode:
  - **v1 (`advisory_v1`)**: Read-only analysis and YAML/HCL diffs only.
  - **v2 (`gitops_pr_v2`)**: Pauses at the Human Gate, then opens a GitOps PR upon approval.
  - **v3 (`direct_canary_v3`)**: Pauses at the Human Gate, applies a canary rollout, and runs synthetic health probes with automatic rollback.
- Click **Submit Request** to open the workflow inspector.

### 3. Inspect Diffs, Policies & Approve with Four-Eyes RBAC (`/approvals`)
- Open a workflow with status **`AWAITING_APPROVAL`** (for example, `checkout-web`).
- Review the tabs:
  - **YAML / HCL Diffs**: Exact Kubernetes & Terraform line diffs.
  - **Deterministic RollbackPlan**: The pre-computed undo artifacts and health probes.
  - **Policy Matrix**: Pass/Block evidence for every security control.
  - **ADK Agent Pipeline**: Live interactive diagram + latency trace table.
- Try **Four-Eyes Separation**: Use the **Active Operator (RBAC)** switcher in the bottom-left sidebar to switch to the original requester (`Maya Lin`), and notice self-approval is blocked on `prod` / `HIGH` changes (`403`). Switch back to **Ravi Raman** (`net-approver`) to sign and execute.

### 4. Test Anti-Drift Locking (`Simulate Infra Drift`)
1. On **Workflows** or **Agent Flow**, click **Simulate Infra Drift**. This mutates a live route out-of-band and updates the cluster's `Live ETag`.
2. Try approving an older `AWAITING_APPROVAL` workflow whose plan pinned the previous ETag.
3. `ExecutionAgent` detects the mismatch and safely halts with **`DRIFT_ABORTED`** (`409 Conflict`).
4. Click **Re-Plan Against Live ETag** to generate a fresh plan anchored to the new cluster state.

### 5. Test Instant Auto-Rollback (`HTTP 503` Simulation)
1. Open a **`v3` (`direct_canary_v3`)** workflow waiting for approval.
2. Click **Approve & Execute**, check **Simulate synthetic probe failure (HTTP 503)**, enter a rationale (12+ chars), and submit.
3. Watch `ExecutionAgent` immediately execute the sealed `RollbackPlan` without any LLM call and transition the workflow to **`ROLLED_BACK`**.

### 6. Verify the Tamper-Evident Audit Log (`/audit-log`)
- Open **Audit Log** in the sidebar.
- Every intake, policy check, RBAC denial, ETag drift abort, approval signature, and rollback is linked in an append-only SHA-256 hash chain (`seq 1..N`).
- Click **Verify Hash Chain Integrity** to recompute and validate every link client-to-server.

### 7. Read Architecture Specs & Phased Roadmap (`/architecture`)
- Open **Architecture** in the sidebar to inspect rendered Mermaid system diagrams, Pydantic/SQL contracts, and edit/export `docs/architecture-spec.md` and `docs/implementation-plan.md`.

---

## Project Structure

```text
├── docs/
│   ├── architecture-spec.md        # Complete system & low-level design specification
│   ├── implementation-plan.md      # Detailed v1–v3 phased roadmap & validation gates
│   └── implementation-progress.md  # Live milestone completion & validation tracker
├── server/
│   ├── agents.ts                   # Multi-agent orchestration, policies, ETag & rollback logic
│   └── store.ts                    # Durable JSON persistence, HMAC signing & SHA-256 audit chain
├── server.ts                       # Express API + SSE stream + Vite dev/prod middleware (port 3000)
├── src/
│   ├── components/
│   │   ├── LiveAgentFlowDiagram.tsx # Interactive real-time agent diagram & step walkthrough
│   │   ├── WorkflowsTable.tsx       # TanStack Table workflows grid
│   │   ├── NewIngressModal.tsx      # Structured & Gemini natural-language intake modal
│   │   ├── layout/RootLayout.tsx    # Sidebar shell, RBAC switcher & SSE stream status
│   │   └── ui/StatusBadge.tsx       # Color-coded workflow state badges
│   ├── pages/
│   │   ├── WorkflowsPage.tsx        # Workflows queue & active cluster routes
│   │   ├── AgentFlowPage.tsx        # Live real-time multi-agent interaction canvas
│   │   ├── WorkflowDetailPage.tsx   # Diffs, RollbackPlan, policy matrix & approval gate
│   │   ├── ApprovalsPage.tsx        # Pending HITL approval queue
│   │   ├── AuditLogPage.tsx         # Append-only hash-chained audit trail & verifier
│   │   └── ArchitecturePage.tsx     # Interactive Mermaid diagrams & docs editor
│   ├── lib/
│   │   ├── api.ts                   # Typed fetch client & RBAC operator personas
│   │   ├── useWorkflowStream.ts     # Real-time SSE listener & React Query invalidation
│   │   └── mockData.ts              # Sample WorkflowRun dataset for WorkflowsTable
│   └── shared/contracts.ts          # Zod validation schemas & TypeScript contracts
└── package.json
```

---

## Available Scripts

| Command | Purpose |
| :--- | :--- |
| `npm run dev` | Start Express backend + Vite frontend on `http://localhost:3000` |
| `npm run build` | Build production frontend bundle (`dist/`) |
| `npm run start` | Run production server (`NODE_ENV=production node server.ts`) |
| `npm run lint` | Run TypeScript type-checking (`tsc --noEmit`) |

---

## Additional Documentation

- [System Architecture & Low-Level Design Specification](docs/architecture-spec.md)
- [Phased Implementation Plan (v1–v3)](docs/implementation-plan.md)
- [Implementation Progress Tracker](docs/implementation-progress.md)
