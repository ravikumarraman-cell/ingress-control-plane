import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/ui/PageHeader";
import { PendingApprovalsPanel } from "../components/workflows/PendingApprovalsPanel";
import { fetchRoutes, fetchWorkflows } from "../lib/api";

export function ApprovalsPage() {
  const wfQuery = useQuery({
    queryKey: ["workflows"],
    queryFn: fetchWorkflows,
  });

  const routesQuery = useQuery({
    queryKey: ["routes"],
    queryFn: fetchRoutes,
  });

  const liveEtag = routesQuery.data?.liveStateEtag ?? wfQuery.data?.liveStateEtag ?? "";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Human-in-the-Loop Approval Inbox"
        subtitle="Workflows halted at the Strands state interrupt requiring signed four-eyes RBAC approval prior to ExecutionAgent unlock."
      />

      <PendingApprovalsPanel
        workflows={wfQuery.data?.workflows ?? []}
        routes={routesQuery.data?.routes ?? []}
        liveStateEtag={liveEtag}
        isLoading={wfQuery.isLoading || routesQuery.isLoading}
        showInboxLink={false}
      />
    </div>
  );
}

