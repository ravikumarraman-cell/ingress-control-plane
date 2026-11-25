import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { bindWorkflowStream } from "./useWorkflowStream";

class TestEventSource extends EventTarget {
  onerror: EventSource["onerror"] = null;
  closed = false;

  close(): void {
    this.closed = true;
  }
}

describe("bindWorkflowStream", () => {
  it("invalidates the addressed workflow detail when a live update arrives", () => {
    const source = new TestEventSource();
    const queryClient = new QueryClient();
    const invalidateQueries = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    const unbind = bindWorkflowStream(source, queryClient, vi.fn(), vi.fn());

    source.dispatchEvent(
      new MessageEvent("workflow_update", {
        data: JSON.stringify({
          workflowId: "workflow-1",
          status: "RUNNING",
          liveStateEtag: "sha256:test",
        }),
      })
    );
    unbind();

    expect(invalidateQueries.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ["workflows"],
      ["workflow", "workflow-1"],
      ["routes"],
      ["audit-log"],
      ["traffic-telemetry"],
      ["strands-telemetry"],
    ]);
  });

  it("invalidates all workflow-dependent queries when a resync is required", () => {
    const source = new TestEventSource();
    const queryClient = new QueryClient();
    const invalidateQueries = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    const onConnected = vi.fn();
    const onDisconnected = vi.fn();
    const unbind = bindWorkflowStream(source, queryClient, onConnected, onDisconnected);

    source.dispatchEvent(new Event("connected"));
    source.dispatchEvent(
      new MessageEvent("resync_required", {
        data: JSON.stringify({ reason: "cursor_expired", latestEventId: 101 }),
      })
    );
    unbind();

    expect(onConnected).toHaveBeenCalledOnce();
    expect(invalidateQueries.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ["workflows"],
      ["workflow"],
      ["routes"],
      ["audit-log"],
      ["traffic-telemetry"],
      ["strands-telemetry"],
    ]);
    expect(source.closed).toBe(true);
  });
});
