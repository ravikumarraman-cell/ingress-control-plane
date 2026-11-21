import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, X } from "lucide-react";
import { createWorkflow, type CreateWorkflowInput } from "../lib/api";
import type { ExecutionMode } from "../shared/contracts";

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

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (intakeMode === "ai") {
      mutation.mutate({
        intakeMode: "ai",
        naturalLanguagePrompt: naturalPrompt,
        ticketRef: ticketRef.trim() || null,
        executionMode,
      });
    } else {
      mutation.mutate({
        intakeMode: "structured",
        executionMode,
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-ingress-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
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
          {/* Segmented Intake Mode & Execution Mode */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Intake Mode
              </label>
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setIntakeMode("structured")}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    intakeMode === "structured"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Structured Schema
                </button>
                <button
                  type="button"
                  onClick={() => setIntakeMode("ai")}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    intakeMode === "ai"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Natural Language (Gemini)
                </button>
              </div>
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
