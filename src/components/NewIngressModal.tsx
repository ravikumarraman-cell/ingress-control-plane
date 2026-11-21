import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, ChevronDown, ChevronUp, Plus, Trash2, X } from "lucide-react";
import { createWorkflow, type CreateWorkflowInput } from "../lib/api";
import type {
  CustomAgentSpec,
  ExecutionMode,
  HitlPolicyMode,
} from "../shared/contracts";
import { SegmentedTabs } from "./ui/SegmentedTabs";

export function NewIngressModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [intakeMode, setIntakeMode] = useState<"structured" | "ai">("structured");
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("gitops_pr_v2");
  const [ticketRef, setTicketRef] = useState("NET-4902");
  const [naturalPrompt, setNaturalPrompt] = useState(
    "Expose billing-api in prod at billing.corp.example.com under /v1/billing targeting billing-core-svc on port 8443 with external exposure and strict TLS 1.3."
  );

  // Structured fields
  const [appName, setAppName] = useState("billing-api");
  const [environment, setEnvironment] = useState<"dev" | "staging" | "prod">("prod");
  const [hostname, setHostname] = useState("billing.corp.example.com");
  const [pathPrefix, setPathPrefix] = useState("/v1/billing");
  const [backendService, setBackendService] = useState("billing-core-svc");
  const [backendPort, setBackendPort] = useState("8443");
  const [exposure, setExposure] = useState<"internal" | "external">("external");
  const [tlsProfile, setTlsProfile] = useState<
    "tls_1_3_strict" | "tls_1_2_compat" | "mtls_internal"
  >("tls_1_3_strict");
  const [justification, setJustification] = useState(
    "Production ingress onboarding for billing-api with WAF and TLS 1.3 strict profile."
  );

  // Flexible Agent Pipeline Controls
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hitlPolicy, setHitlPolicy] = useState<HitlPolicyMode>("always");
  const [enableCostAgent, setEnableCostAgent] = useState(true);
  const [enableSecPostureAgent, setEnableSecPostureAgent] = useState(true);
  const [canaryPreset, setCanaryPreset] = useState<"10_50_100" | "25_100" | "100">("10_50_100");
  const [customInstructions, setCustomInstructions] = useState("");
  const [customAgents, setCustomAgents] = useState<CustomAgentSpec[]>([]);
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentInstruction, setNewAgentInstruction] = useState("");

  const mutation = useMutation({
    mutationFn: (payload: CreateWorkflowInput) => createWorkflow(payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      queryClient.invalidateQueries({ queryKey: ["audit-log"] });
      onClose();
      navigate({
        to: "/workflows/$workflowId",
        params: { workflowId: data.workflow.workflowId },
      });
    },
  });

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !mutation.isPending) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, mutation.isPending]);

  if (!open) return null;

  const applyPreset = (preset: "prod_external" | "staging_canary") => {
    if (preset === "prod_external") {
      setExecutionMode("gitops_pr_v2");
      setTicketRef("NET-4902");
      setAppName("billing-api");
      setEnvironment("prod");
      setHostname("billing.corp.example.com");
      setPathPrefix("/v1/billing");
      setBackendService("billing-core-svc");
      setBackendPort("8443");
      setExposure("external");
      setTlsProfile("tls_1_3_strict");
      setJustification(
        "Production ingress onboarding for billing-api with WAF and TLS 1.3 strict profile."
      );
      setNaturalPrompt(
        "Expose billing-api in prod at billing.corp.example.com under /v1/billing targeting billing-core-svc on port 8443 with external exposure and strict TLS 1.3."
      );
    } else {
      setExecutionMode("direct_canary_v3");
      setTicketRef("NET-4918");
      setAppName("checkout-web");
      setEnvironment("staging");
      setHostname("checkout.staging.example.com");
      setPathPrefix("/v2/checkout");
      setBackendService("checkout-canary-svc");
      setBackendPort("8080");
      setExposure("internal");
      setTlsProfile("mtls_internal");
      setJustification(
        "Staging progressive canary validation for checkout v2 internal gateway route."
      );
      setNaturalPrompt(
        "Create a staging canary ingress for checkout-web at checkout.staging.example.com under /v2/checkout targeting checkout-canary-svc on port 8080 with internal mTLS."
      );
    }
  };

  const buildPipelineConfig = () => {
    const enabledAgents = [
      "DiscoveryInventoryAgent",
      "PolicyComplianceAgent",
      "ImpactAnalysisAgent",
      "ChangePlanningAgent",
      "ValidationRollbackAgent",
    ];
    if (enableCostAgent) enabledAgents.push("CostEstimationAgent");
    if (enableSecPostureAgent) enabledAgents.push("SecurityPostureAgent");

    const canarySteps =
      canaryPreset === "10_50_100"
        ? [10, 50, 100]
        : canaryPreset === "25_100"
          ? [25, 100]
          : [100];

    return {
      hitlPolicy,
      enabledAgents,
      customAgents,
      canarySteps,
      maxSupervisorIterations: 5,
      customInstructions: customInstructions.trim() || undefined,
    };
  };

  const handleAddCustomAgent = () => {
    if (!newAgentName.trim() || !newAgentInstruction.trim()) return;
    setCustomAgents((prev) => [
      ...prev,
      {
        agentName: newAgentName.trim(),
        instruction: newAgentInstruction.trim(),
        accessMode: "READ_ONLY",
      },
    ]);
    setNewAgentName("");
    setNewAgentInstruction("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const pipelineConfig = buildPipelineConfig();
    if (intakeMode === "ai") {
      mutation.mutate({
        intakeMode: "ai",
        naturalLanguagePrompt: naturalPrompt,
        ticketRef: ticketRef.trim() || null,
        executionMode,
        pipelineConfig,
      });
    } else {
      mutation.mutate({
        intakeMode: "structured",
        executionMode,
        pipelineConfig,
        request: {
          ticketRef: ticketRef.trim() || null,
          appName: appName.trim(),
          environment,
          hostname: hostname.trim(),
          pathPrefix: pathPrefix.trim(),
          backendService: backendService.trim(),
          backendPort: Number(backendPort) || 8080,
          exposure,
          tlsProfile,
          rawJustification: justification.trim(),
        },
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-ingress-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !mutation.isPending) {
          onClose();
        }
      }}
    >
      <div className="bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 id="new-ingress-title" className="text-base font-semibold text-slate-900">
              New Ingress Change Request
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Dispatches IngressIntakeAgent, Phase A Read-Only Analysis, and Phase B Rollback Planning.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100 transition-colors"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5">
          {/* Quick Scenario Presets */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
            <span className="text-xs text-slate-500">Quick-fill template:</span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => applyPreset("prod_external")}
                className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap"
              >
                Prod External API
              </button>
              <button
                type="button"
                onClick={() => applyPreset("staging_canary")}
                className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap"
              >
                Staging Canary Service
              </button>
            </div>
          </div>

          {/* Segmented Intake Mode & Execution Mode */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Intake Mode
              </label>
              <SegmentedTabs
                fullWidth
                size="sm"
                ariaLabel="Ingress intake mode"
                value={intakeMode}
                onChange={setIntakeMode}
                items={[
                  { id: "structured", label: "Structured Schema" },
                  { id: "ai", label: "Natural Language (Gemini)" },
                ]}
              />
            </div>

            <div>
              <label
                htmlFor="exec-mode-select"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Execution Target Phase
              </label>
              <select
                id="exec-mode-select"
                value={executionMode}
                onChange={(e) => setExecutionMode(e.target.value as ExecutionMode)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="advisory_v1">v1 — Read-Only Advisory (Diff Only)</option>
                <option value="gitops_pr_v2">v2 — GitOps PR Execution + HITL Gate</option>
                <option value="direct_canary_v3">v3 — Direct Gated Canary + Auto-Rollback</option>
              </select>
            </div>
          </div>

          {intakeMode === "ai" ? (
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="ticket-ai"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Ticket Reference (Optional)
                </label>
                <input
                  id="ticket-ai"
                  type="text"
                  value={ticketRef}
                  onChange={(e) => setTicketRef(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label
                  htmlFor="nl-prompt"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Natural-Language Networking Request
                </label>
                <textarea
                  id="nl-prompt"
                  rows={4}
                  value={naturalPrompt}
                  onChange={(e) => setNaturalPrompt(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  placeholder="Describe app name, environment, hostname, path prefix, backend service/port, exposure, and TLS requirement..."
                  required
                />
                <p className="text-xs text-slate-500 mt-1.5">
                  Parsed server-side via Gemini into a strict IngressRequest schema. Requests containing PEM private keys or API secrets are automatically rejected.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="app-name" className="block text-xs font-medium text-slate-700 mb-1">
                    App Name
                  </label>
                  <input
                    id="app-name"
                    type="text"
                    value={appName}
                    onChange={(e) => setAppName(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="env-select" className="block text-xs font-medium text-slate-700 mb-1">
                    Environment
                  </label>
                  <select
                    id="env-select"
                    value={environment}
                    onChange={(e) =>
                      setEnvironment(e.target.value as "dev" | "staging" | "prod")
                    }
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="dev">dev</option>
                    <option value="staging">staging</option>
                    <option value="prod">prod</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="ticket-str" className="block text-xs font-medium text-slate-700 mb-1">
                    Ticket Ref
                  </label>
                  <input
                    id="ticket-str"
                    type="text"
                    value={ticketRef}
                    onChange={(e) => setTicketRef(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="hostname" className="block text-xs font-medium text-slate-700 mb-1">
                    Hostname (FQDN)
                  </label>
                  <input
                    id="hostname"
                    type="text"
                    value={hostname}
                    onChange={(e) => setHostname(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="path-prefix" className="block text-xs font-medium text-slate-700 mb-1">
                    Path Prefix
                  </label>
                  <input
                    id="path-prefix"
                    type="text"
                    value={pathPrefix}
                    onChange={(e) => setPathPrefix(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="sm:col-span-2">
                  <label htmlFor="backend-svc" className="block text-xs font-medium text-slate-700 mb-1">
                    Backend Service
                  </label>
                  <input
                    id="backend-svc"
                    type="text"
                    value={backendService}
                    onChange={(e) => setBackendService(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="backend-port" className="block text-xs font-medium text-slate-700 mb-1">
                    Port
                  </label>
                  <input
                    id="backend-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={backendPort}
                    onChange={(e) => setBackendPort(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="exposure" className="block text-xs font-medium text-slate-700 mb-1">
                    Exposure
                  </label>
                  <select
                    id="exposure"
                    value={exposure}
                    onChange={(e) => setExposure(e.target.value as "internal" | "external")}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="external">external</option>
                    <option value="internal">internal</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="tls-profile" className="block text-xs font-medium text-slate-700 mb-1">
                    TLS Profile
                  </label>
                  <select
                    id="tls-profile"
                    value={tlsProfile}
                    onChange={(e) =>
                      setTlsProfile(
                        e.target.value as "tls_1_3_strict" | "tls_1_2_compat" | "mtls_internal"
                      )
                    }
                    className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="tls_1_3_strict">tls_1_3_strict</option>
                    <option value="tls_1_2_compat">tls_1_2_compat</option>
                    <option value="mtls_internal">mtls_internal</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="justification" className="block text-xs font-medium text-slate-700 mb-1">
                    Change Justification
                  </label>
                  <input
                    id="justification"
                    type="text"
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                    required
                  />
                </div>
              </div>
            </div>
          )}

          {/* Flexible Agent Pipeline & Governance Options */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="w-full px-4 py-2.5 bg-slate-50 flex items-center justify-between text-xs font-semibold text-slate-800 hover:bg-slate-100 transition-colors"
            >
              <span>Flexible Agent Pipeline & Governance Settings</span>
              {showAdvanced ? (
                <ChevronUp className="h-4 w-4 text-slate-500" />
              ) : (
                <ChevronDown className="h-4 w-4 text-slate-500" />
              )}
            </button>

            {showAdvanced && (
              <div className="p-4 space-y-4 bg-white border-t border-slate-200 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="hitl-policy-select"
                      className="block font-medium text-slate-700 mb-1"
                    >
                      Human Approval (HITL) Policy
                    </label>
                    <select
                      id="hitl-policy-select"
                      value={hitlPolicy}
                      onChange={(e) => setHitlPolicy(e.target.value as HitlPolicyMode)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-md text-slate-900"
                    >
                      <option value="always">Always Pause for Human Sign-Off</option>
                      <option value="prod_or_high">Pause on Prod or HIGH Risk Only</option>
                      <option value="auto_low_risk">Auto-Approve Non-Prod LOW Risk</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="canary-preset-select"
                      className="block font-medium text-slate-700 mb-1"
                    >
                      Canary Rollout Progression (v3)
                    </label>
                    <select
                      id="canary-preset-select"
                      value={canaryPreset}
                      onChange={(e) =>
                        setCanaryPreset(e.target.value as "10_50_100" | "25_100" | "100")
                      }
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-md text-slate-900 font-mono"
                    >
                      <option value="10_50_100">Staged: 10% -&gt; 50% -&gt; 100%</option>
                      <option value="25_100">Two-Step: 25% -&gt; 100%</option>
                      <option value="100">Single-Step: 100%</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="font-medium text-slate-700 mb-1.5">
                    Optional Specialist Phase A Agents
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700">
                      <input
                        type="checkbox"
                        checked={enableCostAgent}
                        onChange={(e) => setEnableCostAgent(e.target.checked)}
                        className="rounded border-slate-300 text-blue-700"
                      />
                      <span>CostEstimationAgent</span>
                    </label>
                    <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700">
                      <input
                        type="checkbox"
                        checked={enableSecPostureAgent}
                        onChange={(e) => setEnableSecPostureAgent(e.target.checked)}
                        className="rounded border-slate-300 text-blue-700"
                      />
                      <span>SecurityPostureAgent</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="custom-agent-guidance"
                    className="block font-medium text-slate-700 mb-1"
                  >
                    Custom Guidance for Supervisor & Planning Agents
                  </label>
                  <input
                    id="custom-agent-guidance"
                    type="text"
                    value={customInstructions}
                    onChange={(e) => setCustomInstructions(e.target.value)}
                    placeholder="e.g., Prioritize low-latency regional edge failover and strict HSTS headers"
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-md"
                  />
                </div>

                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <div className="font-medium text-slate-700">
                    Add Custom Specialist Agent (Optional)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                    <input
                      type="text"
                      value={newAgentName}
                      onChange={(e) => setNewAgentName(e.target.value)}
                      placeholder="AgentName"
                      className="sm:col-span-2 px-2.5 py-1.5 border border-slate-200 rounded-md font-mono"
                    />
                    <input
                      type="text"
                      value={newAgentInstruction}
                      onChange={(e) => setNewAgentInstruction(e.target.value)}
                      placeholder="What should this agent audit?"
                      className="sm:col-span-2 px-2.5 py-1.5 border border-slate-200 rounded-md"
                    />
                    <button
                      type="button"
                      onClick={handleAddCustomAgent}
                      className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 bg-slate-900 text-white rounded-md hover:bg-slate-800"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add
                    </button>
                  </div>

                  {customAgents.length > 0 && (
                    <div className="space-y-1 pt-1">
                      {customAgents.map((ca, i) => (
                        <div
                          key={`${ca.agentName}-${i}`}
                          className="flex items-center justify-between px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded"
                        >
                          <div className="truncate">
                            <span className="font-mono font-semibold text-slate-900">
                              {ca.agentName}
                            </span>
                            <span className="text-slate-400 mx-1.5">·</span>
                            <span className="text-slate-600">{ca.instruction}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setCustomAgents((prev) => prev.filter((_, idx) => idx !== i))
                            }
                            className="text-slate-400 hover:text-red-600 p-1"
                            aria-label={`Remove ${ca.agentName}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {mutation.isError && (
            <div className="flex items-start gap-2.5 p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-800">
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <span>{(mutation.error as Error).message}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-60 transition-colors whitespace-nowrap"
            >
              {mutation.isPending ? "Running Analysis..." : "Submit Request"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
