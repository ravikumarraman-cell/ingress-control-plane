import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { createPolicy, deletePolicy, togglePolicy } from "../../lib/api";
import type { CustomPolicyRule } from "../../shared/contracts";

export interface PolicyRulesPanelProps {
  rules: CustomPolicyRule[];
}

export function PolicyRulesPanel({ rules }: PolicyRulesPanelProps) {
  const queryClient = useQueryClient();
  const [ruleName, setRuleName] = useState("");
  const [ruleType, setRuleType] = useState<CustomPolicyRule["conditionType"]>("max_port");
  const [ruleValue, setRuleValue] = useState("9443");
  const [ruleSeverity, setRuleSeverity] = useState<"WARN" | "BLOCK">("WARN");

  const addPolicyMutation = useMutation({
    mutationFn: () =>
      createPolicy({
        name: ruleName.trim(),
        description: `Dynamic ${ruleType} rule (${ruleValue.trim() || "default"})`,
        conditionType: ruleType,
        value: ruleValue.trim(),
        severity: ruleSeverity,
      }),
    onSuccess: () => {
      setRuleName("");
      queryClient.invalidateQueries({ queryKey: ["policies"] });
    },
  });

  const togglePolicyMutation = useMutation({
    mutationFn: (v: { ruleId: string; enabled: boolean }) => togglePolicy(v.ruleId, v.enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["policies"] }),
  });

  const deletePolicyMutation = useMutation({
    mutationFn: (ruleId: string) => deletePolicy(ruleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["policies"] }),
  });

  const activeCount = rules.filter((r) => r.enabled).length;

  return (
    <div className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Dynamic Policy Rules (Evaluated by PolicyComplianceAgent)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Toggle or add custom governance rules without restarting the server. Active rules apply
            immediately to every new or revised workflow.
          </p>
        </div>
        <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
          {activeCount} active rules
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {rules.map((rule) => (
          <div
            key={rule.ruleId}
            className="flex items-start justify-between gap-3 p-3.5 border border-slate-200 dark:border-slate-800 rounded-md bg-slate-50/50 dark:bg-[#090D16]"
          >
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">{rule.name}</span>
                <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{rule.severity}</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">{rule.description}</p>
              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                {rule.ruleId} · {rule.conditionType} = {rule.value || "any"}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() =>
                  togglePolicyMutation.mutate({
                    ruleId: rule.ruleId,
                    enabled: !rule.enabled,
                  })
                }
                className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors ${
                  rule.enabled
                    ? "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300"
                    : "bg-white dark:bg-[#0F172A] border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                {rule.enabled ? "Enabled" : "Disabled"}
              </button>
              <button
                type="button"
                onClick={() => deletePolicyMutation.mutate(rule.ruleId)}
                className="p-1.5 text-slate-400 hover:text-red-600 transition-colors"
                aria-label={`Delete ${rule.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-6 gap-2.5 items-end">
        <div className="sm:col-span-2">
          <label
            htmlFor="policy-rule-name"
            className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
          >
            New Rule Name
          </label>
          <input
            id="policy-rule-name"
            type="text"
            value={ruleName}
            onChange={(e) => setRuleName(e.target.value)}
            placeholder="e.g. Max Service Port 9443"
            className="w-full px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-800 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
        <div>
          <label
            htmlFor="policy-rule-type"
            className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
          >
            Rule Type
          </label>
          <select
            id="policy-rule-type"
            value={ruleType}
            onChange={(e) => setRuleType(e.target.value as CustomPolicyRule["conditionType"])}
            className="w-full px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-800 rounded-md bg-white dark:bg-[#0F172A] focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="max_port">Max Backend Port</option>
            <option value="allowed_domain_suffix">Domain Suffix</option>
            <option value="require_ticket">Require Ticket</option>
            <option value="enforce_waf_staging">Staging WAF TLS 1.3</option>
          </select>
        </div>
        <div>
          <label
            htmlFor="policy-rule-value"
            className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
          >
            Target Value
          </label>
          <input
            id="policy-rule-value"
            type="text"
            value={ruleValue}
            onChange={(e) => setRuleValue(e.target.value)}
            placeholder="9443 or .example.com"
            className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 dark:border-slate-800 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
        <div>
          <label
            htmlFor="policy-rule-action"
            className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
          >
            Action
          </label>
          <select
            id="policy-rule-action"
            value={ruleSeverity}
            onChange={(e) => setRuleSeverity(e.target.value as "WARN" | "BLOCK")}
            className="w-full px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-800 rounded-md bg-white dark:bg-[#0F172A] focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="WARN">WARN</option>
            <option value="BLOCK">BLOCK</option>
          </select>
        </div>
        <button
          type="button"
          disabled={ruleName.trim().length < 3 || addPolicyMutation.isPending}
          onClick={() => addPolicyMutation.mutate()}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Rule
        </button>
      </div>
    </div>
  );
}
