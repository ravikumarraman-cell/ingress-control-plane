import React, { useMemo, useState } from 'react';
import { Check, Copy, Download, GitCompare } from 'lucide-react';
import { adapterRegistry } from '../../core/adapters/registry';

interface LiveConfigInspectorProps {
  activeAdapterId: string;
  onSelectAdapter: (id: string) => void;
  desiredConfig: string;
  activeConfig: string;
  desiredHash: string;
  activeHash: string;
}

interface DiffLine {
  type: 'same' | 'added' | 'removed';
  text: string;
}

function computeLineDiff(activeText: string, desiredText: string): DiffLine[] {
  const aLines = activeText.split('\n');
  const dLines = desiredText.split('\n');
  const max = Math.max(aLines.length, dLines.length);
  const result: DiffLine[] = [];

  // LCS-lite line diff for readable config comparisons
  const aSet = new Set(aLines);
  const dSet = new Set(dLines);

  let ai = 0;
  let di = 0;
  let safety = 0;
  while ((ai < aLines.length || di < dLines.length) && safety < max * 3 + 200) {
    safety++;
    const aLine = aLines[ai];
    const dLine = dLines[di];
    if (aLine === dLine) {
      result.push({ type: 'same', text: dLine ?? '' });
      ai++;
      di++;
    } else if (aLine !== undefined && !dSet.has(aLine)) {
      result.push({ type: 'removed', text: aLine });
      ai++;
    } else if (dLine !== undefined && !aSet.has(dLine)) {
      result.push({ type: 'added', text: dLine });
      di++;
    } else {
      if (aLine !== undefined) {
        result.push({ type: 'removed', text: aLine });
        ai++;
      }
      if (dLine !== undefined) {
        result.push({ type: 'added', text: dLine });
        di++;
      }
    }
  }
  return result;
}

function highlightLine(line: string, format: 'json' | 'yaml' | 'conf'): React.ReactNode {
  if (line.trim().startsWith('#')) {
    return <span className="text-slate-500 italic">{line}</span>;
  }
  if (format === 'json') {
    const match = line.match(/^(\s*)"([^"]+)":(.*)$/);
    if (match) {
      return (
        <>
          <span>{match[1]}</span>
          <span className="text-sky-300">"{match[2]}"</span>
          <span className="text-slate-400">:</span>
          <span className="text-emerald-300/90">{match[3]}</span>
        </>
      );
    }
  }
  if (format === 'yaml') {
    const match = line.match(/^(\s*-?\s*)([a-zA-Z0-9_-]+):(.*)$/);
    if (match) {
      return (
        <>
          <span className="text-slate-400">{match[1]}</span>
          <span className="text-sky-300">{match[2]}</span>
          <span className="text-slate-400">:</span>
          <span className="text-amber-200/90">{match[3]}</span>
        </>
      );
    }
  }
  if (format === 'conf') {
    const match = line.match(/^(\s*)([a-z_]+)(\s+.*)?$/);
    if (match) {
      return (
        <>
          <span>{match[1]}</span>
          <span className="text-sky-300">{match[2]}</span>
          <span className="text-emerald-200/90">{match[3] ?? ''}</span>
        </>
      );
    }
  }
  return <span className="text-slate-200">{line}</span>;
}

export const LiveConfigInspector: React.FC<LiveConfigInspectorProps> = ({
  activeAdapterId,
  onSelectAdapter,
  desiredConfig,
  activeConfig,
  desiredHash,
  activeHash,
}) => {
  const adapters = adapterRegistry.list();
  const currentAdapter = adapterRegistry.get(activeAdapterId) ?? adapters[0];
  const [diffMode, setDiffMode] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const hasDrift = desiredHash !== activeHash;

  const diffLines = useMemo(() => {
    if (!diffMode) return [];
    return computeLineDiff(activeConfig, desiredConfig);
  }, [diffMode, activeConfig, desiredConfig]);

  const compiledLines = useMemo(() => desiredConfig.split('\n'), [desiredConfig]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(desiredConfig);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard fallback ignored cleanly
    }
  };

  const handleDownload = () => {
    const blob = new Blob([desiredConfig], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentAdapter?.fileName ?? 'ingress-config.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Adapter Selector Row */}
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-200 dark:border-slate-800/80">
        <div className="flex items-center gap-1 p-0.5 rounded-md bg-slate-100 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 overflow-x-auto">
          {adapters.map((adapter) => {
            const active = adapter.id === activeAdapterId;
            return (
              <button
                key={adapter.id}
                type="button"
                onClick={() => onSelectAdapter(adapter.id)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-white dark:bg-slate-800 text-blue-700 dark:text-sky-300 shadow-xs dark:shadow-none'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {adapter.name}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setDiffMode((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
              diffMode
                ? 'border-blue-500/50 dark:border-sky-400/60 bg-blue-50 dark:bg-sky-500/15 text-blue-700 dark:text-sky-300'
                : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#090D16] text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white'
            }`}
            title="Compare Desired IR output vs Active deployed config"
          >
            <GitCompare className="w-3.5 h-3.5" />
            <span>Diff</span>
            {hasDrift && <span className="text-amber-700 dark:text-amber-400 font-mono">Δ</span>}
          </button>

          <button
            type="button"
            onClick={handleCopy}
            className="p-1.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#090D16] text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white transition-colors"
            title="Copy compiled config"
            aria-label="Copy compiled config"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="p-1.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#090D16] text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white transition-colors"
            title={`Download ${currentAdapter?.fileName ?? 'config'}`}
            aria-label="Download compiled config"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Metadata strip (unboxed typography per zero-pill discipline) */}
      <div className="flex items-center justify-between py-2 text-[11px] text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800/60">
        <div className="flex items-center gap-2 truncate">
          <span className="text-slate-700 dark:text-slate-300 font-medium">{currentAdapter?.vendor}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono text-slate-500 dark:text-slate-400">{currentAdapter?.fileName}</span>
        </div>
        <div className="flex items-center gap-2 font-mono tabular-nums shrink-0">
          <span className={hasDrift ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}>
            {hasDrift ? `Desired ${desiredHash} ≠ Active ${activeHash}` : `Synced ${desiredHash}`}
          </span>
        </div>
      </div>

      {/* Code viewport */}
      <div className="flex-1 min-h-0 overflow-auto bg-slate-950 dark:bg-[#070A12] rounded-md border border-slate-800/80 mt-2.5 p-3 font-mono text-[11.5px] leading-relaxed">
        {diffMode ? (
          hasDrift ? (
            <div className="space-y-0.5">
              {diffLines.map((line, idx) => (
                <div
                  key={idx}
                  className={`flex items-start gap-2 px-1.5 rounded-sm ${
                    line.type === 'added'
                      ? 'bg-emerald-500/15 text-emerald-200'
                      : line.type === 'removed'
                        ? 'bg-rose-500/15 text-rose-300'
                        : 'text-slate-400'
                  }`}
                >
                  <span className="w-3 shrink-0 select-none opacity-75">
                    {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                  </span>
                  <span className="whitespace-pre">{line.text}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-400 py-8 text-center">
              Desired configuration ({desiredHash}) matches active regional state ({activeHash}). Edit any route, weight, or middleware to preview live diffs.
            </div>
          )
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {compiledLines.map((line, idx) => (
                <tr key={idx} className="hover:bg-slate-800/30">
                  <td className="select-none pr-3 text-right text-[10.5px] text-slate-600 tabular-nums w-8 align-top">
                    {idx + 1}
                  </td>
                  <td className="whitespace-pre text-slate-200">
                    {highlightLine(line, currentAdapter?.format ?? 'json')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
