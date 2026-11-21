import type { WorkflowStatus } from "../shared/contracts";
import { StatusBadge } from "./ui/StatusBadge";

export function WorkflowStatusIndicator({
  status,
  showCode = false,
}: {
  status: WorkflowStatus;
  showCode?: boolean;
}) {
  return <StatusBadge status={status} showRawStatus={showCode} />;
}
