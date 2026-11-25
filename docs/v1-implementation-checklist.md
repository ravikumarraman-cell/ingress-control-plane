# Phase v1 Implementation Checklist

**Phase:** v1 — Read-Only Advisory + TanStack Telemetry UI  
**Last Updated:** 2026-11-24  
**Next Review:** After v1.1 integration tests complete  

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

## 🔄 IN PROGRESS: Multi-Agent Pipeline (v1.2)

### ADK Agent Framework
- [ ] BaseAgent abstract class with tool management
- [ ] IngressIntakeAgent
  - [ ] Gemini natural language processing
  - [ ] Request validation via Zod
  - [ ] Secret/PEM rejection callbacks
- [ ] SupervisorAgent
  - [ ] State machine for workflow transitions
  - [ ] Bounded feedback loop (max_iterations=5)
  - [ ] Session state checkpointing

### Phase A: Parallel Analysis
- [ ] DiscoveryInventoryAgent
  - [ ] K8s HTTPRoute lister
  - [ ] Gateway API introspection
  - [ ] Cloud LB inventory
  - [ ] Managed TLS cert auditor
  - [ ] Deterministic state_etag computation
- [ ] PolicyComplianceAgent
  - [ ] OPA/Rego engine integration
  - [ ] Built-in rules (CTRL-TLS-13, CTRL-WAF-EXT, CTRL-POOL-ISO, CTRL-CERT-NONWILDCARD)
  - [ ] Dynamic custom rules
- [ ] ImpactAnalysisAgent
  - [ ] Hostname collision detection
  - [ ] Path prefix collision detection
  - [ ] Backend health check audit
  - [ ] BlastRadiusScore computation

### Phase B: Sequential Planning
- [ ] ChangePlanningAgent
  - [ ] Gateway API HTTPRoute YAML synthesis
  - [ ] Terraform HCL generation
  - [ ] DiffHunk artifact creation
  - [ ] Plan digest computation
- [ ] ValidationRollbackAgent
  - [ ] Dry-run API checks (server-side)
  - [ ] RollbackPlan pre-computation
  - [ ] Rollback digest binding

### Tool Decorators
- [ ] @ReadOnlyValidator decorator for sa-ingress-readonly enforcement
- [ ] @SecretScanner decorator for PEM/API key rejection
- [ ] @TLSValidator decorator for TLS 1.3 enforcement

### Estimated LOC: 1,200–1,500 (leveraging v1.1)

---

## 🎯 TODO: ETag & Diff Engine (v1.3)

### Completed (90%)
- [x] Canonical JSON normalization
- [x] Deterministic SHA-256 hashing
- [x] State ETag computation
- [x] Unified diff generation
- [x] Plan digest binding
- [x] State versioning service

### Remaining (10%)
- [ ] Edge case tests (empty docs, 100MB+ files, binary diffs)
- [ ] Performance benchmarks (target < 100ms for 10MB topology)
- [ ] Diff merge conflict detection
- [ ] Optimal diff algorithm selection (Myers vs. Patience)

---

## 📝 TODO: FastAPI SSE & TanStack UI (v1.4)

**Blocked:** Requires v1.1 & v1.3 integration tests + v1.2 agent pipeline

### FastAPI Backend
- [ ] SSE broadcaster with Last-Event-ID replay buffer
- [ ] Authentication middleware (OIDC/JWT)
- [ ] Request/response envelope with Zod validation
- [ ] Workflow command endpoints
  - [ ] POST /api/v1/workflows (create)
  - [ ] GET /api/v1/workflows?status=INTAKE (list)
  - [ ] GET /api/v1/workflows/{id} (detail)
  - [ ] GET /api/v1/workflows/events (SSE stream)
  - [ ] POST /api/v1/workflows/{id}/decision (approve/reject)
- [ ] Audit log endpoints
  - [ ] GET /api/v1/audit-log (paginated)
  - [ ] GET /api/v1/audit-log/verify (chain verification)

### TanStack UI
- [ ] TanStack Router
  - [ ] /workflows (queue)
  - [ ] /workflows/$workflowId (detail)
  - [ ] /approvals (inbox)
  - [ ] /audit-log (trail)
  - [ ] /architecture (overview)
- [ ] TanStack Query
  - [ ] SSE event cache synchronization
  - [ ] Optimistic mutations for approve/reject
  - [ ] Automatic reconnection recovery
- [ ] TanStack Table
  - [ ] Workflows grid
  - [ ] Active routes matrix
  - [ ] Policy compliance matrix
  - [ ] Audit trail searchable table
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

### v1.1 Integration Tests (Priority: HIGH)
- [ ] Repository factory and lifecycle tests
- [ ] Audit hash-chain correctness verification
- [ ] Event bus concurrency and ordering
- [ ] State machine transition validation
- [ ] Result type composition chains
- [ ] Zod schema validation edge cases

### v1.3 Validation Gates
- [ ] V1-SEC-01: Secret & PEM rejection (100% pass rate)
- [ ] V1-DET-01: ETag determinism (50 consecutive runs bit-identical)
- [ ] V1-SSE-01: SSE Last-Event-ID replay + cache sync
- [ ] (Pending v1.2) V1-IAM-01: sa-ingress-readonly write rejection (403)

### v1.4 Integration Tests
- [ ] SSE reconnect with event replay buffer
- [ ] TanStack Query cache invalidation on SSE events
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
