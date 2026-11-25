# Phase v1.1 — Quick Reference Guide

## Core Concepts

### Result<T, E> — Railway-Oriented Programming
```typescript
// Success path
const result = ok(value);
result.map(v => transform(v))
      .flatMap(v => asyncOperation(v))
      .tap(v => log(v));

// Error path
const error = err(new Error("failed"));
error.getOrElse(fallback);  // → fallback
error.getOrThrow();         // → throws Error("failed")

// Async support
type AsyncResult<T> = Promise<Result<T, E>>;
const asyncOp = okAsync(value);
const composed = await asyncOp
  .map(v => transform(v))
  .flatMap(v => asyncFn(v));
```

**When to use:** Every operation that can fail. No try-catch needed.

### EventBus — Event-Driven Architecture
```typescript
const eventBus = new EventBus<DomainEvent>();

// Subscribe
eventBus.subscribe('WorkflowCreated', (event) => {
  console.log(`Workflow ${event.workflowId} created`);
});

// Publish
eventBus.publish({ type: 'WorkflowCreated', workflowId: '123', ... });

// Replay from buffer (last 100 events)
const history = eventBus.getHistory();
```

**When to use:** Workflow lifecycle events, audit events, agent coordination.

### StateMachine — Declarative Transitions
```typescript
const machine = new StateMachine<WorkflowStatus, WorkflowContext>(
  'INTAKE',
  {
    'INTAKE': { 'ANALYZING': () => canAnalyze(ctx) },
    'ANALYZING': { 'AWAITING_APPROVAL': () => true },
    'AWAITING_APPROVAL': { 'APPROVED': () => isApproved(ctx) },
  }
);

await machine.transition('ANALYZING');  // OK
await machine.transition('COMPLETED');  // Error: invalid transition
```

**When to use:** Workflow state progression, guard conditions, history tracking.

### Repository<T> — Data Access
```typescript
interface Repository<T extends Entity> {
  findById(id: T['id']): AsyncResult<T>;
  findAll(): AsyncResult<T[]>;
  save(entity: T): AsyncResult<T>;
  delete(id: T['id']): AsyncResult<boolean>;
  findBy(predicate: (entity: T) => boolean): AsyncResult<T[]>;
}

// Use it
const repo = new InMemoryRepository<Workflow>();
const result = await repo.findBy(w => w.status === 'AWAITING_APPROVAL');
if (result.success) {
  console.log(result.value);  // Workflow[]
}
```

**When to use:** Any CRUD operation. Implementations include InMemory, Cached, Workflow-specific, Audit-specific.

### HashingService — Deterministic ETag
```typescript
const hashing = new HashingService();

// Compute ETag
const etag = hashing.computeStateEtag(topology);  // deterministic SHA-256

// Generate diff
const diff = hashing.generateUnifiedDiff(before, after);  // line-based

// Approve with signature
const signature = hashing.computeApprovalSignature({
  workflowId,
  planDigest,
  targetStateEtag,
  reviewerId,
});
```

**When to use:** State versioning, approval binding, diff generation, change plan digests.

---

## File Structure

```
backend/
  core/
    types.ts                 # Domain interfaces (Entity, Repository, UseCase)
    result.ts               # Result<T, E> + AsyncResult<T> + utilities
    event-bus.ts            # Pub-sub with 100-event buffer
    state-machine.ts        # Declarative transitions
    logger.ts               # Structured logging + NoOp variant
    index.ts                # Selective re-exports
  
  repositories/
    base-repository.ts      # Abstract CRUD + InMemory + Cached
    workflow-repository.ts  # Workflow queries (byStatus, byRequester, etc.)
    audit-repository.ts     # Append-only ledger with hash-chain verification
  
  services/
    hashing-service.ts      # Deterministic ETag, diff, signatures
    use-cases.ts            # 7 composable business logic operations
    v1-orchestrator.ts      # Service orchestration + DI container
  
  schemas/
    v1-contracts.ts         # 15+ Zod schemas with security validators
  
  resilience/
    resilience-patterns.ts  # CircuitBreaker, Retry, RateLimit, Bulkhead
  
  __tests__/
    fixtures.ts             # Mock generators + assertion helpers
    result.test.ts          # 8 Result type tests
    hashing-service.test.ts # 15+ hashing tests
```

