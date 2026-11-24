# Multi-Cloud Ingress: Recommended Direction and Implementation Plan

**Date:** 2026-11-24  
**Status:** Proposed roadmap; not an approved deployment design or production-readiness certification.  
**Initial target scope:** AWS, Azure and Google Cloud, with explicitly selected and versioned ingress implementations.  
**Implementation approach:** Extend the current TypeScript/Express/React/Strands application, not a backend rewrite.

**Research-backed design inputs:** [Ingress Operating Core](core-architecture.md),
[governed extension contract](extension-contract.md) and
[primary-source evidence](research.md). These refine this roadmap; they do not
complete T002/T003's detailed schemas, owner decisions or design approval.

## 1. Executive Summary

The application demonstrates how ingress changes should be governed: intake,
parallel analysis, deterministic planning, human approval, drift protection,
staged execution and rollback. Its simulated values do not yet describe all
the infrastructure, lifecycle behavior or provider differences needed for a
production multi-cloud ingress platform.

The recommended direction is:

```text
Cloud-neutral ingress intent
             |
             v
Target and capability validation ---- unsupported/unknown --> explain and stop
             |
             v
Authoritative discovery and deterministic change plan
             |
             v
Policy authorization: pre-authorized action or required human approval
             |
             v
Provider/controller adapter + governed deployment
             |
             v
Observed-state reconciliation + real traffic verification
             |
        +----+----+
        |         |
        v         v
    Verified   Bounded rollback / operator recovery
```

Reuse the existing governance rules and agent experience. Introduce explicit
durable coordination and a small adapter boundary for infrastructure differences,
rather than a separate agent pipeline or full framework for each cloud. Agents
may explain and propose; deterministic code must authorize, validate and execute.

**Operating model:** Runtime agents own the ingress lifecycle end-to-end through
governed tools. They do not stop at recommendations or ask humans to run routine
deployment commands. Humans approve only where the authorization policy requires
it, resolve exceptions and set the limits under which automation may operate.
This document plans that runtime behavior; it does not authorize coding agents
to start implementing or provisioning the roadmap.

**Success means certified support for declared combinations, not "all CSPs."**
A cloud, controller, version, region, exposure mode, protocol and execution mode
must have evidence before it is advertised as supported.

## 2. Current State and Evidence

| Area | Evidence in the current repository | Consequence for this plan |
|---|---|---|
| Request model | [IngressRequestSchema](../../src/shared/contracts.ts) describes hostname, path, backend service/port, exposure, TLS and onboarding hints. | Add target identity and explicit requested behavior; do not infer a cloud from DNS names. |
| Discovery tools | [Strands tools](../../server/strands/tools.ts) largely read local state or derive answers from inputs. | Introduce authoritative observations with provenance, timestamps and failure states. |
| Artifact generation | [Agent orchestration](../../server/agents.ts) generates HTTPRoute artifacts and Google-specific certificate Terraform. | Separate cloud-neutral planning from controller/provider-specific compilation. |
| Execution | [Agent orchestration](../../server/agents.ts) constructs GitOps PR URLs, changes local route state and supplies simulated probe results. | Real PRs, reconciliation, traffic changes and probes are separate deliverables. |
| Persistence | [Workflow store](../../server/store.ts) uses JSON files outside tests; tests use isolated memory. | Production needs transactional persistence and coordination across replicas. |
| Runtime | [Strands integration guide](../strands-agents-integration.md) describes the current Express/Strands implementation. | Reuse the runtime; model-provider portability is not infrastructure-provider portability. |
| Historical design | [Architecture specification](../architecture-spec.md) and [implementation plan](../implementation-plan.md) contain governance principles and a Python/Google ADK target stack. | Preserve the principles, but do not treat their stack, progress percentages or SLO targets as implemented multi-cloud capabilities. |

The existing 24-test application baseline passed during the preceding repair.
It is a regression baseline, not evidence that real cloud infrastructure works.

## 3. Scope and Support Matrix

### 3.1 Initial baseline

Start with Kubernetes-backed HTTPS applications: explicit target identity,
exact hostname and path-prefix routing, service/port resolution, certificate
references, DNS prerequisites, policy checks, approved artifacts and real
health verification. Certify public and private exposure separately.

Prefer read-only advisory first, then GitOps execution. Direct API writes remain
disabled until their own approval, recovery and certification gates pass.
Use Gateway API where the selected implementation supports the required
semantics; a Kubernetes resource being accepted does not prove traffic works.

### 3.2 Candidate implementation profiles

These are candidates for Phase 0 evaluation, not verified support claims.
Pin exact controller, API and infrastructure-provider versions before coding
against them. Choose one profile per cloud for the initial release.

| Cloud | Candidate Kubernetes/controller profile | Related integration decisions |
|---|---|---|
| AWS | EKS with an approved AWS Load Balancer Controller/Gateway API combination, if its documented support meets the baseline. | Account/role/region, ALB/NLB selection, ACM certificate ownership, Route 53 or enterprise DNS, AWS WAF attachment point and target health. |
| Azure | AKS with an approved Application Gateway for Containers/ALB Controller profile. | Tenant/subscription/resource group/region, identity, frontend/subnet prerequisites, certificate source, DNS and supported WAF topology. |
| Google Cloud | GKE with an approved managed Gateway controller and GatewayClass. | Project/region, load-balancer class, certificate integration, Cloud DNS or enterprise DNS, Cloud Armor topology and backend health. |

