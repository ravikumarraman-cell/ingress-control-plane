import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  action?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  action,
  footer,
  className = "",
}: EmptyStateProps) {
  return (
    <div className={`p-12 text-center space-y-2 ${className}`}>
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</p>
      {description && <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">{description}</p>}
      {(action || (actionLabel && onAction)) && (
        <div className="pt-2">
          {action ?? (
            <button
              type="button"
              onClick={onAction}
              className="px-3.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
            >
              {actionLabel}
            </button>
          )}
        </div>
      )}
      {footer}
    </div>
  );
}