---

## Common Patterns

### Error Handling (No try-catch needed)
```typescript
const workflow = await createWorkflow(request)
  .flatMap(w => validateApproval(w))
  .flatMap(w => persistWorkflow(w));

if (!workflow.success) {
  console.error(workflow.error);  // Type-safe error access
}
```

### Query DSL with Repository
```typescript
const result = await workflowRepo.findByQuery({
  status: 'AWAITING_APPROVAL',
  createdAfter: new Date('2025-01-01'),
  sortBy: 'createdAt',
  sortOrder: 'desc',
  limit: 10,
  offset: 0,
});
```

### Audit Trail (Append-Only)
```typescript
const auditRepo = new AuditEventRepository();

// Can only append
await auditRepo.append({
  aggregateId: 'wf-123',
  event: 'WorkflowApproved',
  details: { approver: 'alice@example.com' },
  // previousHash + currentHash computed automatically
});

// Verify chain
const verified = await auditRepo.verifyIntegrity();
console.log(verified);  // true if no tampering detected
```

### Service Orchestrator (DI Container)
```typescript
const orchestrator = new V1ServiceOrchestrator({
  logger: new ConsoleLogger(),
  hashingService: new HashingService(),
  workflowRepo: new InMemoryRepository<Workflow>(),
  auditRepo: new AuditEventRepository(),
});

// Use high-level operations
const result = await orchestrator.createWorkflow(request);
const workflows = await orchestrator.listWorkflows({ status: 'AWAITING_APPROVAL' });
```

### Resilience Patterns
```typescript
// Circuit breaker
const breaker = new CircuitBreaker({ threshold: 5 });
const result = await breaker.execute(() => risky_operation());

// Retry with backoff
const strategy = new RetryStrategy({ maxRetries: 3, backoffMs: 100 });
const result = await strategy.execute(() => potentially_failing_op());

// Rate limiter
const limiter = new RateLimiter({ capacity: 100, refillMs: 1000 });
await limiter.acquire();  // Wait until capacity available
```

---

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- result.test.ts

# Watch mode
npm test -- --watch

# Coverage
npm test -- --coverage
```

---

## Compilation

```bash
# Type-check without emitting
npm run lint

# Fix formatting
npm run format

# Build (if configured)
npm run build
```

---

## Design Decisions

| Decision | Rationale |
| --- | --- |
| Result<T, E> over try-catch | Deterministic error handling, no surprise throws, type-safe |
| Async/await + AsyncResult | Native Promise support, composable error flows |
| Repository pattern | Testable, swappable storage backends |
| Append-only audit | Compliance, tamper-detection, immutable record |
| Deterministic hashing | State versioning, approval binding, reproducibility |
| Zod schemas | Runtime validation, TypeScript inference, security validators |
| Resilience patterns | Production-grade fault tolerance without libraries |
| Hexagonal architecture | Core domain independent from infrastructure |

---

## Next Steps

1. **Phase v1.2**: Multi-agent pipeline (8 agent classes, 1,200–1,500 LOC)
2. **Phase v1.4**: FastAPI SSE bridge + TanStack UI
3. **Phase v2**: GitOps PR execution + Four-Eyes RBAC
4. **Phase v3**: Direct canary + auto-rollback

---

## Questions?

- **Why Result<T, E> instead of exceptions?** Deterministic control flow, no surprise throws, type-safe error paths.
- **Why append-only audit?** Compliance (non-repudiation), tamper-detection, immutable record.
- **Why deterministic hashing?** State versioning, approval binding, reproducibility across runs.
- **Why Zod?** Runtime validation, TypeScript inference, security validators, discriminated unions.