If a candidate cannot satisfy mandatory controls, select a reviewed alternative
or mark that combination unsupported. Do not silently substitute a different
load balancer, protocol, exposure mode or security policy.

Each support-matrix row must record:

- Provider, product/controller and versions; region and cluster restrictions.
- Protocol, match/filter/backend behavior and public/private exposure.
- TLS termination and backend encryption; certificate and DNS ownership.
- WAF/authentication placement and network controls.
- Advisory, GitOps and direct execution eligibility.
- Limitations, evidence, owner, verification date and upgrade policy.
- Status: **proposed**, **verified-read-only**, **verified-gitops**,
  **verified-direct**, **unsupported** or **deferred**.

### 3.3 Expansion, not implied initial support

Add these only through new capability rows and evidence: gRPC, WebSockets,
TCP/UDP, HTTP/3, header/method matching, rewrites, redirects, multiple backends,
weighted routing, affinity, retries, timeouts, streaming and request-size limits;
IPv6/dual-stack; multi-region/multi-cluster routing; serverless/VM/API-management
backends; other clouds and on-premises environments.

Inventory relevant limits even when customization is deferred. For example, an
application exceeding a controller's idle timeout or body-size limit must be
rejected or explicitly re-scoped, not accepted as a generic HTTP application.

## 4. Recommended Architecture and Responsibilities

### 4.1 Intent, capabilities and authoritative state

The intent model must identify tenant, environment, provider, account/subscription/
project, region, cluster, namespace, gateway/controller, exposure and requested
traffic behavior. Reference certificates and credentials by approved identifiers;
never put secret material into prompts, plans, artifacts or browser payloads.

Capabilities must be evaluated against the actual controller/version, not a
single `supportsAws`-style flag. Distinguish unsupported, unknown, permission
denied, stale observation and quota exhaustion. None is equivalent to success.
Readiness should be based on resource conditions, relevant generations and
provider health, not just HTTP success from a create/update API.

Observations need source identity, resource IDs, version/concurrency tokens,
capture time and completeness. A partial discovery result cannot authorize a
write. Reuse cloud-neutral representations only where semantics genuinely match.

### 4.2 Minimal adapter boundary

Adapters are responsible for discovery, capability reporting, artifact
compilation, validation, execution/reconciliation and recovery evidence for their
declared profile. Shared Kubernetes behavior should be reused; provider-specific
identity, DNS, certificate, network and edge policy behavior must remain explicit.

Do not introduce a plugin marketplace, remote agent fleet or generic provider
framework before the initial profiles need one. Define the concrete contract in
Phase 0 and implement the smallest shared interface demonstrated by those profiles.

### 4.3 Agent interaction

| Existing role | Responsibility after expansion | Boundary |
|---|---|---|
| Intake | Produce validated intent and identify missing target information. | Cannot choose an unapproved target or invent readiness. |
| Supervisor | Dispatch independent reads, track checkpoints and request re-planning. | Cannot bypass a failed capability or policy gate. |
| Discovery | Invoke read-only adapters and build authoritative inventory. | No infrastructure mutations or synthetic replacement for failed reads. |
| Policy and Impact | Evaluate policy, capabilities, ownership, collisions and affected dependencies. | Mandatory controls remain deterministic; LLM advice is supplementary. |
| Planning and Rollback | Compile artifacts, establish preconditions and record restoration boundaries. | No arbitrary model-authored shell commands or unvalidated artifacts. |
| Authorization and human gate | Evaluate trusted policy for the exact target/plan; collect verified human approval only when required. | Agents cannot approve themselves, widen their delegation or waive mandatory controls. |
| Execution | Dispatch approved work to deterministic workers and adapters. | No broad write credentials or authority derived from conversation memory. |
| Verification | Collect real controller, provider and data-plane evidence. | PR creation or API acceptance alone cannot mark ingress complete. |

### 4.4 Execution and recovery invariants

1. Authenticate operators with verified enterprise identity; reject spoofed
   operator headers. Authorize tenant and target access before discovery or writes.
2. Separate read-only and executor identities in actual IAM/Kubernetes RBAC.
   Do not assume that a logical service-account label enforces permission.
3. Bind authorization to the decision, target scope, plan/artifact digest,
   capability profile version, snapshot/preconditions, policy version, actor,
   expiry and replay protection. Include the verified reviewer when human
   approval is required. Record the approved delegation when it is not.
   Use managed signing keys with rotation and auditable access.
4. Recheck state at the actual mutation boundary. Combine scoped locks/leases,
   resource-level conditional writes and idempotency keys; a snapshot hash alone
   does not prevent concurrent updates.
5. Account for GitOps approval-to-merge-to-reconcile races with a reviewed
   pre-apply mechanism. If the deployment path cannot enforce required
   preconditions, it is not eligible for governed production writes.
6. Track asynchronous work durably: submitted, reconciling, verified, failed,
   recovery-needed and corresponding audit evidence. Define exact state/API
   changes in Phase 0 rather than treating `COMPLETED` as "request accepted."
7. Respect ownership. Do not mutate shared gateways, DNS zones, WAF policies or
   certificates without explicit authority and an approved scope.
8. Restore only recorded, owned state. DNS caches, certificate issuance and
   provider propagation are not instantly reversible. Define compensating
   actions and operator escalation for partial or irreversible operations.
