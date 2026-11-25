import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { RefreshCw, ShieldCheck, X } from "lucide-react";
import { WorkflowsTable } from "../components/WorkflowsTable";
import { ControlPlaneStatusDashboard } from "../components/dashboard/ControlPlaneStatusDashboard";
import { IngressTrafficWidget } from "../components/dashboard/IngressTrafficWidget";
import { DataTable } from "../components/ui/DataTable";
import { PageHeader } from "../components/ui/PageHeader";
import { PendingApprovalsPanel } from "../components/workflows/PendingApprovalsPanel";
import { SearchFilterBar } from "../components/ui/SearchFilterBar";
import { SegmentedTabs } from "../components/ui/SegmentedTabs";
import { fetchRoutes, fetchWorkflows, simulateInfraDrift } from "../lib/api";
import { shortHash } from "../lib/format";
import type { ActiveIngressRoute, WorkflowStatus } from "../shared/contracts";

const routeFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns,
});

const routeColumnHelper = createColumnHelper<typeof routeFeatures, ActiveIngressRoute>();

export function WorkflowsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"workflows" | "routes">("workflows");
  const [envFilter, setEnvFilter] = useState<"all" | "prod" | "staging" | "dev">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | WorkflowStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [driftBanner, setDriftBanner] = useState<string | null>(null);

  const workflowsQuery = useQuery({
    queryKey:
      statusFilter === "all" ? ["workflows"] : ["workflows", "status", statusFilter],
    queryFn: () => fetchWorkflows(statusFilter === "all" ? undefined : statusFilter),
  });

  const routesQuery = useQuery({
    queryKey: ["routes"],
    queryFn: fetchRoutes,
  });

  const driftMutation = useMutation({
    mutationFn: simulateInfraDrift,
    onSuccess: (data) => {
      setDriftBanner(
        `Out-of-band mutation injected — Live ETag rotated to ${shortHash(data.liveStateEtag, 16)}`
      );
      queryClient.invalidateQueries({ queryKey: ["routes"] });
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      queryClient.invalidateQueries({ queryKey: ["audit-log"] });
    },
  });

  const allWorkflows = workflowsQuery.data?.workflows ?? [];
  const allRoutes = routesQuery.data?.routes ?? [];

  const filteredWorkflows = useMemo(() => {
    return allWorkflows.filter((w) => {
      if (envFilter !== "all" && w.environment !== envFilter) return false;
      if (statusFilter !== "all" && w.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          w.appName.toLowerCase().includes(q) ||
          w.ingressRequest.hostname.toLowerCase().includes(q) ||
          w.requesterId.toLowerCase().includes(q) ||
          (w.ticketRef ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allWorkflows, envFilter, statusFilter, searchQuery]);

  const filteredRoutes = useMemo(() => {
    return allRoutes.filter((r) => {
      if (envFilter !== "all" && r.environment !== envFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          r.appName.toLowerCase().includes(q) ||
          r.hostname.toLowerCase().includes(q) ||
          r.backendService.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allRoutes, envFilter, searchQuery]);

  const hasActiveFilters =
    envFilter !== "all" ||
    (activeTab === "workflows" && statusFilter !== "all") ||
    searchQuery.trim().length > 0;

  const clearAllFilters = () => {
    setEnvFilter("all");
    setStatusFilter("all");
    setSearchQuery("");
  };

  const routeColumns = useMemo(
    () =>
      routeColumnHelper.columns([
        routeColumnHelper.accessor("appName", {
          header: "Application",
          cell: (info) => (
            <div>
              <span className="font-semibold text-slate-900">{info.getValue()}</span>
              <div className="text-xs font-mono text-slate-500">
                {info.row.original.gatewayName}
              </div>
            </div>
          ),
        }),
        routeColumnHelper.accessor("hostname", {
          header: "Hostname & Path",
          cell: (info) => (
            <span className="font-mono text-xs text-slate-800">
              {info.getValue()}
              {info.row.original.pathPrefix}
            </span>
          ),
        }),
        routeColumnHelper.accessor("backendService", {
          header: "Backend Target",
          cell: (info) => (
            <span className="font-mono text-xs text-slate-700 tabular-nums">
              {info.getValue()}:{info.row.original.backendPort}
            </span>
          ),
        }),
        routeColumnHelper.accessor("environment", {
          header: "Env / Exposure",
          cell: (info) => (
            <span className="font-mono text-xs text-slate-700">
              {info.getValue()} · {info.row.original.exposure}
            </span>
          ),
        }),
        routeColumnHelper.accessor("tlsProfile", {
          header: "TLS & WAF",
          cell: (info) => (
            <span className="font-mono text-xs text-slate-700">
              {info.getValue()} · {info.row.original.wafEnabled ? "WAF On" : "WAF Off"}
            </span>
          ),
        }),
        routeColumnHelper.accessor("canaryWeight", {
          header: "Weight",
          cell: (info) => (
            <span className="font-mono text-xs tabular-nums text-slate-800">
              {info.getValue()}%
            </span>
          ),
        }),
      ]),
    []
  );

  const routeTable = useTable({
    features: routeFeatures,
    data: filteredRoutes,
    columns: routeColumns,
  });

  const liveEtag = routesQuery.data?.liveStateEtag ?? workflowsQuery.data?.liveStateEtag ?? "";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ingress Governance Workflows"
        subtitle="Read-only discovery, compliance validation, HITL approval gates, and active cluster routes."
        actions={
          <>
            <div className="px-3 py-2 bg-white border border-slate-200 rounded-md flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-slate-500 shrink-0" />
              <span className="text-xs text-slate-500">Live ETag:</span>
              <code
                title={liveEtag}
                className="text-xs font-mono text-slate-900 tabular-nums"
              >
                {liveEtag ? shortHash(liveEtag, 22) : "loading..."}
              </code>
            </div>
            <button
              type="button"
              onClick={() => driftMutation.mutate()}
              disabled={driftMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              title="Mutate a live route annotation out-of-band to test TOCTOU ETag anti-drift locking"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${driftMutation.isPending ? "animate-spin" : ""}`}
              />
              Simulate Infra Drift
            </button>
          </>
        }
      />

      {driftBanner && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
          <span className="font-mono">{driftBanner}</span>
          <button
            type="button"
            onClick={() => setDriftBanner(null)}
            aria-label="Dismiss drift notification"
            className="text-amber-700 hover:text-amber-900 p-0.5 rounded"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <ControlPlaneStatusDashboard
        activeStatusFilter={statusFilter}
        onSelectStatusFilter={(status) => {
          setActiveTab("workflows");
          setStatusFilter(status);
        }}
        onShowRoutes={() => setActiveTab("routes")}
      />

      <IngressTrafficWidget />

      <PendingApprovalsPanel
        workflows={allWorkflows}
        routes={allRoutes}
        liveStateEtag={liveEtag}
        isLoading={workflowsQuery.isLoading || routesQuery.isLoading}
      />

      {/* Filter & Segmented Tab Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <SegmentedTabs
            ariaLabel="Control plane view"
            value={activeTab}
            onChange={setActiveTab}
            items={[
              { id: "workflows", label: "Workflows Queue", count: allWorkflows.length },
              { id: "routes", label: "Active Ingress Routes", count: allRoutes.length },
            ]}
          />

          <SegmentedTabs
            ariaLabel="Filter by environment"
            value={envFilter}
            onChange={setEnvFilter}
            items={[
              { id: "all", label: "All Envs" },
              { id: "prod", label: "prod" },
              { id: "staging", label: "staging" },
              { id: "dev", label: "dev" },
            ]}
          />

          {activeTab === "workflows" && (
            <select
              aria-label="Filter by workflow status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | WorkflowStatus)}
              className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="all">All Statuses</option>
              <option value="AWAITING_APPROVAL">Awaiting Approval</option>
              <option value="EXECUTING">Executing</option>
              <option value="COMPLETED">Completed</option>
              <option value="FAILED">Failed</option>
              <option value="DRIFT_ABORTED">Drift Aborted</option>
              <option value="ROLLED_BACK">Rolled Back</option>
            </select>
          )}
        </div>

        <SearchFilterBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Filter app, hostname, ticket..."
          filteredCount={
            activeTab === "workflows" ? filteredWorkflows.length : filteredRoutes.length
          }
          totalCount={activeTab === "workflows" ? allWorkflows.length : allRoutes.length}
          hasActiveFilters={hasActiveFilters}
          onResetFilters={clearAllFilters}
          itemLabel={activeTab === "workflows" ? "workflows" : "routes"}
        />
      </div>

      {/* TanStack Table Container */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {activeTab === "workflows" ? (
          <WorkflowsTable
            workflows={filteredWorkflows}
            liveStateEtag={liveEtag}
            isLoading={workflowsQuery.isLoading || routesQuery.isLoading}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={clearAllFilters}
          />
        ) : (
          <DataTable
            table={routeTable}
            isLoading={workflowsQuery.isLoading || routesQuery.isLoading}
            skeletonRows={3}
            emptyTitle="No active routes match your filter"
            emptyDescription={
              hasActiveFilters
                ? "Reset active environment or search filters to view all live routes."
                : "Approved workflows will register active routes here."
            }
            emptyActionLabel={hasActiveFilters ? "Reset filters" : undefined}
            onEmptyAction={clearAllFilters}
          />
        )}
      </div>
    </div>
  );
}
