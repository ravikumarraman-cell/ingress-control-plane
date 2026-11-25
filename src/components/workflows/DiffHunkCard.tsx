import type { DiffHunk } from "../../shared/contracts";

export function DiffHunkCard({ hunk }: { hunk: DiffHunk }) {
  return (
    <div className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-50 dark:bg-[#090D16] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
        <div className="text-xs font-mono font-medium text-slate-900 dark:text-slate-100">
          {hunk.filePath} · {hunk.resourceKind}
        </div>
        <div className="text-xs font-mono tabular-nums flex items-center gap-3">
          <span className="text-emerald-700 dark:text-emerald-400">+{hunk.linesAdded}</span>
          <span className="text-red-700 dark:text-rose-400">-{hunk.linesRemoved}</span>
        </div>
      </div>
      <pre className="p-4 text-xs font-mono overflow-x-auto leading-relaxed bg-slate-950 text-slate-100">
        {hunk.unifiedDiff.split("\n").map((line, i) => {
          const cls =
            line.startsWith("+") && !line.startsWith("+++")
              ? "text-emerald-400 bg-emerald-950/40 block px-2 -mx-2"
              : line.startsWith("-") && !line.startsWith("---")
                ? "text-red-400 bg-red-950/40 block px-2 -mx-2"
                : "text-slate-300 block";
          return (
            <span key={i} className={cls}>
              {line}
            </span>
          );
        })}
      </pre>
    </div>
  );
}