9. Keep inference out of the traffic path and emergency rollback path.
   Strands sessions and model memory are not the authoritative workflow ledger.
10. Simulation is explicit and isolated. Live mode must fail closed on missing
    configuration, credentials or evidence; it must never fall back to mock
    discovery, fake PRs, synthetic success results or simulated metrics.

### 4.5 Agent-operated ingress with policy-based human approval

The supervisor must continue permitted work automatically, including scheduling
provider operations, waiting for propagation, collecting evidence and dispatching
recovery. Implement these as durable agent/tool jobs with deterministic state
transitions, not unbounded autonomous shell sessions.

The server-side authorization policy returns one of three outcomes:

- **ALLOW_PREAUTHORIZED:** A supported action falls within an approved automation
  envelope. Record its policy version, service identity, target, limits and plan
  digest; execute without asking a human to approve it again.
- **REQUIRE_HUMAN:** Pause before the affected mutation, present the complete
  impact/plan and wait for an authorized human. Persist the checkpoint, then
  revalidate the signed decision, state, scope and expiry before resuming.
- **DENY:** Do not execute. Explain the violated control or missing capability.
  An approval button must not override this result.

These are proposed policy defaults for owner approval in Phase 0:

| Situation | Agent behavior | Human involvement |
|---|---|---|
| Authorized read-only discovery, validation and planning | Run automatically and report observations, failures and proposed changes. | None per run, unless a data-access policy specifically requires it. |
| Supported low-risk dev/staging change within an approved envelope | Plan, authorize, deploy and verify automatically. | Platform owners approve the envelope in advance. |
| Production, high-blast-radius change or new public exposure | Prepare all evidence; pause before mutation. | Authorized reviewer; four-eyes separation where required. |
| Shared DNS/gateway/network resources, certificate trust or material WAF changes | Assess dependencies and request an explicit scoped decision. | Resource owner and any additional reviewers required by policy. |
| Canary stages within an approved plan and measured limits | Advance automatically when acceptance windows pass. | No repeated approval for already-authorized stages; any boundary increase needs a new decision. |
| Probe failure with a valid pre-authorized recovery plan | Stop promotion and execute deterministic recovery immediately. | Notify humans; do not wait for approval that would delay already-authorized recovery. |
| Material plan drift, expired authorization or changed scope/cost | Stop, rediscover, re-plan and re-evaluate policy. | Renew human approval when the revised policy decision requires it. |
| Unsupported feature, mandatory policy violation, missing permission or unknown state | Block the unsafe step; produce actionable diagnostics. | Owners resolve the underlying issue; human approval alone cannot make it supported or authorized. |
| Recovery failure or exhausted retry/time/cost budget | Preserve evidence, stop further mutations and escalate. | Operator decides a separately validated recovery plan. |

An automation envelope must constrain targets, namespaces/resources, permitted
operations, change risk, cost/quota, traffic-weight steps, validity period and
recovery authority. Changes to the envelope itself require authorized human
administration. Runtime agents must not grant IAM, alter approval policy,
disable audit, suppress failed probes or obtain broader tools to finish a task.

The intended operational flow is:

```text
User supplies ingress intent
  -> Intake resolves missing inputs
  -> Supervisor dispatches discovery/policy/impact agents
  -> Planning and rollback agents seal the proposed change
  -> Policy engine:
       DENY -----------------> explain and stop
       REQUIRE_HUMAN --------> durable pause -> approved decision -> revalidate
       ALLOW_PREAUTHORIZED --> recorded delegated authorization
  -> Execution agent invokes scoped provider/GitOps tools
  -> Verification agent observes infrastructure and application traffic
       healthy -------------> advance authorized stages -> verified completion
       unhealthy -----------> pre-authorized deterministic recovery -> verify
  -> Audit, notify and retain evidence throughout
```

Verification may be a scoped supervisor-dispatched role rather than a new
independent service. Existing specialists can own DNS, certificates or cloud
analysis through bounded tools; humans should not have to orchestrate those
handoffs manually.

Approval must not rely on an open browser session or an in-memory conversation.
Support durable resume, duplicate approval/event protection, rejection, expiry,
cancellation and reviewer notifications. The UI must explain what the human is
authorizing and which subsequent steps will run automatically. Rejection stops
the proposed change; it does not prevent recovery actions already authorized to
protect an earlier deployment.

## 5. Requirements

These are local planning IDs derived from the requested direction and the
existing governance design, not an already-approved enterprise specification.

| ID | Proposed requirement |
|---|---|
| REQ-001 | Versioned ingress intent and unambiguous tenant/cloud/cluster/gateway targeting. |
| REQ-002 | Capability validation with explicit unsupported/unknown outcomes and no silent downgrade. |
| REQ-003 | Independently certified AWS, Azure and Google Cloud implementation profiles. |
| REQ-004 | Authoritative, complete and freshness-bounded discovery with provenance and concurrency tokens. |
| REQ-005 | Defined routing, networking, DNS, certificate and edge-policy prerequisites and lifecycles. |
| REQ-006 | Deterministic artifact validation, sealed plans and bounded recovery actions. |
| REQ-007 | Verified identity, target authorization, least privilege and secret-reference handling. |
| REQ-008 | Target-bound approvals, drift revalidation, idempotency and concurrent-writer protection. |
| REQ-009 | Real GitOps operations and deployment reconciliation before completion. |
| REQ-010 | Transactional workflow persistence, durable execution/checkpoints and protected audit evidence. |
| REQ-011 | Real probes, capability-gated canaries and deterministic recovery verification. |
| REQ-012 | Operational ownership, lifecycle management, limits, resilience and explicit SLOs. |
| REQ-013 | Clear UI/API support status, observed progress and actionable failure explanations. |
| REQ-014 | Isolated simulation/live modes and backward-compatible migration of existing workflows. |
| REQ-015 | Layered verification and per-profile evidence before claiming production support. |
| REQ-016 | Approved corporate artifacts, cost controls and controlled dependency/controller upgrades. |
| REQ-017 | Runtime agents perform end-to-end ingress work and resume durable jobs without routine human execution. |
| REQ-018 | Trusted policy distinguishes pre-authorized actions, required human approvals and non-overridable denials. |

