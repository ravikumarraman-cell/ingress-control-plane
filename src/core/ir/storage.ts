import { IngressIR } from './types';

const STORAGE_KEY = 'ingressos.controlplane.ir.v1';

/**
 * Computes a deterministic 8-character config revision hash from the canonical IR.
 */
export function hashIR(ir: IngressIR): string {
  const canonical = JSON.stringify({
    clusterName: ir.clusterName,
    listeners: ir.listeners,
    routes: ir.routes,
    upstreams: ir.upstreams,
    policies: ir.policies,
    certificates: ir.certificates,
    plugins: ir.plugins,
    routeOrder: ir.routeOrder,
  });

  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < canonical.length; i++) {
    const ch = canonical.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return combined.toString(16).padStart(12, '0').slice(0, 8);
}

export function loadPersistedIR(): IngressIR | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as IngressIR;
    if (!parsed || typeof parsed !== 'object' || !parsed.routes || !parsed.upstreams || !parsed.listeners) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function savePersistedIR(ir: IngressIR): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ir));
  } catch {
    // Ignore storage quota errors cleanly
  }
}

/**
 * Deterministic YAML serializer for exporting canonical IR documents.
 */
export function toYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (value === '' || /[:#\n{}[\],&*!|>'"%@`]/.test(value) || /^\s|\s$/.test(value)) {
      return JSON.stringify(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value
      .map((item) => {
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          const inner = toYaml(item, indent + 1);
          const lines = inner.split('\n');
          return `${pad}- ${lines[0].trimStart()}\n${lines.slice(1).join('\n')}`.trimEnd();
        }
        return `${pad}- ${toYaml(item, indent + 1)}`;
      })
      .join('\n');
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '{}';
  return entries
    .map(([k, v]) => {
      if (v !== null && typeof v === 'object') {
        if (Array.isArray(v) && v.length === 0) return `${pad}${k}: []`;
        if (!Array.isArray(v) && Object.keys(v).length === 0) return `${pad}${k}: {}`;
        return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
      }
      return `${pad}${k}: ${toYaml(v, indent)}`;
    })
    .join('\n');
}
