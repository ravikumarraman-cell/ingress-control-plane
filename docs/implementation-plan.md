# Detailed Phased Implementation Plan (v1, v2, v3)
## Governed Multi-Agent Networking Ingress Control Plane

**Document Location:** `docs/implementation-plan.md`  
**Companion Architecture Spec:** `docs/architecture-spec.md`  
**Target Stack:** Google ADK (Python 3.12+), FastAPI + SSE, PostgreSQL (Cloud SQL / AlloyDB), TypeScript + React + TanStack (Router, Query, Table), Kubernetes Gateway API / Cloud Load Balancers / WAF / Managed TLS.

---

## 1. Cross-Phase Engineering Principles & Non-Negotiables

Every milestone across `v1`, `v2`, and `v3` must uphold four invariants:

1. **Control Plane Only:** Agents generate and validate declarative infrastructure artifacts asynchronously. LLM inference never sits in the live network data plane.
2. **Strict Read/Write Separation:** Discovery, policy evaluation, impact analysis, and dry-run validation run strictly under `sa-ingress-readonly`. Write tools belong exclusively to `ExecutionAgent` under `sa-ingress-executor` and remain locked until a signed human `ApprovalDecision` is verified.
3. **Anti-Drift State Locking (TOCTOU Protection):** Every `ChangePlan` binds to a canonical SHA-256 `target_state_etag` and `plan_digest_sha256`. Any out-of-band infrastructure mutation invalidates the proposal prior to execution.
4. **Deterministic Rollbacks:** `RollbackPlan` artifacts are computed from live prior state and sealed *before* human approval—never improvised by an LLM during an active outage.

---

## 2. Phase v1 — Read-Only Advisory + TanStack Telemetry UI

**Objective:** Deliver full infrastructure discovery, compliance evaluation, collision/blast-radius analysis, declarative YAML/HCL diff synthesis, and live TanStack governance visibility with **zero automated write capability**.

### 2.1 Engineering Workstreams & Milestones

#### Milestone v1.1 — Foundation, Pydantic Contracts & PostgreSQL Ledger
* **Tasks:**
  1. Bootstrap Python 3.12+ FastAPI service with structured JSON logging and OpenTelemetry tracing.
  2. Implement immutable Pydantic v2 contracts (`IngressRequest`, `DiffHunk`, `RollbackPlan`, `ChangePlan`, `ApprovalDecision`, `AuditEvent`) with regex secret-rejection validators (`-----BEGIN ... PRIVATE KEY-----`, bearer/API key patterns) and external `prod` TLS 1.3 enforcement.
  3. Author Alembic migrations for `workflow_runs`, `change_plans`, `approval_decisions`, and `audit_events`, including the PostgreSQL `prevent_audit_mutation()` trigger blocking `UPDATE` and `DELETE`.
  4. Implement canonical SHA-256 hash-chaining (`prev_event_hash` -> `event_hash`) in the audit repository layer.
* **Deliverables:** `backend/schemas/contracts.py`, `backend/db/migrations/001_initial.sql`, `backend/repositories/audit_repo.py`.

#### Milestone v1.2 — Read-Only Google ADK Multi-Agent Pipeline
* **Tasks:**
  1. Provision `sa-ingress-readonly` IAM workload identity and Kubernetes `ClusterRole` restricted strictly to `get`, `list`, `watch`, and server-side `--dry-run`.
  2. Implement `IngressIntakeAgent` (`LlmAgent`, `tools=[]`, `before_model_callback` secret scanner) outputting validated `IngressRequest`.
  3. Implement `SupervisorAgent` (`LlmAgent`, `max_iterations=5`) coordinating workflow state transitions via ADK `session.state`.
  4. Implement `PhaseA_ParallelAnalysis` (`ParallelAgent`):
     * `DiscoveryInventoryAgent`: Queries K8s `HTTPRoute`/`Gateway`, Cloud LB, DNS zones, and Managed TLS certs; computes deterministic SHA-256 `state_etag` in Python.
     * `PolicyComplianceAgent`: Runs OPA/Rego policy checks (`CTRL-TLS-13`, `CTRL-WAF-EXT`, `CTRL-POOL-ISO`, `CTRL-CERT-NONWILDCARD`).
     * `ImpactAnalysisAgent`: Audits hostname/path-prefix collisions and backend endpoint health; computes `BlastRadiusScore` (`LOW` | `MEDIUM` | `HIGH`).
  5. Implement `PhaseB_SequentialPlanning` (`SequentialAgent`):
     * `ChangePlanningAgent`: Synthesizes Gateway API `HTTPRoute` YAML, Terraform HCL, and line-by-line `DiffHunk` artifacts.
     * `ValidationRollbackAgent`: Executes read-only API `--dry-run` checks and deterministically constructs `RollbackPlan` from `TopologySnapshot`.
