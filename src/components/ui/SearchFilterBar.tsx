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
  maxLength?: number;
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
  maxLength,
}: SearchFilterBarProps) {
  return (
    <div className={`flex items-center gap-3 w-full md:w-auto ${className}`}>
      {hasActiveFilters &&
        typeof filteredCount === "number" &&
        typeof totalCount === "number" && (
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
            <span className="tabular-nums">
              Showing {filteredCount} of {totalCount} {itemLabel}
            </span>
            {onResetFilters && (
              <button
                type="button"
                onClick={onResetFilters}
                className="text-xs font-medium text-blue-700 dark:text-sky-400 hover:underline whitespace-nowrap"
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
          maxLength={maxLength}
          placeholder={placeholder}
          className="w-full pl-8 pr-7 py-1.5 text-xs bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 transition-colors"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear search query"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:text-slate-300 p-0.5 rounded"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
