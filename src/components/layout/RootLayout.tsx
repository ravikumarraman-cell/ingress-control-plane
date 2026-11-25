import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  BookOpen,
  CheckSquare,
  Compass,
  Cpu,
  FileText,
  GitBranch,
  Moon,
  Plus,
  Radio,
  Sun,
} from "lucide-react";
import {
  fetchWorkflows,
  getCurrentOperator,
  OPERATOR_PERSONAS,
  setCurrentOperator,
} from "../../lib/api";
import { useTheme } from "../../lib/theme";
import { useWorkflowStream } from "../../lib/useWorkflowStream";
import { RegisterPluginModal } from "../../features/policies/RegisterPluginModal";
import { RequestTracerDrawer } from "../../features/simulator/RequestTracerDrawer";
import { useControlPlane } from "../../store/ControlPlaneContext";
import { CommandPalette } from "../primitives/CommandPalette";
import { NewIngressModal } from "../NewIngressModal";
import { BaseLayout, type NavItemConfig } from "./BaseLayout";

export function RootLayout({ children }: { children?: ReactNode }) {
  const { streamConnected } = useWorkflowStream();
  const queryClient = useQueryClient();
  const { theme, toggleTheme } = useTheme();
  const { tracerOpen, setTracerOpen } = useControlPlane();
  const [modalOpen, setModalOpen] = useState(false);
  const [operatorId, setOperatorId] = useState(getCurrentOperator().operatorId);

  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const { data: wfData } = useQuery({
    queryKey: ["workflows"],
    queryFn: () => fetchWorkflows(),
  });

  const pendingApprovalsCount =
    wfData?.workflows.filter((w) => w.status === "AWAITING_APPROVAL").length ?? 0;

  const handleOperatorChange = (nextId: string) => {
    const found = OPERATOR_PERSONAS.find((p) => p.operatorId === nextId);
    if (!found) return;
    setCurrentOperator(found);
    setOperatorId(found.operatorId);
    queryClient.invalidateQueries();
  };

  const getBreadcrumb = () => {
    if (pathname.startsWith("/workflows/")) {
      const id = pathname.replace("/workflows/", "");
      return `Workflows / ${id.slice(0, 8)}...`;
    }
    if (pathname.startsWith("/studio")) return "Control Plane / Provider-Agnostic Edge Studio";
    if (pathname.startsWith("/approvals")) return "Governance / Pending Approvals";
    if (pathname.startsWith("/audit-log")) return "Governance / Audit Trail";
    if (pathname.startsWith("/agents")) return "Control Plane / Live Agent Flow";
    if (pathname.startsWith("/strands-metrics")) return "Observability / Strands Agent Metrics";
    if (pathname.startsWith("/architecture")) return "Documentation / Architecture Spec";
    return "Control Plane / Workflows";
  };

  const navItems: NavItemConfig[] = [
    { to: "/workflows", label: "Workflows", icon: GitBranch, matchPrefix: "/workflows" },
    { to: "/studio", label: "Edge Studio", icon: Compass },
    { to: "/agents", label: "Agent Flow", icon: Cpu },
    { to: "/strands-metrics", label: "Agent Metrics", icon: BarChart3 },
    {
      to: "/approvals",
      label: "Approvals",
      icon: CheckSquare,
      count: pendingApprovalsCount,
    },
    { to: "/audit-log", label: "Audit Log", icon: FileText },
    { to: "/architecture", label: "Architecture", icon: BookOpen },
  ];

  const activePersona =
    OPERATOR_PERSONAS.find((p) => p.operatorId === operatorId) ?? OPERATOR_PERSONAS[0];

  const sidebarFooter = (
    <div className="space-y-3">
      <div>
        <label
          htmlFor="operator-select"
          className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1"
        >
          Active Operator (RBAC)
        </label>
        <select
          id="operator-select"
          value={operatorId}
          onChange={(e) => handleOperatorChange(e.target.value)}
          className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600 dark:focus:ring-sky-400"
        >
          {OPERATOR_PERSONAS.map((op) => (
            <option key={op.operatorId} value={op.operatorId}>
              {op.displayName} ({op.roles[0]})
            </option>
          ))}
        </select>
        <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1 truncate">
          {activePersona.operatorId}
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <Radio
            className={`h-3.5 w-3.5 shrink-0 ${
              streamConnected ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
            }`}
          />
          <span className="whitespace-nowrap">
            {streamConnected ? "SSE Active" : "Reconnecting"}
          </span>
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F172A] text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-blue-500 dark:hover:border-sky-400 transition-colors whitespace-nowrap shrink-0"
        >
          {theme === "light" ? (
            <>
              <Moon className="w-3.5 h-3.5" />
              <span>Dark</span>
            </>
          ) : (
            <>
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              <span>Light</span>
            </>
          )}
        </button>
      </div>
    </div>
  );

  const headerActions = (
    <>
      <button
        type="button"
        onClick={() => setTracerOpen(!tracerOpen)}
        className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
          tracerOpen
            ? "bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950 border-slate-900 dark:border-sky-400"
            : "bg-white dark:bg-[#0F172A] text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
        }`}
      >
        <Activity className="h-3.5 w-3.5 shrink-0" />
        <span>Request Tracer</span>
      </button>

      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 dark:bg-sky-500 dark:text-slate-950 rounded-md hover:bg-blue-800 dark:hover:bg-sky-400 transition-colors whitespace-nowrap shrink-0"
      >
        <Plus className="h-3.5 w-3.5 shrink-0" />
        New Ingress Request
      </button>
    </>
  );

  return (
    <>
      <BaseLayout
        brandTitle="Ingress Control Plane"
        brandTo="/workflows"
        navItems={navItems}
        breadcrumb={getBreadcrumb()}
        headerActions={headerActions}
        sidebarFooter={sidebarFooter}
        fullBleed={pathname.startsWith("/studio")}
      >
        {children}
      </BaseLayout>
      <NewIngressModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <RequestTracerDrawer />
      <CommandPalette />
      <RegisterPluginModal />
    </>
  );
}
