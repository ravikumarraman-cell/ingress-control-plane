import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  BookOpen,
  CheckSquare,
  FileText,
  GitBranch,
  Plus,
  Radio,
  ShieldCheck,
} from "lucide-react";
import {
  fetchWorkflows,
  getCurrentOperator,
  OPERATOR_PERSONAS,
  setCurrentOperator,
} from "../../lib/api";
import { useWorkflowStream } from "../../lib/useWorkflowStream";
import { NewIngressModal } from "../NewIngressModal";

export function RootLayout({ children }: { children?: ReactNode }) {
  const { streamConnected } = useWorkflowStream();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [operatorId, setOperatorId] = useState(getCurrentOperator().operatorId);

  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const { data: wfData } = useQuery({
    queryKey: ["workflows"],
    queryFn: fetchWorkflows,
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
    if (pathname.startsWith("/approvals")) return "Governance / Pending Approvals";
    if (pathname.startsWith("/audit-log")) return "Governance / Audit Trail";
    if (pathname.startsWith("/architecture")) return "Documentation / Architecture Spec";
    return "Control Plane / Workflows";
  };

  const navItems = [
    { to: "/workflows" as const, label: "Workflows", icon: GitBranch },
    {
      to: "/approvals" as const,
      label: "Approvals",
      icon: CheckSquare,
      count: pendingApprovalsCount,
    },
    { to: "/audit-log" as const, label: "Audit Log", icon: FileText },
    { to: "/architecture" as const, label: "Architecture", icon: BookOpen },
  ];

  const activePersona =
    OPERATOR_PERSONAS.find((p) => p.operatorId === operatorId) ?? OPERATOR_PERSONAS[0];

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Left Navigation Sidebar */}
      <aside className="w-[248px] shrink-0 bg-white border-r border-slate-200 flex flex-col justify-between">
        <div>
          <div className="h-14 px-5 flex items-center border-b border-slate-200">
            <Link
              to="/workflows"
              className="flex items-center gap-2.5 text-sm font-bold tracking-tight text-slate-900 whitespace-nowrap"
            >
              <ShieldCheck className="h-4 w-4 text-blue-700 shrink-0" />
              <span>Ingress Control Plane</span>
            </Link>
          </div>

          <nav className="p-3 space-y-1" aria-label="Primary Navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active =
                pathname === item.to ||
                (item.to === "/workflows" &&
                  (pathname === "/" || pathname.startsWith("/workflows")));
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex items-center justify-between px-3 py-2 text-sm rounded-md transition-colors whitespace-nowrap ${
                    active
                      ? "bg-slate-100 text-slate-900 font-semibold"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50 font-medium"
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </span>
                  {typeof item.count === "number" && item.count > 0 && (
                    <span className="text-xs font-mono tabular-nums text-amber-700 font-semibold">
                      {item.count}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer: Operator RBAC Persona Switcher & Live SSE Stream State */}
        <div className="p-4 border-t border-slate-200 space-y-3 bg-slate-50/70">
          <div>
            <label
              htmlFor="operator-select"
              className="block text-xs font-medium text-slate-500 mb-1"
            >
              Active Operator (RBAC)
            </label>
            <select
              id="operator-select"
              value={operatorId}
              onChange={(e) => handleOperatorChange(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {OPERATOR_PERSONAS.map((op) => (
                <option key={op.operatorId} value={op.operatorId}>
                  {op.displayName} ({op.roles[0]})
                </option>
              ))}
            </select>
            <p className="text-[11px] font-mono text-slate-500 mt-1 truncate">
              {activePersona.operatorId}
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-600 pt-1">
            <Radio
              className={`h-3.5 w-3.5 shrink-0 ${
                streamConnected ? "text-emerald-600" : "text-amber-600"
              }`}
            />
            <span className="whitespace-nowrap">
              {streamConnected ? "SSE Stream Active" : "SSE Reconnecting"}
            </span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-8 shrink-0">
          <div className="text-sm font-medium text-slate-600 truncate">
            {getBreadcrumb()}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              New Ingress Request
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 max-w-[1280px] w-full mx-auto">
          {children ?? <Outlet />}
        </main>
      </div>

      <NewIngressModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
