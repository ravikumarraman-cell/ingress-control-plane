/**
 * Audit Event Repository
 * Append-only immutable ledger with hash-chain verification
 * Prevents tampering with historical records
 */

import type { AuditEvent } from '../schemas/v1-contracts';
import type { AsyncResult } from '../core/result';
import { ok, err } from '../core/result';
import { HashingService } from '../services/hashing-service';

export class AuditEventRepository {
  private events: AuditEvent[] = [];
  private sequenceCounter = 0;

  async append(event: Omit<AuditEvent, 'sequenceNumber' | 'previousHash' | 'currentHash'>): AsyncResult<AuditEvent> {
    try {
      const previousHash = this.events.length > 0 ? this.events[this.events.length - 1].currentHash : '0'.repeat(64);

      const auditEvent: AuditEvent = {
        ...event,
        sequenceNumber: this.sequenceCounter++,
        previousHash,
        currentHash: '', // Computed below
      };

      auditEvent.currentHash = HashingService.computeAuditEventHash(previousHash, {
        ...auditEvent,
        currentHash: undefined,
      });

      this.events.push(auditEvent);
      return ok(auditEvent);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async getAll(): AsyncResult<AuditEvent[]> {
    return ok([...this.events]);
  }

  async getByAggregateId(aggregateId: string): AsyncResult<AuditEvent[]> {
    const filtered = this.events.filter(e => e.aggregateId === aggregateId);
    return ok(filtered);
  }

  async getBySequenceRange(start: number, end: number): AsyncResult<AuditEvent[]> {
    const filtered = this.events.filter(e => e.sequenceNumber >= start && e.sequenceNumber <= end);
    return ok(filtered);
  }

  async getByTimeRange(startDate: Date, endDate: Date): AsyncResult<AuditEvent[]> {
    const filtered = this.events.filter(e => e.timestamp >= startDate && e.timestamp <= endDate);
    return ok(filtered);
  }

  async getByActorId(actorId: string): AsyncResult<AuditEvent[]> {
    const filtered = this.events.filter(e => e.actorId === actorId);
    return ok(filtered);
  }

  async getByEventType(eventType: string): AsyncResult<AuditEvent[]> {
    const filtered = this.events.filter(e => e.eventType === eventType);
    return ok(filtered);
  }

  async getLatest(count: number = 10): AsyncResult<AuditEvent[]> {
    const latest = this.events.slice(Math.max(0, this.events.length - count));
    return ok(latest);
  }

  async verifyIntegrity(): AsyncResult<{ isValid: boolean; invalidAt?: number }> {
    if (this.events.length === 0) {
      return ok({ isValid: true });
    }

    let previousHash = '0'.repeat(64);

    for (let i = 0; i < this.events.length; i++) {
      const event = this.events[i];

      if (event.previousHash !== previousHash) {
        return ok({ isValid: false, invalidAt: i });
      }

      const computedHash = HashingService.computeAuditEventHash(previousHash, {
        ...event,
        currentHash: undefined,
      });

      if (event.currentHash !== computedHash) {
        return ok({ isValid: false, invalidAt: i });
      }

      previousHash = event.currentHash;
    }

    return ok({ isValid: true });
  }

  async getFullyVerifiedEvents(upToSequence: number): AsyncResult<AuditEvent[]> {
    const integrityResult = await this.verifyIntegrity();
    if (!integrityResult.success || !integrityResult.value.isValid) {
      return err(new Error('Audit ledger integrity check failed'));
    }

    const verified = this.events.filter(e => e.sequenceNumber <= upToSequence);
    return ok(verified);
  }

  async countByEventType(eventType: string): AsyncResult<number> {
    const count = this.events.filter(e => e.eventType === eventType).length;
    return ok(count);
  }

  async getMetrics(): AsyncResult<{
    totalEvents: number;
    eventsByType: Record<string, number>;
    eventsByActor: Record<string, number>;
    lastEventTime: Date | null;
  }> {
    const eventsByType: Record<string, number> = {};
    const eventsByActor: Record<string, number> = {};

    for (const event of this.events) {
      eventsByType[event.eventType] = (eventsByType[event.eventType] || 0) + 1;
      eventsByActor[event.actorId] = (eventsByActor[event.actorId] || 0) + 1;
    }

    return ok({
      totalEvents: this.events.length,
      eventsByType,
      eventsByActor,
      lastEventTime: this.events.length > 0 ? this.events[this.events.length - 1].timestamp : null,
    });
  }
}
