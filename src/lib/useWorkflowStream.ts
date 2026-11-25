import { useEffect, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

type WorkflowStreamSource = Pick<EventTarget, "addEventListener"> &
  Pick<EventSource, "close" | "onerror">;
type WorkflowStreamQueryClient = Pick<QueryClient, "invalidateQueries">;

export function bindWorkflowStream(
  source: WorkflowStreamSource,
  queryClient: WorkflowStreamQueryClient,
  onConnected: () => void,
  onDisconnected: () => void
): () => void {
  const invalidateWorkflowQueries = (workflowId?: string) => {
    void queryClient.invalidateQueries({ queryKey: ["workflows"] });
    void queryClient.invalidateQueries({
      queryKey: workflowId ? ["workflow", workflowId] : ["workflow"],
    });
    void queryClient.invalidateQueries({ queryKey: ["routes"] });
    void queryClient.invalidateQueries({ queryKey: ["audit-log"] });
    void queryClient.invalidateQueries({ queryKey: ["traffic-telemetry"] });
    void queryClient.invalidateQueries({ queryKey: ["strands-telemetry"] });
  };

  source.addEventListener("connected", onConnected);
  source.addEventListener("workflow_update", (ev) => {
    try {
      const data = JSON.parse((ev as MessageEvent).data) as {
        workflowId: string;
        status: string;
        liveStateEtag: string;
      };
      invalidateWorkflowQueries(data.workflowId);
    } catch {
      // Ignore malformed SSE payload
    }
  });
  source.addEventListener("resync_required", () => {
    invalidateWorkflowQueries();
  });
  source.onerror = onDisconnected;

  return () => source.close();
}

export function useWorkflowStream() {
  const queryClient = useQueryClient();
  const [streamConnected, setStreamConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource("/api/v1/workflows/events");
    const unbind = bindWorkflowStream(
      source,
      queryClient,
      () => setStreamConnected(true),
      () => setStreamConnected(false)
    );

    return () => {
      unbind();
      setStreamConnected(false);
    };
  }, [queryClient]);

  return { streamConnected };
}
