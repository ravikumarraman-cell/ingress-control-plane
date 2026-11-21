import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Cpu,
  DollarSign,
  FileCheck2,
  GitBranch,
  Layers,
  Lock,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import { MermaidDiagram } from "../MermaidDiagram";

const IMPACT_METRICS = [
  {
    label: "Developer Onboarding",
    value: "Days → < 3 min",
    detail: "Plain-English intake turns app intent into validated Gateway configs automatically.",
  },
  {
    label: "New Governance Rule",
    value: "On the fly",
    detail: "Launch FinOps, SecOps, or compliance specialists in seconds with zero code deploy.",
  },
  {
    label: "Deterministic Rollback",
    value: "< 60 sec SLA",
    detail: "Pre-computed restore artifacts execute directly without waiting on AI inference.",
  },
  {
    label: "Unverified Prod Risk",
    value: "Zero writes",
    detail: "Read-only Phase A/B isolation + SHA-256 ETag anti-drift lock + four-eyes RBAC.",
  },
] as const;

const BEFORE_AFTER_ROWS = [
  {
    dimension: "App Team Onboarding",
    before: "Wait 3–7 days in manual NetOps ticket queues; wrestle with complex YAML & WAF rules.",
    after: "Describe routing in plain English or pick a preset; get policy-checked diffs in seconds.",
  },
  {
    dimension: "Adding New Guardrails",
    before: "Every new FinOps or security check requires backend sprint work and server redeploys.",
    after: "Compose an On-the-Fly Agent in Studio, bind read-only tools, and chain JSON outputs live.",
  },
  {
    dimension: "Approver Confidence",
    before: "Reviewers manually cross-check route collisions, TLS settings, and cluster drift.",
    after: "Agents verify policies & Blast Radius automatically; ETag lock guarantees zero silent drift.",
  },
  {
    dimension: "Production Rollouts",
    before: "All-or-nothing applies make teams hesitant to migrate legacy traffic onto Ingress.",
    after: "Progressive 10% -> 50% -> 100% canary shifts with synthetic probes & instant auto-rollback.",
  },
] as const;

const ON_THE_FLY_EXAMPLES = [
  {
    icon: DollarSign,
    agentName: "CostEstimationAgent",
    domain: "FinOps & Budget Guardrail",
    stage: "Phase A Parallel",
    summary:
      "Estimates monthly Cloud Load Balancer & external egress cost deltas before approval, flagging unexpected spend automatically.",
    impact: "Eliminates surprise cloud networking bills across business units.",
  },
  {
    icon: FileCheck2,
    agentName: "ComplianceResidencyAgent",
    domain: "PCI / GDPR & Audit",
    stage: "Phase A Parallel",
    summary:
      "Verifies regional hostname boundaries, required ticket refs, and regulatory annotations for regulated workloads.",
    impact: "Unblocks fintech & enterprise teams to adopt shared Ingress confidently.",
  },
  {
    icon: ShieldCheck,
    agentName: "SecurityPostureAgent",
    domain: "SecOps & Zero Trust",
    stage: "Phase B Sequential",
    summary:
      "Consumes upstream outputs via {{Agent.field}} to verify strict TLS 1.3 and WAF posture; can veto unsafe configs automatically.",
    impact: "Gives Security leadership automated pre-flight enforcement on every route.",
  },
  {
    icon: Zap,
    agentName: "SyntheticHealthProbeAgent",
    domain: "SRE & Canary Reliability",
    stage: "Post-Verify",
    summary:
      "Audits DNS, TLS handshake, HTTP health, and WAF rules after canary shifts, sealing evidence in the SHA-256 audit chain.",
    impact: "Removes outage anxiety so legacy teams migrate faster onto Ingress.",
  },
] as const;

const ADOPTION_PILLARS = [
  {
    icon: Sparkles,
    title: "1. Zero-Friction Developer Experience",
    description:
      "App developers don't need deep Kubernetes Gateway API, Cloud Armor WAF, or DNS expertise. Natural-language intake handles translation while enforcing company standards automatically.",
  },
  {
    icon: Cpu,
    title: "2. Elastic Governance via On-the-Fly Agents",
    description:
      "As more teams adopt Ingress, Security and Platform leaders can spin up new specialist agents on the fly—sharing typed context across the DAG without creating engineering bottlenecks.",
  },
  {
    icon: Lock,
    title: "3. Trust Through Cryptographic Isolation",
    description:
      "Analysis agents operate under strictly read-only credentials. Execution only unlocks after a signed four-eyes human decision and live ETag anti-drift verification.",
  },
  {
    icon: TrendingUp,
    title: "4. Safe Legacy Migration at Scale",
    description:
      "Progressive canary traffic shifting paired with zero-LLM deterministic rollbacks (< 60s) lets hesitant teams migrate critical revenue APIs with confidence.",
  },
] as const;

export interface LeadershipOverviewSectionProps {
  adoptionMermaid?: string;
}

