import React from "react";
import {
  Activity,
  Command,
  Layers,
  Network,
  PanelRightOpen,
  Plus,
  Route,
  Server,
  Shield,
} from "lucide-react";
import { PRESET_ARCHITECTURES } from "../core/ir/presets";
import { InspectorPane } from "../features/inspector/InspectorPane";
import { PoliciesView } from "../features/policies/PoliciesView";
import { RoutesView } from "../features/routes/RoutesView";
import { SecuritySyncView } from "../features/security/SecuritySyncView";
import { TopologyView } from "../features/topology/TopologyView";
import { UpstreamsView } from "../features/upstreams/UpstreamsView";
import { useControlPlane, type WorkspaceView } from "../store/ControlPlaneContext";

const STUDIO_TABS: {
  id: WorkspaceView;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "topology", label: "Topology", icon: Network },
  { id: "routes", label: "Routes", icon: Route },
  { id: "upstreams", label: "Upstreams", icon: Server },
  { id: "policies", label: "Policies & Plugins", icon: Layers },
  { id: "security", label: "TLS & Regional Drift", icon: Shield },
];

export const EdgeStudioPage: React.FC = () => {
  const {
    activeView,
    setActiveView,
    activePresetId,
    loadPreset,
    desiredHash,
    activeHash,
    diagnostics,
    inspectorOpen,
    setInspectorOpen,
    tracerOpen,
    setTracerOpen,
    setCommandPaletteOpen,
    setCustomPluginModalOpen,
  } = useControlPlane();

  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.filter((d) => d.severity === "warning").length;
  const hasDrift = desiredHash !== activeHash;

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] w-full overflow-hidden bg-slate-50 dark:bg-[#090D16] text-slate-900 dark:text-slate-100">
      {/* Studio Sub-Toolbar: Tabs, Presets, Quick Utilities */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0B101B]">
        <div className="flex items-center gap-1 p-0.5 rounded-md bg-slate-100 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 overflow-x-auto">
          {STUDIO_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeView === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveView(tab.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? "bg-white dark:bg-slate-800 text-blue-700 dark:text-sky-300 shadow-xs dark:shadow-none"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activePresetId}
            onChange={(e) => loadPreset(e.target.value)}
            aria-label="Load production preset architecture"
            className="bg-white dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1 text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-600 dark:focus:border-sky-400"
          >
            {PRESET_ARCHITECTURES.map((preset) => (
              <option key={preset.id} value={preset.id}>
                Preset: {preset.name}
              </option>
            ))}
          </select>

          <span className="hidden xl:inline-flex items-center gap-2 text-[11px] font-mono tabular-nums px-2 py-1 text-slate-500 dark:text-slate-400">
            <span className={hasDrift ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}>
              Rev {desiredHash}
            </span>
            <span aria-hidden="true">·</span>
            <span
              className={
                errorCount > 0
                  ? "text-rose-600 dark:text-rose-400"
                  : warningCount > 0
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-emerald-600 dark:text-emerald-400"
              }
            >
              {errorCount}E {warningCount}W
            </span>
          </span>

          <button
            type="button"
            onClick={() => setCustomPluginModalOpen(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#090D16] hover:border-blue-500 dark:hover:border-sky-400 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Custom Plugin</span>
          </button>

          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#090D16] text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
            title="Open Command Palette (Cmd+K)"
          >
            <Command className="w-3.5 h-3.5" />
            <span className="font-mono text-[11px]">⌘K</span>
          </button>

          <button
            type="button"
            onClick={() => setTracerOpen(!tracerOpen)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              tracerOpen
                ? "bg-blue-700 dark:bg-sky-500 text-white dark:text-slate-950"
                : "border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#090D16] text-slate-700 dark:text-slate-200 hover:border-blue-500 dark:hover:border-sky-400"
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Request Tracer</span>
          </button>

          {!inspectorOpen && (
            <button
              type="button"
              onClick={() => setInspectorOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-blue-200 dark:border-sky-500/40 bg-blue-50 dark:bg-sky-500/10 text-xs font-medium text-blue-700 dark:text-sky-300 transition-colors whitespace-nowrap shrink-0"
            >
              <PanelRightOpen className="w-3.5 h-3.5" />
              <span>Inspector</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Split-Pane Studio Body */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
          {activeView === "topology" && <TopologyView />}
          {activeView === "routes" && <RoutesView />}
          {activeView === "upstreams" && <UpstreamsView />}
          {activeView === "policies" && <PoliciesView />}
          {activeView === "security" && <SecuritySyncView />}
        </div>

        <InspectorPane />
      </div>
    </div>
  );
};
