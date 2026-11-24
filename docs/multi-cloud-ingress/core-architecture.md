# The Ingress Operating Core: Governed Agents, Durable Workflows, Real Evidence

**Status:** Proposed architecture for owner approval; not implemented or production-certified.  
**Research date:** 2026-11-24  
**Scope:** Runtime agents operating ingress, not coding agents implementing this roadmap.

**Evidence boundary:** The primary-source coordination comparison is now complete
for the bounded shortlist below. Temporal is the recommended workflow runtime,
subject to corporate approval and a measured integration/recovery proof.
Documentation review is not production certification or a performance benchmark.

Read this first for the recommendation. Use the [source ledger](research.md)
to check claims, the [extension contract](extension-contract.md) to design
integrations, and the [implementation roadmap](plan.md) for staged delivery.

## 1. Executive recommendation

**Build a deterministic ingress operating core that uses agents, rather than a
collection of agents that collectively pretend to be a control plane.**

Use three cooperating loops:

1. **Reasoning loop:** Bounded Strands agents interpret intent, investigate
   observations, compare options and explain decisions.
2. **Durable operating loop:** A trusted workflow advances explicit states,
   obtains policy authorization, waits for required humans, dispatches scoped
   operations and performs bounded recovery.
3. **Infrastructure loop:** The selected Kubernetes/cloud/GitOps controllers
   reconcile desired resources; independent observations establish the result.

The recommended architecture is **Strands + Temporal + PostgreSQL + OPA**,
integrated with **one selected GitOps owner and certified provider profiles**.
Each component has a different job; do not make all of them orchestrators.
Keep a modular TypeScript codebase and independently credentialed workers rather
than starting with a fleet of microservices.

Temporal's documented separation of replayable Workflows and side-effecting
Activities, message handling, cancellation and upgrade mechanisms fit the required
operating model. An official TypeScript Strands integration is also documented.
Corporate artifact, hosting, exact-version compatibility and recovery validation
remain release gates. Nothing has been installed or approved for deployment.
Do not silently replace durability with the current JSON store if a gate fails.

### What the user experiences

```text
Describe desired ingress
        |
        v
Understand -> Investigate -> Plan -> Authorize -> Deliver -> Prove
                                         |
                           ask a human only when policy requires
                                         |
                      unhealthy? -> authorized recovery -> prove again
```

Agents do the permitted work end-to-end. Humans establish automation envelopes,
approve policy-required changes and resolve exceptions. A human approval does
not override a mandatory denial or manufacture unsupported cloud capabilities.

### What this does not promise

- Universal feature parity across clouds or controllers.
- Exactly-once external side effects or cross-cloud atomic transactions.
- Instant DNS convergence, certificate issuance or unconditional reversibility.
- Safety established by prompts, agent agreement, a confidence score or a green
  animation.
- A universally "best" framework independent of corporate constraints.

This is a reasoned selection for this project's requirements, not proof that
Temporal is universally superior. Restate and LangGraph have real durability
capabilities; the decision below explains why they are not the initial choice.

## 2. Software boundaries and decision rationale

| Component | Recommended responsibility | Must not become |
|---|---|---|
| Strands SDK / existing Graph integration | Bounded analysis, structured findings, approved read tools and explanation | The sole durable authority for approvals, external effects or long-running deployment |
| Temporal, recommended workflow runtime | Durable scheduling, timers, waits, retries and target workflow coordination | A replacement for IAM, database transactions, cloud idempotency or controller reconciliation |
| PostgreSQL | Business records: immutable intent/plan revisions, authorization, operation receipts, evidence indexes, audit and outbox/inbox | A second competing workflow scheduler alongside Temporal |
| OPA/Rego | One versioned policy authority producing the application's three-outcome decision contract | Model-controlled rules or an HTTP-200-means-allow check |
| Selected GitOps controller | Own approved Kubernetes desired-state fields and report reconciliation | An authorization bypass or proof that application traffic is healthy |
| Existing infrastructure controllers | Own their declared cloud resources and publish observed state | A second writer competing with Terraform or our direct executor |
| Certified adapters and verifiers | Translate real profile semantics; dispatch and observe narrowly scoped actions | Unrestricted shell access disguised as a plugin |
| OpenTelemetry | Minimal operational traces, metrics and correlation | A complete audit ledger, secrets sink or chain-of-thought recorder |

