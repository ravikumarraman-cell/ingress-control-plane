import React, { useRef } from 'react';
import { WeightedTarget } from '../../core/ir/types';

interface TrafficSplitBarProps {
  targets: WeightedTarget[];
  upstreamNames: Record<string, string>;
  onChange: (nextTargets: WeightedTarget[]) => void;
  onNormalize?: () => void;
}

const SEGMENT_COLORS = [
  'bg-sky-500/85',
  'bg-emerald-500/85',
  'bg-amber-500/85',
  'bg-indigo-400/85',
];

const DOT_COLORS = [
  'bg-sky-400',
  'bg-emerald-400',
  'bg-amber-400',
  'bg-indigo-400',
];

export const TrafficSplitBar: React.FC<TrafficSplitBarProps> = ({
  targets,
  upstreamNames,
  onChange,
  onNormalize,
}) => {
  const barRef = useRef<HTMLDivElement | null>(null);
  const totalWeight = targets.reduce((acc, t) => acc + t.weight, 0);
  const isAnomaly = totalWeight !== 100;

  const handleWeightInput = (idx: number, raw: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(raw || 0)));
    const next = targets.map((t, i) => (i === idx ? { ...t, weight: clamped } : t));
    onChange(next);
  };

  const handleDividerDrag = (dividerIndex: number, e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const container = barRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const pairTotal = targets[dividerIndex].weight + targets[dividerIndex + 1].weight;
    const prefixWeight = targets.slice(0, dividerIndex).reduce((s, t) => s + t.weight, 0);

    const onMove = (moveEvent: MouseEvent) => {
      const pctFromLeft = Math.round(((moveEvent.clientX - rect.left) / rect.width) * 100);
      const nextFirst = Math.max(0, Math.min(pairTotal, pctFromLeft - prefixWeight));
      const nextSecond = pairTotal - nextFirst;
      onChange(
        targets.map((t, idx) => {
          if (idx === dividerIndex) return { ...t, weight: nextFirst };
          if (idx === dividerIndex + 1) return { ...t, weight: nextSecond };
          return t;
        })
      );
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (targets.length === 0) {
    return (
      <div className="text-xs text-rose-600 dark:text-rose-400 border border-rose-500/30 bg-rose-500/5 rounded-md px-3 py-2">
        No upstream targets assigned to this route.
      </div>
    );
  }

  const safeDivisor = totalWeight > 0 ? totalWeight : 1;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500 dark:text-slate-400 font-medium">Canary Traffic Distribution</span>
        <div className="flex items-center gap-2.5">
          <span
            className={`font-mono tabular-nums font-medium ${
              isAnomaly ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'
            }`}
          >
            Total {totalWeight}%
          </span>
          {isAnomaly && onNormalize && (
            <button
              type="button"
              onClick={onNormalize}
              className="px-2 py-0.5 text-[11px] font-medium rounded border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-colors whitespace-nowrap shrink-0"
            >
              Normalize 100%
            </button>
          )}
        </div>
      </div>

      {/* Interactive segmented bar */}
      <div
        ref={barRef}
        className="relative h-7 w-full rounded-md bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 overflow-hidden flex select-none"
      >
        {targets.map((t, idx) => {
          const widthPct = totalWeight > 0 ? (t.weight / safeDivisor) * 100 : 100 / targets.length;
          return (
            <React.Fragment key={`${t.upstreamId}-${idx}`}>
              <div
                style={{ width: `${widthPct}%` }}
                className={`${SEGMENT_COLORS[idx % SEGMENT_COLORS.length]} h-full flex items-center justify-center text-[11px] font-mono tabular-nums font-semibold text-slate-950 transition-[width] duration-75 overflow-hidden px-1`}
              >
                {widthPct >= 10 ? `${t.weight}%` : ''}
              </div>
              {idx < targets.length - 1 && (
                <button
                  type="button"
                  aria-label={`Adjust split between ${upstreamNames[t.upstreamId] ?? t.upstreamId} and ${
                    upstreamNames[targets[idx + 1].upstreamId] ?? targets[idx + 1].upstreamId
                  }`}
                  onMouseDown={(e) => handleDividerDrag(idx, e)}
                  className="w-2 -ml-1 -mr-1 z-10 h-full bg-slate-950/90 hover:bg-white/90 border-x border-slate-300 dark:border-slate-700 cursor-ew-resize transition-colors shrink-0"
                  title="Drag to rebalance traffic split"
                />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Numeric breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {targets.map((t, idx) => (
          <div
            key={`${t.upstreamId}-ctrl-${idx}`}
            className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800/90"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className={`w-2 h-2 rounded-sm shrink-0 ${DOT_COLORS[idx % DOT_COLORS.length]}`} />
              <span className="text-xs text-slate-800 dark:text-slate-200 truncate">
                {upstreamNames[t.upstreamId] ?? t.upstreamId}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <input
                type="number"
                min={0}
                max={100}
                value={t.weight}
                onChange={(e) => handleWeightInput(idx, Number(e.target.value))}
                aria-label={`Weight for ${upstreamNames[t.upstreamId] ?? t.upstreamId}`}
                className="w-12 bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded px-1.5 py-0.5 text-right text-xs font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
              />
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
