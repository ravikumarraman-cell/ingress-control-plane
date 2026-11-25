import React, { useRef, useState } from 'react';
import { Download, RefreshCw, RotateCcw, ShieldCheck, Upload } from 'lucide-react';
import { toYaml } from '../../core/ir/storage';
import { EdgeRegion, IngressIR } from '../../core/ir/types';
import { useControlPlane } from '../../store/ControlPlaneContext';

export const SecuritySyncView: React.FC = () => {
  const {
    ir,
    desiredHash,
    regions,
    snapshots,
    chaos,
    syncRegion,
    syncAllRegions,
    rollbackSnapshot,
    updateCertificate,
    importIR,
  } = useControlPlane();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const certificates = Object.values(ir.certificates);
  const referenceNow = new Date('2026-11-25T07:30:00Z');

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(ir, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${ir.clusterName}-ir.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportYaml = () => {
    const blob = new Blob([toYaml(ir)], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${ir.clusterName}-ir.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as IngressIR;
      if (!parsed.listeners || !parsed.routes || !parsed.upstreams) {
        setImportError('Uploaded JSON is not a valid IngressOS IR document.');
        return;
      }
      importIR(parsed, `Imported (${file.name})`);
    } catch {
      setImportError('Failed to parse IR JSON file.');
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-auto p-4 lg:p-5 space-y-6">
      {/* Header + Export/Import */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800/80">
        <div>
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            TLS Certificates, Regional Sync & Drift Control
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Desired Revision <span className="font-mono text-blue-700 dark:text-sky-300">{desiredHash}</span> across 3 edge regions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportJson}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] text-xs text-slate-800 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export IR JSON</span>
          </button>
          <button
            type="button"
            onClick={handleExportYaml}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] text-xs text-slate-800 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export IR YAML</span>
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] text-xs text-slate-800 dark:text-slate-200 hover:border-sky-400 transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import IR JSON</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImportFile}
            className="hidden"
          />
        </div>
      </div>

      {importError && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          {importError}
        </div>
      )}

      {/* Regional Data-Plane Sync Matrix */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-slate-700 dark:text-slate-300">Regional Data-Plane Nodes</h2>
          <button
            type="button"
            onClick={syncAllRegions}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-sky-500 text-slate-950 hover:bg-sky-400 text-xs font-semibold transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Sync All Regions</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(Object.keys(regions) as EdgeRegion[]).map((regKey) => {
            const node = regions[regKey];
            const isDrifted = node.activeHash !== desiredHash;
            const statusTone =
              node.status === 'degraded'
                ? 'text-rose-600 dark:text-rose-400'
                : isDrifted
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-emerald-700 dark:text-emerald-400';
            return (
              <div
                key={regKey}
                className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">{node.label}</div>
                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">{regKey}</div>
                  </div>
                  <span className={`text-xs font-medium capitalize ${statusTone}`}>
                    {node.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200 dark:border-slate-800/70 text-[11px] font-mono tabular-nums">
                  <div>
                    <span className="text-slate-500 block">Active Hash</span>
                    <span className={isDrifted ? 'text-amber-700 dark:text-amber-300' : 'text-slate-800 dark:text-slate-200'}>
                      {node.activeHash}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Sync Latency</span>
                    <span className="text-slate-800 dark:text-slate-200">{node.syncLatencyMs}ms</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Traffic</span>
                    <span className="text-slate-800 dark:text-slate-200">{node.rps} rps</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Connections</span>
                    <span className="text-slate-800 dark:text-slate-200">{node.activeConnections}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => syncRegion(regKey)}
                  className="w-full py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#090D16] hover:border-sky-400 text-xs font-medium text-slate-800 dark:text-slate-200 transition-colors"
                >
                  {isDrifted ? `Reconcile ${regKey} to ${desiredHash}` : 'Force Re-Sync'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* TLS Certificate Inventory */}
      <div className="space-y-3">
        <h2 className="text-xs font-semibold text-slate-700 dark:text-slate-300">TLS Certificate Inventory</h2>
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-3">Certificate</th>
                <th className="py-2.5 px-3">Common Name & SANs</th>
                <th className="py-2.5 px-3">Algorithm</th>
                <th className="py-2.5 px-3">Expires</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/70">
              {certificates.map((cert) => {
                const chaosExp = Boolean(chaos.forceExpiredCerts[cert.id]);
                const daysLeft = chaosExp
                  ? -12
                  : Math.ceil(
                      (new Date(cert.notAfter).getTime() - referenceNow.getTime()) /
                        (1000 * 60 * 60 * 24)
                    );
                const statusText =
                  daysLeft <= 0
                    ? 'Expired'
                    : daysLeft <= 30
                      ? `Expiring (${daysLeft}d)`
                      : `Valid (${daysLeft}d)`;
                const statusClass =
                  daysLeft <= 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : daysLeft <= 30
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-emerald-700 dark:text-emerald-400';

                return (
                  <tr key={cert.id} className="hover:bg-slate-100/80 dark:hover:bg-slate-800/30">
                    <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-slate-100">{cert.name}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-700 dark:text-slate-300">
                      <div>{cert.commonName}</div>
                      <div className="text-[10.5px] text-slate-500">{cert.sans.join(', ')}</div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-700 dark:text-slate-300">{cert.algorithm}</td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {cert.notAfter.slice(0, 10)}
                    </td>
                    <td className={`py-2.5 px-3 font-medium ${statusClass}`}>{statusText}</td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          updateCertificate(cert.id, {
                            notAfter: new Date(
                              referenceNow.getTime() + 365 * 24 * 60 * 60 * 1000
                            ).toISOString(),
                            managed: true,
                          })
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#090D16] text-[11px] font-medium text-slate-800 dark:text-slate-200 hover:border-emerald-400/70 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
                      >
                        <ShieldCheck className="w-3 h-3" />
                        <span>Renew 365d</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Config Snapshot Rollback History */}
      <div className="space-y-3">
        <h2 className="text-xs font-semibold text-slate-700 dark:text-slate-300">Revision Snapshots & Drift Rollback</h2>
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] divide-y divide-slate-200 dark:divide-slate-800/70">
          {snapshots.map((snap) => (
            <div
              key={snap.id}
              className="flex items-center justify-between gap-4 px-4 py-2.5 text-xs"
            >
              <div className="min-w-0">
                <div className="font-medium text-slate-800 dark:text-slate-200 truncate">{snap.label}</div>
                <div className="text-[11px] font-mono text-slate-500">
                  Revision {snap.hash} · {new Date(snap.timestamp).toLocaleTimeString()}
                </div>
              </div>
              <button
                type="button"
                onClick={() => rollbackSnapshot(snap.id)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#090D16] hover:border-amber-400/70 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:text-amber-700 dark:hover:text-amber-300 transition-colors shrink-0"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Rollback</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
