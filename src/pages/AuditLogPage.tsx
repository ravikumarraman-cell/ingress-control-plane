import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, ShieldAlert, ShieldCheck } from "lucide-react";
import { AuditLogTable } from "../components/AuditLogTable";
import { PageHeader } from "../components/ui/PageHeader";
import { SearchFilterBar } from "../components/ui/SearchFilterBar";
import { SegmentedTabs } from "../components/ui/SegmentedTabs";
import { fetchAuditLog, verifyAuditLog } from "../lib/api";

export function AuditLogPage() {
  const [search, setSearch] = useState("");
  const [actorFilter, setActorFilter] = useState<"ALL" | "HUMAN" | "AGENT" | "SYSTEM">("ALL");

  const auditQuery = useQuery({
    queryKey: ["audit-log"],
    queryFn: fetchAuditLog,
  });

  const verifyMutation = useMutation({
    mutationFn: verifyAuditLog,
  });

  const allEvents = auditQuery.data?.events ?? [];

  const filteredEvents = useMemo(() => {
    return allEvents.filter((ev) => {
      if (actorFilter !== "ALL" && ev.actorType !== actorFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          ev.eventType.toLowerCase().includes(q) ||
          ev.actorId.toLowerCase().includes(q) ||
          ev.workflowId.toLowerCase().includes(q) ||
          JSON.stringify(ev.payload).toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allEvents, actorFilter, search]);

  const hasActiveFilters = actorFilter !== "ALL" || search.trim().length > 0;
  const clearFilters = () => {
    setActorFilter("ALL");
    setSearch("");
  };

  const chainResult = verifyMutation.data ?? auditQuery.data?.verification;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Immutable Governance Audit Log"
        subtitle="Append-only SHA-256 hash-chained ledger recording every intake, HITL signature, drift check, and rollback."
        actions={
          <>
            {chainResult && (
              <div
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border ${
                  chainResult.valid
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                    : "bg-red-50 border-red-200 text-red-800"
                }`}
              >
                {chainResult.valid ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                ) : (
                  <ShieldAlert className="h-3.5 w-3.5 text-red-700" />
                )}
                <span className="tabular-nums">
                  {chainResult.valid
                    ? `Chain Verified (${chainResult.checkedCount} events)`
                    : `Broken at seq #${chainResult.brokenAtSeq}`}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={() => verifyMutation.mutate()}
              disabled={verifyMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap transition-colors"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Verify Hash Chain
            </button>
          </>
        }
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <SegmentedTabs
          ariaLabel="Filter audit events by actor type"
          value={actorFilter}
          onChange={setActorFilter}
          items={[
            { id: "ALL", label: "All Actors" },
            { id: "HUMAN", label: "HUMAN" },
            { id: "AGENT", label: "AGENT" },
            { id: "SYSTEM", label: "SYSTEM" },
          ]}
        />

        <SearchFilterBar
          value={search}
          onChange={setSearch}
          placeholder="Search event type, actor, payload..."
          filteredCount={filteredEvents.length}
          totalCount={allEvents.length}
          hasActiveFilters={hasActiveFilters}
          onResetFilters={clearFilters}
          itemLabel="events"
          className="sm:w-auto"
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <AuditLogTable
          events={filteredEvents}
          isLoading={auditQuery.isLoading}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={clearFilters}
        />
      </div>
    </div>
  );
}
