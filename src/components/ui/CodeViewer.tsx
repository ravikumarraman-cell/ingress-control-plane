import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { copyTextToClipboard } from "../../lib/format";

export interface CodeViewerProps {
  title?: ReactNode;
  code: string;
  headerActions?: ReactNode;
  copyLabel?: string;
  maxHeightClass?: string;
  accentTextClass?: string;
  className?: string;
}

export function CodeViewer({
  title,
  code,
  headerActions,
  copyLabel = "Copy",
  maxHeightClass = "max-h-[480px]",
  accentTextClass = "text-slate-100",
  className = "",
}: CodeViewerProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(code);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <div
      className={`bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden ${className}`}
    >
      {(title || headerActions) && (
        <div className="px-4 py-2.5 bg-slate-50 dark:bg-[#090D16] border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
            {title}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {headerActions}
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors whitespace-nowrap"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  {copyLabel}
                </>
              )}
            </button>
          </div>
        </div>
      )}
      <pre
        className={`p-4 text-xs font-mono leading-relaxed bg-slate-950 ${accentTextClass} overflow-x-auto ${maxHeightClass} tabular-nums`}
      >
        {code}
      </pre>
    </div>
  );
}
