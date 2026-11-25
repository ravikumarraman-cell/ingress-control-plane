/**
 * Deterministic ETag & Hashing Service
 * Implements canonical normalization and deterministic SHA-256 hashing
 * Critical for TOCTOU protection and state versioning
 */

import { createHash } from 'crypto';
import type { StateSnapshot } from '../schemas/v1-contracts';

export class HashingService {
  static computeSha256(data: string | Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }

  static computeStateEtag(topology: Record<string, unknown>): string {
    const normalized = this.normalizeForHashing(topology);
    const jsonString = JSON.stringify(normalized);
    return this.computeSha256(jsonString);
  }

  static computePlanDigest(diffs: Array<{ filePath: string; operation: string; diff: string }>): string {
    const normalized = diffs
      .sort((a, b) => a.filePath.localeCompare(b.filePath))
      .map(d => JSON.stringify(d));

    const concatenated = normalized.join('|');
    return this.computeSha256(concatenated);
  }

  static computeRollbackDigest(precomputedArtifacts: Array<{ filePath: string; diff: string }>): string {
    const normalized = precomputedArtifacts
      .sort((a, b) => a.filePath.localeCompare(b.filePath))
      .map(a => JSON.stringify(a));

    const concatenated = normalized.join('|');
    return this.computeSha256(concatenated);
  }

  static computeApprovalSignature(components: {
    workflowId: string;
    planId: string;
    approvedStateEtag: string;
    approvedPlanDigest: string;
    reviewerId: string;
  }): string {
    const sortedKeys = Object.keys(components).sort();
    const orderedValues = sortedKeys.map(key => components[key as keyof typeof components]).join('|');

    return this.computeSha256(orderedValues);
  }

  static computeAuditEventHash(previousHash: string, eventData: Record<string, unknown>): string {
    const eventJson = JSON.stringify(eventData);
    const combined = previousHash + eventJson;
    return this.computeSha256(combined);
  }

  private static normalizeForHashing(obj: unknown): unknown {
    if (obj === null || obj === undefined) return null;

    if (Array.isArray(obj)) {
      return obj.map(item => this.normalizeForHashing(item)).sort();
    }

    if (typeof obj === 'object') {
      const normalized: Record<string, unknown> = {};
      const keys = Object.keys(obj as Record<string, unknown>).sort();

      for (const key of keys) {
        const value = (obj as Record<string, unknown>)[key];

        if (this.shouldExcludeField(key)) {
          continue;
        }

        normalized[key] = this.normalizeForHashing(value);
      }

      return normalized;
    }

    return obj;
  }

  private static shouldExcludeField(key: string): boolean {
    const excludedPatterns = ['resourceVersion', 'timestamp', 'createdAt', 'updatedAt', 'managedFields', 'uid'];

    return excludedPatterns.some(pattern => key.toLowerCase().includes(pattern.toLowerCase()));
  }
}

export class DiffEngine {
  static computeUnifiedDiff(before: string, after: string): string {
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');

    const hunks: string[] = [];
    hunks.push(`--- original`);
    hunks.push(`+++ modified`);

    let beforeIdx = 0;
    let afterIdx = 0;

    while (beforeIdx < beforeLines.length || afterIdx < afterLines.length) {
      const beforeLine = beforeLines[beforeIdx] || '';
      const afterLine = afterLines[afterIdx] || '';

      if (beforeLine === afterLine) {
        hunks.push(` ${beforeLine}`);
        beforeIdx++;
        afterIdx++;
      } else {
        if (beforeIdx < beforeLines.length) {
          hunks.push(`-${beforeLine}`);
          beforeIdx++;
        }
        if (afterIdx < afterLines.length) {
          hunks.push(`+${afterLine}`);
          afterIdx++;
        }
      }
    }

    return hunks.join('\n');
  }

  static countDiffStats(diff: string): { added: number; removed: number } {
    const lines = diff.split('\n');
    let added = 0;
    let removed = 0;

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) added++;
      if (line.startsWith('-') && !line.startsWith('---')) removed++;
    }

    return { added, removed };
  }

  static generateLineByLineDiff(before: Array<{ line: string; number: number }>, after: Array<{ line: string; number: number }>): string {
    const diffs: string[] = [];

    const maxLength = Math.max(before.length, after.length);

    for (let i = 0; i < maxLength; i++) {
      const beforeItem = before[i];
      const afterItem = after[i];

      if (beforeItem && afterItem && beforeItem.line === afterItem.line) {
        diffs.push(` ${beforeItem.number} | ${beforeItem.line}`);
      } else {
        if (beforeItem) {
          diffs.push(`-${beforeItem.number} | ${beforeItem.line}`);
        }
        if (afterItem) {
          diffs.push(`+${afterItem.number} | ${afterItem.line}`);
        }
      }
    }

    return diffs.join('\n');
  }
}

export class StateVersioningService {
  private stateHistory: Map<string, StateSnapshot> = new Map();

  recordSnapshot(snapshot: StateSnapshot): void {
    this.stateHistory.set(snapshot.id, snapshot);
  }

  getSnapshot(snapshotId: string): StateSnapshot | undefined {
    return this.stateHistory.get(snapshotId);
  }

  getSnapshotByEtag(etag: string): StateSnapshot | undefined {
    for (const snapshot of this.stateHistory.values()) {
      if (snapshot.stateEtag === etag) {
        return snapshot;
      }
    }
    return undefined;
  }

  verifyStateConsistency(currentEtag: string, expectedEtag: string): boolean {
    return currentEtag === expectedEtag;
  }

  getAllSnapshots(): StateSnapshot[] {
    return Array.from(this.stateHistory.values());
  }

  clearHistory(): void {
    this.stateHistory.clear();
  }
}
