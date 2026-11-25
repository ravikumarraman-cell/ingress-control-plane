# Phase v1 Implementation Checklist

**Phase:** v1 — Read-Only Advisory + TanStack Telemetry UI  
**Last Updated:** 2026-11-24
**Next Review:** After v1.4 replay-resync browser validation and live-adapter decisions

---

## ✅ COMPLETED: Foundation & Contracts (v1.1)

### Core Infrastructure
- [x] Type system with Entity, Repository, UseCase, EventHandler, Logger interfaces
- [x] Result<T, E> type with Railway-Oriented Programming utilities
  - [x] ok(), err(), isOk(), isErr()
  - [x] mapResult(), flatMapResult(), allAsync(), tapAsync()
  - [x] Composable error handling with zero try-catch
- [x] Event Bus with publish/subscribe pattern
  - [x] Event history buffer (bounded 10k events)
  - [x] Async handler support
  - [x] Event type filtering
- [x] State Machine framework
  - [x] Declarative transition definitions
  - [x] Guard condition callbacks
  - [x] State history tracking
- [x] Logger implementation
  - [x] Hierarchical log levels
  - [x] Structured context fields
  - [x] Correlation ID support
  - [x] NoOp logger for testing

### Repository Pattern
- [x] BaseRepository<T> abstract CRUD template
- [x] InMemoryRepository reference implementation
- [x] CachedRepository with TTL eviction
- [x] WorkflowRepository with rich DSL
  - [x] findByStatus(), findByRequester(), findByEnvironment()
  - [x] query() with filtering, sorting, pagination
  - [x] findPendingApprovals(), findByApprovedRange()
  - [x] getMetrics() aggregation
- [x] AuditEventRepository (append-only)
  - [x] Hash-chained event ledger
  - [x] verifyIntegrity() with tamper detection
  - [x] Query by aggregateId, eventType, actor, timeRange
  - [x] getMetrics() for compliance reports

### Deterministic Hashing & Versioning
- [x] HashingService.computeSha256() with deterministic output
- [x] Canonical JSON normalization
  - [x] Strip volatile fields (resourceVersion, timestamps, uid)
  - [x] Sort object keys lexicographically
  - [x] Sort array elements for determinism
- [x] StateVersioningService for topology snapshots
- [x] DiffEngine with unified diff format
  - [x] Line-by-line comparison
  - [x] Hunk statistics (added/removed lines)
  - [x] Pre-computed diff digest

### Zod Contracts (v1.1)
- [x] IngressRequest schema
  - [x] Secret/PEM private key rejection
  - [x] Bearer token pattern blocking
  - [x] Email validation
  - [x] Hostname validation
  - [x] Port range enforcement (1–65535)
  - [x] TLS 1.3 enforcement for prod
- [x] ChangePlan schema with RiskAssessment
- [x] ApprovalDecision with 4-eyes RBAC roles
- [x] AuditEvent with hash-chain fields
- [x] Workflow aggregate with full state
- [x] CanaryStep, SyntheticProbeResult, StateSnapshot

### Use Cases (v1.1 partial)
- [x] CreateWorkflowUseCase
- [x] ComputeStateEtagUseCase (deterministic)
- [x] GenerateDiffUseCase
- [x] ComputeChangePlanDigestUseCase
- [x] ValidateApprovalSignatureUseCase
- [x] ListWorkflowsUseCase (with pagination)
- [x] GetWorkflowDetailsUseCase

### Resilience Patterns
- [x] CircuitBreaker with CLOSED/OPEN/HALF_OPEN states
  - [x] Configurable failure threshold
  - [x] Success threshold for recovery
  - [x] Timeout for reset attempts
- [x] RetryStrategy with exponential backoff
- [x] RateLimiter (token bucket algorithm)
- [x] Bulkhead for concurrency control

### Service Orchestration
- [x] V1ServiceOrchestrator with dependency injection
  - [x] Coordinates all v1 services
  - [x] Audit trail integration
  - [x] Logging at operation boundaries
  - [x] Exposes repositories for advanced queries

### Testing Infrastructure
- [x] Mock generators (mockIngressRequest, mockWorkflow, etc.)
- [x] Mock topology with resourceVersion
- [x] Test assertions for UUID and SHA-256 validation
- [x] Result type test suite
- [x] HashingService test suite
- [x] DiffEngine test suite

### Documentation
- [x] v1-implementation-artifact.md
  - [x] Architecture patterns applied
  - [x] Design pattern traceability
  - [x] Performance characteristics
  - [x] Production readiness checklist
  - [x] File structure guide
  - [x] SOLID principles alignment
- [x] This checklist

