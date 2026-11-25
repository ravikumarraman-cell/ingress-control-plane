import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertCircle, Search, Stethoscope, Wrench } from "lucide-react";
import { troubleshootWorkflow } from "../../lib/api";
import type { TroubleshootingDiagnosis, WorkflowRun } from "../../shared/contracts";

export interface TroubleshootingPanelProps {
  workflow: WorkflowRun;
  onUseSupervisorFix?: () => void;
}

const SAMPLE_SNIPPETS = [
  { label: "DNS A-Record Error", text: "Error: existing DNS entry uses bare A record; Infoblox CNAME required." },
  { label: "Origin HTTP 503", text: "Synthetic probe failed: GET /healthz returned HTTP 503 connection timeout." },
  { label: "Cloudflare IP Drop", text: "HTTP 522 connection timed out between Cloudflare edge and origin port 8443." },
  { label: "Cert SAN Mismatch", text: "x509: certificate SAN does not match FQDN or intermediate chain incomplete." },
];

export function TroubleshootingPanel({
  workflow,
  onUseSupervisorFix,
}: TroubleshootingPanelProps) {
  const [errorText, setErrorText] = useState(
    workflow.errorMessage ?? workflow.probeResult?.detail ?? ""
  );
  const [logs, setLogs] = useState("");
  const [configDiff, setConfigDiff] = useState("");

  const diagnoseMutation = useMutation({
    mutationFn: () =>
      troubleshootWorkflow({
        workflowId: workflow.workflowId,
        errorText: errorText.trim() || undefined,
        logs: logs.trim() || undefined,
        configDiff: configDiff.trim() || undefined,
      }),
  });

  const diagnosis: TroubleshootingDiagnosis | undefined = diagnoseMutation.data?.diagnosis;

  return (
    <div className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Stethoscope className="h-4 w-4 text-blue-700 dark:text-sky-400 shrink-0" />
            <span>Troubleshooting Agent (Root-Cause & Next-Action Classifier)</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Ingests workflow failures, error messages, logs, or diffs and classifies root cause across
            DNS, Cert, Network Allowlist, Health Check, WAF, Policy, or Drift.
          </p>
        </div>
        <button
          type="button"
          onClick={() => diagnoseMutation.mutate()}
          disabled={diagnoseMutation.isPending}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
        >
          <Search className="h-3.5 w-3.5" />
          {diagnoseMutation.isPending ? "Diagnosing..." : "Run Root-Cause Diagnosis"}
        </button>
      </div>

      <div className="space-y-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-500 dark:text-slate-400">Quick-test signal:</span>
          {SAMPLE_SNIPPETS.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => setErrorText(s.text)}
              className="px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded transition-colors"
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div>
            <label htmlFor="ts-error" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              Error Message / Probe Detail
            </label>
            <textarea
              id="ts-error"
              rows={3}
              value={errorText}
              onChange={(e) => setErrorText(e.target.value)}
              placeholder="Paste ingress error, Infoblox message, TLS handshake error, or HTTP 503/522..."
              className="w-full px-3 py-2 font-mono text-xs bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label htmlFor="ts-logs" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              Edge / Origin Logs or Config Diff (Optional)
            </label>
            <textarea
              id="ts-logs"
              rows={3}
              value={logs}
              onChange={(e) => setLogs(e.target.value)}
              placeholder="Paste WAF rule hits, curl -vk TLS output, or HTTPRoute diff..."
              className="w-full px-3 py-2 font-mono text-xs bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        </div>

        <div>
          <label htmlFor="ts-diff" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
            Config Diff Context (Optional)
          </label>
          <input
            id="ts-diff"
            type="text"
            value={configDiff}
            onChange={(e) => setConfigDiff(e.target.value)}
            placeholder="e.g., backendPort changed 8080 -> 8443, or dnsRecordType: a_record"
            className="w-full px-3 py-1.5 font-mono text-xs bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
      </div>

      {diagnoseMutation.isError && (
        <div className="p-3 bg-red-50 dark:bg-rose-500/10 border border-red-200 dark:border-rose-500/30 rounded-md text-xs text-red-800 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{(diagnoseMutation.error as Error).message}</span>
        </div>
      )}

      {diagnosis && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 dark:bg-[#090D16] border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
              <Wrench className="h-3.5 w-3.5 text-blue-700 dark:text-sky-400" />
              <span>{diagnosis.title}</span>
            </div>
            <div className="font-mono text-slate-600 dark:text-slate-400">
              Category: {diagnosis.category} · Severity: {diagnosis.severity} · Engine:{" "}
              {diagnosis.poweredBy}
            </div>
          </div>
          <div className="p-4 space-y-3 text-xs">
            <div>
              <div className="font-semibold text-slate-800 dark:text-slate-200">Root Cause</div>
              <p className="text-slate-700 dark:text-slate-300 mt-0.5">{diagnosis.rootCause}</p>
            </div>
            <div>
              <div className="font-semibold text-slate-800 dark:text-slate-200">Plain-English Summary</div>
              <p className="text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                {diagnosis.plainEnglishExplanation}
              </p>
            </div>
            <div>
              <div className="font-semibold text-slate-800 dark:text-slate-200 mb-1">Recommended Next Actions</div>
              <ol className="list-decimal list-inside space-y-1 text-slate-700 dark:text-slate-300">
                {diagnosis.nextActions.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
            {onUseSupervisorFix && (
              <div className="pt-2 border-t border-slate-100 flex justify-end">
                <button
                  type="button"
                  onClick={onUseSupervisorFix}
                  className="px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-sky-400 bg-blue-50 dark:bg-sky-500/10 border border-blue-200 dark:border-sky-500/30 rounded-md hover:bg-blue-100 transition-colors"
                >
                  Apply Fix via Revise with Supervisor
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