export function LeadershipOverviewSection({ adoptionMermaid }: LeadershipOverviewSectionProps) {
  return (
    <div className="space-y-6">
      {/* Executive Pitch Banner + 4 Impact Metrics */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6 border-b border-slate-200">
          <div className="space-y-2 max-w-3xl">
            <div className="text-xs font-mono font-semibold text-blue-700 uppercase tracking-wide">
              Executive Architecture Brief · Platform & Security Leadership
            </div>
            <h2 className="text-lg font-semibold text-slate-950 tracking-tight">
              Self-Service Speed for Developers. Zero-Compromise Safety for Production Ingress.
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              This control plane turns slow, manual Ingress ticket queues into a governed self-service
              pipeline. Read-only AI specialists validate policies, costs, and collision risks in seconds;
              human approvers sign with four-eyes RBAC; and live customer traffic never passes through an LLM.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <Link
              to="/agents"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 transition-colors whitespace-nowrap"
            >
              Open Live Agent Studio
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              to="/workflows"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              View Live Workflows
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 bg-slate-50/50">
          {IMPACT_METRICS.map((m) => (
            <div key={m.label} className="p-5 space-y-1">
              <div className="text-xs font-medium text-slate-500">{m.label}</div>
              <div className="text-xl font-semibold text-slate-950 font-mono tabular-nums">
                {m.value}
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">{m.detail}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Before vs Today Comparison Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Why Traditional Ingress Stalls Adoption — And How This Architecture Solves It
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Removing manual friction for app teams while raising safety assurances for NetOps and SecOps.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-5 py-2.5 text-xs font-semibold text-slate-600 w-48">
                  Capability
                </th>
                <th className="px-5 py-2.5 text-xs font-semibold text-slate-600">
                  Before (Manual Ticket Model)
                </th>
                <th className="px-5 py-2.5 text-xs font-semibold text-emerald-800">
                  Today (Governed Multi-Agent Control Plane)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {BEFORE_AFTER_ROWS.map((row) => (
                <tr key={row.dimension}>
                  <td className="px-5 py-3.5 font-semibold text-slate-900 align-top whitespace-nowrap">
                    {row.dimension}
                  </td>
                  <td className="px-5 py-3.5 text-slate-600 align-top leading-relaxed">
                    {row.before}
                  </td>
                  <td className="px-5 py-3.5 text-slate-900 font-medium align-top leading-relaxed bg-emerald-50/30">
                    {row.after}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* How On-the-Fly Agents Work + Specialist Catalog */}
      <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-blue-700 shrink-0" />
              <h3 className="text-sm font-semibold text-slate-900">
                How On-the-Fly Agents Multiply Team Agility Without Engineering Bottlenecks
              </h3>
            </div>
            <p className="text-xs text-slate-600 max-w-3xl">
              Instead of writing custom backend code for every new governance rule, leaders create
              specialist agents directly in the UI. Each dynamic agent is automatically sandboxed to
              read-only tools and validated for cycle-free execution.
            </p>
          </div>
          <Link
            to="/agents"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:underline whitespace-nowrap shrink-0"
          >
            Try Agent Studio
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {/* 3-Step On-the-Fly Agent Lifecycle */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 border border-slate-200 rounded-md bg-slate-50/60 space-y-1.5">
            <div className="text-xs font-mono font-semibold text-blue-700">Step 1 · Author</div>
            <div className="text-xs font-semibold text-slate-900">
              Define Specialist in Seconds
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Give the agent a domain role, read-only tools (<code className="font-mono">get_lb_config</code>,{" "}
              <code className="font-mono">evaluate_opa_policies</code>), and a typed JSON output contract.
            </p>
          </div>
          <div className="p-4 border border-slate-200 rounded-md bg-slate-50/60 space-y-1.5">
            <div className="text-xs font-mono font-semibold text-blue-700">Step 2 · Chain</div>
            <div className="text-xs font-semibold text-slate-900">
              Wire Typed Context (<code className="font-mono">{"{{Agent.field}}"}</code>)
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Plug into any pipeline stage (<code className="font-mono">Pre-Intake</code> to{" "}
              <code className="font-mono">Post-Verify</code>). The DAG engine blocks circular dependencies automatically.
            </p>
          </div>
          <div className="p-4 border border-slate-200 rounded-md bg-slate-50/60 space-y-1.5">
            <div className="text-xs font-mono font-semibold text-blue-700">Step 3 · Enforce</div>
            <div className="text-xs font-semibold text-slate-900">
              Safe Veto & Cryptographic Audit
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Agents can elevate Blast Radius or pause deployment for human review—with every output
              hashed into the append-only audit log.
            </p>
          </div>
        </div>

        {/* 4 Leadership Scenarios */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ON_THE_FLY_EXAMPLES.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.agentName}
                className="p-4 border border-slate-200 rounded-md bg-white space-y-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-7 w-7 rounded-md bg-blue-50 border border-blue-200/70 text-blue-700 flex items-center justify-center shrink-0">
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 truncate">
                        {item.domain}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 truncate">
                        {item.agentName} · {item.stage}
                      </div>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">{item.summary}</p>
                <div className="pt-1.5 border-t border-slate-100 text-xs font-medium text-emerald-800">
                  Leadership Value: {item.impact}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4 Adoption Pillars */}
      <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
          <GitBranch className="h-4 w-4 text-blue-700 shrink-0" />
          <h3 className="text-sm font-semibold text-slate-900">
            How This Architecture Accelerates Organization-Wide Ingress Adoption
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ADOPTION_PILLARS.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <div
                key={pillar.title}
                className="p-4 border border-slate-200 rounded-md bg-slate-50/40 space-y-1.5"
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                  <Icon className="h-4 w-4 text-blue-700 shrink-0" />
                  <span>{pillar.title}</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">{pillar.description}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Visual Diagram of On-the-Fly Agents -> Adoption */}
      {adoptionMermaid && (
        <MermaidDiagram
          title="How On-the-Fly Agents Plug Into the Pipeline & Drive Ingress Adoption"
          code={adoptionMermaid}
        />
      )}
    </div>
  );
}
