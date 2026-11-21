import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  backLink?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({
  title,
  subtitle,
  backLink,
  badge,
  actions,
}: PageHeaderProps) {
  return (
    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
      <div className="min-w-0">
        {backLink && <div className="mb-2">{backLink}</div>}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-slate-950 text-balance">
            {title}
          </h1>
          {badge}
        </div>
        {subtitle && <div className="text-sm text-slate-600 mt-1">{subtitle}</div>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">{actions}</div>
      )}
    </div>
  );
}
