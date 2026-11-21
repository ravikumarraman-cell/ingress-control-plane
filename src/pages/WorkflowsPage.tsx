import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createColumnHelper,
  createSortedRowModel,
  flexRender,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowUpDown, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { WorkflowsTable } from "../components/WorkflowsTable";
import { fetchRoutes, fetchWorkflows, simulateInfraDrift } from "../lib/api";
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

  const workflowsQuery = useQuery({
    queryKey: ["workflows"],
    queryFn: fetchWorkflows,
  });

  const routesQuery = useQuery({
    queryKey: ["routes"],
    queryFn: fetchRoutes,
  });

  const driftMutation = useMutation({
    mutationFn: simulateInfraDrift,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routes"] });
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      queryClient.invalidateQueries({ queryKey: ["audit-log"] });
    },
  });

  const filteredWorkflows = useMemo(() => {
    const items = workflowsQuery.data?.workflows ?? [];
    return items.filter((w) => {
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
  }, [workflowsQuery.data, envFilter, statusFilter, searchQuery]);

  const filteredRoutes = useMemo(() => {
    const items = routesQuery.data?.routes ?? [];
    return items.filter((r) => {
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
  }, [routesQuery.data, envFilter, searchQuery]);

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
      {/* Page Title & Live State ETag Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Ingress Governance Workflows
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Read-only discovery, compliance validation, HITL approval gates, and active cluster routes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="px-3 py-2 bg-white border border-slate-200 rounded-md flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-slate-500 shrink-0" />
            <span className="text-xs text-slate-500">Live ETag:</span>
            <code className="text-xs font-mono text-slate-900 tabular-nums">
              {liveEtag ? `${liveEtag.slice(0, 22)}...` : "loading..."}
            </code>
          </div>
          <button
            type="button"
            onClick={() => driftMutation.mutate()}
            disabled={driftMutation.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            title="Mutate a live route annotation out-of-band to test TOCTOU ETag anti-drift locking"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${driftMutation.isPending ? "animate-spin" : ""}`} />
            Simulate Infra Drift
          </button>
        </div>
      </div>

      {/* Summary Metric Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-slate-200 rounded-lg divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
        <div className="p-4">
          <div className="text-xs font-medium text-slate-500">Total Workflows</div>
          <div className="text-2xl font-semibold text-slate-900 font-mono tabular-nums mt-1">
            {workflowsQuery.data?.workflows.length ?? 0}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs font-medium text-slate-500">Awaiting Human Approval</div>
          <div className="text-2xl font-semibold text-amber-700 font-mono tabular-nums mt-1">
            {workflowsQuery.data?.workflows.filter((w) => w.status === "AWAITING_APPROVAL")
              .length ?? 0}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs font-medium text-slate-500">Active Ingress Routes</div>
          <div className="text-2xl font-semibold text-slate-900 font-mono tabular-nums mt-1">
            {routesQuery.data?.routes.length ?? 0}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs font-medium text-slate-500">Out-of-Band Drift Events</div>
          <div className="text-2xl font-semibold text-slate-900 font-mono tabular-nums mt-1">
            {routesQuery.data?.driftCounter ?? 0}
          </div>
        </div>
      </div>

      {/* Filter & Segmented Tab Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
            <button
              type="button"
              onClick={() => setActiveTab("workflows")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                activeTab === "workflows"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Workflows Queue
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("routes")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                activeTab === "routes"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Active Ingress Routes
            </button>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
            {(["all", "prod", "staging", "dev"] as const).map((env) => (
              <button
                key={env}
                type="button"
                onClick={() => setEnvFilter(env)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  envFilter === env
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {env === "all" ? "All Envs" : env}
              </button>
            ))}
          </div>

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

        <div className="relative w-full md:w-72">
          <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter app, hostname, ticket..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
      </div>

      {/* TanStack Table Container */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {workflowsQuery.isLoading || routesQuery.isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((idx) => (
              <div key={idx} className="h-10 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : activeTab === "workflows" ? (
          <WorkflowsTable workflows={filteredWorkflows} />
        ) : filteredRoutes.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-medium text-slate-900">No active routes match your filter</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                {routeTable.getHeaderGroups().map((hg) => (
                  <tr key={hg.id} className="border-b border-slate-200 bg-slate-50">
                    {hg.headers.map((header) => (
                      <th
                        key={header.id}
                        className="px-4 py-2.5 text-xs font-semibold text-slate-600 whitespace-nowrap"
                      >
                        {header.isPlaceholder ? null : header.column.getCanSort() ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className="inline-flex items-center gap-1 hover:text-slate-900"
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            <ArrowUpDown className="h-3 w-3 text-slate-400" />
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {routeTable.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                    {row.getAllCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-3 align-middle">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
