import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ClipboardCopy,
  Compass,
  Play,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { assessOnboarding } from "../../lib/api";
import { copyTextToClipboard } from "../../lib/format";
import type {
  ConstrainedUseCase,
  DnsProvider,
  DnsRecordType,
  OnboardingAssessment,
  OnboardingAssessmentInput,
  TlsProfile,
} from "../../shared/contracts";
import { SegmentedTabs } from "../ui/SegmentedTabs";

export interface OnboardingCopilotPanelProps {
  initialValues: {
    appName: string;
    environment: "dev" | "staging" | "prod";
    hostname: string;
    pathPrefix: string;
    backendService: string;
    backendPort: number;
    exposure: "internal" | "external";
    tlsProfile: TlsProfile;
    ticketRef: string;
  };
  onApplyToRequest: (values: {
    appName: string;
    environment: "dev" | "staging" | "prod";
    hostname: string;
    pathPrefix: string;
    backendService: string;
    backendPort: number;
    exposure: "internal" | "external";
    tlsProfile: TlsProfile;
    ticketRef: string;
    dnsProvider: DnsProvider;
    dnsRecordType: DnsRecordType;
    healthCheckPath: string;
    originCertReady: boolean;
    cloudflareAllowlisted: boolean;
    useCaseFlags: ConstrainedUseCase[];
  }) => void;
}

