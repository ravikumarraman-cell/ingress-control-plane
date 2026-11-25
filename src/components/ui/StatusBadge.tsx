import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  RotateCcw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import type { WorkflowStatus } from "../../shared/contracts";

interface BadgeStyle {
  label: string;
  surfaceClass: string;
  Icon: typeof Clock;
  spin?: boolean;
}

const STATUS_STYLES: Record<WorkflowStatus, BadgeStyle> = {
  INTAKE: {
    label: "Intake",
    surfaceClass: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300",
    Icon: Clock,
  },
  ANALYZING: {
    label: "Analyzing",
    surfaceClass: "bg-blue-50 dark:bg-sky-500/10 text-blue-800",
    Icon: Loader2,
    spin: true,
  },
  PLANNING: {
    label: "Planning",
    surfaceClass: "bg-blue-50 dark:bg-sky-500/10 text-blue-800",
    Icon: Loader2,
    spin: true,
  },
  AWAITING_APPROVAL: {
    label: "Awaiting Approval",
    surfaceClass: "bg-amber-50 dark:bg-amber-500/10 text-amber-800",
    Icon: Clock,
  },
  APPROVED: {
    label: "Approved",
    surfaceClass: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
    Icon: CheckCircle2,
  },
  EXECUTING: {
    label: "Executing",
    surfaceClass: "bg-blue-50 dark:bg-sky-500/10 text-blue-800",
    Icon: Loader2,
    spin: true,
  },
  COMPLETED: {
    label: "Completed",
    surfaceClass: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
    Icon: CheckCircle2,
  },
  FAILED: {
    label: "Failed",
    surfaceClass: "bg-red-50 dark:bg-rose-500/10 text-red-800",
    Icon: AlertTriangle,
  },
  REJECTED: {
    label: "Rejected",
    surfaceClass: "bg-red-50 dark:bg-rose-500/10 text-red-800",
    Icon: XCircle,
  },
  DRIFT_ABORTED: {
    label: "Drift Aborted",
    surfaceClass: "bg-red-50 dark:bg-rose-500/10 text-red-800",
    Icon: ShieldAlert,
  },
  ROLLED_BACK: {
    label: "Rolled Back",
    surfaceClass: "bg-amber-50 dark:bg-amber-500/10 text-amber-900 dark:text-amber-200",
    Icon: RotateCcw,
  },
};

export interface StatusBadgeProps {
  status: WorkflowStatus;
  showRawStatus?: boolean;
  className?: string;
}

export function StatusBadge({
  status,
  showRawStatus = false,
  className = "",
}: StatusBadgeProps) {
  const style = STATUS_STYLES[status] ?? {
    label: status,
    surfaceClass: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300",
    Icon: Clock,
  };
  const Icon = style.Icon;

  return (
    <span
      role="status"
      aria-label={`Workflow status: ${style.label}`}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 ${style.surfaceClass} ${className}`}
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 ${style.spin ? "animate-spin" : ""}`} />
      <span>{showRawStatus ? status : style.label}</span>
    </span>
  );
}
