import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { BookOpen, CheckSquare, Cpu, FileText, GitBranch, Plus, Radio } from "lucide-react";
import {
  fetchWorkflows,
  getCurrentOperator,
  OPERATOR_PERSONAS,
  setCurrentOperator,
} from "../../lib/api";
import { useWorkflowStream } from "../../lib/useWorkflowStream";
import { NewIngressModal } from "../NewIngressModal";
import { BaseLayout, type NavItemConfig } from "./BaseLayout";

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
    if (pathname.startsWith("/agents")) return "Control Plane / Live Agent Flow";
    if (pathname.startsWith("/architecture")) return "Documentation / Architecture Spec";
    return "Control Plane / Workflows";
  };

  const navItems: NavItemConfig[] = [
    { to: "/workflows", label: "Workflows", icon: GitBranch, matchPrefix: "/workflows" },
    { to: "/agents", label: "Agent Flow", icon: Cpu },
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
  );

  const headerActions = (
    <button
      type="button"
      onClick={() => setModalOpen(true)}
      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0"
    >
      <Plus className="h-3.5 w-3.5 shrink-0" />
      New Ingress Request
    </button>
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
      >
        {children}
      </BaseLayout>
      <NewIngressModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
