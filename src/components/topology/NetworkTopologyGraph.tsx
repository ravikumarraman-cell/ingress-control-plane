import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as d3 from "d3";
import { ArrowRight, Maximize2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import {
  fetchAgentBlueprints,
  fetchArchitectureDoc,
  fetchRoutes,
  fetchWorkflows,
} from "../../lib/api";
import { SegmentedTabs } from "../ui/SegmentedTabs";
import {
  buildTopologyGraph,
  type TopologyEdge,
  type TopologyEdgeKind,
  type TopologyNode,
  type TopologyNodeKind,
  type TopologyViewMode,
} from "./buildTopologyGraph";

const NODE_PALETTE: Record<
  TopologyNodeKind,
  { fill: string; stroke: string; titleColor: string; subtitleColor: string; badge: string }
> = {
  ui: {
    fill: "#eff6ff",
    stroke: "#2563eb",
    titleColor: "#1e3a8a",
    subtitleColor: "#3b82f6",
    badge: "Control Plane UI",
  },
  api: {
    fill: "#f0fdf4",
    stroke: "#16a34a",
    titleColor: "#14532d",
    subtitleColor: "#15803d",
    badge: "API & SSE Bridge",
  },
  agent_ro: {
    fill: "#f8fafc",
    stroke: "#475569",
    titleColor: "#0f172a",
    subtitleColor: "#475569",
    badge: "Read-Only AI Agent",
  },
  agent_dynamic: {
    fill: "#ecfdf5",
    stroke: "#059669",
    titleColor: "#064e3b",
    subtitleColor: "#047857",
    badge: "On-the-Fly Agent",
  },
  store: {
    fill: "#faf5ff",
    stroke: "#7e22ce",
    titleColor: "#3b0764",
    subtitleColor: "#6b21a8",
    badge: "Durable Audit Store",
  },
  hitl: {
    fill: "#fffbeb",
    stroke: "#d97706",
    titleColor: "#78350f",
    subtitleColor: "#b45309",
    badge: "Human Approval Gate",
  },
  agent_rw: {
    fill: "#fef2f2",
    stroke: "#dc2626",
    titleColor: "#7f1d1d",
    subtitleColor: "#b91c1c",
    badge: "Scoped Write Engine",
  },
  infra: {
    fill: "#ecfeff",
    stroke: "#0891b2",
    titleColor: "#164e63",
    subtitleColor: "#0e7490",
    badge: "Network Infrastructure",
  },
  route: {
    fill: "#ffffff",
    stroke: "#1d4ed8",
    titleColor: "#0f172a",
    subtitleColor: "#1d4ed8",
    badge: "Active Ingress Route",
  },
};

const EDGE_COLOR: Record<TopologyEdgeKind, string> = {
  control: "#2563eb",
  readonly: "#64748b",
  approval: "#d97706",
  dynamic: "#059669",
  traffic: "#0891b2",
};

export interface NetworkTopologyGraphProps {
  flowchartMermaidOverride?: string;
}

export function NetworkTopologyGraph({ flowchartMermaidOverride }: NetworkTopologyGraphProps) {
  const [viewMode, setViewMode] = useState<TopologyViewMode>("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string>("HITL");

  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const docQuery = useQuery({
    queryKey: ["architecture-doc"],
    queryFn: fetchArchitectureDoc,
    enabled: !flowchartMermaidOverride,
  });

  const blueprintsQuery = useQuery({
    queryKey: ["agent-blueprints"],
    queryFn: fetchAgentBlueprints,
  });

  const routesQuery = useQuery({
    queryKey: ["routes"],
    queryFn: fetchRoutes,
  });

  const workflowsQuery = useQuery({
    queryKey: ["workflows"],
    queryFn: () => fetchWorkflows(),
  });

  const flowchartMermaid =
    flowchartMermaidOverride ?? docQuery.data?.flowchartMermaid ?? "";

  const graph = useMemo(
    () =>
      buildTopologyGraph({
        flowchartMermaid,
        blueprints: blueprintsQuery.data?.blueprints ?? [],
        routes: routesQuery.data?.routes ?? [],
        workflows: workflowsQuery.data?.workflows ?? [],
        viewMode,
      }),
    [
      flowchartMermaid,
      blueprintsQuery.data?.blueprints,
      routesQuery.data?.routes,
      workflowsQuery.data?.workflows,
      viewMode,
    ]
  );

  const nodeMap = useMemo(() => {
    const map = new Map<string, TopologyNode>();
    for (const node of graph.nodes) {
      map.set(node.id, node);
    }
    return map;
  }, [graph.nodes]);

  const selectedNode = useMemo(() => {
    return nodeMap.get(selectedNodeId) ?? graph.nodes[0] ?? null;
  }, [nodeMap, selectedNodeId, graph.nodes]);

  const connectedEdges = useMemo(() => {
    if (!selectedNode) return { incoming: [] as TopologyEdge[], outgoing: [] as TopologyEdge[] };
    return {
      incoming: graph.edges.filter((e) => e.target === selectedNode.id),
      outgoing: graph.edges.filter((e) => e.source === selectedNode.id),
    };
  }, [graph.edges, selectedNode]);

  // Render interactive D3 topology SVG
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    const defs = svg.append("defs");

    // Arrowhead markers per edge kind
    (Object.entries(EDGE_COLOR) as Array<[TopologyEdgeKind, string]>).forEach(([kind, color]) => {
      defs
        .append("marker")
        .attr("id", `topo-arrow-${kind}`)
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 9)
        .attr("refY", 0)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-4L10,0L0,4Z")
        .attr("fill", color);
    });

    const viewport = svg.append("g").attr("class", "topology-viewport");

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.55, 1.85])
      .on("zoom", (event) => {
        viewport.attr("transform", event.transform.toString());
      });

    zoomBehaviorRef.current = zoom;
    svg.call(zoom);

    // Subtle column zone backdrop guides
    const columns = Array.from(new Set(graph.nodes.map((n) => n.column))).sort((a, b) => a - b);
    const zoneGroup = viewport.append("g").attr("class", "topology-zones");
    columns.forEach((colIdx) => {
      const colNodes = graph.nodes.filter((n) => n.column === colIdx);
      if (colNodes.length === 0) return;
      const cx = colNodes[0].x;
      zoneGroup
        .append("rect")
        .attr("x", cx - 102)
        .attr("y", 18)
        .attr("width", 204)
        .attr("height", graph.canvasHeight - 36)
        .attr("rx", 10)
        .attr("fill", colIdx % 2 === 0 ? "#ffffff" : "#f8fafc")
        .attr("stroke", "#e2e8f0")
        .attr("stroke-width", 1);
    });

    // Edge spline paths using d3.linkHorizontal
    const linkGenerator = d3
      .linkHorizontal<TopologyEdge, { x: number; y: number }>()
      .source((d) => {
        const src = nodeMap.get(d.source);
        return src ? { x: src.x + src.width / 2, y: src.y } : { x: 0, y: 0 };
      })
      .target((d) => {
        const tgt = nodeMap.get(d.target);
        return tgt ? { x: tgt.x - tgt.width / 2 - 4, y: tgt.y } : { x: 0, y: 0 };
      });

    const edgeGroup = viewport.append("g").attr("class", "topology-edges");

    const edgeSelection = edgeGroup
      .selectAll("g.topology-edge")
      .data(graph.edges, (d) => (d as TopologyEdge).id)
      .join("g")
      .attr("class", "topology-edge");

    edgeSelection
      .append("path")
      .attr("d", (d) => linkGenerator(d) ?? "")
      .attr("fill", "none")
      .attr("stroke", (d) => EDGE_COLOR[d.kind])
      .attr("stroke-width", (d) => {
        const isAdjacent =
          selectedNode && (d.source === selectedNode.id || d.target === selectedNode.id);
        const base =
          d.kind === "traffic" && typeof d.weightPercent === "number"
            ? Math.max(1.75, Math.min(4, (d.weightPercent / 100) * 3.5))
            : 1.75;
        return isAdjacent ? base + 0.9 : base;
      })
      .attr("stroke-opacity", (d) => {
        if (!selectedNode) return 0.78;
        return d.source === selectedNode.id || d.target === selectedNode.id ? 1 : 0.25;
      })
      .attr("stroke-dasharray", (d) => (d.dashed ? "5 4" : null))
      .attr("marker-end", (d) => `url(#topo-arrow-${d.kind})`);

    // Edge labels for highlighted or traffic paths
    edgeSelection
      .filter((d) => {
        if (!d.label) return false;
        if (selectedNode && (d.source === selectedNode.id || d.target === selectedNode.id)) {
          return true;
        }
        return d.kind === "traffic" || d.kind === "dynamic";
      })
      .append("text")
      .attr("x", (d) => {
        const s = nodeMap.get(d.source);
        const t = nodeMap.get(d.target);
        if (!s || !t) return 0;
        return (s.x + t.x) / 2;
      })
      .attr("y", (d) => {
        const s = nodeMap.get(d.source);
        const t = nodeMap.get(d.target);
        if (!s || !t) return 0;
        return (s.y + t.y) / 2 - 6;
      })
      .attr("text-anchor", "middle")
      .attr("font-family", "JetBrains Mono, monospace")
      .attr("font-size", "10px")
      .attr("fill", (d) => EDGE_COLOR[d.kind])
      .text((d) => d.label ?? "");

    // Render nodes
    const nodeGroup = viewport.append("g").attr("class", "topology-nodes");

    const nodeSelection = nodeGroup
      .selectAll("g.topology-node")
      .data(graph.nodes, (d) => (d as TopologyNode).id)
      .join("g")
      .attr("class", "topology-node")
      .attr("transform", (d) => `translate(${d.x - d.width / 2}, ${d.y - d.height / 2})`)
      .style("cursor", "pointer")
      .on("click", (_event, d) => {
        setSelectedNodeId(d.id);
      });

    nodeSelection
      .append("rect")
      .attr("width", (d) => d.width)
      .attr("height", (d) => d.height)
      .attr("rx", 8)
      .attr("fill", (d) => NODE_PALETTE[d.kind].fill)
      .attr("stroke", (d) =>
        selectedNode?.id === d.id ? "#1d4ed8" : NODE_PALETTE[d.kind].stroke
      )
      .attr("stroke-width", (d) => (selectedNode?.id === d.id ? 2.5 : 1.5))
      .attr("stroke-dasharray", (d) => (d.source === "dynamic_agent" ? "4 3" : null));

    nodeSelection
      .append("text")
      .attr("x", 12)
      .attr("y", 23)
      .attr("font-family", "Plus Jakarta Sans, DM Sans, sans-serif")
      .attr("font-size", "12px")
      .attr("font-weight", "600")
      .attr("fill", (d) => NODE_PALETTE[d.kind].titleColor)
      .text((d) => (d.label.length > 20 ? `${d.label.slice(0, 19)}…` : d.label));

    nodeSelection
      .append("text")
      .attr("x", 12)
      .attr("y", 41)
      .attr("font-family", "JetBrains Mono, monospace")
      .attr("font-size", "10px")
      .attr("fill", (d) => NODE_PALETTE[d.kind].subtitleColor)
      .text((d) => (d.subtitle.length > 24 ? `${d.subtitle.slice(0, 23)}…` : d.subtitle));

    // Initial fit scale
    const containerWidth = svgEl.clientWidth || 1000;
    const initialScale = Math.min(1, Math.max(0.62, (containerWidth - 24) / graph.canvasWidth));
    const tx = Math.max(12, (containerWidth - graph.canvasWidth * initialScale) / 2);
    svg.call(zoom.transform, d3.zoomIdentity.translate(tx, 8).scale(initialScale));
  }, [graph, nodeMap, selectedNode]);

  const handleZoom = (factor: number) => {
    const svgEl = svgRef.current;
    const zoom = zoomBehaviorRef.current;
    if (!svgEl || !zoom) return;
    d3.select(svgEl).transition().duration(180).call(zoom.scaleBy, factor);
  };

  const handleResetView = () => {
    const svgEl = svgRef.current;
    const zoom = zoomBehaviorRef.current;
    if (!svgEl || !zoom) return;
    const containerWidth = svgEl.clientWidth || 1000;
    const scale = Math.min(1, Math.max(0.62, (containerWidth - 24) / graph.canvasWidth));
    const tx = Math.max(12, (containerWidth - graph.canvasWidth * scale) / 2);
    d3.select(svgEl)
      .transition()
      .duration(200)
      .call(zoom.transform, d3.zoomIdentity.translate(tx, 8).scale(scale));
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="px-5 py-3.5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Interactive Agent Connectivity & Traffic Flow Topology (D3.js)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
            Derived from stored specification ({graph.specSummary.specNodeCount} spec nodes ·{" "}
            {graph.specSummary.specEdgeCount} spec edges) + live dynamic specialists & cluster routes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SegmentedTabs
            size="sm"
            ariaLabel="Topology focus mode"
            value={viewMode}
            onChange={setViewMode}
            items={[
              { id: "all", label: "All Paths" },
              { id: "agents", label: "Agent Connectivity" },
              { id: "traffic", label: "Traffic Flow Paths" },
            ]}
          />

          <div className="flex items-center gap-1 border border-slate-200 rounded-md p-0.5 bg-slate-50">
            <button
              type="button"
              onClick={() => handleZoom(1.2)}
              aria-label="Zoom in topology"
              className="p-1.5 text-slate-600 hover:text-slate-950 hover:bg-white rounded transition-colors"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleZoom(0.82)}
              aria-label="Zoom out topology"
              className="p-1.5 text-slate-600 hover:text-slate-950 hover:bg-white rounded transition-colors"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleResetView}
              aria-label="Reset topology zoom"
              className="p-1.5 text-slate-600 hover:text-slate-950 hover:bg-white rounded transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Split: D3 Canvas + Node/Path Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-slate-200">
        <div className="xl:col-span-8 bg-slate-50/60 relative">
          <svg
            ref={svgRef}
            className="w-full h-[480px] select-none touch-none"
            role="img"
            aria-label="D3 network topology illustrating agent connectivity and traffic flow paths"
          />

          {/* Quiet Legend Strip */}
          <div className="px-4 py-2.5 bg-white border-t border-slate-200 flex flex-wrap items-center gap-4 text-[11px] text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-slate-100 border border-slate-600" />
              Read-Only AI Agent
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-emerald-50 border border-emerald-600 border-dashed" />
              On-the-Fly Specialist
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-amber-50 border border-amber-600" />
              HITL Four-Eyes Gate
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-red-50 border border-red-600" />
              Scoped Write Executor
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-cyan-50 border border-cyan-600" />
              Data Plane & Canary Traffic
            </span>
          </div>
        </div>

        {/* Interactive Node & Path Inspector */}
        <div className="xl:col-span-4 p-5 bg-white space-y-4">
          {selectedNode ? (
            <>
              <div className="space-y-1 border-b border-slate-200 pb-3">
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span>{NODE_PALETTE[selectedNode.kind].badge}</span>
                  <span className="font-mono">
                    {selectedNode.source === "spec"
                      ? "docs/architecture-spec.md"
                      : selectedNode.source === "dynamic_agent"
                        ? "Agent Studio Runtime"
                        : "Live Cluster Route"}
                  </span>
                </div>
                <h3 className="text-base font-semibold text-slate-950">{selectedNode.label}</h3>
                <div className="text-xs font-mono text-slate-600">{selectedNode.subtitle}</div>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">{selectedNode.detailText}</p>

              <div className="grid grid-cols-1 gap-2 p-3 bg-slate-50 border border-slate-200 rounded-md text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Security Boundary</span>
                  <span className="font-mono font-medium text-slate-900">
                    {selectedNode.securityBoundary}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Live Telemetry</span>
                  <span className="font-mono text-slate-800 tabular-nums">
                    {selectedNode.metricsSummary}
                  </span>
                </div>
              </div>

              <div className="space-y-2.5">
                <div className="text-xs font-semibold text-slate-800">
                  Connected Paths ({connectedEdges.incoming.length} in ·{" "}
                  {connectedEdges.outgoing.length} out)
                </div>

                {connectedEdges.incoming.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[11px] font-medium text-slate-500">Upstream Sources</div>
                    <div className="space-y-1">
                      {connectedEdges.incoming.map((edge) => {
                        const src = nodeMap.get(edge.source);
                        if (!src) return null;
                        return (
                          <button
                            key={edge.id}
                            type="button"
                            onClick={() => setSelectedNodeId(src.id)}
                            className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded transition-colors text-left"
                          >
                            <span className="font-medium text-slate-900 truncate">{src.label}</span>
                            <span className="font-mono text-[11px] text-slate-500 shrink-0">
                              {edge.label ?? edge.kind}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {connectedEdges.outgoing.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[11px] font-medium text-slate-500">
                      Downstream Targets
                    </div>
                    <div className="space-y-1">
                      {connectedEdges.outgoing.map((edge) => {
                        const tgt = nodeMap.get(edge.target);
                        if (!tgt) return null;
                        return (
                          <button
                            key={edge.id}
                            type="button"
                            onClick={() => setSelectedNodeId(tgt.id)}
                            className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded transition-colors text-left"
                          >
                            <span className="inline-flex items-center gap-1.5 font-medium text-slate-900 truncate">
                              <ArrowRight className="h-3 w-3 text-blue-700 shrink-0" />
                              {tgt.label}
                            </span>
                            <span className="font-mono text-[11px] text-slate-500 shrink-0">
                              {edge.label ?? edge.kind}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="py-12 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
              <Maximize2 className="h-4 w-4 text-slate-400" />
              <span>Click any node in the topology to inspect connectivity and traffic rules.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
