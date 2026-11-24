# Ingress Agent Core: Research and Decision Evidence

**Retrieved:** 2026-11-24  
**Purpose:** Support the proposed [core architecture](core-architecture.md) and
[extension contract](extension-contract.md), not certify a production deployment.

## Reading the evidence

- Sources are first-party specifications, project documentation or engineering
  reports. Engineering reports support their authors' experience, not a universal
  benchmark or proof that this application's agents will perform similarly.
- "Verified" below means the relevant primary text was retrieved and checked.
  It does not mean the product was installed, its complete documentation audited,
  or its behavior tested in this corporate environment.
- Recommendations and failure-handling protocols are this project's design
  synthesis. No source establishes cross-cloud atomicity, exactly-once cloud
  effects, universal Gateway API parity or unconditional rollback.
- Versioned URLs identify the reviewed material where available. `latest` and
  `stable` URLs are moving references: capture exact product versions and
  certification evidence before implementation.
- Truncated or unavailable material is called out rather than treated as proof.
  Source IDs below are local citations, not requirements or certification IDs.

## Security, authorization, extension trust and experience

<a id="s01"></a>
### S01 - OWASP AI Agent Security

**Source:** [AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html).

**Verified:** Least-privilege tool scopes, external enforcement, exact-action
approval binding, atomic replay protection, output validation, memory isolation
and bounded autonomy. A `user_confirmed` flag does not establish approval.

**Implication / limit:** Place authorization in the executor, outside agent
context. This is security guidance, not a certified implementation; do not copy
illustrative filtering or cryptographic snippets as a production security design.

<a id="s02"></a>
### S02 - Transaction authorization

**Source:** [OWASP Transaction Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html).

**Verified:** Server-side enforcement, what-you-see-is-what-you-sign, significant
action data binding and atomically accepting a credential once across servers.

**Implication / limit:** Reserve authorization for one immutable logical operation,
then recover that operation's receipt on duplicate delivery. This source does not
make the database reservation and a cloud API call one atomic transaction.

<a id="s03"></a>
### S03 - Prompt injection

**Source:** [OWASP LLM Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html).

**Verified:** Indirect instructions can enter through retrieved content, tool
responses and memory. Prompt delimiters and keyword/regex filtering do not create
an authorization or injection-resistance boundary.

**Implication / limit:** Treat external context as untrusted; enforce typed tool
parameters, egress, data access and mutation authority independently. A second
model checking the first is not a substitute for these controls.

<a id="s04"></a>
### S04 - MCP security boundaries

**Source:** [MCP Security Best Practices, 2026-07-28 documentation](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices.md).

**Verified:** Confused-deputy risks, per-client consent, token-audience validation,
the prohibition on token passthrough, and SSRF risks in metadata discovery,
redirects and DNS rebinding.

**Implication / limit:** MCP standardizes integration, not trusted cloud authority.
Approve endpoints and identities; constrain network destinations. The installed
Strands/MCP client's protocol compatibility was not tested.

<a id="s05"></a>
### S05 - Artifact verification

