import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, Copy, Download, Play, Save, XCircle } from "lucide-react";
import { MermaidDiagram } from "../components/MermaidDiagram";
import {
  fetchArchitectureDoc,
  runValidationSuite,
  saveArchitectureDoc,
  saveImplementationPlan,
  saveImplementationProgress,
} from "../lib/api";

const PYDANTIC_SNIPPET = `class IngressRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    request_id: UUID
    requester_id: str
    app_name: str
    environment: Literal["dev", "staging", "prod"]
    hostname: str
    path_prefix: str
    backend_service: str
    backend_port: int = Field(ge=1, le=65535)
    exposure: Literal["internal", "external"]
    tls_profile: Literal["tls_1_3_strict", "tls_1_2_compat", "mtls_internal"]
    raw_justification: str

class ChangePlan(BaseModel):
    model_config = ConfigDict(frozen=True)
    plan_id: UUID
    workflow_id: UUID
    target_state_etag: str  # sha256:<64-hex>
    blast_radius: Literal["LOW", "MEDIUM", "HIGH"]
    policy_violations: list[str]
    artifacts: dict[str, str]
    diffs: list[DiffHunk]
    dry_run_passed: bool
    rollback_plan: RollbackPlan
    plan_digest_sha256: str

class ApprovalDecision(BaseModel):
    model_config = ConfigDict(frozen=True)
    decision_id: UUID
    workflow_id: UUID
    plan_id: UUID
    decision: Literal["APPROVE", "REJECT"]
    reviewer_id: str
    reviewer_roles: list[str]
    rationale: str
    approved_state_etag: str
    approved_plan_digest: str
    signature: str
    decided_at: datetime`;

const POSTGRES_DDL = `CREATE TABLE workflow_runs (
    workflow_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    adk_session_id      TEXT NOT NULL UNIQUE,
    requester_id        TEXT NOT NULL,
    app_name            TEXT NOT NULL,
    environment         TEXT NOT NULL CHECK (environment IN ('dev', 'staging', 'prod')),
    status              TEXT NOT NULL,
    ingress_request     JSONB NOT NULL,
    current_state_etag  TEXT,
    blast_radius        TEXT CHECK (blast_radius IN ('LOW', 'MEDIUM', 'HIGH')),
    adk_checkpoint      JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
    seq_no              BIGSERIAL PRIMARY KEY,
    event_id            UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    workflow_id         UUID NOT NULL REFERENCES workflow_runs(workflow_id) ON DELETE RESTRICT,
    actor_id            TEXT NOT NULL,
    actor_type          TEXT NOT NULL CHECK (actor_type IN ('HUMAN', 'AGENT', 'SYSTEM')),
    event_type          TEXT NOT NULL,
    payload             JSONB NOT NULL,
    prev_event_hash     CHAR(64) NOT NULL,
    event_hash          CHAR(64) NOT NULL UNIQUE,
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_audit_no_update
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();`;