* **Deliverables:** `backend/agents/intake.py`, `backend/agents/phase_a_parallel.py`, `backend/agents/phase_b_sequential.py`, `backend/tools/readonly_infra.py`.

#### Milestone v1.3 — Deterministic ETag & Diff Engine
* **Tasks:**
  1. Build canonical JSON/YAML normalizer stripping volatile cluster timestamps/resourceVersions before SHA-256 hashing.
  2. Build unified diff generator producing `linesAdded`, `linesRemoved`, and `plan_digest_sha256`.
  3. Implement `GET /api/v1/routes` returning active ingress inventory and live `state_etag`.
* **Deliverables:** `backend/services/etag.py`, `backend/services/diff_engine.py`.

#### Milestone v1.4 — FastAPI SSE Bridge & TanStack Control Plane UI
* **Tasks:**
  1. Implement authenticated FastAPI SSE broadcaster (`GET /api/v1/workflows/events`) with `Last-Event-ID` replay support.
  2. Initialize React + TypeScript application with **TanStack Router** (`/workflows`, `/workflows/$workflowId`, `/approvals`, `/audit-log`, `/architecture`).
  3. Wire **TanStack Query** SSE cache patching (`setQueryData` + selective `invalidateQueries`).
  4. Build **TanStack Table** views for Workflows Queue, Active Ingress Routes, Policy Matrix, and Audit Log.
  5. Build Diff & Governance Inspector with side-by-side YAML/HCL diffs, `BlastRadiusScore` indicator, `state_etag` display, and *Advisory Export* download (write approval buttons disabled in v1).
* **Deliverables:** `backend/api/sse.py`, `src/router.tsx`, `src/pages/WorkflowsPage.tsx`, `src/pages/WorkflowDetailPage.tsx`, `src/pages/AuditLogPage.tsx`.

### 2.2 v1 Validation & Testing Gates

| Gate ID | Verification Test | Pass Criteria |
| :--- | :--- | :--- |
| `V1-SEC-01` | Secret & Key Rejection Suite | `IngressRequest` returns `422` for PEM private keys, API keys, and `tls_1_2_compat` on external `prod`. |
| `V1-IAM-01` | Read-Only Credential Penetration Test | Executing `PATCH`/`POST`/`DELETE` with `sa-ingress-readonly` against K8s and Cloud APIs fails with `403 Forbidden`. |
| `V1-DET-01` | ETag Determinism Test | 50 consecutive snapshots of unchanged cluster topology yield bit-identical `state_etag` hashes. |
| `V1-SSE-01` | SSE Reconnect & Cache Sync Test | Dropping and restoring SSE connection with `Last-Event-ID` reconciles TanStack Query caches with zero stale statuses. |

### 2.3 v1 Deployment Steps
1. Provision Cloud SQL PostgreSQL (private VPC IP) and run Alembic migration `001_initial.sql`.
2. Deploy FastAPI + ADK runtime to private Cloud Run / GKE with `sa-ingress-readonly` Workload Identity.
3. Deploy TanStack SPA behind corporate Identity-Aware Proxy (IAP / OIDC) with read/advisory permissions only.

---

## 3. Phase v2 — GitOps PR Execution + HITL Gate

**Objective:** Enable governed write execution via GitOps Pull Requests, strictly gated by an ADK HITL state interrupt, signed four-eyes human approval, and TOCTOU `state_etag` anti-drift verification.

### 3.1 Engineering Workstreams & Milestones