export function OnboardingCopilotPanel({
  initialValues,
  onApplyToRequest,
}: OnboardingCopilotPanelProps) {
  const [form, setForm] = useState<OnboardingAssessmentInput>({
    appName: initialValues.appName || "billing-api",
    environment: initialValues.environment,
    exposure: initialValues.exposure,
    internalOnlyPattern: false,
    hostname: initialValues.hostname || "billing.corp.example.com",
    pathPrefix: initialValues.pathPrefix || "/v1/billing",
    backendService: initialValues.backendService || "billing-core-svc",
    backendPort: initialValues.backendPort || 8443,
    tlsProfile: initialValues.tlsProfile,
    dnsProvider: "infoblox",
    dnsRecordType: "cname",
    healthCheckPath: "/healthz",
    originCertReady: true,
    originCertHasSanAndChain: true,
    cloudflareAllowlisted: true,
    hasAdminAccess: true,
    ticketRef: initialValues.ticketRef || "",
    useCaseFlags: [],
    notes: "",
  });

  const [resultTab, setResultTab] = useState<"checks" | "templates" | "ticket">("checks");
  const [templateKey, setTemplateKey] = useState<
    "httprouteYaml" | "originAllowlistTf" | "terraformHcl" | "cliOnboardCommand" | "healthCheckStarterSnippet"
  >("httprouteYaml");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const assessMutation = useMutation({
    mutationFn: (payload: OnboardingAssessmentInput) => assessOnboarding(payload),
  });

  const assessment: OnboardingAssessment | undefined = assessMutation.data?.assessment;

  const toggleConstraintFlag = (flag: ConstrainedUseCase) => {
    setForm((prev) => {
      const exists = prev.useCaseFlags.includes(flag);
      return {
        ...prev,
        useCaseFlags: exists
          ? prev.useCaseFlags.filter((f) => f !== flag)
          : [...prev.useCaseFlags, flag],
      };
    });
  };

  const handleCopy = async (id: string, text: string) => {
    if (await copyTextToClipboard(text)) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1600);
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
          <Compass className="h-4 w-4 text-blue-700 shrink-0" />
          <span>Guided Onboarding & Pre-Flight Copilot</span>
        </div>
        <p className="text-xs text-slate-600 leading-relaxed">
          Verify pattern fit, Infoblox CNAME eligibility, origin certificate chain, Cloudflare IP allowlisting,
          and unsupported constraints (APIM, DR pools, Private Endpoints) before filing a ServiceNow change.
        </p>
      </div>

      {/* Core Workload + Pattern Questions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div>
          <label htmlFor="ob-app" className="block font-medium text-slate-700 mb-1">
            App Name
          </label>
          <input
            id="ob-app"
            type="text"
            value={form.appName}
            onChange={(e) => setForm({ ...form, appName: e.target.value })}
            className="w-full px-2.5 py-1.5 font-mono bg-white border border-slate-200 rounded-md"
          />
        </div>
        <div>
          <label htmlFor="ob-env" className="block font-medium text-slate-700 mb-1">
            Environment
          </label>
          <select
            id="ob-env"
            value={form.environment}
            onChange={(e) =>
              setForm({ ...form, environment: e.target.value as "dev" | "staging" | "prod" })
            }
            className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-md"
          >
            <option value="dev">dev</option>
            <option value="staging">staging</option>
            <option value="prod">prod</option>
          </select>
        </div>
        <div>
          <label htmlFor="ob-exposure" className="block font-medium text-slate-700 mb-1">
            Exposure
          </label>
          <select
            id="ob-exposure"
            value={form.exposure}
            onChange={(e) =>
              setForm({
                ...form,
                exposure: e.target.value as "internal" | "external",
                tlsProfile:
                  e.target.value === "external" && form.environment === "prod"
                    ? "tls_1_3_strict"
                    : form.tlsProfile,
              })
            }
            className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-md"
          >
            <option value="external">External (Internet Edge WAF)</option>
            <option value="internal">Internal Service Mesh</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div>
          <label htmlFor="ob-host" className="block font-medium text-slate-700 mb-1">
            Hostname (FQDN)
          </label>
          <input
            id="ob-host"
            type="text"
            value={form.hostname}
            onChange={(e) => setForm({ ...form, hostname: e.target.value })}
            className="w-full px-2.5 py-1.5 font-mono bg-white border border-slate-200 rounded-md"
          />
        </div>
        <div>
          <label htmlFor="ob-dns-provider" className="block font-medium text-slate-700 mb-1">
            DNS Provider
          </label>
          <select
            id="ob-dns-provider"
            value={form.dnsProvider}
            onChange={(e) => setForm({ ...form, dnsProvider: e.target.value as DnsProvider })}
            className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-md"
          >
            <option value="infoblox">Infoblox</option>
            <option value="cloud_dns_delegated">Cloud Native DNS (Infoblox-delegated)</option>
            <option value="external_other">Other / Undegated DNS</option>
          </select>
        </div>
        <div>
          <label htmlFor="ob-dns-type" className="block font-medium text-slate-700 mb-1">
            Existing DNS Record
          </label>
          <select
            id="ob-dns-type"
            value={form.dnsRecordType}
            onChange={(e) => setForm({ ...form, dnsRecordType: e.target.value as DnsRecordType })}
            className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-md"
          >
            <option value="cname">CNAME (Supported)</option>
            <option value="new_record">New CNAME Provisioning</option>
            <option value="a_record">Bare A Record (Blocked on Edge)</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div>
          <label htmlFor="ob-hc" className="block font-medium text-slate-700 mb-1">
            Origin Health-Check Path
          </label>
          <input
            id="ob-hc"
            type="text"
            value={form.healthCheckPath}
            onChange={(e) => setForm({ ...form, healthCheckPath: e.target.value })}
            placeholder="/healthz"
            className="w-full px-2.5 py-1.5 font-mono bg-white border border-slate-200 rounded-md"
          />
        </div>
        <div>
          <label htmlFor="ob-svc" className="block font-medium text-slate-700 mb-1">
            Backend Service & Port
          </label>
          <div className="flex gap-1.5">
            <input
              id="ob-svc"
              type="text"
              value={form.backendService}
              onChange={(e) => setForm({ ...form, backendService: e.target.value })}
              className="w-2/3 px-2 py-1.5 font-mono bg-white border border-slate-200 rounded-md"
            />
            <input
              aria-label="Backend Port"
              type="number"
              value={form.backendPort}
              onChange={(e) => setForm({ ...form, backendPort: Number(e.target.value) || 8443 })}
              className="w-1/3 px-2 py-1.5 font-mono bg-white border border-slate-200 rounded-md tabular-nums"
            />
          </div>
        </div>
        <div>
          <label htmlFor="ob-ticket" className="block font-medium text-slate-700 mb-1">
            ServiceNow Ticket (Optional)
          </label>
          <input
            id="ob-ticket"
            type="text"
            value={form.ticketRef ?? ""}
            onChange={(e) => setForm({ ...form, ticketRef: e.target.value })}
            placeholder="NET-4902"
            className="w-full px-2.5 py-1.5 font-mono bg-white border border-slate-200 rounded-md"
          />
        </div>
      </div>

      {/* Readiness & Constraint Checkboxes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 border border-slate-200 rounded-md bg-white text-xs">
        <div className="space-y-1.5">
          <div className="font-semibold text-slate-800">Origin & Access Prerequisites</div>
          <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={form.originCertReady && form.originCertHasSanAndChain}
              onChange={(e) =>
                setForm({
                  ...form,
                  originCertReady: e.target.checked,
                  originCertHasSanAndChain: e.target.checked,
                })
              }
            />
            <span>Origin TLS 1.2+ cert with FQDN SAN & full chain ready</span>
          </label>
          <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={form.cloudflareAllowlisted}
              onChange={(e) => setForm({ ...form, cloudflareAllowlisted: e.target.checked })}
            />
            <span>Origin firewall allows Cloudflare edge IP ranges</span>
          </label>
          <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={form.hasAdminAccess}
              onChange={(e) => setForm({ ...form, hasAdminAccess: e.target.checked })}
            />
            <span>Requester holds PRM/PCAM Admin entitlement</span>
          </label>
        </div>

        <div className="space-y-1.5">
          <div className="font-semibold text-slate-800">Pattern & Constraint Screening</div>
          <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={form.internalOnlyPattern}
              onChange={(e) => setForm({ ...form, internalOnlyPattern: e.target.checked })}
            />
            <span>Internal-only consumers (check IP Filtering fit)</span>
          </label>
          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5 text-slate-700">
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.useCaseFlags.includes("managed_apim")}
                onChange={() => toggleConstraintFlag("managed_apim")}
              />
              <span>Managed APIM</span>
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.useCaseFlags.includes("dr_pool")}
                onChange={() => toggleConstraintFlag("dr_pool")}
              />
              <span>DR Pool</span>
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.useCaseFlags.includes("private_endpoint")}
                onChange={() => toggleConstraintFlag("private_endpoint")}
              />
              <span>Private Endpoint</span>
            </label>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => assessMutation.mutate(form)}
          disabled={assessMutation.isPending}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-60 transition-colors whitespace-nowrap"
        >
          <Play className="h-3.5 w-3.5" />
          {assessMutation.isPending ? "Running 10-Point Pre-Flight..." : "Run Guided Pre-Flight Check"}
        </button>

        {assessment && (
          <button
            type="button"
            onClick={() =>
              onApplyToRequest({
                appName: form.appName,
                environment: form.environment,
                hostname: form.hostname,
                pathPrefix: form.pathPrefix,
                backendService: form.backendService,
                backendPort: form.backendPort,
                exposure: form.exposure,
                tlsProfile: form.tlsProfile,
                ticketRef: form.ticketRef ?? "",
                dnsProvider: form.dnsProvider,
                dnsRecordType: form.dnsRecordType,
                healthCheckPath: form.healthCheckPath,
                originCertReady: form.originCertReady && form.originCertHasSanAndChain,
                cloudflareAllowlisted: form.cloudflareAllowlisted,
                useCaseFlags: form.useCaseFlags,
              })
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors whitespace-nowrap"
          >
            Apply Validated Settings to Workflow Request
          </button>
        )}
      </div>

      {assessMutation.isError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-800">
          {(assessMutation.error as Error).message}
        </div>
      )}

      {/* Assessment Results */}
      {assessment && (
        <div className="border border-slate-200 rounded-lg overflow-hidden bg-white space-y-0">
          <div
            className={`px-4 py-3 border-b flex items-start gap-2.5 text-xs ${
              assessment.verdict === "RECOMMENDED_INGRESS"
                ? "bg-emerald-50/70 border-emerald-200 text-emerald-900"
                : assessment.verdict === "USE_IP_FILTERING"
                  ? "bg-amber-50/70 border-amber-200 text-amber-900"
                  : "bg-red-50/70 border-red-200 text-red-900"
            }`}
          >
            {assessment.verdict === "RECOMMENDED_INGRESS" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
            ) : assessment.verdict === "USE_IP_FILTERING" ? (
              <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
            ) : (
              <ShieldAlert className="h-4 w-4 text-red-700 shrink-0 mt-0.5" />
            )}
            <div className="space-y-0.5 flex-1">
              <div className="font-semibold flex flex-wrap items-center justify-between gap-2">
                <span>{assessment.recommendedPath}</span>
                <span className="font-mono text-[11px] opacity-80">
                  Lead Time: {assessment.estimatedLeadTime}
                </span>
              </div>
              <p className="leading-relaxed opacity-95">{assessment.plainEnglishSummary}</p>
            </div>
          </div>

          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
            <SegmentedTabs
              size="sm"
              ariaLabel="Onboarding copilot output tabs"
              value={resultTab}
              onChange={setResultTab}
              items={[
                { id: "checks", label: "10-Blocker Pre-Flight", count: assessment.blockerChecks.length },
                { id: "templates", label: "Starter Configs" },
                { id: "ticket", label: "ServiceNow Ticket Prefill" },
              ]}
            />
            <span className="text-[11px] font-mono text-slate-500">
              Engine: {assessment.poweredBy}
            </span>
          </div>

          {resultTab === "checks" && (
            <div className="divide-y divide-slate-200 max-h-60 overflow-y-auto text-xs">
              {assessment.blockerChecks.map((item) => (
                <div key={item.blockerNumber} className="px-4 py-2.5 flex items-start gap-2.5">
                  {item.status === "PASS" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : item.status === "ACTION_REQUIRED" ? (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="font-medium text-slate-900">
                      <span className="font-mono text-slate-500 mr-1.5">#{item.blockerNumber}</span>
                      {item.blockerTitle}
                    </div>
                    <p className="text-slate-600">{item.finding}</p>
                    {item.status !== "PASS" && (
                      <p className="text-slate-800 font-medium">Next action: {item.remediation}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {resultTab === "templates" && (
            <div className="p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <select
                  aria-label="Select generated starter template"
                  value={templateKey}
                  onChange={(e) =>
                    setTemplateKey(e.target.value as typeof templateKey)
                  }
                  className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md font-mono"
                >
                  <option value="httprouteYaml">Gateway API HTTPRoute YAML</option>
                  <option value="originAllowlistTf">Origin Cloudflare IP Allowlist (.tf)</option>
                  <option value="terraformHcl">Edge SSL + Rate-Limit + WAF (.tf)</option>
                  <option value="cliOnboardCommand">Ingress CLI Starter (Replaces PCAM UI)</option>
                  <option value="healthCheckStarterSnippet">Origin /healthz Probe Starter</option>
                </select>
                <button
                  type="button"
                  onClick={() => handleCopy("tpl", assessment.starterTemplates[templateKey])}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
                >
                  {copiedId === "tpl" ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <ClipboardCopy className="h-3.5 w-3.5" />
                  )}
                  {copiedId === "tpl" ? "Copied" : "Copy Template"}
                </button>
              </div>
              <pre className="p-3 bg-slate-950 text-slate-100 rounded-md text-[11px] font-mono overflow-x-auto max-h-52">
                {assessment.starterTemplates[templateKey]}
              </pre>
            </div>
          )}

          {resultTab === "ticket" && (
            <div className="p-4 space-y-3 text-xs">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-900">
                    {assessment.serviceNowPrefill.shortDescription}
                  </div>
                  <div className="text-slate-500 font-mono mt-0.5">
                    {assessment.serviceNowPrefill.assignmentGroup} · Risk:{" "}
                    {assessment.serviceNowPrefill.riskLevel}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    handleCopy(
                      "snow",
                      [
                        `Short Description: ${assessment.serviceNowPrefill.shortDescription}`,
                        `Category: ${assessment.serviceNowPrefill.category}`,
                        `Assignment Group: ${assessment.serviceNowPrefill.assignmentGroup}`,
                        `Risk: ${assessment.serviceNowPrefill.riskLevel}`,
                        `\nImplementation Plan:\n${assessment.serviceNowPrefill.implementationPlan}`,
                        `\nBackout Plan:\n${assessment.serviceNowPrefill.backoutPlan}`,
                        `\nAttestation:\n${assessment.serviceNowPrefill.attestationSummary}`,
                      ].join("\n")
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 shrink-0"
                >
                  {copiedId === "snow" ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <ClipboardCopy className="h-3.5 w-3.5" />
                  )}
                  {copiedId === "snow" ? "Copied Ticket" : "Copy ServiceNow Prefill"}
                </button>
              </div>
              <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded p-2">
                {assessment.serviceNowPrefill.rbacGuardrailNote}
              </p>
              <pre className="p-3 bg-slate-50 border border-slate-200 rounded text-[11px] font-mono text-slate-800 whitespace-pre-wrap">
                {assessment.serviceNowPrefill.implementationPlan}
                {"\n\nBackout: "}
                {assessment.serviceNowPrefill.backoutPlan}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