export function ArchitecturePage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<
    "diagrams" | "contracts" | "roadmap" | "progress" | "markdown"
  >("diagrams");
  const [draftMarkdown, setDraftMarkdown] = useState("");
  const [draftPlanMarkdown, setDraftPlanMarkdown] = useState("");
  const [draftProgressMarkdown, setDraftProgressMarkdown] = useState("");
  const [copied, setCopied] = useState(false);

  const docQuery = useQuery({
    queryKey: ["architecture-doc"],
    queryFn: fetchArchitectureDoc,
  });

  useEffect(() => {
    if (docQuery.data?.markdown) {
      setDraftMarkdown(docQuery.data.markdown);
    }
    if (docQuery.data?.implementationPlanMarkdown) {
      setDraftPlanMarkdown(docQuery.data.implementationPlanMarkdown);
    }
    if (docQuery.data?.implementationProgressMarkdown) {
      setDraftProgressMarkdown(docQuery.data.implementationProgressMarkdown);
    }
  }, [
    docQuery.data?.markdown,
    docQuery.data?.implementationPlanMarkdown,
    docQuery.data?.implementationProgressMarkdown,
  ]);

  const saveMutation = useMutation({
    mutationFn: (md: string) => saveArchitectureDoc(md),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["architecture-doc"] });
    },
  });

  const savePlanMutation = useMutation({
    mutationFn: (md: string) => saveImplementationPlan(md),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["architecture-doc"] });
    },
  });

  const saveProgressMutation = useMutation({
    mutationFn: (md: string) => saveImplementationProgress(md),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["architecture-doc"] });
    },
  });

  const validationMutation = useMutation({
    mutationFn: runValidationSuite,
  });

  const handleCopyMarkdown = async () => {
    if (!docQuery.data?.markdown) return;
    await navigator.clipboard.writeText(docQuery.data.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadMarkdown = () => {
    if (!docQuery.data?.markdown) return;
    const blob = new Blob([docQuery.data.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "architecture-spec.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Stored Architecture & System Design Specification
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1">
            <span className="font-mono">{docQuery.data?.filePath ?? "docs/architecture-spec.md"}</span>
            <span aria-hidden="true">·</span>
            <span>Version {docQuery.data?.version ?? "1.0.0"}</span>
            {docQuery.data?.updatedAt && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  Last saved {new Date(docQuery.data.updatedAt).toLocaleString()}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCopyMarkdown}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied Spec" : "Copy Markdown"}
          </button>
          <button
            type="button"
            onClick={handleDownloadMarkdown}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            Export .md
          </button>
        </div>
      </div>

      {/* Segmented Navigation Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit overflow-x-auto max-w-full">
        {(
          [
            ["diagrams", "Mermaid Diagrams"],
            ["contracts", "Data Contracts & SQL"],
            ["roadmap", "Phased Plan (v1–v3)"],
            ["progress", "Progress Tracker"],
            ["markdown", "Stored Markdown & Editor"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              tab === key
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {docQuery.isLoading ? (
        <div className="h-96 bg-white border border-slate-200 rounded-lg animate-pulse" />
      ) : tab === "diagrams" ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 bg-white border border-slate-200 rounded-lg divide-y md:divide-y-0 md:divide-x divide-slate-200">
            <div className="p-4">
              <div className="text-xs font-semibold text-slate-900">1. Control Plane Only</div>
              <p className="text-xs text-slate-600 mt-1">
                LLM inference runs asynchronously in the control plane; zero LLM latency in live packet routing.
              </p>
            </div>
            <div className="p-4">
              <div className="text-xs font-semibold text-slate-900">2. Read/Write Separation</div>
              <p className="text-xs text-slate-600 mt-1">
                Phase A & B use <code className="font-mono">sa-ingress-readonly</code>; only ExecutionAgent holds scoped write tools.
              </p>
            </div>
            <div className="p-4">
              <div className="text-xs font-semibold text-slate-900">3. TOCTOU ETag Lock</div>
              <p className="text-xs text-slate-600 mt-1">
                Every ChangePlan pins a SHA-256 <code className="font-mono">target_state_etag</code> re-verified prior to apply.
              </p>
            </div>
            <div className="p-4">
              <div className="text-xs font-semibold text-slate-900">4. Deterministic Rollback</div>
              <p className="text-xs text-slate-600 mt-1">
                Rollbacks are pre-computed declarative artifacts sealed before approval, never improvised during incidents.
              </p>
            </div>
          </div>

          {docQuery.data?.flowchartMermaid && (
            <MermaidDiagram
              title="System Architecture Topology (flowchart TD)"
              code={docQuery.data.flowchartMermaid}
            />
          )}

          {docQuery.data?.sequenceMermaid && (
            <MermaidDiagram
              title="End-to-End Execution & HITL Sequence (sequenceDiagram)"
              code={docQuery.data.sequenceMermaid}
            />
          )}
        </div>
      ) : tab === "contracts" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-900">
              Pydantic v2 Data Contracts (Control Plane Schemas)
            </div>
            <pre className="p-4 text-xs font-mono bg-slate-950 text-slate-100 overflow-x-auto leading-relaxed">
              {PYDANTIC_SNIPPET}
            </pre>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-900">
              PostgreSQL Durable State & Append-Only Audit DDL
            </div>
            <pre className="p-4 text-xs font-mono bg-slate-950 text-slate-100 overflow-x-auto leading-relaxed">
              {POSTGRES_DDL}
            </pre>
          </div>
        </div>
      ) : tab === "roadmap" ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
              <div className="text-xs font-mono text-slate-500">Phase v1</div>
              <h3 className="text-base font-semibold text-slate-900">
                Read-Only Advisory + TanStack UI
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Full discovery, policy compliance evaluation, collision/blast-radius analysis, and YAML/HCL diff synthesis without automated write execution.
              </p>
              <div className="pt-2 border-t border-slate-200 space-y-1.5 text-xs text-slate-700">
                <div className="font-semibold">Validation Gates</div>
                <p>• V1-SEC-01: Secret/PEM rejection in IngressRequest</p>
                <p>• V1-IAM-01: Read-only IAM returns 403 on write verbs</p>
                <p>• V1-DET-01: Bit-identical SHA-256 ETag snapshots</p>
                <p>• V1-SSE-01: SSE reconnect cache hydration</p>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
              <div className="text-xs font-mono text-slate-500">Phase v2</div>
              <h3 className="text-base font-semibold text-slate-900">
                GitOps PR Execution + HITL Gate
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                ExecutionAgent opens GitOps Pull Requests upon signed TanStack UI approval after verifying four-eyes RBAC and TOCTOU ETag parity.
              </p>
              <div className="pt-2 border-t border-slate-200 space-y-1.5 text-xs text-slate-700">
                <div className="font-semibold">Validation Gates</div>
                <p>• V2-DRIFT-01: Out-of-band drift triggers DRIFT_ABORTED</p>
                <p>• V2-TAMPER-01: HMAC/KMS plan digest tamper rejection</p>
                <p>• V2-RBAC-01: Requester self-approval blocked (403)</p>
                <p>• V2-DUR-01: ADK checkpoint survival across restarts</p>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
              <div className="text-xs font-mono text-slate-500">Phase v3</div>
              <h3 className="text-base font-semibold text-slate-900">
                Direct Gated Canary + Auto-Rollback
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Scoped API execution with progressive canary weights, real-time synthetic probes, and deterministic zero-LLM rollback under 60 seconds.
              </p>
              <div className="pt-2 border-t border-slate-200 space-y-1.5 text-xs text-slate-700">
                <div className="font-semibold">Validation Gates</div>
                <p>• V3-CHAOS-01: HTTP 503 failure injection -&gt; rollback &lt; 60s</p>
                <p>• V3-AUDIT-01: Audit hash-chain integrity seq 1..N</p>
                <p>• V3-CONC-01: Concurrent approval ETag lock test</p>
                <p>• V3-SLO-01: 14-day staging soak test</p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-4">
              <span className="text-xs font-mono text-slate-700">
                {docQuery.data?.implementationPlanPath ?? "docs/implementation-plan.md"}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const blob = new Blob([draftPlanMarkdown], {
                      type: "text/markdown;charset=utf-8",
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "implementation-plan.md";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export Plan .md
                </button>
                <button
                  type="button"
                  onClick={() => savePlanMutation.mutate(draftPlanMarkdown)}
                  disabled={savePlanMutation.isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-60 whitespace-nowrap"
                >
                  <Save className="h-3.5 w-3.5" />
                  {savePlanMutation.isPending ? "Saving..." : "Save Plan"}
                </button>
              </div>
            </div>
            <textarea
              value={draftPlanMarkdown}
              onChange={(e) => setDraftPlanMarkdown(e.target.value)}
              rows={24}
              className="w-full p-4 text-xs font-mono text-slate-900 bg-white focus:outline-none leading-relaxed"
              aria-label="Stored phased implementation plan markdown"
            />
          </div>
        </div>
      ) : tab === "progress" ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 bg-white border border-slate-200 rounded-lg divide-y md:divide-y-0 md:divide-x divide-slate-200">
            <div className="p-4 space-y-1">
              <div className="text-xs font-mono text-slate-500">Phase v1</div>
              <div className="text-xl font-semibold text-emerald-700 font-mono tabular-nums">
                95%
              </div>
              <p className="text-xs text-slate-600">
                Advisory pipeline, Gemini intake, ETag determinism, SSE replay & bundle export done.
              </p>
            </div>
            <div className="p-4 space-y-1">
              <div className="text-xs font-mono text-slate-500">Phase v2</div>
              <div className="text-xl font-semibold text-emerald-700 font-mono tabular-nums">
                90%
              </div>
              <p className="text-xs text-slate-600">
                Configurable HITL gate, four-eyes RBAC, HMAC signing, TOCTOU drift lock & replan done.
              </p>
            </div>
            <div className="p-4 space-y-1">
              <div className="text-xs font-mono text-slate-500">Phase v3</div>
              <div className="text-xl font-semibold text-blue-700 font-mono tabular-nums">
                85%
              </div>
              <p className="text-xs text-slate-600">
                Staged canary shifting (10→50→100%), 4-probe checks, instant rollback & audit verifier.
              </p>
            </div>
            <div className="p-4 space-y-1">
              <div className="text-xs font-mono text-slate-500">Flexible Agent Engine</div>
              <div className="text-xl font-semibold text-emerald-700 font-mono tabular-nums">
                100%
              </div>
              <p className="text-xs text-slate-600">
                Custom specialist agents, dynamic policy rules, Supervisor loops & real-time diagram.
              </p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Live Validation Gate Verification Suite
                </h2>
                <p className="text-xs text-slate-500">
                  Execute real server-side checks against secret rejection, 50x ETag determinism, RBAC separation, and SHA-256 audit continuity.
                </p>
              </div>
              <button
                type="button"
                disabled={validationMutation.isPending}
                onClick={() => validationMutation.mutate()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-60 whitespace-nowrap"
              >
                <Play className="h-3.5 w-3.5" />
                {validationMutation.isPending ? "Running Checks..." : "Run Validation Gates"}
              </button>
            </div>

            {validationMutation.data?.results && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                {validationMutation.data.results.map((gate) => (
                  <div
                    key={gate.gateId}
                    className={`p-3.5 border rounded-md text-xs ${
                      gate.passed
                        ? "bg-emerald-50/70 border-emerald-200 text-emerald-900"
                        : "bg-red-50 border-red-200 text-red-900"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 font-semibold">
                      <span className="inline-flex items-center gap-1.5">
                        {gate.passed ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-red-700" />
                        )}
                        {gate.gateId} · {gate.name}
                      </span>
                      <span className="font-mono uppercase">{gate.passed ? "PASS" : "FAIL"}</span>
                    </div>
                    <p className="mt-1 opacity-90">{gate.detail}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-4">
              <span className="text-xs font-mono text-slate-700">
                {docQuery.data?.implementationProgressPath ?? "docs/implementation-progress.md"}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const blob = new Blob([draftProgressMarkdown], {
                      type: "text/markdown;charset=utf-8",
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "implementation-progress.md";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export Progress .md
                </button>
                <button
                  type="button"
                  onClick={() => saveProgressMutation.mutate(draftProgressMarkdown)}
                  disabled={saveProgressMutation.isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-60 whitespace-nowrap"
                >
                  <Save className="h-3.5 w-3.5" />
                  {saveProgressMutation.isPending ? "Saving..." : "Save Progress"}
                </button>
              </div>
            </div>
            <textarea
              value={draftProgressMarkdown}
              onChange={(e) => setDraftProgressMarkdown(e.target.value)}
              rows={24}
              className="w-full p-4 text-xs font-mono text-slate-900 bg-white focus:outline-none leading-relaxed"
              aria-label="Stored implementation progress tracker markdown"
            />
          </div>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-4">
            <span className="text-xs font-mono text-slate-700">
              {docQuery.data?.filePath}
            </span>
            <button
              type="button"
              onClick={() => saveMutation.mutate(draftMarkdown)}
              disabled={saveMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-60 whitespace-nowrap"
            >
              <Save className="h-3.5 w-3.5" />
              {saveMutation.isPending ? "Saving..." : "Save to Disk"}
            </button>
          </div>
          <textarea
            value={draftMarkdown}
            onChange={(e) => setDraftMarkdown(e.target.value)}
            rows={26}
            className="w-full p-4 text-xs font-mono text-slate-900 bg-white focus:outline-none leading-relaxed"
            aria-label="Stored architecture markdown document"
          />
        </div>
      )}
    </div>
  );
}