---

## ✅ IMPLEMENTED (SIMULATED): Multi-Agent Pipeline (v1.2)

**Runtime decision:** The application uses TypeScript `@strands-agents/sdk` and
`@strands-agents/harness`, not the Python Google ADK runtime named in the original
plan. The pipeline is implemented and integration-tested against simulated local
infrastructure. This does not complete live IAM, cluster, cloud, or OPA integration.

### Agent orchestration and security
- [x] Native Strands Graph with intake → supervisor → Phase A fan-out → Phase B planning
- [x] Natural-language intake with Zod validation and secret/PEM rejection
- [x] Bounded supervisor revision loop and workflow/session state handling
- [x] Per-agent `ReadOnlyIsolationIntervention` with explicit read-only tool allowlists
- [x] Secret/TLS guardrails, steering, and HITL intervention wiring
- [x] Deterministic model fallback and invocation limits for offline execution

### Analysis and planning (local simulated state)
- [x] Route inventory, ETag lookup, and LB/DNS/TLS tool contracts
- [x] Built-in and dynamic policy evaluation in application code (not OPA/Rego)
- [x] Hostname/path collision checks and blast-radius scoring
- [x] HTTPRoute YAML, Terraform HCL, diff, plan digest, and rollback artifact generation
- [x] Workflow traces, session history, and Strands telemetry

### Still open before production
- [ ] Provision and verify `sa-ingress-readonly` Workload Identity + Kubernetes RBAC
- [ ] Connect live Gateway API, cloud LB, DNS, and managed-certificate adapters
- [ ] Integrate actual OPA/Rego evaluation and server-side Kubernetes/Terraform dry-run
- [ ] Add live backend health checks and verify real topology ETag stability
- [ ] Decide whether to retain the implemented Strands TypeScript runtime or migrate to the plan's Python Google ADK stack

### Verification
- [x] `npm test -- server/__tests__/strandsIntegration.test.ts` — 6 passed
- [x] `npm run lint` — passed

---

## 🟡 IN PROGRESS: ETag & Diff Engine (v1.3)

### Implemented
- [x] Canonical JSON normalization
- [x] Deterministic SHA-256 hashing
- [x] State ETag computation
- [x] Plan digest independent of artifact insertion order
- [x] Plan digest binds target ETag, change artifacts, and rollback artifacts
- [x] Active server ETag repeatability across 50 snapshots, ignoring `updatedAt`
- [x] Route-order independence without mutating caller-owned arrays
- [x] ETag changes when a meaningful route field changes
- [x] Active server diff aligns insertions/deletions and emits unified hunk ranges
- [x] Empty-document additions/deletions do not produce phantom lines
- [x] Bounded Myers line comparison with full-replacement fallback for large edit distances
- [x] Text-only diff contract rejects NUL-containing input with a typed error
- [x] Plan digest binding
- [x] State versioning service

### Remaining
- [x] Measure active diff performance on a 10MB topology (9,999,999 bytes, 100,000 lines, one changed line: 30.18 ms locally)
- [ ] Add merge-conflict detection if required by the active plan contract
- [ ] Exercise the active implementation against live HTTPRoute topology

The NUL check rejects a common binary marker; it does not identify arbitrary
binary data after a caller has decoded it into a string.
The timing is an initial local measurement, not a hard CI performance assertion.
The tests in `backend/__tests__/hashing-service.test.ts` cover the standalone
foundation only; `server/__tests__/store.test.ts` covers the active Express
implementation.

---

## 📝 TODO: SSE & TanStack UI (v1.4)

**Prototype implemented:** Production identity, durable shared storage, and native browser-level reconnect validation remain open.

### API Backend (implementation-plan target: FastAPI; current runtime: Express)
- [x] SSE broadcaster with 100-event in-memory `Last-Event-ID` replay
- [x] Resync notification for invalid, expired, or future event cursors
- [x] TanStack Query invalidation on live workflow updates and `resync_required` (client regression tests)
- [ ] Native browser SSE reconnect and replay cache synchronization
- [ ] Authentication middleware (OIDC/JWT)
- [ ] Request/response envelope with Zod validation
- [ ] Workflow command endpoints
  - [x] POST /api/v1/workflows (create)
  - [x] GET /api/v1/workflows?status=INTAKE (validated list filter)
  - [x] GET /api/v1/workflows/{id} (detail and missing-ID behavior)
  - [x] GET /api/v1/workflows/events (SSE stream, replay, and cursor recovery)
  - [x] POST /api/v1/workflows/{id}/decision (approve/reject lifecycle tested)
