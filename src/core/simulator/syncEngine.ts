import { hashIR } from '../ir/storage';
import { EdgeRegion, IngressIR, RegionalNodeState } from '../ir/types';

export const EDGE_REGION_META: Record<EdgeRegion, { label: string; baseSyncLatencyMs: number }> = {
  'us-east': { label: 'US East (iad-1)', baseSyncLatencyMs: 18 },
  'eu-central': { label: 'EU Central (fra-1)', baseSyncLatencyMs: 34 },
  'ap-south': { label: 'AP South (bom-1)', baseSyncLatencyMs: 52 },
};

export function createInitialRegions(ir: IngressIR): Record<EdgeRegion, RegionalNodeState> {
  const hash = hashIR(ir);
  const now = new Date().toISOString();
  return {
    'us-east': {
      region: 'us-east',
      label: EDGE_REGION_META['us-east'].label,
      status: 'synced',
      activeHash: hash,
      syncLatencyMs: 18,
      lastSyncedAt: now,
      activeConnections: 482,
      rps: 1840,
    },
    'eu-central': {
      region: 'eu-central',
      label: EDGE_REGION_META['eu-central'].label,
      status: 'synced',
      activeHash: hash,
      syncLatencyMs: 34,
      lastSyncedAt: now,
      activeConnections: 319,
      rps: 1210,
    },
    'ap-south': {
      region: 'ap-south',
      label: EDGE_REGION_META['ap-south'].label,
      status: 'synced',
      activeHash: hash,
      syncLatencyMs: 52,
      lastSyncedAt: now,
      activeConnections: 194,
      rps: 760,
    },
  };
}

export function reconcileRegionDrift(
  regions: Record<EdgeRegion, RegionalNodeState>,
  desiredHash: string,
  droppedRegion?: EdgeRegion | null
): Record<EdgeRegion, RegionalNodeState> {
  const next = { ...regions };
  (Object.keys(next) as EdgeRegion[]).forEach((reg) => {
    const node = next[reg];
    if (droppedRegion === reg) {
      next[reg] = { ...node, status: 'degraded' };
    } else if (node.activeHash !== desiredHash) {
      next[reg] = { ...node, status: 'drifted' };
    } else {
      next[reg] = { ...node, status: 'synced' };
    }
  });
  return next;
}
