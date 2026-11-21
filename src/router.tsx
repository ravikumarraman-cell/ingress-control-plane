import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { RootLayout } from "./components/layout/RootLayout";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { ArchitecturePage } from "./pages/ArchitecturePage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { WorkflowDetailPage } from "./pages/WorkflowDetailPage";
import { WorkflowsPage } from "./pages/WorkflowsPage";

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
  component: WorkflowsPage,
});

export const workflowDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workflows/$workflowId",
  component: WorkflowDetailPage,
});

export const approvalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/approvals",
  component: ApprovalsPage,
});

export const auditLogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/audit-log",
  component: AuditLogPage,
});

export const architectureRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/architecture",
  component: ArchitecturePage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  workflowsRoute,
  workflowDetailRoute,
  approvalsRoute,
  auditLogRoute,
  architectureRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