- [ ] Audit log endpoints
  - [x] GET /api/v1/audit-log (bounded optional pagination with page metadata)
  - [x] GET /api/v1/audit-log/verify (full-chain verification independent of page filters)

### TanStack UI
- [ ] TanStack Router
  - [ ] /workflows (queue)
  - [ ] /workflows/$workflowId (detail)
  - [ ] /approvals (inbox)
  - [ ] /audit-log (trail)
  - [ ] /architecture (overview)
- [ ] TanStack Query
  - [x] SSE resync cache invalidation (client unit test and browser smoke)
  - [ ] Optimistic mutations for approve/reject
  - [ ] Native Last-Event-ID reconnection recovery
- [ ] TanStack Table
  - [ ] Workflows grid
  - [ ] Active routes matrix
  - [ ] Policy compliance matrix
  - [x] Audit trail searchable, server-paginated table
- [ ] Governance Inspector
  - [ ] Side-by-side YAML/HCL diffs
  - [ ] BlastRadiusScore indicator
  - [ ] State ETag display
  - [ ] Advisory export (YAML/HCL bundle)
  - [ ] (v1) Advisory-only approval buttons

### Estimated LOC: 2,000+ (FastAPI, React, TanStack integration)

---

## 🔐 PHASE v2: GitOps + HITL (Pending v1 Completion)

### Milestone v2.1: HITL & Checkpointing
- [ ] DatabaseSessionService for ADK InvocationContext persistence
- [ ] Mandatory approval gate for prod workflows
- [ ] HIGH blast-radius escalation
- [ ] SSE AWAITING_APPROVAL alerts

### Milestone v2.2: Four-Eyes RBAC & Signing
- [ ] OIDC JWT role verification
- [ ] Separation-of-duties enforcement
- [ ] KMS/HMAC-SHA256 approval signatures
- [ ] /approvals inbox UI

### Milestone v2.3: Scoped Executor & TOCTOU
- [ ] ExecutionAgent with single write tool
- [ ] Pre-flight ETag consistency check
- [ ] Live topology validation
- [ ] Drift detection → DRIFT_ABORTED
- [ ] Re-Plan interactive loop

---

## ⚡ PHASE v3: Direct Canary + Auto-Rollback (Pending v2 Completion)

### Milestone v3.1: Executor Workload Identity
- [ ] sa-ingress-executor provisioning
- [ ] Namespace-scoped RBAC (HTTPRoute, Gateway, WAFPolicy only)
- [ ] Credential exchange gating

### Milestone v3.2: Progressive Canary
- [ ] Staged traffic shifting (10% → 50% → 100%)
- [ ] 4-vantage synthetic probes
  - [ ] DNS A/AAAA resolution
  - [ ] TLS 1.3 handshake + ALPN h2 + SAN verification
  - [ ] HTTP status/latency SLA
  - [ ] WAF enforcement (synthetic SQLi/XSS vectors)

### Milestone v3.3: Auto-Rollback & Audit
- [ ] Zero-LLM deterministic rollback
- [ ] Sub-60s execution SLA
- [ ] Audit hash-chain verifier
- [ ] PagerDuty/Slack webhooks

---

## 📊 Testing & Validation

### v2/v3 Portable Execution Gates
- [x] Recompute approval plan digest from the target ETag, change artifacts, and rollback artifacts before signing/execution
- [x] Reject a tampered plan with `403`, a `SIGNATURE_INVALID` audit event, and no route mutation
- [x] Verify same-process same-hostname contention allows only one workflow to mutate route state
- [x] Require approval and active/completed direct-canary state before manual rollback
- [x] Verify the active route is still owned by the workflow requesting rollback
- [x] Reject pending and superseded-workflow rollback requests with `409` and preserve route state
- [x] Verify live ETag and route ownership before canary promotion or rollback
- [x] Abort drifted canary mutations with `409`, `DRIFT_ABORTED`, audit event, and no route mutation
- [x] Revalidate HMAC approval and change/rollback artifact digests before each canary mutation
- [x] Reject post-approval signature or artifact tampering with `403` and no route mutation
- [x] Reject malformed `simulateProbeFailure` values with `422` rather than triggering rollback
- [x] Require rollback reasons to be strings of at most 1000 characters; reject invalid input before mutation
- [x] Reject repeated rollback attempts after `ROLLED_BACK` with `409` and preserve route state
- [ ] Validate cross-process/instance concurrency with a durable transactional store

Verification: `npm test` passes 56 tests across nine files; `npm run lint`,
`npm run build`, and `git diff --check` pass. The concurrency test covers only
the in-memory single-process simulator, not production transaction guarantees.

