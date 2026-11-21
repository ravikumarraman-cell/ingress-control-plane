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
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {description && <p className="text-xs text-slate-500 max-w-md mx-auto">{description}</p>}
      {(action || (actionLabel && onAction)) && (
        <div className="pt-2">
          {action ?? (
            <button
              type="button"
              onClick={onAction}
              className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
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
