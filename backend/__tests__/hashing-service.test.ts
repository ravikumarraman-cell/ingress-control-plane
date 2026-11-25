/**
 * Hashing Service Tests
 * Validates deterministic ETag computation and diff generation
 */

import { describe, it, expect } from 'vitest';
import { HashingService, DiffEngine } from '../services/hashing-service';
import { topologyWithFixedResourceVersion } from './fixtures';

describe('HashingService', () => {
  describe('computeSha256()', () => {
    it('produces consistent hash for same input', () => {
      const input = 'test-value';
      const hash1 = HashingService.computeSha256(input);
      const hash2 = HashingService.computeSha256(input);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
      expect(/^[a-f0-9]{64}$/.test(hash1)).toBe(true);
    });

    it('produces different hash for different input', () => {
      const hash1 = HashingService.computeSha256('input1');
      const hash2 = HashingService.computeSha256('input2');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('computeStateEtag()', () => {
    it('produces deterministic hash ignoring resourceVersion', () => {
      const topology1 = topologyWithFixedResourceVersion();
      const topology2 = JSON.parse(JSON.stringify(topology1));

      topology2.metadata.resourceVersion = '999999'; // Modify volatile field

      const etag1 = HashingService.computeStateEtag(topology1);
      const etag2 = HashingService.computeStateEtag(topology2);

      expect(etag1).toBe(etag2);
    });

    it('produces different hash for different topology content', () => {
      const topology1 = topologyWithFixedResourceVersion();
      const topology2 = JSON.parse(JSON.stringify(topology1));

      topology2.items[0].metadata.name = 'api-v2'; // Change actual content

      const etag1 = HashingService.computeStateEtag(topology1);
      const etag2 = HashingService.computeStateEtag(topology2);

      expect(etag1).not.toBe(etag2);
    });

    it('handles empty topology', () => {
      const etag = HashingService.computeStateEtag({});
      expect(etag).toHaveLength(64);
    });

    it('handles nested objects with arrays', () => {
      const topology = {
        items: [
          { id: 1, name: 'a' },
          { id: 2, name: 'b' },
        ],
      };

      // Arrays are sorted during normalization
      const etag1 = HashingService.computeStateEtag(topology);
      const etag2 = HashingService.computeStateEtag(topology);

      expect(etag1).toBe(etag2);
    });
  });

  describe('computePlanDigest()', () => {
    it('produces consistent digest for same diffs', () => {
      const diffs = [
        { filePath: 'a.yaml', operation: 'CREATE', diff: 'diff1' },
        { filePath: 'b.yaml', operation: 'UPDATE', diff: 'diff2' },
      ];

      const digest1 = HashingService.computePlanDigest(diffs);
      const digest2 = HashingService.computePlanDigest(diffs);

      expect(digest1).toBe(digest2);
    });

    it('handles diffs in any order (lexicographic sorting)', () => {
      const diffs1 = [
        { filePath: 'z.yaml', operation: 'CREATE', diff: 'z-diff' },
        { filePath: 'a.yaml', operation: 'CREATE', diff: 'a-diff' },
      ];

      const diffs2 = [
        { filePath: 'a.yaml', operation: 'CREATE', diff: 'a-diff' },
        { filePath: 'z.yaml', operation: 'CREATE', diff: 'z-diff' },
      ];

      const digest1 = HashingService.computePlanDigest(diffs1);
      const digest2 = HashingService.computePlanDigest(diffs2);

      expect(digest1).toBe(digest2);
    });
  });

  describe('computeApprovalSignature()', () => {
    it('produces signature binding all approval components', () => {
      const components = {
        workflowId: 'wf-123',
        planId: 'plan-456',
        approvedStateEtag: 'a'.repeat(64),
        approvedPlanDigest: 'b'.repeat(64),
        reviewerId: 'reviewer@example.com',
      };

      const signature1 = HashingService.computeApprovalSignature(components);
      const signature2 = HashingService.computeApprovalSignature(components);

      expect(signature1).toBe(signature2);
      expect(signature1).toHaveLength(64);
    });

    it('detects tampering with any component', () => {
      const components = {
        workflowId: 'wf-123',
        planId: 'plan-456',
        approvedStateEtag: 'a'.repeat(64),
        approvedPlanDigest: 'b'.repeat(64),
        reviewerId: 'reviewer@example.com',
      };

      const signature1 = HashingService.computeApprovalSignature(components);

      const tamperedComponents = { ...components, reviewerId: 'other@example.com' };
      const signature2 = HashingService.computeApprovalSignature(tamperedComponents);

      expect(signature1).not.toBe(signature2);
    });
  });
});

describe('DiffEngine', () => {
  describe('computeUnifiedDiff()', () => {
    it('generates unified diff format', () => {
      const before = 'line1\nline2\nline3';
      const after = 'line1\nline2-modified\nline3';

      const diff = DiffEngine.computeUnifiedDiff(before, after);

      expect(diff).toContain('--- original');
      expect(diff).toContain('+++ modified');
      expect(diff).toContain('-line2');
      expect(diff).toContain('+line2-modified');
    });

    it('handles empty strings', () => {
      const diff1 = DiffEngine.computeUnifiedDiff('', 'new content');
      const diff2 = DiffEngine.computeUnifiedDiff('old content', '');

      expect(diff1).toContain('+new content');
      expect(diff2).toContain('-old content');
    });
  });

  describe('countDiffStats()', () => {
    it('counts added and removed lines correctly', () => {
      const diff = `--- original
+++ modified
 context
-removed line
+added line`;

      const stats = DiffEngine.countDiffStats(diff);

      expect(stats.added).toBe(1);
      expect(stats.removed).toBe(1);
    });

    it('ignores diff header lines', () => {
      const diff = `--- original
+++ modified
++++`;

      const stats = DiffEngine.countDiffStats(diff);

      expect(stats.added).toBe(0);
      expect(stats.removed).toBe(0);
    });
  });
});