### v1.1 Integration Tests (Priority: HIGH)
- [ ] Repository factory and lifecycle tests
- [ ] Audit hash-chain correctness verification
- [ ] Event bus concurrency and ordering
- [ ] State machine transition validation
- [ ] Result type composition chains
- [ ] Zod schema validation edge cases

### v1.3 Validation Gates
- [ ] V1-SEC-01: Secret & PEM rejection (100% pass rate)
- [x] V1-DET-01: Active simulator ETag is stable across 50 snapshots and route-order permutations
- [ ] (Pending v1.2) V1-IAM-01: sa-ingress-readonly write rejection (403)

### v1.4 Integration Tests
- [x] SSE replay/resync server integration test (`server/__tests__/sseReplay.test.ts`)
- [x] TanStack Query invalidation on live updates and `resync_required` (`src/lib/useWorkflowStream.test.ts`)
- [x] Browser smoke confirms stubbed `resync_required` refreshes workflow and route queries (1 → 4), and native EventSource ahead-cursor recovery on an isolated app refreshes workflows
- [ ] V1-SSE-01: Browser-generated `Last-Event-ID` reconnect/replay reconciles workflow and route caches
- [ ] Zod validation on API endpoints
- [ ] Approval modal 4-eyes validation

---

## 📋 Code Quality & Documentation

### Code Quality
- [ ] TypeScript strict mode: `strict: true`
- [ ] ESLint + Prettier configured
- [ ] Pre-commit hooks (lint, format, test)
- [ ] CI/CD pipeline with branch protection
- [ ] 85%+ test coverage (v1.1 core)

### Documentation
- [x] v1-implementation-artifact.md (design patterns, architecture)
- [ ] v1-api-reference.md (endpoint signatures, examples)
- [ ] v1-operator-guide.md (deployment, configuration)
- [ ] v1-troubleshooting.md (common issues, debug)
- [ ] README.md updated with v1 overview

### Type Safety
- [ ] No `any` types (replace with explicit unions)
- [ ] No implicit `any` parameter types
- [ ] All Zod schemas exported with type inference
- [ ] Generics used for maximum reusability

---

## 🎯 Completion Criteria

### v1 Ready for Production
1. ✅ v1.1 integration tests pass with ≥ 85% coverage
2. ✅ v1.2 agent pipeline fully integrated and tested
3. ✅ v1.3 determinism validation gates pass 100%
4. ✅ v1.4 SSE + TanStack UI deployed and E2E tested
5. ✅ Security audit: secret patterns, TOCTOU, audit integrity
6. ✅ Performance benchmarks: ETag < 100ms, Diffs < 500ms
7. ✅ Documentation complete and reviewed
8. ✅ Operational runbooks prepared (incident response, rollback)

### Next Phase Gate (v2 Approval)
1. v1 production deployment ≥ 7 days stable
2. Zero security incidents
3. Approval from NetOps, Security, Platform leadership
4. v2 scope agreement (GitOps, HITL, Four-Eyes)

---

## 🚀 Quick Reference

### Key Files
- Core: `backend/core/index.ts`
- Repositories: `backend/repositories/*.ts`
- Services: `backend/services/*.ts`
- Schemas: `backend/schemas/v1-contracts.ts`
- Tests: `backend/__tests__/*.test.ts`

### Key Commands (Once Setup Complete)
```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Type check
npm run lint

# Format code
npx prettier --write backend/

# Build
npm run build
```

### Design Pattern Checklist
- [x] Repository Pattern (generic CRUD)
- [x] Railway-Oriented Programming (Result type)
- [x] Event-Driven Architecture (EventBus)
- [x] State Machine (Workflow states)
- [x] Dependency Injection (Service orchestrator)
- [x] Adapter Pattern (Logger implementations)
- [x] Circuit Breaker (Resilience)
- [ ] Factory Pattern (Agent creation — v1.2)
- [ ] Decorator Pattern (Tool validation — v1.2)
- [ ] Hexagonal Architecture (Ports & Adapters — v1.4)

---

## 🔄 Status Summary

| Component | v1.1 | v1.2 | v1.3 | v1.4 | v2 | v3 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Core** | ✅ | 🔄 | ✅ | ⏳ | ⏳ | ⏳ |
| **Repo** | ✅ | ✅ | ✅ | ⏳ | 🔄 | ⏳ |
| **Logic** | ✅ | 🔄 | ✅ | ⏳ | 🔄 | ⏳ |
| **Tests** | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| **Docs** | ✅ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |

**Legend:** ✅ Done | 🔄 In Progress | ⏳ Pending | 📋 Planned

---

**Next Step:** Run v1.1 integration tests and update this checklist.
