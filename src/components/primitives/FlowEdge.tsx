import React from 'react';

interface FlowEdgeProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
  state: 'nominal' | 'traced' | 'degraded' | 'blocked';
}

export const FlowEdge: React.FC<FlowEdgeProps> = ({ x1, y1, x2, y2, label, state }) => {
  const dx = Math.abs(x2 - x1) * 0.5;
  const path = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  const stroke =
    state === 'traced'
      ? '#10B981'
      : state === 'blocked'
        ? '#F43F5E'
        : state === 'degraded'
          ? '#F59E0B'
          : 'rgba(148, 163, 184, 0.45)';

  const strokeWidth = state === 'traced' ? 2.2 : state === 'blocked' ? 1.8 : 1.3;

  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={state === 'blocked' || state === 'degraded' ? '5 4' : undefined}
      />
      {label && (
        <g transform={`translate(${midX}, ${midY})`}>
          <rect
            x={-18}
            y={-9}
            width={36}
            height={18}
            rx={4}
            className="fill-white dark:fill-[#090D16]"
            stroke={state === 'traced' ? '#10B981' : 'rgba(148,163,184,0.35)'}
            strokeWidth={1}
          />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            className={state === 'traced' ? 'fill-emerald-600 dark:fill-emerald-300' : 'fill-slate-700 dark:fill-slate-300'}
            fontSize="10"
            fontFamily="JetBrains Mono, monospace"
          >
            {label}
          </text>
        </g>
      )}
    </g>
  );
};
