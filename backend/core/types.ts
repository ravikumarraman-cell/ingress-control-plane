/**
 * Core Type Definitions
 * Fundamental types used across the entire control plane
 * Follows hexagonal architecture patterns for clean separation
 */

export type Nullable<T> = T | null | undefined;

export type Result<T, E = Error> =
  | { success: true; value: T }
  | { success: false; error: E };

export type AsyncResult<T, E = Error> = Promise<Result<T, E>>;

export interface Entity<TId = string> {
  id: TId;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface Repository<T extends Entity> {
  findById(id: T['id']): AsyncResult<T>;
  findAll(): AsyncResult<T[]>;
  save(entity: T): AsyncResult<T>;
  delete(id: T['id']): AsyncResult<boolean>;
}

export interface UseCase<TRequest, TResponse> {
  execute(request: TRequest): AsyncResult<TResponse>;
}

export interface DomainEvent {
  id: string;
  eventType: string;
  aggregateId: string;
  aggregateType: string;
  timestamp: Date;
  version: number;
  data: Record<string, unknown>;
}

export interface EventHandler<T extends DomainEvent = DomainEvent> {
  handle(event: T): AsyncResult<void>;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error, context?: Record<string, unknown>): void;
}

export interface Validator<T> {
  validate(input: unknown): Result<T>;
}

export interface Pipeline<TInput, TOutput> {
  execute(input: TInput): AsyncResult<TOutput>;
}

export enum WorkflowStatus {
  INTAKE = 'INTAKE',
  ANALYZING = 'ANALYZING',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  APPROVED = 'APPROVED',
  EXECUTING = 'EXECUTING',
  COMPLETED = 'COMPLETED',
  DRIFT_ABORTED = 'DRIFT_ABORTED',
  FAILED = 'FAILED',
  ROLLED_BACK = 'ROLLED_BACK',
}

export enum BlastRadiusLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum ChangeType {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  REPLACE = 'REPLACE',
}

export interface AuditEvent {
  id: string;
  sequenceNumber: number;
  timestamp: Date;
  eventType: string;
  aggregateId: string;
  actorId: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details: Record<string, unknown>;
  previousHash: string;
  currentHash: string;
}
