/**
 * Workflow Repository
 * Data access layer for workflow persistence
 * Supports filtering, sorting, and audit trail queries
 */

import type { Workflow } from '../schemas/v1-contracts';
import type { AsyncResult } from '../core/result';
import { ok, err } from '../core/result';
import { InMemoryRepository } from './base-repository';

export interface WorkflowQuery {
  status?: string;
  requesterEmail?: string;
  environment?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  sortBy?: 'createdAt' | 'updatedAt' | 'status';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export class WorkflowRepository extends InMemoryRepository<Workflow> {
  async findByStatus(status: string): AsyncResult<Workflow[]> {
    return this.findBy(w => w.status === status);
  }

  async findByRequester(requesterEmail: string): AsyncResult<Workflow[]> {
    return this.findBy(w => w.ingressRequest.requesterEmail === requesterEmail);
  }

  async findByEnvironment(environment: string): AsyncResult<Workflow[]> {
    return this.findBy(w => w.ingressRequest.environment === environment);
  }

  async query(query: WorkflowQuery): AsyncResult<Workflow[]> {
    const allResult = await this.findAll();
    if (!allResult.success) return allResult;

    let filtered = allResult.value;

    if (query.status) {
      filtered = filtered.filter(w => w.status === query.status);
    }

    if (query.requesterEmail) {
      filtered = filtered.filter(w => w.ingressRequest.requesterEmail === query.requesterEmail);
    }

    if (query.environment) {
      filtered = filtered.filter(w => w.ingressRequest.environment === query.environment);
    }

    if (query.createdAfter) {
      filtered = filtered.filter(w => w.createdAt >= query.createdAfter!);
    }

    if (query.createdBefore) {
      filtered = filtered.filter(w => w.createdAt <= query.createdBefore!);
    }

    if (query.sortBy) {
      filtered.sort((a, b) => {
        const aValue = a[query.sortBy as keyof Workflow];
        const bValue = b[query.sortBy as keyof Workflow];

        if (aValue === undefined || bValue === undefined) return 0;
        if (aValue < bValue) return query.sortOrder === 'desc' ? 1 : -1;
        if (aValue > bValue) return query.sortOrder === 'desc' ? -1 : 1;
        return 0;
      });
    }

    if (query.limit) {
      const offset = query.offset || 0;
      filtered = filtered.slice(offset, offset + query.limit);
    }

    return ok(filtered);
  }

  async findPendingApprovals(): AsyncResult<Workflow[]> {
    return this.findBy(w => {
      const isPending = w.status === 'AWAITING_APPROVAL' && w.approval === undefined;
      return isPending;
    });
  }

  async findByApprovedRange(startDate: Date, endDate: Date): AsyncResult<Workflow[]> {
    return this.findBy(w => {
      if (!w.approval) return false;
      return w.approval.approvedAt >= startDate && w.approval.approvedAt <= endDate;
    });
  }

  async getAuditTrailForWorkflow(workflowId: string): AsyncResult<Workflow['auditTrail']> {
    const result = await this.findById(workflowId);
    if (!result.success) return result;
    return ok(result.value.auditTrail);
  }

  async countByStatus(status: string): AsyncResult<number> {
    const result = await this.findByStatus(status);
    return result.success ? ok(result.value.length) : result;
  }

  async getMetrics(): AsyncResult<{
    totalWorkflows: number;
    byStatus: Record<string, number>;
    byEnvironment: Record<string, number>;
    averageApprovalTimeMs: number;
  }> {
    const allResult = await this.findAll();
    if (!allResult.success) return allResult;

    const workflows = allResult.value;
    const byStatus: Record<string, number> = {};
    const byEnvironment: Record<string, number> = {};
    const approvalTimes: number[] = [];

    for (const workflow of workflows) {
      byStatus[workflow.status] = (byStatus[workflow.status] || 0) + 1;
      byEnvironment[workflow.ingressRequest.environment] = (byEnvironment[workflow.ingressRequest.environment] || 0) + 1;

      if (workflow.approval) {
        const timeDiff = workflow.approval.approvedAt.getTime() - workflow.createdAt.getTime();
        approvalTimes.push(timeDiff);
      }
    }

    const averageApprovalTimeMs = approvalTimes.length > 0 ? approvalTimes.reduce((a, b) => a + b, 0) / approvalTimes.length : 0;

    return ok({
      totalWorkflows: workflows.length,
      byStatus,
      byEnvironment,
      averageApprovalTimeMs,
    });
  }
}
