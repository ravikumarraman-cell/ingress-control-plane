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
      <div className="h-16 bg-white border border-slate-200 rounded-lg animate-pulse" />
      <div className="h-80 bg-white border border-slate-200 rounded-lg animate-pulse" />
    </div>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => (
    <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
      <h2 className="text-base font-semibold text-slate-900">Route Not Found</h2>
      <p className="text-xs text-slate-500 mt-1">
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

const routeTree = rootRoute.addChildren([
  indexRoute,
  workflowsRoute,
  workflowDetailRoute,
  approvalsRoute,
  auditLogRoute,
  architectureRoute,
  agentsRoute,
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