### Comparison and selection

| Option | Verified strengths | Limits / project fit | Decision |
|---|---|---|---|
| **Temporal + Strands** | TypeScript Workflows/Activities, explicit timeouts/retries, Signals/Updates, cancellation choices and replay-compatible versioning; official Strands integration | Separate service/worker operations, native artifacts and workflow-determinism discipline; neither retries nor cancellation make cloud effects exactly once | **Recommended:** fits a governed ingress lifecycle while retaining the current reasoning SDK. [C01](research.md#c01)-[C06](research.md#c06) |
| **Restate + Strands** | Journaled execution, durable steps, request deduplication, per-entity single-writer state and HA/single-node server options | External effects can outlive an attempt and need idempotency; its server/context programming model still requires operational and upgrade qualification | **Credible alternative:** reconsider if a bounded proof demonstrates better enterprise fit. This review does not establish lower cost or weaker reliability. [C07](research.md#c07) |
| **LangGraph with persistent checkpointing** | Persistent graph state and human interrupts; production checkpointers can survive restarts | Resuming an interrupted node runs code before the interrupt again; still needs safe side effects, verified authorization and lifecycle operations; replacing or duplicating Strands is not justified by this project's evidence | **Not initial choice**, not a rejection of its durability. [C08](research.md#c08) |
| **Strands Graph/Harness alone** | Existing SDK, typed tools/outputs, Graph dependencies, streaming and model-driven Swarm routing; configurable Harness | Reviewed material/local implementation do not establish the separate operational ledger and governed external-effect protocol we require; Harness defaults include broad host tools | **Retain for reasoning**, not as evidence that the whole control plane is already durable or authorized. [C09](research.md#c09), [C10](research.md#c10) |
| **Custom PostgreSQL jobs/state machine** | Could consolidate business state and scheduling transactions in a deliberately small design | Our team must design and prove leases, durable timers, redelivery, cancellation, recovery and in-flight upgrades; no job-runner implementation was evaluated here | **Do not build by default.** This is an ownership-cost assessment, not a tested product comparison. |

Temporal wins this selection on explicit lifecycle contracts and incremental fit,
not an invented numerical score or a claim that the alternatives lack durability.
Do not deploy multiple workflow engines or an engine-portability framework first.

Cedar remains an authorization alternative, not a second policy authority to add
by default; see its [skip-on-error caveat](research.md#s08). Crossplane is useful
only where selected as the [actual resource owner](research.md#i13).

### Strands integration strategy

**Initial path:** Keep a normal deterministic Temporal ingress Workflow. Run
bounded Strands specialist invocations in Activities on read-only workers,
returning immutable finding/evidence references. Temporal owns the durable
fan-out/join and human waits; a nested Strands Graph may handle a bounded local
analysis task, not a second end-to-end deployment state machine.

**Optional finer-grained path:** The official `@temporalio/strands-agents`
integration routes model/tool/MCP calls through Activities. Consider it when
step-level agent recovery materially reduces repeated analysis. It is not
required to deliver the initial path, and compatibility with our Graph,
interventions, sessions and privacy constraints must be proven first.

Neither path gives a model direct cloud authority. Mutating Activities remain
separate deterministic executor operations with policy and receipt enforcement.
Do not copy the plugin example's default model or permissive tool wiring into
production; explicitly configure the approved provider and tool set.

See [C06](research.md#c06) for the plugin and corporate metadata check.

## 3. Architecture: one core, explicit trust boundaries

```text
Operator / enterprise automation
             |
     Verified identity + target authorization
             |
     API + business ledger + transactional outbox
             |
     Durable workflow coordinator
       |           |                 |
       |           |                 +--> Policy / required human decision
       |           |
       |           +--> Read-only analysis workers (Strands)
       |                         |
       |                  Typed findings + evidence references
       |
       +--> Deterministic plan compiler / validators
       |
       +--> Scoped execution workers
       |          |
       |          +--> GitOps / IaC / certified direct adapter
       |                          |
       |                   Existing infrastructure controllers
       |
       +--> Independent observation / traffic verification
                    |
          Verified result or bounded recovery

Protected audit + durable lifecycle events -> filtered UI / notifications
```

Start with three deployment identities from one codebase: API/workflow control,
read-only analysis, and privileged execution. Verifiers may share read-only
worker infrastructure where scope isolation is sufficient. Split further only
for an actual trust, scale, lifecycle or availability requirement.

The workflow coordinator decides **when** a permitted step runs. Policy decides
**whether** it is authorized. An adapter defines **how** the selected profile
works. Observers establish **what actually happened**.

Neither the coordinator nor an adapter may reinterpret a denial as a request to
find a more permissive tool.

## 4. Agent interaction without agent sprawl

### Logical roles

| Role | Output / handoff | Authority |
|---|---|---|
| Intake | Validated `IntentRevision`, missing-input questions and target reference | No target guessing or infrastructure credentials |
| Discovery | `ObservationSet` from scoped Kubernetes/provider/DNS/PKI reads | Real read-only identity |
| Domain specialists | `FindingSet` for routing, exposure, certificates, DNS, impact or cost | Advisory; findings reference the same observation revision |
| Planner | Candidate options and a proposed change model | Cannot authorize or execute its own proposal |
| Deterministic compiler / validator | `PlanRevision`, artifact digests, prerequisites, checks and `RecoveryPlan` | Mandatory checks are code/policy, not agent votes |
| Execution role | Dispatch of the exact permitted `Operation` | Trusted executor, not an unrestricted model |
| Verification role | `EvidenceBundle` and explicit pass/fail/unknown against acceptance criteria | Reads/probes independent of the planner's success assertion |
| Operator explanation | Concise status, evidence, approval reason and next action | Cannot change the underlying status or policy outcome |

These are responsibilities, not a requirement for eight LLM calls or services.
Use deterministic tools for inventory, schema checks, policy, diff compilation
and health predicates. Use an agent only where interpretation, investigation or
explaining alternatives benefits from reasoning.

The "supervisor" should mainly be deterministic workflow coordination. It may
ask a model to propose investigation tasks from an approved catalog; it must
validate the resulting bounded graph before execution.

### Dependency-aware flow

1. Authenticate and resolve the exact target and supported profile.
2. Collect independent resource inventories in parallel where safe.
3. Normalize a revisioned observation set, including partial/stale failures.
   This is a versioned collection, **not an atomic multi-cloud snapshot**.
4. Fan out policy, impact and optional specialist analysis over that same set.
   Do not allow policy and planning to quietly reason about different snapshots.
5. Compile and validate the concrete artifacts. Evaluate policy again against
   the resolved changes, not just the user's initial intent.
6. Seal the plan and recovery boundaries; obtain delegated or human authorization.
7. Revalidate at dispatch, deliver through the selected owner, observe and verify.
8. Advance authorized stages or recover; always publish the actual evidence.

Keep mandatory and advisory findings distinct. An optional cost explanation
failing need not stop an otherwise authorized operation; missing mandatory
budget/quota evidence must stop it. A model's confidence cannot fill that gap.

### Bounded cooperation

- Dispatch only installed roles/tools permitted for the target.
- Bound graph size, depth, fan-out, model calls, wall time, tokens, cost and
  provider API usage. Define budgets by task class rather than a universal
  ten-second timeout.
- Reserve execution/recovery capacity independently of expensive analysis.
- Give each specialist the minimum relevant context, not a shared unrestricted
  conversation or global memory.
- Persist structured artifacts with provenance, input digests, schema and
  model/prompt/tool versions. Pass references rather than growing chat histories.
- Treat retrieved runbooks, annotations, DNS text and tool output as untrusted.
  Findings can propose actions but cannot become executable instructions.
- Never rely on two agents agreeing as independent verification.

Multi-agent benefit must be measured against a single-agent/deterministic
baseline. Parallelize genuinely independent investigation; serialize conflicting
mutations. More agents are not inherently more reliable. First-party guidance
supports context specialization and independent parallel tasks, not splitting
every task into an agent; its illustrative performance tables are not an ingress
benchmark. See [C11](research.md#c11).

### Anti-stall contract

Every automated task needs an absolute deadline, maximum attempts and a
task-appropriate no-progress threshold. Transport heartbeats or token streaming
must not extend the absolute deadline or count as completed evidence.

On expiry, stop scheduling dependent work, signal cancellation, and publish
`TIMED_OUT`, `CANCEL_PENDING` or `OUTCOME_UNKNOWN` as appropriate. Do not wait
forever for a cancellation acknowledgement: use a bounded wait, observe possible
effects and escalate. Human waits are durable states with explicit policy expiry,
not a stuck model invocation. Expose deadline, last meaningful progress and the
next safe action in the UI.

## 5. Durable workflow and data ownership

### State model

The following are proposed lifecycle semantics; map them to backward-compatible
API contracts in T002/T004, not directly onto today's status strings:

```text
INTAKE -> DISCOVERING -> PLANNING -> VALIDATING -> AUTHORIZING
                                                   |
                          +------------------------+-------------------+
                          |                        |                   |
                         DENIED             WAITING_HUMAN       PREAUTHORIZED
                                                   |                   |
                                             revalidate ---------------+
                                                                       |
                                                               READY_TO_DISPATCH
                                                                       |
                                                           SUBMITTED -> RECONCILING
                                                                       |
                                                                  VERIFYING
                                                                 /         \
                                                           VERIFIED     RECOVERING
                                                                           |
                                                             RECOVERED / RECOVERY_NEEDED
```

Expiry, rejection, cancellation, stale preconditions and exhausted budgets are
explicit branches. `OUTCOME_UNKNOWN` belongs to operation state and can block
workflow progression while observation resolves it. A `FAILED` workflow must
still preserve and display any changes already made.

### Authorities, not duplicated truth

| Record | Authority |
|---|---|
| User intent, sealed plan, approval/envelope, operation receipt | Business ledger |
| Workflow scheduling, durable waits/timers and execution history | Durable workflow runtime |
| Cloud/Kubernetes resource state | The actual target APIs/controllers |
| Application behavior | Approved independent probes/telemetry |
| UI status | Rebuildable projection of the above; not browser-local authority |
| Agent memory | Untrusted, scoped assistance; never authorization or live truth |

Use database transactions for related business records, audit and outbox writes.
Do not claim a distributed transaction between PostgreSQL, the workflow service,
GitHub, Kubernetes and a cloud provider.

For approval/cancel commands, record the authenticated command and request ID,
then deliver a deduplicated workflow notification through an outbox. The
notification wakes the workflow; the persisted authorization record remains the
authority. Show "request recorded" separately from "operation stopped."

Workflow tasks use immutable artifact references rather than large manifests,
secrets or raw prompts in execution histories. Store sensitive artifacts with
approved encryption, retention and access controls.

### Durable runtime implementation rules

Keep Temporal Workflow code deterministic; run network, LLM, database, provider
and filesystem effects in Activities. Import Activity types, not their I/O
implementations, into the workflow bundle. Temporal's TypeScript sandbox supplies
deterministic replacements for time/random functions; do not confuse that with
ordinary Node execution being replay-safe. See [C01](research.md#c01).

Configure per-attempt `startToCloseTimeout` and total
`scheduleToCloseTimeout`/retry bounds by task class. Long-running ordinary
Activities need heartbeats and abort-aware I/O for cooperative cancellation;
heartbeats are neither cloud readiness evidence nor a total execution deadline.
See [C02](research.md#c02).

The default `TRY_CANCEL` can release the Workflow's wait while its Activity still
runs. For steps where overlap with recovery would be unsafe, use bounded
`WAIT_CANCELLATION_COMPLETED` handling plus enforceable fences and observation.
Even acknowledgement cannot recall a cloud request already accepted.
`ABANDON` is not a safe generic stop button. See [C04](research.md#c04).

Use Signals as wake-ups, not synchronous proof that approval was processed.
Queries cannot mutate state or perform async checks. Update validators are
synchronous and do not replace external identity/policy validation.
Serialize conflicting handlers or hand commands to the main state machine;
complete handlers before Continue-As-New. See [C03](research.md#c03).

Use durable timers for waits and bounded observation, not an HTTP request kept
open while a human reviews a plan. Session checkpoints and model transcripts do
not replace durable workflow events.

Give each logical step one retry owner. Avoid multiplying model-SDK, HTTP-client,
Activity and application retries without a shared budget. A timeout does not
prove that a cloud mutation was never accepted.

Pin workflow, schema, policy, compiler, extension and artifact versions.
Replay existing histories and exercise old/new worker coexistence before
deployment. Bound history growth and preserve the needed identifiers across
workflow continuation. Do not silently run an old approved plan through a new
compiler or regenerate a plan when retrying apply.

Use current Worker Versioning or documented patching rather than pre-2025
experimental versioning examples. Deployments must include replay tests against
retained histories; the precise server/SDK support matrix is an approval gate.
See [C05](research.md#c05).

## 6. Failure, recovery and concurrency model

### Write-ahead operation protocol

1. Revalidate target, installed profile, ownership, relevant state, policy,
   approval/envelope validity, budgets and recovery eligibility.
2. In a transaction, create or recover one immutable operation record and
   reserve/consume authorization for that operation. Reject the same idempotency
   key with different parameters.
3. Acquire the appropriate scoped execution lease and enforceable fence.
   Verify downstream conditional-write support, not just a local lock.
4. Dispatch the approved artifact using its stable provider idempotency key
   where available. Persist receipt/handle and actual submission state.
5. If the result is ambiguous, mark `OUTCOME_UNKNOWN` and observe first.
   Do not blindly retry a non-idempotent effect.
6. Wait for actual reconciliation, then collect acceptance evidence. An accepted
   submission is not verified completion.

A lease expiry does not stop a stale worker. A local operation ID cannot force
a provider to execute exactly once. Certification must document each primitive
and residual limitation. Unsafe unsupported operations stay disabled.

### Failure handling

| Failure | Required behavior |
|---|---|
| Model unavailable, malformed output or budget exhausted | Preserve diagnostics; stop affected mandatory reasoning. Never substitute simulated live evidence. Deterministic authorized observation/recovery remains independent of inference. |
| Worker dies before dispatch | Recover the durable operation; dispatch only if no prior effect and authority remains valid. |
| Worker dies / response is lost after dispatch | Recover provider handle or inspect target state; keep ambiguity visible until resolved. |
| Duplicate or out-of-order callback | Authenticate, deduplicate and compare the expected revision; re-read authoritative state rather than treating event arrival as truth. |
| Stale approval, policy or resource state | Stop the affected mutation, rediscover/re-plan and reauthorize where required. |
| Competing writer | Reject/resolve ownership or conditional-write conflict; no automatic force-apply. |
| Quota, throttling or provider outage | Bounded retry only for classified safe cases, with backoff/jitter and per-target limits; no rapid cross-cloud retry storm. |
| Policy error, missing result, wrong schema or stale bundle | Deny the new dispatch and expose the reason; never interpret an empty result as permission. |
| Audit/business-ledger outage | Freeze ordinary new mutations. Recovery needs an already certified independent authorization/evidence path or must stop and escalate; do not invent an unaudited bypass. |
| Workflow-service outage | Existing traffic must remain independent. Resume safely after recovery; do not promise rollback availability during this outage without a separately certified recovery mechanism. |
| Cancellation | Stop future affected dispatches; observe in-flight effects and carry out already-authorized safety handling. Cancellation cannot recall a submitted cloud request. |
| Recovery fails or previous target is unhealthy | Stop further promotion, preserve evidence and report `RECOVERY_NEEDED`; do not label it a successful rollback. |

### Recovery is compensation, not time travel

Prepare recovery before deployment: owned resources, prior values, allowed
traffic changes, dependency order, limits, deadlines, verification and escalation.
Recheck the current state before compensation so recovery does not erase another
owner's valid change.

Do not blindly apply an old forward Terraform plan. A corrective change must
be validated against current state and fit the recovery authorization.
For GitOps-owned fields, restore through the selected owner so self-healing does
not undo an out-of-band rollback.

DNS caches, client connection reuse, propagation and certificate lifecycle effects
are not instantly reversible. TTL is not a guaranteed global recovery deadline.
Disclose the restoration boundary and measure actual traffic convergence.

Use separate authorization for emergency recovery; do not ask for redundant human
approval already granted by the envelope. Neither a model call nor an open browser
is a recovery prerequisite. If recovery must survive a complete workflow-service
outage, explicitly design and certify that additional mechanism before promising
the SLO. Never trigger disruptive rollback solely because a control-plane
heartbeat disappeared.

## 7. Real ingress semantics and one effective mutation authority

Gateway API is the portable starting vocabulary, not a cross-cloud capability
guarantee. Certify the selected controller/GatewayClass, CRD bundle/channel,
region, exposure, protocol, identity, ownership and execution mode.

Examples from primary documentation:

- AWS LBC distinguishes L4/NLB and L7/ALB behavior and has its own certificate,
  networking and CRD requirements.
- Azure Application Gateway for Containers has listener restrictions and
  materially different BYO versus controller-managed resource lifecycles.
- GKE GatewayClasses inherit different load-balancer capabilities and depend on
  the installed GKE/API version.

See [I03](research.md#i03)-[I08](research.md#i08). These examples do not certify
our proposed profiles.

### Ownership boundaries

| Resource / field | Example selected owner |
|---|---|
| Shared network/subnets/cluster prerequisites | Existing platform IaC owner |
| Shared Gateway / approved listener fields | Platform GitOps owner |
| Application route fields | Application GitOps path under delegated policy |
| Controller-created LB/listeners | Selected ingress controller |
| DNS records | One explicit enterprise DNS integration/owner |
| Certificate issuance/renewal | Selected PKI/certificate owner |
| WAF/security attachment | Explicit cloud/network owner and approved integration |

Record ownership at the resource/field level, not just "AWS owns this."
GitOps changing a desired Kubernetes object and its controller changing a derived
load balancer is a valid ownership chain. Two systems reconciling the **same**
effective resource fields is not.

A Terraform state lock protects that state workflow, not portal edits or another
controller. A direct executor must not patch GitOps-owned fields without a
reviewed ownership transfer and recovery procedure.

### Approval-to-apply race

A PR approval or merge check does not enforce resource preconditions at eventual
apply. Bind the exact artifact/base revision and install a reviewed enforcement
mechanism at the actual mutation boundary: for example, target admission checks
for governed Kubernetes objects and appropriate provider/IaC preconditions.

The gate verifies actor, target, artifact/plan, current authority and relevant
old state. It must handle deletions, retries, controller field ownership and
partial multi-object application explicitly.

If the selected GitOps path cannot enforce required preconditions, it is not
eligible for the corresponding governed production writes. Do not present
ordinary Argo/Flux synchronization as this extra security mechanism.
No hook makes a multi-object or cross-cloud update globally atomic.

### Completion contract

Require all applicable checks for the selected profile:

1. The exact approved revision was delivered by the intended owner.
2. Relevant Gateway/Route/controller conditions describe the intended current
   generation; references resolve and required listeners are programmed.
3. Provider frontend/backend health and required network/edge policy attachment
   are observed, not inferred from manifest creation.
4. DNS resolves as intended from the approved vantage points.
5. TLS validates the intended hostname/SNI, chain, validity and selected policy;
   verify backend encryption/mTLS separately where requested.
6. Real requests reach the intended application/backend and expected behavior.
   A generic HTTP 200 from another service is not enough.
7. Approved canary acceptance windows and sample requirements pass.

Treat controller status as that controller's observation, not independent proof
of traffic. Validate freshness and generation semantics per implementation.
For low traffic, insufficient samples mean **insufficient evidence**, not healthy.
Configured traffic weight and measured traffic share are different facts.

Use approved internal and external probe locations as appropriate. Do not open
private ingress to obtain an external test result. DNS, certificate renewal,
drift and decommissioning need ongoing lifecycle ownership after initial setup.

## 8. Authorization: autonomy inside an explicit envelope

The trusted application decision is one of:

- `ALLOW_PREAUTHORIZED`: Execute within an owner-approved automation envelope.
- `REQUIRE_HUMAN`: Persist a pause and obtain the exact required decision.
- `DENY`: Stop; an approval button cannot override it.

OPA is the recommended initial implementation authority, not a reason to trust
all Rego results. Validate the decision schema, required obligations, loaded
policy revision and freshness. Undefined, conflicting, malformed or unavailable
decisions deny dispatch. Policy bundle convergence is eventual, so critical
revocation needs a fresh trusted check.

Bind delegated/human authority to tenant, verified actor, target, action,
plan/artifact digest, profile/certification, relevant preconditions, policy
version, expiry and replay protection. Recheck reviewer authority and separation
of duties at execution, not only when the approval was clicked.

An envelope constrains resources, operations, exposure, risk, budgets, traffic
steps, time window and recovery. It does not delegate IAM administration, policy
editing, audit suppression or arbitrary tool installation to an agent.

Collect human review only when required. An approved multi-stage rollout can
advance within its measured limits without prompting again at every step.
Material scope, artifact, permission or risk changes require policy reevaluation.

Use enterprise OIDC for operators and approved short-lived workload credentials
for workers. Cloud federation is usually the first integration choice; SPIFFE is
an optional mechanism when heterogeneous workload identity actually requires it.
See [S01](research.md#s01), [S02](research.md#s02), [S07](research.md#s07),
[S11](research.md#s11) and [S12](research.md#s12).

## 9. Extensibility without an unsafe plugin platform

The [extension contract](extension-contract.md) defines the reusable seam:
versioned descriptors, capability predicates, methods, result/error schemas,
operation receipts, trust, permissions, revocation and certification.

The invariant is **extend behavior without extending authority implicitly**.
Installations are reviewed, artifact-pinned and corporate-sourced. Enabling a
feature requires both technical certification and target authorization.

Prefer shared Kubernetes normalization plus focused provider/PKI/DNS/edge
handlers over copying the entire pipeline for each CSP. Keep provider quirks in
profiles/adapters, not scattered cloud-name branches in the coordinator.
Do not flatten incompatible semantics into a misleading universal field.

Reuse domain records such as `TargetRef`, `ObservationSet`, `CapabilityProfile`,
`PlanRevision`, `Authorization`, `OperationReceipt`, `EvidenceBundle` and
`RecoveryPlan`. Avoid building a universal workflow DSL or engine-neutral
abstraction before one production path is proven.

Other teams should eventually be able to supply a conforming extension and its
evidence package. They should not need to modify approval logic, fork the UI or
teach an LLM undocumented execution instructions.

## 10. Security and evidence integrity

- Separate actual IAM/RBAC and worker credentials; a tool label is not isolation.
- Models receive secret references, not private keys or cloud access tokens.
- Validate tool parameters, paths, resource identifiers and destinations outside
  the model. Review redirects, metadata endpoints and DNS rebinding risks.
- Do not hot-load arbitrary executable plugins or auto-trust discovered MCP tools.
  MCP tokens are not downstream cloud credentials.
- Reject arbitrary shell, unapproved Terraform execution/provisioners and remote
  artifact downloads outside the corporate supply chain.
- Isolate tenant/session memory with expiry and access controls; knowledge is not
  policy. Never let a retrieved runbook widen privileges.
- Protect artifacts/audit with restricted writers, retention and independently
  protected checkpoints where required. A hash chain alone cannot reveal events
  never recorded or establish the truth of signed claims.
- Corroborate execution with provider audit/operation records and independent
  probes where available; declare observer coverage limits.
- Separate mandatory durable audit from best-effort/sampled observability.
  Minimize telemetry and avoid raw prompts, credentials, personal data and
  chain-of-thought. Retain decision summaries and evidence references instead.

The [security sources](research.md#security-authorization-extension-trust-and-experience)
describe defenses and their limits. This document is not a penetration test or
an assertion that the current application implements them.

## 11. User experience: calm overview, inspectable truth

Keep the animated agent experience, but make it a projection of durable events,
not the source of state.

### Default view

Show target/environment, simulation/live status, current stage, what changed,
what happens next and whether a human is needed. Use a simple stage rail with
the currently active specialists nested beneath it. Do not draw every dependency
or animate every tool call by default.

### Expand on demand

Allow expansion into the detailed DAG, observations, limitations, exact diff,
policy reason, ownership, operation receipts and verification evidence.
Show approved versus current revision and any stale evidence clearly.

Every reported fact has a provenance class: observed, calculated, agent-advised,
simulated, stale or unknown. Do not display synthetic numbers as measured costs,
latency, readiness or progress.

### Approval card

Explain the exact target and change, exposure/ownership impact, why review is
required, evidence freshness, rollback limits, expiry and the automatic stages
that follow. Show what the reviewer can approve, reject or request to revise.
Do not encourage blind "approve all" interactions or make a denial look like an
overridable warning.

### Live behavior

- Deliver tenant-authorized events from a persistent sequence/cursor with
  reconnect, deduplication and snapshot resynchronization.
- A stream heartbeat proves connection liveness, not ingress progress.
- Show waiting/blocked/recovery-needed states with a reason and safe next action.
- Pausing animation must not pause the operation; cancelling the operation must
  not falsely claim in-flight requests were undone.
- Honor reduced motion; provide keyboard-accessible detail and meaningful,
  rate-controlled status announcements without stealing focus.

See [S14](research.md#s14) and [S15](research.md#s15). Animation is useful only
when it improves comprehension; motion is not inherently better for every user.

## 12. Maintainability, operations and measurement

Keep domain planning/validation independent of Express routes, model prompts and
cloud SDK response types. Use the current TypeScript/Zod/Vitest conventions;
change narrow boundaries incrementally rather than rewrite the backend.

Assign accountable owners for core/workflow, authorization, each provider
profile, PKI/DNS/network dependencies, and operational recovery. Each extension
needs a runbook, supported compatibility set, upgrade/deprecation policy and
evidence owner.

Define numerical SLOs and budgets with owners in T003, then measure them:

| Measure | What it establishes |
|---|---|
| Plan validity and deterministic compilation | Same normalized inputs/pinned compiler give the expected artifacts |
| Unauthorized/unsupported dispatch rejection | Mandatory controls act before writes |
| Duplicate/ambiguous operation outcomes | Real side-effect handling, not only local deduplication |
| Time in analysis, approval, reconciliation and verification | Where work actually waits |
| Recovery dispatch and traffic convergence separately | Control-plane restoration versus user-visible recovery |
| Evidence freshness and unknown-state duration | Quality of operational truth |
| Agent calls, tokens, latency and cost per successful task | Whether extra specialists earn their complexity |
| Operator task success and unnecessary approval count | Whether the product is understandable and avoids review fatigue |
| Time/changes needed to add a second certified profile | Whether the extension seam is genuinely reusable |

Run failure drills for process/service outages, duplicate and reordered events,
lost provider responses, stale workers, policy errors/revocation, in-flight
upgrades, audit failure and partial recovery. Test backup/restore and reconcile
receipts against actual targets after restoration.

Durability is not disaster recovery: hosting, database backup, encryption,
workflow-history retention, restore dependencies and operational on-call remain
explicit delivery responsibilities.

## 13. Adoption sequence and approval decisions

This refines the existing [34-task roadmap](plan.md); it does not start execution
or create a competing project plan.

| Existing tasks | Research-backed refinement / acceptance evidence |
|---|---|
| T001-T003 | Select one initial profile and owner chain; approve this core, extension contracts, precise schemas, SLOs and automation/recovery boundaries. |
| T031, early | Approve durable-runtime SDK/native artifacts/server hosting, DB driver, OPA distribution and provider/IaC/GitOps artifacts through corporate sources. |
| T007-T009 / T033 | Verified identities, transactional ledger, managed approval binding and a strict external policy authority. |
| T034 | Durable coordination foundation, bounded Strands handoffs, human waits, cancellation and restart semantics. Prove a minimal no-cloud workflow before expanding. |
| T010-T017 | First observe-only profile, contract fixtures, deterministic compilation, complete evidence and bounded recovery design. |
| T018-T020 | Durable operation protocol, real PR/IaC integration and actual pre-apply enforcement. Crash/ambiguity cases must pass before writes expand. |
| T021-T023 | Independent traffic evidence, approved canary/recovery behavior; direct writes remain separately gated. |
| T024-T030 / T032 | Honest live UX, operational evidence, replay/upgrade drills and exact-profile release certification. |

### Required decisions before production implementation

1. Which initial cloud/controller/profile, resources and owners are approved?
2. Is the recommended Temporal runtime's exact-version corporate artifact,
   hosting and operations footprint acceptable, or must Restate pass the same
   durability proof as an alternative?
3. Which GitOps/IaC owner and actual pre-apply gate enforce the plan?
4. Who can establish automation envelopes, approve production changes and
   authorize recovery? What happens during policy/audit/workflow outages?
5. What are the measured acceptance, recovery, cost, data-residency and retention
   targets, including non-reversible effects?

### First vertical proof

One target, one exact hostname/path, one owned route and one execution owner:
real read-only discovery -> deterministic plan -> all three policy outcomes ->
durable human pause/restart -> exact authorized dispatch -> observed
reconciliation -> real traffic proof -> injected failure and bounded recovery.

Include duplicate delivery, lost response and stale-state rejection. Then add a
second profile without changing the core authorization/recovery protocol.
Passing that test is more meaningful than adding many agents or advertising
three cloud logos.