#### Milestone v2.1 — ADK HITL State Interrupt & PostgreSQL Checkpointing
* **Tasks:**
  1. Implement `DatabaseSessionService` persisting full ADK `InvocationContext` state into `workflow_runs.adk_checkpoint` when `SupervisorAgent` triggers an interrupt.
  2. Enforce mandatory `AWAITING_APPROVAL` halt for all `prod` workflows and any `HIGH` blast-radius change (configurable per environment).
  3. Emit `AWAITING_APPROVAL` SSE frames immediately upon checkpoint commit.
* **Deliverables:** `backend/adk/checkpoint_service.py`, `backend/agents/hitl_gate.py`.

#### Milestone v2.2 — Four-Eyes RBAC & Cryptographic Approval Signing
* **Tasks:**
  1. Enforce OIDC JWT role verification (`net-approver`, `platform-sre-lead`, `secops-admin`) on `POST /api/v1/workflows/{id}/decision`.
  2. Enforce **Four-Eyes Separation**: reject with `403 Forbidden` if `reviewer_id == workflow.requester_id` on `prod` or `HIGH` blast-radius plans.
  3. Mint KMS / HMAC-SHA256 `ApprovalDecision.signature` binding `(workflow_id, plan_id, approved_state_etag, approved_plan_digest, reviewer_id)`.
  4. Build TanStack `/approvals` inbox and RBAC Approve/Reject modal requiring rationale ≥ 12 characters with optimistic `useMutation` rollback on `403`/`409`.
* **Deliverables:** `backend/security/approval_signer.py`, `src/pages/ApprovalsPage.tsx`.

#### Milestone v2.3 — Scoped `ExecutionAgent` (GitOps PR Only) & TOCTOU Gate
* **Tasks:**
  1. Provision `ExecutionAgent` with a single scoped write tool: `create_gitops_pr` (bot credential restricted to `ingress-configs` PR branches; direct push to `main` blocked).
  2. Implement `before_tool_callback` pre-flight gate verifying:
     * Valid `ApprovalDecision` exists and signature verifies against KMS public key / HMAC secret.
     * `approved_plan_digest == validated_change_plan.plan_digest_sha256`.
     * Live `compute_live_state_etag() == approved_state_etag`.
  3. On ETag mismatch, transition workflow to `DRIFT_ABORTED`, record `DRIFT_DETECTED` audit event, emit SSE alert, and expose **Re-Plan Against Live ETag** in TanStack UI.
* **Deliverables:** `backend/agents/execution.py`, `backend/tools/gitops_pr.py`.

### 3.2 v2 Validation & Testing Gates

| Gate ID | Verification Test | Pass Criteria |
| :--- | :--- | :--- |
| `V2-DRIFT-01` | TOCTOU Chaos Injection Test | Mutating a live `HTTPRoute` annotation while workflow sits in `AWAITING_APPROVAL` causes `ExecutionAgent` to abort with `409 Conflict` (`DRIFT_ABORTED`) and create zero PRs. |
| `V2-TAMPER-01` | Artifact Digest Tamper Test | Altering 1 byte in `change_plans.artifacts` post-approval causes `before_tool_callback` to halt execution with `SIGNATURE_INVALID`. |
| `V2-RBAC-01` | Four-Eyes Self-Approval Test | Requester attempting to approve their own `prod` or `HIGH` workflow receives `403 Forbidden` and logs `FOUR_EYES_VIOLATION`. |
| `V2-DUR-01` | Checkpoint Recovery Test | Restarting FastAPI/ADK pods while 10 workflows sit in `AWAITING_APPROVAL` resumes cleanly without state loss. |

### 3.3 v2 Deployment Steps
1. Provision Cloud KMS asymmetric signing key (`INGRESS_APPROVAL_KEY`) and GitOps bot token in Secret Manager; grant signing access exclusively to FastAPI bridge (agents receive verify-only access).
2. Enable ArgoCD/Flux/Atlantis GitOps reconciler with branch protection requiring CI schema checks + signed `ApprovalDecision` trailer.
3. Roll out v2 behind environment feature flags: `dev` (Week 1) -> `staging` (Week 2) -> `prod` (Week 3).

---

## 4. Phase v3 — Direct Gated Execution + Automated Canary Rollback

