import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { WorkflowRun } from "../../shared/contracts";

export interface DagEdgeGeometry {
  id: string;
  fromName: string;
  toName: string;
  path: string;
  labelX: number;
  labelY: number;
  active: boolean;
  vetoed: boolean;
}

export function useDagEdgeGeometry(
  canvasRef: RefObject<HTMLDivElement | null>,
  workflow: WorkflowRun | null | undefined,
  deps: ReadonlyArray<unknown>
) {
  const nodeElementMapRef = useRef<Map<string, HTMLElement>>(new Map());
  const [dagEdges, setDagEdges] = useState<DagEdgeGeometry[]>([]);

  const registerNodeRef = useCallback(
    (names: string[]) => (el: HTMLElement | null) => {
      for (const n of names) {
        if (el) {
          nodeElementMapRef.current.set(n, el);
        } else {
          nodeElementMapRef.current.delete(n);
        }
      }
    },
    []
  );

  const recomputeDagEdges = useCallback(() => {
    const container = canvasRef.current;
    if (!container || !workflow) {
      setDagEdges([]);
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const assignments = workflow.dynamicTaskAssignments ?? [];
    const nextEdges: DagEdgeGeometry[] = [];

    for (const a of assignments) {
      const targetEl = nodeElementMapRef.current.get(a.agentName);
      if (!targetEl) continue;
      const tRect = targetEl.getBoundingClientRect();

      for (const depName of a.dependsOn) {
        const sourceEl = nodeElementMapRef.current.get(depName);
        if (!sourceEl) continue;
        const sRect = sourceEl.getBoundingClientRect();

        const sameColumn = Math.abs(sRect.left - tRect.left) < 40;
        let x1: number;
        let y1: number;
        let x2: number;
        let y2: number;

        if (sameColumn) {
          x1 = sRect.left + sRect.width / 2 - containerRect.left;
          y1 = sRect.bottom - containerRect.top;
          x2 = tRect.left + tRect.width / 2 - containerRect.left;
          y2 = tRect.top - containerRect.top;
        } else {
          x1 = sRect.right - containerRect.left;
          y1 = sRect.top + sRect.height / 2 - containerRect.top;
          x2 = tRect.left - containerRect.left;
          y2 = tRect.top + tRect.height / 2 - containerRect.top;
        }

        const dx = Math.max(28, Math.abs(x2 - x1) * 0.45);
        const path = sameColumn
          ? `M ${x1} ${y1} C ${x1 + 24} ${y1 + 20}, ${x2 + 24} ${y2 - 20}, ${x2} ${y2}`
          : `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

        const upstreamOut = workflow.sharedContextBus?.[depName];
        const vetoed =
          Boolean(upstreamOut?.vetoTriggered) || a.status === "SKIPPED_UPSTREAM_FAILED";
        const active = a.status === "COMPLETED" || a.status === "RUNNING";

        nextEdges.push({
          id: `${depName}->${a.agentName}`,
          fromName: depName,
          toName: a.agentName,
          path,
          labelX: (x1 + x2) / 2,
          labelY: (y1 + y2) / 2,
          active,
          vetoed,
        });
      }
    }

    setDagEdges(nextEdges);
  }, [canvasRef, workflow]);

  useLayoutEffect(() => {
    let rafId: number | null = null;
    const schedule = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => recomputeDagEdges());
    };

    recomputeDagEdges();
    const container = canvasRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      return () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
      };
    }

    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    window.addEventListener("resize", schedule);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recomputeDagEdges, ...deps]);

  return { dagEdges, registerNodeRef };
}
