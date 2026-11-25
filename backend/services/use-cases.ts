/**
 * Phase v1 Use Cases
 * Business logic layer following SOLID principles
 * Each use case is independently testable and composable
 */

import type { UseCase, AsyncResult } from '../core/types';
import { ok, err, flatMapAsync, mapAsync } from '../core/result';
import type { IngressRequest, ChangePlan, Workflow } from '../schemas/v1-contracts';
import { WorkflowStatusSchema } from '../schemas/v1-contracts';
import type { WorkflowRepository } from '../repositories/workflow-repository';
import { HashingService, DiffEngine, StateVersioningService } from '../services/hashing-service';

export interface CreateWorkflowRequest {
  ingressRequest: IngressRequest;
}

export interface CreateWorkflowResponse {
  workflow: Workflow;
}

export class CreateWorkflowUseCase implements UseCase<CreateWorkflowRequest, CreateWorkflowResponse> {
  constructor(private workflowRepository: WorkflowRepository) {}

  async execute(request: CreateWorkflowRequest): AsyncResult<CreateWorkflowResponse> {
    const now = new Date();
    const workflow: Workflow = {
      id: crypto.randomUUID(),
      status: 'INTAKE',
      version: 1,
      createdAt: now,
      updatedAt: now,
      ingressRequest: request.ingressRequest,
      auditTrail: [],
      syntheticProbes: [],
    };

    const result = await this.workflowRepository.save(workflow);
    return result.success ? ok({ workflow: result.value }) : result;
  }
}

export interface ComputeStateEtagRequest {
  topology: Record<string, unknown>;
}

export interface ComputeStateEtagResponse {
  stateEtag: string;
  topologyHash: string;
}

export class ComputeStateEtagUseCase implements UseCase<ComputeStateEtagRequest, ComputeStateEtagResponse> {
  async execute(request: ComputeStateEtagRequest): AsyncResult<ComputeStateEtagResponse> {
    const stateEtag = HashingService.computeStateEtag(request.topology);

    return ok({
      stateEtag,
      topologyHash: stateEtag,
    });
  }
}

export interface GenerateDiffRequest {
  before: string;
  after: string;
  filePath: string;
  language: 'yaml' | 'hcl' | 'json';
  operation: 'CREATE' | 'UPDATE' | 'DELETE' | 'REPLACE';
}

export interface GenerateDiffResponse {
  diff: string;
  linesAdded: number;
  linesRemoved: number;
  digest: string;
}

export class GenerateDiffUseCase implements UseCase<GenerateDiffRequest, GenerateDiffResponse> {
  async execute(request: GenerateDiffRequest): AsyncResult<GenerateDiffResponse> {
    const diff = DiffEngine.computeUnifiedDiff(request.before, request.after);
    const stats = DiffEngine.countDiffStats(diff);
    const digest = HashingService.computeSha256(diff);

    return ok({
      diff,
      linesAdded: stats.added,
      linesRemoved: stats.removed,
      digest,
    });
  }
}

export interface ComputeChangePlanDigestRequest {
  diffs: Array<{ filePath: string; operation: string; diff: string }>;
}

export interface ComputeChangePlanDigestResponse {
  planDigestSha256: string;
}

export class ComputeChangePlanDigestUseCase
  implements UseCase<ComputeChangePlanDigestRequest, ComputeChangePlanDigestResponse>
{
  async execute(request: ComputeChangePlanDigestRequest): AsyncResult<ComputeChangePlanDigestResponse> {
    const digest = HashingService.computePlanDigest(request.diffs);
    return ok({ planDigestSha256: digest });
  }
}

export interface ValidateApprovalSignatureRequest {
  workflowId: string;
  planId: string;
  approvedStateEtag: string;
  approvedPlanDigest: string;
  reviewerId: string;
  providedSignature: string;
}

export interface ValidateApprovalSignatureResponse {
  isValid: boolean;
  expectedSignature: string;
}

export class ValidateApprovalSignatureUseCase
  implements UseCase<ValidateApprovalSignatureRequest, ValidateApprovalSignatureResponse>
{
  async execute(request: ValidateApprovalSignatureRequest): AsyncResult<ValidateApprovalSignatureResponse> {
    const expectedSignature = HashingService.computeApprovalSignature({
      workflowId: request.workflowId,
      planId: request.planId,
      approvedStateEtag: request.approvedStateEtag,
      approvedPlanDigest: request.approvedPlanDigest,
      reviewerId: request.reviewerId,
    });

    const isValid = expectedSignature === request.providedSignature;

    return ok({
      isValid,
      expectedSignature,
    });
  }
}

export interface ListWorkflowsRequest {
  status?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'status';
}

export interface ListWorkflowsResponse {
  workflows: Workflow[];
  total: number;
}

export class ListWorkflowsUseCase implements UseCase<ListWorkflowsRequest, ListWorkflowsResponse> {
  constructor(private workflowRepository: WorkflowRepository) {}

  async execute(request: ListWorkflowsRequest): AsyncResult<ListWorkflowsResponse> {
    const allResult = await this.workflowRepository.findAll();
    if (!allResult.success) return allResult;

    let filtered = allResult.value;

    if (request.status) {
      filtered = filtered.filter(w => w.status === request.status);
    }

    const total = filtered.length;
    const offset = request.offset || 0;
    const limit = request.limit || 10;

    if (request.sortBy) {
      filtered.sort((a, b) => {
        const aVal = a[request.sortBy as keyof Workflow];
        const bVal = b[request.sortBy as keyof Workflow];
        if (aVal === undefined || bVal === undefined) return 0;
        if (aVal < bVal) return -1;
        if (aVal > bVal) return 1;
        return 0;
      });
    }

    filtered = filtered.slice(offset, offset + limit);

    return ok({ workflows: filtered, total });
  }
}

export interface GetWorkflowDetailsRequest {
  workflowId: string;
}

export interface GetWorkflowDetailsResponse {
  workflow: Workflow;
}

export class GetWorkflowDetailsUseCase implements UseCase<GetWorkflowDetailsRequest, GetWorkflowDetailsResponse> {
  constructor(private workflowRepository: WorkflowRepository) {}

  async execute(request: GetWorkflowDetailsRequest): AsyncResult<GetWorkflowDetailsResponse> {
    const result = await this.workflowRepository.findById(request.workflowId);
    return result.success ? ok({ workflow: result.value }) : result;
  }
}
