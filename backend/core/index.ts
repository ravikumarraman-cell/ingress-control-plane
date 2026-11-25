/**
 * Phase v1 Core Exports
 * Central index for all v1 infrastructure components
 * Simplifies imports and enforces modular structure
 */

// Core foundation (selective re-exports to avoid ambiguity)
export type { Nullable, Result } from '../core/types';
export { ConsoleLogger, NoOpLogger, LogLevel } from '../core/logger';
export { EventBus } from '../core/event-bus';
export { StateMachine } from '../core/state-machine';

// Re-export from result.ts (this is the canonical source for AsyncResult)
export type { AsyncResult } from '../core/result';
export {
  ok,
  err,
  isOk,
  isErr,
  mapResult,
  flatMapResult,
  bimap,
  getOrElse,
  getOrThrow,
  okAsync,
  errAsync,
  mapAsync,
  flatMapAsync,
  allAsync,
  allAsyncIterable,
  tap,
  tapAsync,
  tapError,
  tapErrorAsync,
  ResultError,
} from '../core/result';

// Repositories
export { BaseRepository, InMemoryRepository, CachedRepository } from '../repositories/base-repository';
export { WorkflowRepository } from '../repositories/workflow-repository';
export { AuditEventRepository } from '../repositories/audit-repository';

// Services
export { HashingService, DiffEngine, StateVersioningService } from '../services/hashing-service';
export {
  CreateWorkflowUseCase,
  ComputeStateEtagUseCase,
  GenerateDiffUseCase,
  ComputeChangePlanDigestUseCase,
  ValidateApprovalSignatureUseCase,
  ListWorkflowsUseCase,
  GetWorkflowDetailsUseCase,
} from '../services/use-cases';
export { V1ServiceOrchestrator } from '../services/v1-orchestrator';

// Schemas & types
export * from '../schemas/v1-contracts';

// Resilience patterns
export {
  CircuitBreaker,
  CircuitState,
  RetryStrategy,
  RateLimiter,
  Bulkhead,
} from '../resilience/resilience-patterns';