**Source:** [Sigstore Cosign: Verifying Signatures](https://docs.sigstore.dev/cosign/verifying/verify/).

**Verified:** Verification can constrain expected signing identity/issuer or a
trusted key, and normally verifies the image digest against the signature.
Custom trust-chain and local verification mechanisms are documented.

**Implication / limit:** Trust expected publishers and immutable digests through
enterprise-approved verification. A valid signature does not establish that the
code is safe. Public transparency services are not a required enterprise choice.
Specific Cosign/bundle versions and offline behavior need installation validation.

<a id="s06"></a>
### S06 - Build provenance

**Sources:** [SLSA v1.2 specification](https://slsa.dev/spec/v1.2/) and
[Build Track Basics](https://slsa.dev/spec/v1.2/build-track-basics).

**Verified:** The reviewed v1.2 specification is marked approved. Build L1 records
provenance; L2 adds authenticated provenance from a hosted build platform; L3 adds
build hardening. Consumers must verify provenance rather than merely receive it.

**Implication / limit:** Pin and verify extension artifacts and their expected
build origin. SLSA does not prove runtime least privilege, correct ingress behavior
or the truth of an agent's execution report. No SLSA level is claimed here.

**Retrieval correction:** The v1.1 levels page was marked retired.
`/spec/v1.2/levels` and `/spec/v1.3/levels` returned 404; the specification index
resolved to the approved v1.2 pages above. The retired page is not the selected
normative baseline.

<a id="s07"></a>
### S07 - OPA decision semantics

**Source:** [OPA Policy Language](https://www.openpolicyagent.org/docs/policy-language).

**Verified:** Rego evaluates structured inputs and can return structured results;
rules and expressions can be undefined.

**Implication / limit:** Recommend one initial OPA/Rego policy authority with a
strict application decision schema, explicit default deny and visible error
handling. `ALLOW_PREAUTHORIZED`, `REQUIRE_HUMAN` and `DENY` are our decision
contract, not a built-in OPA guarantee. A successful HTTP exchange alone is not
an authorization decision.

<a id="s08"></a>
### S08 - Cedar alternative and error caveat

**Source:** [Cedar Authorization](https://docs.cedarpolicy.com/auth/authorization.html).

**Verified:** Principal/action/resource/context model, default deny and
forbid-overrides-permit. Cedar skips policies with evaluation errors and returns
diagnostics; another satisfied permit can still produce Allow.

**Implication / limit:** Cedar is a credible alternative for fine-grained
authorization, but "default deny" does not mean every evaluation error fails
closed. An integration requiring that behavior must explicitly reject diagnostics.
Do not install Cedar and OPA as competing ingress policy authorities without a
separate requirement and a defined precedence model.

<a id="s09"></a>
### S09 - Evidence is not the same as a signed assertion

**Source:** [OWASP Verifying Third-Party Agent Execution Evidence](https://cheatsheetseries.owasp.org/cheatsheets/Verifying_Third_Party_Agent_Execution_Evidence_Cheat_Sheet.html).

**Verified:** Signatures establish who asserted bytes, not whether actions
occurred or whether events were omitted. Independent boundary observations
corroborate only what those observers can actually see. Shared-MAC key holders
can forge the same MACs they verify.

**Implication / limit:** Keep provider/controller observations and data-plane
probes separate from agent assertions. Hash chains, signatures and traces do not
alone establish complete, independent audit evidence.

<a id="s10"></a>
### S10 - MCP authorization scope

**Source:** [MCP Authorization, protocol 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization.md).

**Verified:** HTTP transport authorization uses resource-server/client roles,
protected-resource metadata and scoped authorization. The specification treats
STDIO differently; authorization support is optional for MCP implementations.

**Implication / limit:** Pin transport/protocol behavior and enforce our own
mandatory authentication policy. MCP conformance does not supply downstream
cloud RBAC or per-ingress-plan approval. Do not infer this version's behavior
from an installed client's package name.

<a id="s11"></a>
### S11 - Workload identity

**Source:** [SPIFFE Overview](https://spiffe.io/docs/latest/spiffe-about/overview/).

**Verified:** SPIFFE defines workload identity across heterogeneous systems and
short-lived SVID identity documents usable for mutual authentication.

**Implication / limit:** Prefer enterprise workload identity and short-lived,
target-scoped credentials; use existing cloud federation first where suitable.
SPIFFE/SPIRE is an optional interoperability mechanism, not mandatory new
infrastructure and not an authorization policy by itself.

<a id="s12"></a>
### S12 - Policy distribution and freshness

**Source:** [OPA Bundles](https://www.openpolicyagent.org/docs/management-bundles).

**Verified:** Bundles can carry signed policy/data, are distributed eventually
consistently and can optionally persist the last activated bundle for restart.
Signing/verification requires configuration.

**Implication / limit:** Check the loaded policy revision, signature, activation
health and permitted age. Persistence does not prove freshness or instantaneous
global revocation. Critical dispatch needs a current authorization/revocation
check rather than trusting asynchronous bundle convergence.

<a id="s13"></a>
### S13 - Telemetry privacy

**Source:** [OpenTelemetry: Handling Sensitive Data](https://opentelemetry.io/docs/security/handling-sensitive-data/).

**Verified:** Implementers remain responsible for sensitive attributes and
third-party instrumentation. Data minimization is preferred; redaction/filtering
processors are available. Hashing predictable identifiers is not necessarily
anonymization.

**Implication / limit:** Export minimal decision metadata, not secrets, raw
prompts, tool bodies or chain-of-thought. Sampled observability is not the audit
ledger. The former GenAI agent-span URL reported a move to a separate repository;
this research does not assume those evolving conventions are stable or installed.

<a id="s14"></a>
### S14 - Motion accessibility

**Source:** [W3C WCAG 2.2 Understanding 2.3.3: Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html).

**Verified:** Nonessential interaction-triggered motion should be disableable;
the guidance explicitly covers reduced-motion preferences. This criterion is
Level AAA.

**Implication / limit:** Make agent animation optional and nonessential to
understanding status. This source is not proof of complete WCAG conformance and
does not make all animation mandatory or beneficial.

<a id="s15"></a>
### S15 - Accessible live status

**Source:** [W3C WCAG 2.2 Understanding 4.1.3: Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).

**Verified:** Important status changes should be programmatically determinable
and announceable without moving focus; this criterion is Level AA.

**Implication / limit:** Use meaningful stage announcements and accessible
non-color status. Do not announce every token or animated connection. Browser and
assistive-technology validation remain future implementation work.

## Repository fit and corporate availability evidence

These observations are from local source inspection, not external product claims:

| Evidence | Observed implication |
|---|---|
| [Core Strands graph](../../server/strands/corePipelineGraph.ts#L80) constructs agents with `DeterministicControlPlaneModel`; graph limits are configured in the same file. | Existing graph wiring demonstrates coordination, not live authoritative ingress execution. Retain bounded reasoning, not simulated success as production proof. |
| [Dynamic runner](../../server/dagRunner.ts#L223) permits a deterministic model fallback and catches failures before returning synthesized output. | Live mode needs explicit failure/provenance handling; schema-valid fallback output cannot satisfy live evidence gates. |
| [Stage handoffs](../../server/dagRunner.ts#L417) use typed outputs and dependency waves. | Reuse the contract-first idea, but move authoritative handoffs to durable, versioned artifacts. |
| [Policy-named tool](../../server/strands/tools.ts#L145) evaluates local state and conditions. | Its name is not evidence that a production OPA policy authority exists. |
| [Interventions](../../server/strands/guardrailsAndSteering.ts#L95) enforce logical tool allowlists and service-account labels. | Preserve defense-in-depth; separately implement real IAM/RBAC and executor authorization. |
| [Plan digest and approval helpers](../../server/store.ts#L254) bind artifacts and snapshot information. | Preserve exact-plan binding while expanding identity, expiry, scope, replay and managed-key controls. |
| [Local session storage](../../server/strands/sessionMemoryTelemetry.ts#L73) uses files outside tests. | Session persistence is not the authoritative multi-replica execution ledger. |
| [Event buffer and operator helper](../../server.ts#L47) use process memory and development header identity. | Production needs verified identity, tenant-filtered durable events and replica-safe cursor replay. |

Corporate-registry metadata checks:

```text
npm view @temporalio/client version engines --json --fetch-retries=0 --fetch-timeout=20000
npm view @temporalio/worker version engines --json --fetch-retries=0 --fetch-timeout=20000
```

Both completed through the configured corporate registry and reported version
`1.26.0`, with Node engine `>= 20.3.0`. No dependencies were installed and no
registry configuration was changed.

**What this proves:** Those package metadata records were listed at retrieval.
**What it does not prove:** Curation approval of tarballs, native worker/core
bindings, transitive artifacts, container images, Temporal hosting, OPA binaries,
licenses, production connectivity, or this project's full toolchain compatibility.
T031 must verify those before a runtime is selected for deployment.

## Ingress, reconciliation, GitOps and provider semantics

<a id="i01"></a>
### I01 - Reconciliation rather than one-shot execution

**Source:** [Kubernetes Controllers](https://kubernetes.io/docs/concepts/architecture/controller/).

**Verified:** Controllers compare desired and current state, make or request
changes, and can manage external systems while reporting observed status.

**Implication / limit:** Build level-triggered observation and reconciliation;
do not make an event notification the sole source of truth. This pattern does
not make multiple controllers or clouds one atomic transaction.

<a id="i02"></a>
### I02 - Kubernetes concurrency

**Source:** [Kubernetes API Concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/).

**Verified:** Stale `resourceVersion` updates can return 409 Conflict.
Server-side apply tracks field ownership and can detect conflicts; forcing a
conflict is possible and therefore needs explicit prohibition or authorization.

**Implication / limit:** Use applicable conditional writes and ownership checks;
re-read and re-plan on material conflict. A local snapshot hash is not an API
precondition, and field ownership is not a distributed resource lock.

<a id="i03"></a>
### I03 - Gateway API conformance

**Source:** [Gateway API Conformance](https://gateway-api.sigs.k8s.io/docs/conformance/).

**Verified:** Core, Extended and implementation-specific features have different
portability expectations. Extended features are not universally implemented;
implementation-specific behavior is not covered by portable conformance tests.
Conformance reports are public, reproducible implementation evidence.

**Implication / limit:** Certify selected feature/profile compatibility, not
"supports Gateway API" or "supports AWS." Specific submitted implementation
reports were not retrieved; none of our candidate profiles is certified here.

<a id="i04"></a>
### I04 - API release/channel compatibility

**Source:** [Gateway API Versioning](https://gateway-api.sigs.k8s.io/docs/concepts/versioning/).

**Verified:** Standard and Experimental channels have different stability
guarantees; Experimental resources can introduce breaking changes.

**Implication / limit:** Pin the CRD bundle/channel as well as controller version.
Moving documentation and API graduation details must be rechecked at profile
selection; do not infer installed cluster support from the latest website.

<a id="i05"></a>
### I05 - Gateway ownership and status

**Sources:** [GatewayClass](https://gateway-api.sigs.k8s.io/reference/api-types/gatewayclass/)
and [Gateway](https://gateway-api.sigs.k8s.io/reference/api-types/gateway/).

**Verified:** GatewayClass identifies its intended controller; acceptance and
Gateway/listener conditions describe controller processing.

**Implication / limit:** Inspect the selected controller's relevant status,
not any condition with a true value. Controller selection is not a cryptographic
proof that only that controller could write status; RBAC and independent evidence
remain necessary.

<a id="i06"></a>
### I06 - AWS controller-specific behavior

**Source:** [AWS Load Balancer Controller: Gateway API](https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/guide/gateway/gateway/).

**Verified:** The reviewed controller documentation separates L4/NLB and L7/ALB
routes, disallows mixing protocol layers on one Gateway, and describes
AWS-specific CRDs and networking prerequisites. Listener certificate references
are not a universally usable certificate mechanism; ACM/static/discovery
integration is controller-specific.

**Implication / limit:** AWS is a controller/profile adapter, not a generic
HTTPRoute serializer. This is the controller project's documentation, not proof
that a particular EKS cluster or every AWS ingress product supports the profile.
Version thresholds and certificate behavior must be pinned and tested.

<a id="i07"></a>
### I07 - Azure lifecycle and listener constraints

**Source:** [Microsoft: Application Gateway for Containers Overview](https://learn.microsoft.com/en-us/azure/application-gateway/for-containers/overview).

**Verified:** The product is an AKS L7 service with ALB Controller integration.
The reviewed Gateway support table restricts listener ports to 80 and 443.
Bring-your-own and controller-managed resource strategies have different
lifecycle behavior; deleting a Gateway does not delete a BYO frontend.
Region, subnet and managed-identity prerequisites apply.

**Implication / limit:** Ownership mode belongs in the plan and certification
key. Neither L4 support nor generic Application Gateway/WAF feature parity can
be inferred from this product name. Recheck current per-feature documentation.

<a id="i08"></a>
### I08 - GKE GatewayClass differences

**Sources:** [GKE Gateway API concepts](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/gateway-api)
and [GatewayClass capabilities](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/gatewayclass-capabilities).

**Verified:** GatewayClasses map to different underlying load balancers with
different restrictions. GKE version affects supported Gateway API versions;
regional/global, internal/external and multi-cluster choices are not equivalent.

**Implication / limit:** Certify a selected class and supported GKE/API version.
The capability tables were only partially reviewed; this research does not claim
every field, TLS mode or Cloud Armor combination is supported.

<a id="i09"></a>
### I09 - GitOps health is resource-specific

**Source:** [Argo CD Resource Health](https://argo-cd.readthedocs.io/en/stable/operator-manual/health/).

**Verified:** Resource-specific and custom health assessment are documented;
generation-aware checks are important where the CRD exposes the relevant fields.
The documented Ingress address check is narrower than application traffic health.

**Implication / limit:** A sync/health badge is not our complete ingress
acceptance contract. Argo auto-sync timing, sync waves and the exact installed
Gateway health implementation were not verified by this research.

<a id="i10"></a>
### I10 - Flux drift correction and pruning

**Source:** [Flux Kustomization](https://fluxcd.io/flux/components/kustomize/kustomizations/).

**Verified:** Periodic reconciliation can detect/correct cluster drift, and
pruning can delete objects absent from the source revision.

**Implication / limit:** Directly editing GitOps-owned fields can fight the
controller; define disjoint ownership and explicit recovery through the owner.
The initial source retrieval did not cover all `wait`/`healthChecks` semantics.
No claim is made that Flux's default readiness proves our data-plane contract.

<a id="i11"></a>
### I11 - Terraform exact-plan execution

**Sources:** [Terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan)
and [Terraform apply](https://developer.hashicorp.com/terraform/cli/commands/apply).

**Verified:** `plan -out` creates a saved plan for automation; speculative plans
do not bind the eventual apply. Passing a saved plan to apply counts as approval
to Terraform and does not prompt again.

**Implication / limit:** Our executor must enforce approval before supplying the
file. Bind artifacts, inputs, provider versions and state preconditions.
Terraform's exact stale-plan refusal behavior was not verified from retrieved
text; do not rely on an undocumented freshness assumption. A prior forward plan
is not a rollback plan.

<a id="i12"></a>
### I12 - State locks have a scope

**Source:** [Terraform State Locking](https://developer.hashicorp.com/terraform/language/state/locking).

**Verified:** Locking depends on backend support; disabling it is discouraged.
Force-unlock has explicit multiple-writer risks.

**Implication / limit:** Certify the selected backend and serialize appropriate
state operations. A Terraform state lock does not prevent a cloud controller or
portal user from changing the same remote resource.

<a id="i13"></a>
### I13 - Reusable provider packaging

**Source:** [Crossplane Providers](https://docs.crossplane.io/latest/packages/providers/).

**Verified:** Providers map Kubernetes APIs to external APIs, run controller
logic in their own pods and are distributed through container registries.
Digest pinning supports repeatable installation.

**Implication / limit:** Reuse the versioned-provider/ownership pattern where
helpful. A digest pin is not a signature, and neither is behavior certification.
Do not install Crossplane solely to add another controller framework; adopt it
only where it becomes the explicitly selected resource owner.

<a id="i14"></a>
### I14 - Condition meaning and generation freshness

**Source:** [Rendered upstream Gateway API v1 Go documentation](https://pkg.go.dev/sigs.k8s.io/gateway-api/apis/v1),
particularly Gateway, listener and route condition constants/status comments.

**Verified:** Gateway acceptance is not proof of propagation. `Programmed`
describes configuration assumed to be ready soon, not independently tested
traffic. `ResolvedRefs` describes reference resolution; route conditions apply
to the relevant parent. Gateway condition updates carry the generation being
observed and must avoid overwriting a newer observed generation.

**Implication / limit:** Require the intended parent/listener and relevant current
generation, then independently verify the data path. Reason strings can be
extended by implementations; do not hard-code only today's examples.

**Retrieval limit:** The rendered upstream comments were read, but the resolved
Go module version was not captured. Raw source retrieval returned empty and the
complete CRD schema was not inspected. The precise Gateway generation rule was
verified; equivalent Route/GatewayClass sections were not fully read.
Pin and inspect the actual installed schema/controller in T001/T011 before
implementing per-resource readiness predicates.

<a id="i15"></a>
### I15 - DNS cache limits, not instant recovery

**Sources:** [RFC 1034](https://www.rfc-editor.org/rfc/rfc1034.txt),
sections 3.6 and 4.3.4, and [RFC 1035](https://www.rfc-editor.org/rfc/rfc1035.txt),
sections 3.2.1 and 7.

**Verified:** Resource-record TTL limits cache retention; cached TTLs count down.
RFC 1034 describes reducing TTL in advance of a planned change to reduce
inconsistency, and discusses negative caching.

**Implication / limit:** Updating authoritative DNS does not recall answers
already cached. Observe recovery from the intended client vantage points;
never promise a global convergence deadline from the configured TTL alone.

These are foundational RFCs, not an exhaustive modern DNS behavior review.
Later TTL/negative-cache/serve-stale clarifications, client/OS caching,
connection reuse and each cloud DNS provider's propagation behavior were not
validated here. They are implementation/certification questions, not measured
recovery guarantees.

## Durable coordination and agent runtime evidence

**Status:** Bounded primary-source comparison completed directly on 2026-11-24.
The earlier unfinished research contributes no findings or citations.

**Decision:** Recommend Temporal for durable ingress coordination and retain
Strands for bounded reasoning. Restate is a credible alternative, and LangGraph
has real persistent state/HITL capabilities. The choice is based on fit with
explicit operational workflows, current Strands investment and the documented
TypeScript lifecycle contracts below, not a measured superiority claim.

### What changed the decision

- Temporal documents explicit replay/Activity boundaries, message processing,
  retry/timeout scopes, cancellation modes and upgrade strategies.
- An official Temporal TypeScript Strands plugin exists. No agent-framework
  migration is inherently necessary; the initial integration can still use
  ordinary Activities rather than add the plugin.
- Restate's detailed durable-step documentation explicitly identifies old
  attempts continuing to perform side effects. Its high-level exactly-once
  terminology must not be interpreted as exactly-once arbitrary cloud effects.
- LangGraph documents durable interrupts and also explicitly says the
  interrupted node restarts from its beginning. Checkpointing does not excuse
  non-idempotent operations before an interrupt.
- Current Harness defaults include shell/file tools. Reusing the SDK with
  explicit allowlists is safer than adopting assembled defaults unchanged.

<a id="c01"></a>
### C01 - Temporal TypeScript workflow boundary

**Source:** [Temporal Workflow basics](https://docs.temporal.io/develop/typescript/workflows/basics).

**Verified:** Workflows run in a deterministic sandbox. Side effects and external
state access belong in Activities whose results are recorded in history.
Workflow code imports Activity types rather than I/O implementations. The
TypeScript sandbox replaces time/random/timer functions with deterministic
versions and excludes ordinary Node/DOM APIs.

**Implication / limit:** Do not import the existing Express/Strands/provider
implementation wholesale into replayable workflow code. Bounded reasoning can
run in Activities. These documented semantics do not verify our worker bundle,
native dependencies or exact installed-version compatibility.

<a id="c02"></a>
### C02 - Temporal retries, deadlines and heartbeats

**Sources:** [Activity Execution](https://docs.temporal.io/develop/typescript/activities/execution)
and [Activity Timeouts](https://docs.temporal.io/develop/typescript/activities/timeouts).

**Verified:** Activity calls are scheduled through proxies, recorded in history
and may retry after failure/timeout; implementations should be idempotent.
Start-To-Close bounds an attempt; Schedule-To-Close bounds the overall Activity
execution. Retry policies are configurable. Heartbeats detect liveness and can
carry resumable progress details; cancellation delivery depends on heartbeating
and observing cancellation/abort signals, and heartbeat throttling can delay it.

**Implication / limit:** Set attempt and total budgets explicitly, keep payloads
small and make one component own retries. A live heartbeat is not evidence that
ingress works and must not extend an absolute task deadline. Activity result
recording and a remote side effect are not one transaction.

<a id="c03"></a>
### C03 - Temporal human decisions and message semantics

**Source:** [Workflow message passing](https://docs.temporal.io/develop/typescript/workflows/message-passing).

**Verified:** Queries read workflow state without mutation/async work. Signals
are asynchronous; their response does not wait for handler processing. Updates
can return a result and have synchronous validators; absent a validator, an
Update is accepted without that optional check. Async handlers can use Activities
and durable waits. Handlers must finish before Continue-As-New; it is not
supported from inside an Update handler.

**Implication / limit:** Persist the verified approval command in the business
ledger/outbox, signal the workflow and recheck authority at execution. Do not
treat a Signal acknowledgement or a validator receiving `approved: true` as
enterprise authorization. Serialize conflicting handlers or use a command inbox;
async handlers can interleave.

<a id="c04"></a>
### C04 - Cancellation is not termination of external effects

**Source:** [Temporal cancellation](https://docs.temporal.io/develop/typescript/workflows/cancellation).

**Verified:** The default Activity `TRY_CANCEL` can release the Workflow wait
while the Activity keeps running until it receives cancellation.
`WAIT_CANCELLATION_COMPLETED` waits for acknowledgement/completion, potentially
until timeout. `ABANDON` does not request Activity cancellation.

**Implication / limit:** Recovery must not race a still-running writer. Use
appropriate cancellation handling, bounded waits, fences and outcome observation.
Neither cancellation acknowledgement nor resetting execution history undoes
effects already accepted by Kubernetes or a cloud provider.

<a id="c05"></a>
### C05 - Temporal upgrades and replay

**Source:** [TypeScript Versioning](https://docs.temporal.io/develop/typescript/workflows/versioning).

**Verified:** Changes to command-producing workflow code can break replay.
The documented approaches include Worker Versioning and patching, with replay
testing recommended. The page warns against pre-2025 experimental Worker
Versioning examples.

**Implication / limit:** Select supported versioning for the approved server/SDK,
retain compatible workers where needed, and replay old histories before release.
No replay test or production rollout was run during this documentation task.

<a id="c06"></a>
### C06 - Official Temporal / Strands TypeScript integration

**Source:** [Temporal Strands Agents integration](https://docs.temporal.io/develop/typescript/integrations/strands-agents).

**Verified:** The guide documents `@temporalio/strands-agents`, `TemporalAgent`
and `StrandsPlugin`. Model, tool and MCP operations can execute through Activities.
I/O hooks likewise need Activity-backed handling; deterministic callbacks can
execute in Workflow context. The guide shows configurable models and Activity
options rather than requiring a single inference provider.

**Implication / limit:** There is a documented fine-grained integration, not
merely a hypothetical compatibility claim. Start with specialist Activities if
that is the smaller integration; adopt the plugin only after proving Graph,
structured-output, intervention/session and privacy behavior for pinned versions.
Do not treat the sample tool wiring as our authorization architecture.

An additional corporate-only metadata query completed successfully:

```text
npm view @temporalio/strands-agents version engines peerDependencies --json --fetch-retries=0 --fetch-timeout=10000
```

It reported `2.0.0`, Node `>=22.12.0` and peers including
`@strands-agents/sdk: ^1.13.0`, `zod: ^4.0.0`, `long: ^5.3.2` and
`protobufjs: ^8.7.1`. The project's declared Strands/Zod ranges and checked
Node 22.19.0 do not show an immediate mismatch with those particular constraints.
This is **not** full dependency resolution or proof of compatibility with the
previously listed Temporal client/worker versions. No package was installed;
tarballs, native/transitive artifacts, age-policy approval and runtime integration
remain unverified.

<a id="c07"></a>
### C07 - Restate: a real durable alternative with external-effect limits

**Sources:** [Restate Key Concepts](https://docs.restate.dev/foundations/key-concepts)
and [TypeScript Durable Steps](https://docs.restate.dev/develop/ts/durable-steps).

**Verified:** Restate documents a server plus SDK services, a journal for
execution recovery, idempotency-key request deduplication, per-entity single-writer
state and single-node/HA deployment options. `ctx.run` records nondeterministic
step results; failures retry unless bounded/classified otherwise.
The durable-step guide explicitly warns that an old attempt can continue making
side effects after its connection is lost. An abort signal helps, but cannot
recall a request already received externally.

**Implication / limit:** Restate can satisfy serious durable-workflow needs;
it is not dismissed as a simple queue. It still needs our receipt/idempotency and
authorization protocol. Its single-binary description does not establish lower
operating cost or better recovery than Temporal for this deployment. Exact
versions, upgrade behavior, corporate artifacts and performance were not tested.

<a id="c08"></a>
### C08 - LangGraph persistence and human interrupts

**Sources:** [JavaScript Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
and [Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts).

**Verified:** Checkpointers persist graph/thread state; stores serve a separate
cross-thread purpose. In-memory checkpointing does not survive restart.
Interrupts can pause for external input and resume with the same thread ID.
The interrupted node restarts from the beginning, repeating code before the
interrupt. A durable checkpointer is required for production persistence.

**Implication / limit:** LangGraph has genuine durability/HITL building blocks;
do not claim otherwise. Isolate or make pre-interrupt effects idempotent and
authenticate resume commands outside graph payloads. Its documented Agent Server
can manage persistence, but that deployment/operations option was not evaluated.
Retaining Strands avoids an unjustified additional agent framework here.

<a id="c09"></a>
### C09 - Current Strands source and orchestration patterns

**Sources:** [Harness monorepo README](https://raw.githubusercontent.com/strands-agents/harness-sdk/main/README.md)
and [current TypeScript SDK README](https://raw.githubusercontent.com/strands-agents/harness-sdk/main/strands-ts/README.md).

**Verified:** The repository contains both Harness and SDK packages. Strands
describes an in-process agent loop, typed tools/structured outputs, hooks,
streaming and model portability. Graph uses declared dependencies and supports
parallel nodes; Swarm lets agents choose model-driven handoffs. Some vended
execution/file tools run on the host unless a sandbox is supplied.

**Implication / limit:** Keep the SDK and declared dependency graph for bounded
analysis; do not make a model-routed Swarm the production mutation scheduler.
The separate `sdk-typescript` repository reports that it is archived and points
to this monorepo; its old requirements are not the selected current baseline.
These are moving `main` references, not proof every feature exists in the exact
installed package. Session-manager/HITL storage semantics beyond local source
evidence still need pinned-version integration checks.

<a id="c10"></a>
### C10 - Harness defaults need explicit restriction

**Source:** [Strands Harness configuration reference](https://strandsagents.com/docs/user-guide/harness/reference/configuration/).

**Verified:** Current documented `builtinTools` defaults include shell, file
read/write/edit, web access, programmatic tool calling and subagents; `[]`
disables the built-ins. Sessions and memory have local-file defaults; skills
and background-task policies are configurable.

**Implication / limit:** Prefer an explicit SDK configuration, or disable broad
Harness defaults and opt in only reviewed tools/features. Set model, memory,
skills, sessions and background-task policy deliberately. This is a current-docs
finding, not a claim that the already-installed release has identical defaults.

<a id="c11"></a>
### C11 - When multiple agents are justified

**Source:** [LangChain JavaScript Multi-agent](https://docs.langchain.com/oss/javascript/langchain/multi-agent).

**Verified:** First-party guidance states that a single agent with appropriate
tools can handle many complex tasks. It identifies context management,
independent team development and parallelization as reasons for multiple agents,
and describes subagents, handoffs, skills, routing and custom workflows.

**Implication / limit:** Use specialists for independent read-only investigations
or distinct bounded contexts; use tools/code for mechanical checks.
Do not copy the page's illustrative call-count/token comparisons or star ratings
as an ingress performance claim. Measure this project's quality, cost, latency
and operator comprehension against a simpler baseline.

### Retrieval limits and remaining deployment gates

Two Strands concept URLs linked from the overview returned 404:
`/docs/user-guide/concepts/multi-agent/graph/` and
`/docs/user-guide/concepts/agents/session-management/`.
The current monorepo SDK README supplied the Graph/Swarm evidence instead.
The attempted Anthropic `engineering/building-effective-agents` page returned
403 and contributes **no findings** to this comparison.

The Temporal TypeScript overview confirmed the current detailed guide paths.
The former LangGraph `durable-execution` URL redirected to Persistence; the
separate Interrupts page supplied the resume/re-execution evidence.
Truncated pages were used only for the claims actually visible in retrieved text.

T002/T031 must still close the following before deployment:

| Selection question | Required evidence |
|---|---|
| Approved versions and artifacts | Exact SDK/server compatibility, Node/platform/native-binding requirements, licenses and corporate curation |
| Durable human decisions | Restart across approval, rejection, expiry and cancellation; duplicate commands have one logical effect |
| Replay and upgrades | Documented side-effect/determinism contracts and recorded-history replay across the proposed deployment strategy |
| Retry and ambiguity | Explicit retry ownership, deadlines, cancellation limits, idempotency and lost-response handling |
| Strands boundary | Exact installed Graph/session/HITL behavior; bounded analysis outputs cannot substitute for executor authorization |
| Operational fit | Hosting, identity, network/data residency, backup/restore, retention, support ownership and measured operating cost |
| Alternatives | Restate is the reviewed fallback candidate; require the same failure proof if enterprise constraints change the selection |
| Multi-agent value | Compare task success, evidence quality, latency, cost and operator comprehension against a simpler baseline |

These are implementation approval gates, not unfinished source comparison.
No live integration, hosting/cost benchmark, native-binding install or
production-readiness claim follows from this research.
