import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  createColumnHelper,
  flexRender,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { CheckCircle2, Search, ShieldAlert, ShieldCheck } from "lucide-react";
import { fetchAuditLog, verifyAuditLog } from "../lib/api";
import type { AuditEvent } from "../shared/contracts";

const features = tableFeatures({});
const columnHelper = createColumnHelper<typeof features, AuditEvent>();

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

  const filteredEvents = useMemo(() => {
    const events = auditQuery.data?.events ?? [];
    return events.filter((ev) => {
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
  }, [auditQuery.data, actorFilter, search]);

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("seqNo", {
          header: "Seq",
          cell: (info) => (
            <span className="font-mono text-xs tabular-nums text-slate-500">
              #{info.getValue()}
            </span>
          ),
        }),
        columnHelper.accessor("eventType", {
          header: "Event Type",
          cell: (info) => (
            <span className="font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
              {info.getValue()}
            </span>
          ),
        }),
        columnHelper.accessor("actorId", {
          header: "Actor",
          cell: (info) => (
            <div className="text-xs">
              <span className="text-slate-900 font-medium">{info.getValue()}</span>
              <span className="text-slate-400 mx-1.5">·</span>
              <span className="font-mono text-slate-500">{info.row.original.actorType}</span>
            </div>
          ),
        }),
        columnHelper.accessor("workflowId", {
          header: "Workflow",
          cell: (info) => (
            <Link
              to="/workflows/$workflowId"
              params={{ workflowId: info.getValue() }}
              className="font-mono text-xs text-blue-700 hover:underline whitespace-nowrap"
            >
              {info.getValue().slice(0, 8)}...
            </Link>
          ),
        }),
        columnHelper.accessor("payload", {
          header: "Payload",
          cell: (info) => (
            <code className="text-[11px] font-mono text-slate-600 block max-w-[340px] truncate">
              {JSON.stringify(info.getValue())}
            </code>
          ),
        }),
        columnHelper.accessor("eventHash", {
          header: "SHA-256 Chain Hash",
          cell: (info) => (
            <span className="font-mono text-[11px] text-slate-500 whitespace-nowrap">
              {info.getValue().slice(0, 14)}...
            </span>
          ),
        }),
        columnHelper.accessor("occurredAt", {
          header: "Timestamp",
          cell: (info) => (
            <span className="font-mono text-xs tabular-nums text-slate-500 whitespace-nowrap">
              {new Date(info.getValue()).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          ),
        }),
      ]),
    []
  );

  const table = useTable({
    features: features,
    data: filteredEvents,
    columns,
  });

  const chainResult = verifyMutation.data ?? auditQuery.data?.verification;

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Immutable Governance Audit Log
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Append-only SHA-256 hash-chained ledger recording every intake, HITL signature, drift check, and rollback.
          </p>
        </div>

        <div className="flex items-center gap-3">
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
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Verify Hash Chain
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
          {(["ALL", "HUMAN", "AGENT", "SYSTEM"] as const).map((actor) => (
            <button
              key={actor}
              type="button"
              onClick={() => setActorFilter(actor)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                actorFilter === actor
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {actor === "ALL" ? "All Actors" : actor}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search event type, actor, payload..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {auditQuery.isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id} className="border-b border-slate-200 bg-slate-50">
                    {hg.headers.map((header) => (
                      <th
                        key={header.id}
                        className="px-4 py-2.5 text-xs font-semibold text-slate-600 whitespace-nowrap"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                    {row.getAllCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-3 align-middle">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