**Objective:** Enable direct scoped API execution (`apply_gated_ingress_patch`) with progressive traffic shifting, multi-vantage synthetic health probes, and sub-minute deterministic rollbacks with zero LLM latency.

### 4.1 Engineering Workstreams & Milestones

#### Milestone v3.1 — Scoped Executor Workload Identity (`sa-ingress-executor`)
* **Tasks:**
  1. Provision `sa-ingress-executor` with namespace-scoped write RBAC limited strictly to `HTTPRoute`, `Gateway`, `WAFPolicy`, and `ManagedCertificate` patches (explicitly denying `Secret`, `RBAC`, and `IAM` mutations).
  2. Gate credential exchange so `ExecutionAgent` activates short-lived execution credentials only after `before_tool_callback` validates `ApprovalDecision` + `live_state_etag`.
* **Deliverables:** `infra/iam/sa_ingress_executor.tf`, `infra/k8s/executor_rbac.yaml`.

#### Milestone v3.2 — Progressive Canary Shifting & Synthetic Probe Suite
* **Tasks:**
  1. Extend `ChangePlanningAgent` and `ExecutionAgent` to generate staged Gateway API `backendRefs` weight steps (`10% -> 50% -> 100%`) or weighted DNS records.
  2. Implement `run_synthetic_probe` executing from internal VPC and external vantage points:
     * DNS A/AAAA resolution check
     * TLS 1.3 handshake + ALPN `h2` + exact SAN verification
     * HTTP status / latency SLA check (`/healthz` and target path)
     * WAF enforcement probe (verifying synthetic SQLi/XSS test vector returns `403`)
* **Deliverables:** `backend/tools/canary_patch.py`, `backend/tools/synthetic_probe.py`.

#### Milestone v3.3 — Sub-Minute Deterministic Auto-Rollback & Audit Verifier
* **Tasks:**
  1. Wire any `run_synthetic_probe` failure to invoke `execute_deterministic_rollback()` directly in Python using `RollbackPlan.precomputed_artifacts`—completely bypassing LLM inference.
  2. Enforce `max_rollback_seconds <= 60` SLA, record `ROLLBACK_TRIGGERED` to `audit_events`, and push `ROLLED_BACK` SSE alert to TanStack UI and PagerDuty/Slack webhooks.
  3. Build continuous audit verifier endpoint (`GET /api/v1/audit-log/verify`) walking `seq_no = 1..N` to attest cryptographic hash-chain continuity.
* **Deliverables:** `backend/services/rollback_executor.py`, `backend/services/audit_verifier.py`, `backend/integrations/alerting.py`.

### 4.2 v3 Validation & Testing Gates

| Gate ID | Verification Test | Pass Criteria |
| :--- | :--- | :--- |
| `V3-CHAOS-01` | Canary `503` Failure Injection | Deploying a misconfigured backend returning HTTP `503` at 10% canary traffic triggers `run_synthetic_probe` failure and restores prior live manifest in `< 60s` with `0` LLM calls. |
| `V3-AUDIT-01` | Ledger Immutability & Chain Test | Hash-chain verifier passes across `seq_no 1..N`; direct SQL `UPDATE`/`DELETE` on `audit_events` fails via trigger. |
| `V3-CONC-01` | Concurrent Hostname Contention Test | Two simultaneously approved workflows targeting the same hostname allow only the first to commit; the second aborts cleanly with `DRIFT_ABORTED`. |
| `V3-SLO-01` | End-to-End Canary Soak Test | 14-day `staging` soak achieving 100% deterministic rollback on injected faults and 0 unauthorized mutations. |

### 4.3 v3 Production Cutover & Operational SLOs
* **Staging Soak:** Run v3 in `staging` for 14 days with automated chaos probe drills twice weekly.
* **Production Enablement:** Enable `direct_canary_v3` per application tier (`Tier-2` -> `Tier-1`), keeping `gitops_pr_v2` as fallback mode.
* **Target Operational SLOs:**
  * Rollback completion time (`probe_fail` -> `prior_state_restored`): **≤ 60 seconds (p99)**
  * TOCTOU ETag drift false-negative rate: **0%**
  * Audit hash-chain integrity: **100% continuous verification**
