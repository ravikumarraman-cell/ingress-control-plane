# Governed Ingress Extensions: Proposed Contract

**Status:** Research-backed design proposal, not an implemented SDK or an approved plugin installation mechanism.  
**Research date:** 2026-11-24  
**Companion documents:** [Core architecture](core-architecture.md), [research evidence](research.md), [implementation roadmap](plan.md).

## 1. What "plug and play" means

A new extension implements a small, versioned contract and passes certification.
Operators can then enable its declared capabilities for approved targets without
changing the workflow's authorization or recovery machinery. It does **not** mean
installing arbitrary code, trusting a discovered MCP server, or allowing an agent
to acquire tools or permissions at runtime.

Start with reviewed, statically registered TypeScript modules in this repository.
Pure compilers may run in-process. Privileged handlers run in separately
credentialed executor workers, even when built from the same repository.
Define an out-of-process wire protocol only when an actual extension requires it;
do not build a marketplace or distributed agent fleet first.

Signatures establish artifact identity and signer assertions, not correctness.
Certification and independent observations remain necessary. See
[S01](research.md#s01), [S05](research.md#s05), [S06](research.md#s06) and
[S09](research.md#s09).

## 2. Extension kinds and non-transferable authority

| Kind | Receives | May produce | Must not do |
|---|---|---|---|
| Analyzer | Scoped evidence references and an approved task | Structured findings, missing evidence, proposed options | Mutate infrastructure, grant permissions or authorize its own advice |
| Capability provider / compiler | Validated intent, profile and normalized observations | Constraints, declarative artifacts and required checks | Invent support, silently downgrade behavior or access execution credentials |
| Actuator | Exact authorized operation and approved artifact references | Submission receipt, operation handle and observed outcome | Accept arbitrary commands or changes outside the envelope |
| Verifier | Expected behavior, approved vantage points and observation scope | Timestamped checks with provenance and explicit gaps | Modify the target to make verification pass |
| Policy pack | Validated authorization inputs | A schema-checked decision and obligations | Override higher-priority mandatory controls or change its own trust configuration |

These are logical responsibilities, not five mandatory services. A profile can
compose shared Kubernetes code with provider-specific certificate, DNS or edge
handlers. A module implementing multiple kinds must still receive different
credentials and execution contexts for read and write operations.

An agent descriptor is configuration, not executable authority. Its requested
tools are intersected with installed certification, operator policy and current
target authorization. An unknown or newly added tool is disabled by default.

## 3. Installed descriptor

The following is a field contract to implement in T002/T010/T031, not a finished
JSON Schema.

| Field group | Required content and invariant |
|---|---|
| Identity | Organization-controlled extension ID, immutable release version, artifact digest and contract-version range |
| Trust | Approved publisher/build identity, signature verification policy, provenance reference and corporate artifact location |
| Compatibility | Supported core/schema versions; controller, CRD bundle/channel, provider API and tool versions where relevant |
| Capability selectors | Explicit target/region/exposure/protocol/ownership/execution-mode predicates and unsupported combinations |
| Permissions | Exact API operations, resource kinds and target scopes; secret-reference types; permitted network destinations |
| Methods | Implemented read/compile/submit/observe/recover methods and input/output schema versions |
| Execution semantics | Side-effect classification, idempotency behavior, conditional-write support, cancellation limits and outcome-query behavior |
| Bounds | Pagination/completeness rules, absolute/per-attempt deadlines, no-progress threshold, maximum attempts, cancellation-acknowledgement limit, concurrency and quota/cost budgets |
| Recovery | Supported compensations, preserved-state requirements, irreversible effects and escalation conditions |
| Operations | Owner, support runbook, compatibility fixtures, certification evidence, deprecation and revocation behavior |

The core independently verifies the descriptor against installation policy.
An extension cannot self-certify its capabilities or expand an installed
permission set by changing its metadata. Capture the effective descriptor and
certification digest in every plan.

Certification applies to a declared compatibility set, not just a cloud name.
An extension upgrade is a new installation candidate, not an automatic update to
in-flight plans.

Progress notifications and heartbeats do not renew an absolute deadline.
Cancellation must report whether execution stopped, remains pending or has an
unknown external outcome; it must not return success merely because the caller
stopped waiting. See [Temporal cancellation](research.md#c04) and
[Restate attempt overlap](research.md#c07).

## 4. Method semantics

Use the existing TypeScript/Zod patterns for runtime validation and generate
portable schemas from the same source where needed. Keep provider objects behind
the adapter; share only concepts whose semantics actually match.

| Method family | Required behavior |
|---|---|
| `discover` / `observe` | Read only; return source identity, target, resource identifiers/tokens, capture time, completeness and freshness information. A partial response is not a complete empty inventory. |
| `capabilities` | Return supported constraints for the selected installed profile. Distinguish unsupported, unknown, forbidden and temporarily unavailable. |
| `compile` | Deterministic for the same normalized inputs and pinned compiler/profile. Return artifacts, dependencies, affected ownership scopes, validation requirements and recovery boundaries. |
| `validate` | Run applicable schema/admission/provider checks; report what was checked, skipped or unavailable. A dry-run is not proof of traffic health. |
| `submit` | Accept one immutable authorized operation, enforce current preconditions and return a durable receipt or explicit outcome ambiguity. No implicit plan regeneration. |
| `observeOperation` | Resolve an operation using its original operation ID, provider handle and independently observable resource identity; safe to repeat without resubmitting the mutation. |
| `prepareRecovery` / `recover` | Describe and perform only separately authorized compensations against recorded owned state. Recheck current state; never blindly replay an old forward plan. |
| `verify` | Compare independently collected observations with the approved acceptance contract. Insufficient samples, stale evidence and inaccessible vantage points are not passes. |

Not every extension implements every method. A read-only release must not expose
a write endpoint merely to satisfy an interface.

### Common envelope

Every invocation carries:

- Tenant, workflow, intent revision, execution mode and exact target identity.
- Invocation/task ID, stable logical operation ID where applicable, and
  trace/correlation identifiers.
- Input schema version; immutable artifact/evidence references and digests.
- Installed extension/profile/certification versions.
- Deadline, attempt budget and authorized resource/egress scope.
- For writes: plan digest, authorization record, ownership preconditions,
  concurrency tokens and execution fence where enforceable.

Authenticate the caller and authorize each operation at the receiving execution
boundary. Fields supplied by a caller are claims to verify, not credentials.
Do not pass cloud secrets through this envelope, prompts or event payloads.

### Result and error contract

Separate a method's technical result from the infrastructure lifecycle:

- A successful submission means **submitted**, not **verified**.
- Read results distinguish complete, partial, stale and unavailable evidence.
- Operation outcomes distinguish not submitted, accepted, outcome unknown,
  reconciling, verified, failed and recovery needed.
- Failures include stable category, affected scope, retry disposition, safe
  operator explanation and evidence references. Useful categories include
  invalid intent, unsupported capability, forbidden, stale precondition,
  ownership conflict, quota exhausted, rate limited, transient transport,
  outcome unknown and permanent provider failure.
- Unknown categories and malformed results stop the affected mandatory step;
  they do not fall through to success or a simulator.

The core owns classification policy. It must not blindly retry because an
extension marks an error transient.

## 5. Duplicate delivery, retries and ambiguous writes

1. The executor durably creates an operation record before dispatch. Its unique
   key includes tenant and logical operation ID; the request digest is immutable.
2. Authorization is checked and reserved/consumed atomically for that logical
   operation. Concurrent duplicate requests cannot authorize different actions.
3. Use a provider idempotency key and conditional-write primitive when available.
   Record the provider request/operation handle without exposing credentials.
4. If the response is lost, record `OUTCOME_UNKNOWN`. Observe first. Do not start
   a second logical operation or blindly resubmit a non-idempotent request.
5. A repeated delivery of the **same** operation can recover its existing receipt.
   Single-use approval does not mean creating a new approval for every network
   retry. Any further dispatch still needs valid current execution authority.
6. If the provider cannot disambiguate a non-idempotent effect, stop for recovery
   rather than pretending that a local unique key creates exactly-once effects.

Leases alone are insufficient: an expired worker can still be running.
Use fencing and resource preconditions where the downstream system can enforce
them. Where it cannot, certify a serialized ownership strategy or disable the
unsafe operation. A local fence does not control portal users or other systems.

See the [core failure model](core-architecture.md#6-failure-recovery-and-concurrency-model)
and [transaction authorization evidence](research.md#s02).

## 6. Capability and certification lifecycle

An installation progresses through:

```text
proposed -> reviewed -> verified-read-only -> verified-gitops
                                         \-> verified-direct (separate gate)
       \-> rejected / revoked / deprecated as applicable
```

GitOps and direct verification are separate execution qualifications, not
automatic consequences of passing the same interface.

Each certification record binds:

- Extension and artifact digest, contract/schema version and test evidence.
- Exact controller/API/GatewayClass and CRD bundle/channel compatibility.
- Target restrictions, region, exposure, protocols, selected features and
  resource ownership model.
- Identity, network, DNS, PKI and edge-policy prerequisites.
- Execution mode, conditional-write and ambiguity-handling guarantees.
- Real readiness/probe/recovery results, failure cases and known limitations.
- Accountable reviewer/owner, verification date and reassessment conditions.

Use predicates to describe a reviewed compatibility set; do not generate every
theoretical cross-product or imply that an untested region is certified.
An operator may request certification of a missing combination, but cannot click
an approval button to make an unsupported mandatory feature safe.

Revocation immediately blocks new eligible dispatches through the trusted
authorization boundary. Existing operations are observed and handled according
to their state; revocation must not erase receipts or blindly kill recovery.
Pin in-flight workflows to their approved releases. Upgrades require compatibility
checks, certification and an explicit migration/drain decision.

## 7. Host controls and supply chain

- Resolve packages, images, charts, IaC providers and browser artifacts only
  through approved corporate sources. A listed version is not proof that its
  tarball, native bindings or transitive artifacts pass curation.
- Verify digest, expected signer/build identity and provenance using approved
  trust roots. Do not require public transparency-log publication of enterprise
  metadata; use the approved enterprise/offline verification path.
- Do not hot-load third-party JavaScript into the API process. An isolated
  process/container is a boundary only with enforced identity, filesystem,
  resource and network restrictions.
- When using the assembled Strands Harness, disable broad built-in tools and
  opt in only reviewed capabilities. Set skills, memory and background execution
  deliberately rather than inheriting local-development defaults.
  See [C10](research.md#c10).
- Deny unrestricted shell tools. Use reviewed SDK calls or fixed, validated
  command runners. Reject arbitrary Terraform provisioners, external execution,
  remote modules and unapproved provider downloads.
- For MCP integrations, approve server identity, transport/protocol version,
  tool definitions, scopes and egress. Tool annotations are not authorization.
  Never forward an MCP access token as a downstream cloud token.
- Constrain probe destinations and redirects, including metadata/link-local
  addresses and DNS rebinding. Approved internal targets require a deliberately
  scoped internal vantage point, not disabling SSRF protection globally.
- Enforce tenant/session memory isolation and bounded context. Retrieved content,
  DNS text, manifests, annotations and tool descriptions remain untrusted data.
  Prompt labels, regex filters and a second model are defense-in-depth, not the
  execution security boundary.

Supporting evidence: [S01](research.md#s01), [S03](research.md#s03),
[S04](research.md#s04), [S05](research.md#s05), [S06](research.md#s06) and
[S10](research.md#s10).

## 8. Required acceptance evidence

Before enabling writes, demonstrate:

1. Unsupported/unknown combinations, unsigned or revoked artifacts, schema
   mismatches and excess permissions reject before dispatch.
2. Concurrent duplicates produce one logical operation and preserve its receipt;
   changed parameters with the same operation ID reject.
3. Crash-before-send, crash-after-send, lost response, stale worker, conflicting
   resource change, rate limit and cancellation have explicit outcomes.
4. Authorization expiry/revocation, missing audit persistence and unavailable
   policy cannot silently widen authority.
5. A compromised analyzer or malicious retrieved instruction cannot invoke the
   actuator outside its existing authorization.
6. Simulation cannot obtain live credentials or satisfy a live evidence gate.
7. Controller/provider status and real probes establish the declared result;
   the extension's own signed success assertion alone does not.
8. Recovery proves the allowed restoration boundary or reports recovery needed,
   including partial and non-reversible effects.

Contract fixtures support development; only real selected-profile evidence
qualifies external IAM, controller behavior, propagation and data-plane results.
Implement these under the existing roadmap's T027-T031, not a second unrelated
test framework.
