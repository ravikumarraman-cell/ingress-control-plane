import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function useWorkflowStream() {
  const queryClient = useQueryClient();
  const [streamConnected, setStreamConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource("/api/v1/workflows/events");

    source.addEventListener("connected", () => {
      setStreamConnected(true);
    });

    source.addEventListener("workflow_update", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as {
          workflowId: string;
          status: string;
          liveStateEtag: string;
        };
        queryClient.invalidateQueries({ queryKey: ["workflows"] });
        queryClient.invalidateQueries({ queryKey: ["workflow", data.workflowId] });
        queryClient.invalidateQueries({ queryKey: ["routes"] });
        queryClient.invalidateQueries({ queryKey: ["audit-log"] });
        queryClient.invalidateQueries({ queryKey: ["traffic-telemetry"] });
        queryClient.invalidateQueries({ queryKey: ["strands-telemetry"] });
      } catch {
        // Ignore malformed SSE payload
      }
    });

    source.onerror = () => {
      setStreamConnected(false);
    };

    return () => {
      source.close();
      setStreamConnected(false);
    };
  }, [queryClient]);

  return { streamConnected };
}
