import { Search, X } from "lucide-react";

export interface SearchFilterBarProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  filteredCount?: number;
  totalCount?: number;
  hasActiveFilters?: boolean;
  onResetFilters?: () => void;
  itemLabel?: string;
  className?: string;
}

export function SearchFilterBar({
  value,
  onChange,
  placeholder = "Search...",
  filteredCount,
  totalCount,
  hasActiveFilters = false,
  onResetFilters,
  itemLabel = "results",
  className = "",
}: SearchFilterBarProps) {
  return (
    <div className={`flex items-center gap-3 w-full md:w-auto ${className}`}>
      {hasActiveFilters &&
        typeof filteredCount === "number" &&
        typeof totalCount === "number" && (
          <div className="flex items-center gap-2 text-xs text-slate-500 whitespace-nowrap">
            <span className="tabular-nums">
              Showing {filteredCount} of {totalCount} {itemLabel}
            </span>
            {onResetFilters && (
              <button
                type="button"
                onClick={onResetFilters}
                className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
              >
                Reset filters
              </button>
            )}
          </div>
        )}

      <div className="relative flex-1 md:w-72">
        <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-8 pr-7 py-1.5 text-xs bg-white border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 transition-colors"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear search query"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-0.5 rounded"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
