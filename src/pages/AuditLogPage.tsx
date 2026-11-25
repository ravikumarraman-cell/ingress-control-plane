import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronLeft, ChevronRight, ShieldAlert, ShieldCheck } from "lucide-react";
import { AuditLogTable } from "../components/AuditLogTable";
import { PageHeader } from "../components/ui/PageHeader";
import { SearchFilterBar } from "../components/ui/SearchFilterBar";
import { SegmentedTabs } from "../components/ui/SegmentedTabs";
import { fetchAuditLogPage, verifyAuditLog } from "../lib/api";

const AUDIT_PAGE_SIZE = 50;

export function AuditLogPage() {
  const [search, setSearch] = useState("");
  const [actorFilter, setActorFilter] = useState<"ALL" | "HUMAN" | "AGENT" | "SYSTEM">("ALL");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [pageIndex, setPageIndex] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const auditQuery = useQuery({
    queryKey: ["audit-log", pageIndex, actorFilter, debouncedSearch],
    queryFn: () =>
      fetchAuditLogPage({
        limit: AUDIT_PAGE_SIZE,
        offset: pageIndex * AUDIT_PAGE_SIZE,
        actorType: actorFilter === "ALL" ? undefined : actorFilter,
        search: debouncedSearch || undefined,
      }),
  });

  const verifyMutation = useMutation({
    mutationFn: verifyAuditLog,
  });

  const hasActiveFilters = actorFilter !== "ALL" || search.trim().length > 0;
  const clearFilters = () => {
    setActorFilter("ALL");
    setSearch("");
    setPageIndex(0);
  };

  const chainResult = verifyMutation.data ?? auditQuery.data?.verification;
  const pagination = auditQuery.data?.pagination;
  const pageStart = pagination && pagination.total > 0 ? pagination.offset + 1 : 0;
  const pageEnd = pagination
    ? Math.min(pagination.offset + pagination.limit, pagination.total)
    : 0;

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
                    ? "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300"
                    : "bg-red-50 dark:bg-rose-500/10 border-red-200 dark:border-rose-500/30 text-red-800"
                }`}
              >
                {chainResult.valid ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />
                ) : (
                  <ShieldAlert className="h-3.5 w-3.5 text-red-700 dark:text-rose-400" />
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
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/60 whitespace-nowrap transition-colors"
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
          onChange={(value) => {
            setActorFilter(value);
            setPageIndex(0);
          }}
          items={[
            { id: "ALL", label: "All Actors" },
            { id: "HUMAN", label: "HUMAN" },
            { id: "AGENT", label: "AGENT" },
            { id: "SYSTEM", label: "SYSTEM" },
          ]}
        />

        <SearchFilterBar
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPageIndex(0);
          }}
          placeholder="Search event type, actor, payload..."
          maxLength={200}
          filteredCount={pagination?.total ?? 0}
          totalCount={pagination?.totalEvents ?? 0}
          hasActiveFilters={hasActiveFilters}
          onResetFilters={clearFilters}
          itemLabel="events"
          className="sm:w-auto"
        />
      </div>

      {auditQuery.isError && (
        <p role="alert" className="text-sm text-red-700 dark:text-rose-400">
          Failed to load audit events: {auditQuery.error.message}
        </p>
      )}

      <div className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <AuditLogTable
          events={auditQuery.data?.events ?? []}
          isLoading={auditQuery.isLoading}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={clearFilters}
        />
      </div>

      <nav
        aria-label="Audit log pagination"
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-400"
      >
        <span className="tabular-nums">
          Showing {pageStart}-{pageEnd} of {pagination?.total ?? 0} matching events
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Previous audit log page"
            disabled={pageIndex === 0 || auditQuery.isFetching}
            onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
            className="inline-flex items-center gap-1 px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-md bg-white dark:bg-[#0F172A] hover:bg-slate-50 dark:hover:bg-slate-800/60 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Previous
          </button>
          <button
            type="button"
            aria-label="Next audit log page"
            disabled={!pagination?.hasMore || auditQuery.isFetching}
            onClick={() => setPageIndex((current) => current + 1)}
            className="inline-flex items-center gap-1 px-3 py-1.5 border border-slate-200 dark:border-slate-800 rounded-md bg-white dark:bg-[#0F172A] hover:bg-slate-50 dark:hover:bg-slate-800/60 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </nav>
    </div>
  );
}
