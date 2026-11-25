import React from 'react';
import { TelemetryPoint } from '../../core/ir/types';

interface TopologyNodeCardProps {
  title: string;
  subtitle: string;
  kindLabel: string;
  statusLabel: string;
  statusTone: 'healthy' | 'warning' | 'critical' | 'neutral';
  rps?: number;
  p99Ms?: number;
  sparkline?: TelemetryPoint[];
  selected?: boolean;
  highlighted?: boolean;
  onClick?: () => void;
  footerMeta?: string;
}

const TONE_TEXT: Record<TopologyNodeCardProps['statusTone'], string> = {
  healthy: 'text-emerald-700 dark:text-emerald-400',
  warning: 'text-amber-700 dark:text-amber-400',
  critical: 'text-rose-600 dark:text-rose-400',
  neutral: 'text-slate-500 dark:text-slate-400',
};

const SPARK_STROKE: Record<TopologyNodeCardProps['statusTone'], string> = {
  healthy: '#10B981',
  warning: '#F59E0B',
  critical: '#F43F5E',
  neutral: '#38BDF8',
};

export const TopologyNodeCard: React.FC<TopologyNodeCardProps> = ({
  title,
  subtitle,
  kindLabel,
  statusLabel,
  statusTone,
  rps,
  p99Ms,
  sparkline,
  selected = false,
  highlighted = false,
  onClick,
  footerMeta,
}) => {
  // Build SVG polyline path for latency sparkline
  const sparkPath = React.useMemo(() => {
    if (!sparkline || sparkline.length < 2) return '';
    const values = sparkline.map((p) => p.p99Ms);
    const min = Math.min(...values);
    const max = Math.max(...values, min + 1);
    const width = 88;
    const height = 22;
    return values
      .map((val, idx) => {
        const x = (idx / (values.length - 1)) * width;
        const y = height - ((val - min) / (max - min)) * (height - 4) - 2;
        return `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [sparkline]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-lg border p-3 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
        selected
          ? 'bg-blue-50/70 dark:bg-[#131B2E] border-sky-400/80'
          : highlighted
            ? 'bg-emerald-50/60 dark:bg-[#11192B] border-emerald-400/70'
            : 'bg-white dark:bg-[#0F172A] border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
      }`}
    >
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-slate-500 dark:text-slate-400 font-medium truncate">{kindLabel}</span>
        <span className={`font-medium shrink-0 ${TONE_TEXT[statusTone]}`}>{statusLabel}</span>
      </div>

      <div className="mt-1">
        <div className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 truncate">{title}</div>
        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate mt-0.5">{subtitle}</div>
      </div>

      {(rps !== undefined || p99Ms !== undefined) && (
        <div className="mt-2.5 pt-2 border-t border-slate-200 dark:border-slate-800/70 flex items-end justify-between gap-2">
          <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums">
            {rps !== undefined && (
              <div>
                <span className="text-slate-500">RPS </span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">{rps}</span>
              </div>
            )}
            {p99Ms !== undefined && (
              <div>
                <span className="text-slate-500">p99 </span>
                <span
                  className={`font-medium ${
                    p99Ms > 120 ? 'text-amber-700 dark:text-amber-300' : 'text-slate-800 dark:text-slate-200'
                  }`}
                >
                  {p99Ms}ms
                </span>
              </div>
            )}
          </div>

          {sparkPath && (
            <svg width="88" height="22" className="shrink-0 overflow-visible" aria-hidden="true">
              <path
                d={sparkPath}
                fill="none"
                stroke={SPARK_STROKE[statusTone]}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>
      )}

      {footerMeta && (
        <div className="mt-1.5 text-[10.5px] font-mono text-slate-500 truncate">{footerMeta}</div>
      )}
    </button>
  );
};
