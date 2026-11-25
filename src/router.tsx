import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import { RootLayout } from "./components/layout/RootLayout";

function RoutePendingFallback() {
  return (
    <div className="space-y-4">
      <div className="h-16 bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-lg animate-pulse" />
      <div className="h-80 bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-lg animate-pulse" />
    </div>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => (
    <div className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-lg p-8 text-center">
      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Route Not Found</h2>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
        The requested control plane view does not exist.
      </p>
    </div>
  ),
});

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/workflows" });
  },
});

export const workflowsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workflows",
  component: lazyRouteComponent(() => import("./pages/WorkflowsPage"), "WorkflowsPage"),
});

export const workflowDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workflows/$workflowId",
  component: lazyRouteComponent(
    () => import("./routes/workflows.$workflowId"),
    "WorkflowDetailRouteView"
  ),
});

export const approvalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/approvals",
  component: lazyRouteComponent(() => import("./pages/ApprovalsPage"), "ApprovalsPage"),
});

export const auditLogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/audit-log",
  component: lazyRouteComponent(() => import("./pages/AuditLogPage"), "AuditLogPage"),
});

export const architectureRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/architecture",
  component: lazyRouteComponent(() => import("./pages/ArchitecturePage"), "ArchitecturePage"),
});

export const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/agents",
  component: lazyRouteComponent(() => import("./pages/AgentFlowPage"), "AgentFlowPage"),
});

export const strandsMetricsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/strands-metrics",
  component: lazyRouteComponent(() => import("./pages/StrandsMetricsPage"), "StrandsMetricsPage"),
});

export const studioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/studio",
  component: lazyRouteComponent(() => import("./pages/EdgeStudioPage"), "EdgeStudioPage"),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  workflowsRoute,
  workflowDetailRoute,
  approvalsRoute,
  auditLogRoute,
  architectureRoute,
  agentsRoute,
  strandsMetricsRoute,
  studioRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultPendingMs: 120,
  defaultPendingComponent: RoutePendingFallback,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
