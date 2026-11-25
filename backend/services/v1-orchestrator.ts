/**
 * Phase v1 Service Orchestrator
 * Coordinates all v1 services with dependency injection
 * Provides high-level operations for the control plane
 */

import type { Logger } from '../core/types';
import { WorkflowRepository } from '../repositories/workflow-repository';
import { AuditEventRepository } from '../repositories/audit-repository';
import { HashingService, StateVersioningService } from '../services/hashing-service';
import {
  CreateWorkflowUseCase,
  ComputeStateEtagUseCase,
  GenerateDiffUseCase,
  ComputeChangePlanDigestUseCase,
  ValidateApprovalSignatureUseCase,
  ListWorkflowsUseCase,
  GetWorkflowDetailsUseCase,
} from './use-cases';
import type { IngressRequest, Workflow, AuditEvent } from '../schemas/v1-contracts';
import { ok, type AsyncResult } from '../core/result';

export interface V1ServiceOrchestratorConfig {
  logger: Logger;
  enableAuditTrail: boolean;
}

export class V1ServiceOrchestrator {
  private workflowRepository: WorkflowRepository;
  private auditRepository: AuditEventRepository;
  private stateVersioning: StateVersioningService;

  private createWorkflowUseCase: CreateWorkflowUseCase;
  private computeStateEtagUseCase: ComputeStateEtagUseCase;
  private generateDiffUseCase: GenerateDiffUseCase;
  private computePlanDigestUseCase: ComputeChangePlanDigestUseCase;
  private validateSignatureUseCase: ValidateApprovalSignatureUseCase;
  private listWorkflowsUseCase: ListWorkflowsUseCase;
  private getWorkflowDetailsUseCase: GetWorkflowDetailsUseCase;

  constructor(private logger: Logger, private config: V1ServiceOrchestratorConfig) {
    this.workflowRepository = new WorkflowRepository();
    this.auditRepository = new AuditEventRepository();
    this.stateVersioning = new StateVersioningService();

    this.createWorkflowUseCase = new CreateWorkflowUseCase(this.workflowRepository);
    this.computeStateEtagUseCase = new ComputeStateEtagUseCase();
    this.generateDiffUseCase = new GenerateDiffUseCase();
    this.computePlanDigestUseCase = new ComputeChangePlanDigestUseCase();
    this.validateSignatureUseCase = new ValidateApprovalSignatureUseCase();
    this.listWorkflowsUseCase = new ListWorkflowsUseCase(this.workflowRepository);
    this.getWorkflowDetailsUseCase = new GetWorkflowDetailsUseCase(this.workflowRepository);

    this.logger.info('V1ServiceOrchestrator initialized');
  }

  async createWorkflow(request: IngressRequest): AsyncResult<Workflow> {
    const result = await this.createWorkflowUseCase.execute({
      ingressRequest: request,
    });

    if (!result.success) {
      this.logger.error('Failed to create workflow', result.error, { requestId: request.id });
      return result;
    }

    if (this.config.enableAuditTrail) {
      await this.auditRepository.append({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        eventType: 'WORKFLOW_CREATED',
        aggregateId: result.value.workflow.id,
        aggregateType: 'Workflow',
        actorId: request.requesterEmail,
        actorRole: 'requester',
        action: 'create',
        resourceType: 'Workflow',
        resourceId: result.value.workflow.id,
        details: {
          hostname: request.targetHostname,
          environment: request.environment,
        },
      });
    }

    return ok(result.value.workflow);
  }

  async computeStateEtag(topology: Record<string, unknown>): AsyncResult<string> {
    this.logger.debug('Computing state ETag', { topologyKeys: Object.keys(topology).length });

    const result = await this.computeStateEtagUseCase.execute({
      topology,
    });

    if (result.success) {
      this.logger.debug('State ETag computed', { etag: result.value.stateEtag });
    }

    return result.success ? ok(result.value.stateEtag) : result;
  }

  async listWorkflows(
    status?: string,
    limit?: number,
    offset?: number,
  ): AsyncResult<{ workflows: Workflow[]; total: number }> {
    this.logger.debug('Listing workflows', { status, limit, offset });

    const result = await this.listWorkflowsUseCase.execute({
      status,
      limit,
      offset,
      sortBy: 'createdAt',
    });

    if (result.success) {
      this.logger.debug('Workflows listed', { total: result.value.total });
    }

    return result;
  }

  async getWorkflow(workflowId: string): AsyncResult<Workflow> {
    this.logger.debug('Getting workflow details', { workflowId });

    const result = await this.getWorkflowDetailsUseCase.execute({
      workflowId,
    });

    if (result.success) {
      this.logger.debug('Workflow retrieved', { workflowId, status: result.value.workflow.status });
    }

    return result.success ? ok(result.value.workflow) : result;
  }

  async recordAuditEvent(event: Omit<AuditEvent, 'sequenceNumber' | 'previousHash' | 'currentHash'>): AsyncResult<AuditEvent> {
    if (!this.config.enableAuditTrail) {
      return ok({
        ...event,
        sequenceNumber: 0,
        previousHash: '0'.repeat(64),
        currentHash: '0'.repeat(64),
      });
    }

    return this.auditRepository.append(event);
  }

  async getAuditTrail(aggregateId: string): AsyncResult<AuditEvent[]> {
    return this.auditRepository.getByAggregateId(aggregateId);
  }

  async verifyAuditIntegrity(): AsyncResult<{ isValid: boolean; invalidAt?: number }> {
    return this.auditRepository.verifyIntegrity();
  }

  getWorkflowRepository(): WorkflowRepository {
    return this.workflowRepository;
  }

  getAuditRepository(): AuditEventRepository {
    return this.auditRepository;
  }

  getStateVersioningService(): StateVersioningService {
    return this.stateVersioning;
  }
}