## 6. Technical Context, Constraints and Design Gates

- **Current stack:** TypeScript, Express, React, TanStack, Zod, Strands and Vitest.
  Follow the Node engine range and corporate registry configuration in
  [package.json](../../package.json) and [.npmrc](../../.npmrc).
- **Proposed durable store:** PostgreSQL, consistent with the historical design.
  Select hosting, migration/backup policy and tenant-isolation approach in Phase 0.
  Keep the existing JSON store for explicitly local simulation only.
- **Proposed durable coordination:** Temporal is recommended after the bounded
  primary-source comparison in [the core design](core-architecture.md#2-software-boundaries-and-decision-rationale).
  Initially run bounded Strands specialists in Activities; the documented
  Temporal/Strands plugin is an optional finer-grained integration, not a prerequisite.
  Corporate SDK/plugin metadata is listed, but exact-version compatibility,
  native artifacts, server hosting and measured replay/recovery behavior remain
  unverified. T031 must
  approve the foundation artifacts before T008/T034; a rejected runtime requires
  an explicit alternative decision, not a fallback to local files.
- **Proposed policy authority:** OPA/Rego with a strict application decision
  schema, default deny and explicit handling of undefined/error/stale results.
  Current policy-named local tools are not proof of a production OPA integration.
- **Artifacts:** Kubernetes manifests and provider-specific declarative plans.
  Prefer the enterprise's approved IaC/GitOps tools, mirrored providers and charts.
- **Principles check:** Control-plane-only inference, actual read/write isolation,
  plan-bound approval/drift protection and precomputed recovery are retained.
  No standalone constitution or approved multi-cloud contract exists in this
  repository; Phase 0 must ratify these before dependent implementation.
- **Applied guidelines:** Existing TypeScript/Zod contracts, Express endpoints,
  Strands tool boundaries, Vitest isolation and governance invariants are reused.
  The available Java migration guidelines do not apply. This is not a
  Python/ADK migration.
- **Design inputs:** Sections 2-4, the linked architecture/governance documents
  and current code. Detailed API/schema, database and adapter designs are
  prerequisite deliverables, not implicitly approved by this roadmap.

Phase 0 must approve the initial profiles and cloud rollout order; actual
accounts/regions/clusters; namespace/gateway ownership; DNS/certificate/WAF
authorities; identity provider and roles; GitOps/IaC ownership boundaries;
availability/data-residency requirements; budgets; and measurable SLOs.
It must also approve the automation envelopes, mandatory human-review triggers,
reviewer/resource-owner roles and pre-authorized emergency recovery boundaries
described in Section 4.5.
No cloud provisioning or new production access is authorized by this document.

## 7. Implementation Steps and Task Breakdown

All paths below are repository-relative. New paths are proposed deliverables,
not existing implementation. `[P]` marks independent provider files that can be
implemented in parallel after their shared prerequisites.

### Phase 0 - Ratify scope and prerequisite designs

**Plan 0.1 - Scope, support profiles and detailed design approval**  
Requirements: REQ-001, REQ-002, REQ-003, REQ-005, REQ-012, REQ-016.

- [ ] T001 [Plan:0.1] Produce `docs/multi-cloud-ingress/support-matrix.md` with approved cloud/controller versions, feature/exposure cells, region restrictions and platform owners. Dependency: none.
- [ ] T002 [Plan:0.1] Produce reviewed intent/API, adapter, durable workflow and persistence designs in `docs/multi-cloud-ingress/design.md`, using `core-architecture.md` and `extension-contract.md` as proposed inputs; include exact schemas, compatibility, authority/outbox boundaries and provider-error semantics. Dependency: T001.
- [ ] T003 [Plan:0.1] Record identity, ownership, SLO, budget, recovery and rollback limitations in `docs/multi-cloud-ingress/acceptance-criteria.md`, including policy/audit/workflow outage behavior and GitOps pre-apply enforcement; obtain platform/network/security owner approval. Dependency: T001.

**Exit:** Required design artifacts are approved. Do not start dependent source
changes while the target support profiles or contract semantics remain undecided.

### Phase 1 - Shared control-plane foundations

**Plan 1.1 - Portable intent, capabilities and simulation separation**  
Requirements: REQ-001, REQ-002, REQ-014.

- [ ] T004 [Plan:1.1] Extend `src/shared/contracts.ts` with the approved versioned intent, target, observation and error contracts while preserving existing workflow readers. Dependency: T002.
- [ ] T005 [Plan:1.1] Implement `server/ingress/capabilities.ts` with versioned profile evaluation and explicit rejection of unknown/unsupported mandatory features. Dependencies: T001, T004.
- [ ] T006 [Plan:1.1] Update `server.ts` and `server/agents.ts` to require explicit simulation/live configuration and migrate legacy workflows to simulation without silently choosing production targets. Dependencies: T004, T005.

**Plan 1.2 - Identity, transactional persistence and approval authority**  
Requirements: REQ-007, REQ-008, REQ-010.

- [ ] T007 [Plan:1.2] Implement verified OIDC identity and tenant/target authorization in `server/security/identity.ts`; integrate with `server.ts` without trusting caller-supplied operator roles. Dependencies: T002, T003.
- [ ] T008 [Plan:1.2] Implement the approved repository boundary in `server/store.ts`, PostgreSQL persistence in `server/persistence/postgresStore.ts`, and migrations in `server/persistence/migrations/`; include transactional audit/outbox writes, operation records and isolated test stores without creating a competing workflow scheduler. Dependencies: T002, T031.
- [ ] T009 [Plan:1.2] Implement managed-key approval binding, expiry, replay prevention and resource-scope checks in `server/security/approvals.ts`; integrate approval handling in `server/agents.ts`. Dependencies: T003, T004, T007, T008.

**Plan 1.3 - Agent autonomy and conditional human intervention**  
Requirements: REQ-007, REQ-008, REQ-010, REQ-014, REQ-017, REQ-018.

- [ ] T033 [Plan:1.3] Implement `server/security/authorizationPolicy.ts` for the approved OPA integration, automation envelopes and ALLOW_PREAUTHORIZED/REQUIRE_HUMAN/DENY outcomes; validate decision schema/revision/freshness, fail closed on errors and bind authority to exact plans without agent self-approval. Dependencies: T003, T005, T007, T009.
- [ ] T034 [Plan:1.3] Implement the approved Temporal workflow foundation through `server/ingress/autonomy.ts` and integrate `server/strands/corePipelineGraph.ts` and `server/agents.ts` using bounded specialist Activities, artifact handoffs, durable human waits, restart and duplicate-command handling; enforce total deadlines, bounded cancellation acknowledgement and recovery fencing, with LLM/external I/O outside replayable code. Dependencies: T006, T008, T031, T033.

**Exit:** Unauthorized targets cannot be read or changed; simulation cannot
obtain executor credentials; workflow and approval recovery survives restart.
The three policy outcomes demonstrably control agent/tool behavior, including
automatic progress for authorized work and a real pause for required approval.

### Phase 2 - Real discovery and deterministic planning

**Plan 2.1 - Adapter contract, shared Kubernetes discovery and cloud profiles**  
Requirements: REQ-003, REQ-004, REQ-005.

- [ ] T010 [Plan:2.1] Implement the reviewed extension/adapter boundary in `server/ingress/adapter.ts`, including versioned capability/permission contracts and certification checks; move simulated observations into `server/ingress/adapters/simulation.ts` with explicit provenance. Dependencies: T004, T005.
- [ ] T011 [Plan:2.1] Implement `server/ingress/kubernetes.ts` for namespace/gateway/service resolution, controller conditions, resource versions, ownership and bounded discovery; connect read-only tools in `server/strands/tools.ts`. Dependencies: T007, T010.
- [ ] T012 [P] [Plan:2.1] Implement the approved AWS profile in `server/ingress/adapters/aws.ts`, including authoritative provider observations, identity scope, quotas and documented unsupported combinations. Dependencies: T011, T031.
- [ ] T013 [P] [Plan:2.1] Implement the approved Azure profile in `server/ingress/adapters/azure.ts` with the same observation/error guarantees and its actual frontend/policy constraints. Dependencies: T011, T031.
- [ ] T014 [P] [Plan:2.1] Implement the approved Google Cloud profile in `server/ingress/adapters/gcp.ts` with actual GatewayClass, backend, certificate and edge-policy behavior. Dependencies: T011, T031.

**Plan 2.2 - Routing, DNS/TLS/edge lifecycle and validated plans**  
Requirements: REQ-002, REQ-005, REQ-006.

- [ ] T015 [Plan:2.2] Implement deterministic planning in `server/ingress/planner.ts` and route provider-specific artifact compilation through adapters instead of Google-specific generation in `server/agents.ts`. Dependencies: T005, T011.
- [ ] T016 [Plan:2.2] Implement the approved DNS, certificate, network and edge-policy lifecycle boundary in `server/ingress/lifecycle.ts`, including ownership, renewal, propagation and unsupported-feature rejection. Dependencies: T003, T015 and the selected provider task T012, T013 or T014.
- [ ] T017 [Plan:2.2] Implement `server/ingress/validation.ts` and `server/ingress/recovery.ts` for schema/admission/provider validation, deterministic artifacts, preconditions and precomputed compensating actions. Dependencies: T015, T016.

**Exit:** One selected cloud profile can produce an authoritative read-only plan,
with no production writes. Certify each additional profile independently rather
than blocking the first cloud on simultaneous completion of all three.

### Phase 3 - Governed deployment and observed verification

**Plan 3.1 - Durable execution, real GitOps and reconciliation**  
Requirements: REQ-006, REQ-008, REQ-009, REQ-010.

- [ ] T018 [Plan:3.1] Implement `server/ingress/execution.ts` on the approved durable workflow foundation, with write-ahead operations/receipts, idempotency, scoped leases/enforceable fences, bounded retries, observe-first OUTCOME_UNKNOWN handling and worker-restart recovery. Dependencies: T008, T009, T017, T034.
- [ ] T019 [Plan:3.1] Implement `server/ingress/gitops.ts` for real PR creation, exact artifact/base-commit binding, authenticated deduplicated events and the reviewed actual pre-apply enforcement mechanism; merge approval alone must not authorize stale eventual apply. Dependencies: T007, T018.
- [ ] T020 [Plan:3.1] Implement `server/ingress/reconciler.ts` and update `server/agents.ts` so approval/drift preconditions are enforced at mutation, readiness is observed, and a PR URL never means deployment is complete. Dependencies: T011, T017, T019.

**Plan 3.2 - Real probes, canaries and bounded recovery**  
Requirements: REQ-005, REQ-011, REQ-012.

- [ ] T021 [Plan:3.2] Implement `server/ingress/probes.ts` for DNS/TLS/application probes from approved internal/external vantage points, with timestamped evidence and safe WAF verification where authorized. Dependencies: T016, T031.
- [ ] T022 [Plan:3.2] Integrate capability-gated traffic stages, measured acceptance windows and deterministic rollback/recovery verification in `server/ingress/execution.ts` and `server/ingress/recovery.ts`. Dependencies: T020, T021.
- [ ] T023 [Plan:3.2] Add the separately gated direct-execution path in `server/ingress/directExecutor.ts`; leave it disabled until the selected profile passes direct-write and recovery certification. Dependencies: T009, T022, T030.

**Exit:** Actual controller/provider readiness and data-plane observations prove
the desired result. Recovery either proves restoration or explicitly escalates;
failure to recover is not reported as a successful rollback.

### Phase 4 - Experience, certification and controlled rollout

**Plan 4.1 - Transparent UX, telemetry and operational ownership**  
Requirements: REQ-010, REQ-012, REQ-013, REQ-014.

- [ ] T024 [Plan:4.1] Update `src/components/LiveAgentFlowDiagram.tsx`, `src/pages/AgentFlowPage.tsx` and `src/routes/workflows.$workflowId.tsx` for progressive detail, accessible/reduced-motion status, evidence provenance, capability gaps, human decisions and observed stages through tenant-filtered durable SSE cursor/replay in `server.ts`. Dependencies: T006, T018, T033.
- [ ] T025 [Plan:4.1] Add provider/controller readiness, probe freshness, operation latency, quota/cost budgets and failure metrics in `server/ingress/telemetry.ts`, keeping measured infrastructure data distinct from agent-token telemetry. Dependencies: T018, T021.
- [ ] T026 [Plan:4.1] Implement protected audit export/retention through `server/persistence/postgresStore.ts` and publish `docs/multi-cloud-ingress/runbook.md` covering ownership, alerts, key rotation, backup and incident recovery. Dependencies: T008, T020, T025.

**Plan 4.2 - Contract, real-cloud and browser evidence**  
Requirements: REQ-003, REQ-015.

- [ ] T027 [Plan:4.2] Extend `server/__tests__/strandsIntegration.test.ts` and add `server/__tests__/ingressAdapters.test.ts` for contracts, capability/observation failures, all three policy outcomes, durable human pause/resume, delegated progress and deterministic plan/recovery boundaries under the existing `npm test` command. Dependencies: T005, T010, T017, T034.
- [ ] T028 [Plan:4.2] Add isolated database/concurrency and per-profile live-cloud scenarios in `server/__tests__/ingressCertification.test.ts`, with explicit opt-in credentials, evidence capture, ownership-scoped cleanup and visible skips. Dependencies: T020, T021, T027, T031 and the selected provider task T012, T013 or T014.
- [ ] T029 [Plan:4.2] Add corporate-approved browser validation in `e2e/ingress-governance.spec.ts` and `playwright.config.ts` for target selection, unsupported-feature feedback, approval, observed deployment and recovery. Dependencies: T007, T024, T027, T031.

**Plan 4.3 - Resilience, supply chain and release gates**  
Requirements: REQ-003, REQ-012, REQ-015, REQ-016.

- [ ] T030 [Plan:4.3] Record failover, restart, lost-response/stale-worker, duplicate-event, drift/concurrent-writer, workflow replay/upgrade and GitOps recovery results in `docs/multi-cloud-ingress/certification.md`, including failed/blocked scenarios and measured recovery limits. Dependencies: T003, T028.
- [ ] T031 [Plan:4.3] Establish `docs/multi-cloud-ingress/approved-artifacts.md` and approve the initial durable-runtime SDK/native artifacts/server hosting, DB driver and OPA foundation batch through corporate sources; define mandatory batch-approval gates for subsequent cloud SDK, IaC provider, chart, image and browser artifacts before their dependent tasks use them. Dependencies: T001, T002.
- [ ] T032 [Plan:4.3] Update `docs/multi-cloud-ingress/support-matrix.md` with evidence-backed statuses and obtain release approval in `docs/multi-cloud-ingress/certification.md`; release each profile advisory -> staging GitOps -> bounded production, with direct mode separately reviewed. Dependencies: T026, T029, T030, T031; T023 additionally required for a direct-mode release.

**Sequencing note:** T031 belongs to release controls but must run early, after
scope/design approval and before new provider integrations or test tooling.
Foundation artifact approval in T031 precedes T008/T034; it does not certify
runtime behavior or require every later provider/browser artifact at once.
T031 completes with the foundation approvals and the catalog/gating process;
each later integration task must record approval for its own artifacts before use.
T030 certifies the GitOps/recovery foundation before T023; direct-mode evidence
is then added before any direct-mode release in T032. T033-T034 are Phase 1
prerequisites despite their appended task IDs. There is no prerequisite cycle.

## 8. Proposed Project Structure

```text
src/shared/contracts.ts            Versioned intent, target and observation contracts
server.ts                         Authenticated API and observed-state event bridge
server/agents.ts                  Existing workflow/governance integration
server/strands/                    Existing bounded analysis runtime and tools
server/security/                  Identity, authorization policy and approval authority
server/ingress/
  adapter.ts, capabilities.ts     Minimal shared contracts and support evaluation
  adapters/                      Explicit simulation, AWS, Azure and GCP profiles
  kubernetes.ts, planner.ts       Shared discovery and deterministic planning
  lifecycle.ts, validation.ts     DNS/TLS/edge lifecycle and plan validation
  execution.ts, gitops.ts         Durable orchestration and real GitOps
  autonomy.ts                    Agent handoffs and conditional human pause/resume
  reconciler.ts, probes.ts        Observed readiness and data-plane verification
  recovery.ts, directExecutor.ts  Bounded recovery and separately gated writes
  telemetry.ts                   Measured infrastructure/operation telemetry
server/persistence/               Transactional workflow/audit persistence
server/__tests__/                 Existing runner plus planned adapter/certification coverage
e2e/                              Planned browser journeys; no tests generated by this document
```

This is a work allocation proposal, not a requirement to create every file at
once. Consolidate modules where that remains clearer, while preserving the
authorization, observation and execution boundaries.

## 9. Testing Strategy and Acceptance Gates

**App type:** Mixed Express API and React SPA.  
**Canonical regression command:** `npm test`; retain the existing Vitest/API
suites with isolated stores. Future targeted checks must run before their task
is considered complete and report passed, failed and skipped counts.  
**Current planning environment:** Node 22.19.0 and a responding Docker daemon
were verified on 2026-11-24. Browser binaries, real-cloud access and production
connectors were not validated by this documentation task.

### Validation layers and independent fallbacks

| Layer | Planned primary approach | Fallback and coverage loss |
|---|---|---|
| Unit/API/adapter contract | Existing Vitest and Node HTTP clients; recorded fixtures for provider APIs with invalid/denied/partial/stale cases. | Fixtures cannot prove IAM, API availability, quotas or actual ingress behavior. |
| Persistence/coordination | Isolated PostgreSQL via approved Docker images, real migrations, parallel workers and restart scenarios. | In-memory tests may continue if Docker is unavailable, but cannot certify transactions, locks, recovery or production persistence. |
| Browser | Corporate-approved Playwright/browser artifacts against the running React/Express app. | API coverage may continue if browser setup is blocked; rendering, client routing and approval UX remain unverified. Docker absence does not justify skipping browser checks. |
| Controller/provider | Actual staging controller and cloud targets for every proposed certified profile. | Local Kubernetes or emulators support development only; no substitute for provider certification. |

Use Docker/PostgreSQL and browser validation independently. Do not install tools
or pull public images merely to complete this plan; T031 must approve sources.
Keep fixture-only `npm test` usable without cloud credentials or manual setup.
Live suites must be explicitly opted into; skipped live cases cannot be counted
as certified. Wire future test assets into the canonical runner/CI workflow
without silently replacing existing coverage.

**Existing test assets:** The discovered Vitest suites
`server/__tests__/agentDag.test.ts`, `adoptionAgents.test.ts` and
`strandsIntegration.test.ts` are retained with minimal edits. No existing browser
suite was found in the inspected application/test locations. Do not claim that
the current simulations cover the external boundaries.

**Shared setup:** Provide adapter fixtures and identity helpers, per-suite
database schemas, temporary artifact storage, and per-profile opt-in targets.
Replace KMS/cloud/Git providers with contract fixtures for local tests; use real
approved services for certification. Keep issuer/audience/role rejection cases.
Use unique run IDs, resource ownership tags, namespaces, TTL cleanup and budget
limits. Teardown must never delete pre-existing shared infrastructure.

### Critical journeys and measurable acceptance

| Journey/gate | Required evidence |
|---|---|
| G0 - Supported intent | Every selected feature resolves to a verified profile capability; all unsupported/unknown mandatory combinations reject before any write. |
| G1 - Advisory discovery | Read-only credentials cannot mutate infrastructure; denial, stale state and partial inventory stop planning. Stable relevant state yields a stable fingerprint. |
| G2 - Governed GitOps | Distinct authorized reviewer approves exact artifacts; tampering, expiry, replay and material drift reject; actual PR, reconciliation and data-plane evidence are recorded. |
| G3 - Safe recovery | Injected backend failure triggers bounded deterministic recovery with zero LLM calls; a fresh observation proves restoration or reports recovery-needed. |
| G4 - Durable concurrency | Restart and duplicate-delivery cases cause no duplicate mutations; conflicting changes cannot both apply against the same stale preconditions; audit evidence remains consistent. |
| G5 - User experience | Browser shows correct target, simulation/live status, unsupported reasons, approval authority and actual deployment progress without fake completion. |
| G6 - Per-profile release | Public/private behavior, DNS/TLS renewal, mandatory edge controls, quotas, cleanup and supported protocol cases have real staging evidence for the exact certified versions. |
| G7 - Conditional human approval | Pre-authorized low-risk work completes without manual commands; required-review work makes no mutation before approval; deny cannot be overridden; restart resumes once, and authorized recovery does not wait for redundant human approval. |

Each certification record must include target/controller versions, artifact
digest, command and exit status, scenario pass/fail/skip counts, resource/PR
identifiers, timestamps, probe observations, recovery timings and known gaps.
The final reviewer must check both control-plane and data-plane evidence.
Mocks, an API returning 200 and a green agent animation are not release evidence.

Do not promise a universal sub-minute rollback. Define separate numeric targets
for control-plane restoration, traffic convergence, DNS propagation and operator
response in T003, measure them in T030, and disclose provider limitations.

## 10. Rollout, Ownership and Risks

| Release | Enabled behavior | Required exit evidence |
|---|---|---|
| R0 - Approved scope | Simulation remains available; no new cloud writes. | T001-T003 and T031 approved. |
| R1 - First-cloud advisory | Authoritative read-only discovery and export. | G0/G1; reviewed IAM and cost limits. |
| R2 - First-cloud staging GitOps | Agent-led PRs and reconciled changes on owned staging resources within approved automation envelopes. | G2-G5 and G7; recovery drills and durable coordination. |
| R3 - Bounded production | Opt-in tenants/apps for an explicitly certified profile. | G6, owner sign-off, alert/runbook coverage and measurable SLOs. |
| R4 - Additional profiles | Repeat R1-R3 independently for the other clouds/controllers. | Their own evidence, not inherited certification. |
| R5 - Direct writes/advanced protocols | Explicitly gated features only. | Separate mutation/recovery and feature certification. |

Recommended accountable roles: platform owner for intent/runtime, cloud/network
owners for profiles and resource boundaries, identity/security owners for
permissions/signing, application owners for traffic acceptance, and SRE for
recovery/SLOs. These are responsibilities, not named staffing commitments.

No calendar estimates are committed before Phase 0. Access approvals, enterprise
DNS/PKI/WAF ownership, controller limitations and real-cloud verification are
critical dependencies; parallel adapter development does not remove them.

Primary risks are false cross-cloud equivalence, shared-resource ownership,
eventual consistency, approval-to-apply drift, DNS/certificate recovery limits,
local-file assumptions, inadequate staging budgets and unapproved dependencies.
Capability rejection, authoritative evidence and staged certification address
these risks; additional agents alone do not.

## 11. Requirement Mapping

All evidence below is planned, not a claim that the files/features already exist.

| Requirement | Plan items | Planned implementation evidence |
|---|---|---|
| REQ-001 - Intent/target | 0.1, 1.1 | Approved design; `src/shared/contracts.ts`; target selection behavior. |
| REQ-002 - Capabilities | 0.1, 1.1, 2.2 | `server/ingress/capabilities.ts`; rejected unsupported combinations. |
| REQ-003 - Cloud profiles | 0.1, 2.1, 4.2, 4.3 | Three adapter profiles and per-profile support/certification records. |
| REQ-004 - Discovery truth | 2.1 | `server/ingress/kubernetes.ts`; adapter observations with provenance. |
| REQ-005 - Ingress lifecycle | 0.1, 2.1, 2.2, 3.2 | `planner.ts`, `lifecycle.ts`, provider artifacts and real probe evidence. |
| REQ-006 - Validated plans/recovery | 2.2, 3.1 | `validation.ts`, `recovery.ts`; sealed artifacts and restoration boundaries. |
| REQ-007 - Identity/permissions | 1.2, 1.3 | `server/security/identity.ts`; target authorization and real IAM/RBAC evidence. |
| REQ-008 - Approval/concurrency | 1.2, 1.3, 3.1 | `approvals.ts`, `execution.ts`, `reconciler.ts`; rejected stale/conflicting work. |
| REQ-009 - Real GitOps | 3.1 | `gitops.ts`; actual PR and reconciliation evidence. |
| REQ-010 - Durable ledger | 1.2, 1.3, 3.1, 4.1 | PostgreSQL repository/migrations; durable jobs and protected audit export. |
| REQ-011 - Probes/canary | 3.2 | `probes.ts`, `execution.ts`, `recovery.ts`; measured traffic/recovery evidence. |
| REQ-012 - Operations/resilience | 0.1, 3.2, 4.1, 4.3 | Acceptance criteria, telemetry, runbook, failover/recovery records. |
| REQ-013 - UX/transparency | 4.1 | Workflow/agent UI and observed-state SSE behavior. |
| REQ-014 - Modes/migration | 1.1, 1.3, 4.1 | Explicit mode enforcement, legacy migration and provenance labels. |
| REQ-015 - Verification | 4.2, 4.3 | Adapter/API/browser/live-cloud checks and reviewed certification evidence. |
| REQ-016 - Supply chain/cost | 0.1, 4.3 | Approved-artifact inventory, corporate-source controls and budget approval. |
| REQ-017 - Agent-operated lifecycle | 1.3 | `autonomy.ts`, Strands graph integration and autonomous end-to-end journey evidence. |
| REQ-018 - Conditional approval | 1.3 | `authorizationPolicy.ts`; delegated, human-required and denied workflow evidence. |

Traceability companions:
[requirements to plan](./checkpoints/spec-to-plan.yaml) and
[plan to tasks](./checkpoints/plan-to-tasks.yaml).
They track document coverage only; they do not certify infrastructure.
