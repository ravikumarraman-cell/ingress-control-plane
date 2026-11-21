export interface SegmentedTabItem<T extends string> {
  id: T;
  label: string;
  count?: number | string;
}

export interface SegmentedTabsProps<T extends string> {
  items: ReadonlyArray<SegmentedTabItem<T>>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel?: string;
  size?: "sm" | "md";
  fullWidth?: boolean;
}

export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  size = "md",
  fullWidth = false,
}: SegmentedTabsProps<T>) {
  const padClass = size === "sm" ? "px-2.5 py-1" : "px-3.5 py-1.5";

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-1 p-1 bg-slate-200/75 rounded-lg max-w-full overflow-x-auto ${
        fullWidth ? "w-full" : "w-fit"
      }`}
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={`${
              fullWidth ? "flex-1 justify-center" : ""
            } inline-flex items-center gap-1.5 ${padClass} text-xs font-medium rounded-md transition-all duration-150 whitespace-nowrap shrink-0 tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
              active
                ? "bg-white text-slate-950 shadow-xs ring-1 ring-slate-900/5"
                : "text-slate-600 hover:text-slate-950"
            }`}
          >
            <span>{item.label}</span>
            {item.count !== undefined && (
              <span
                className={`font-mono text-[11px] ${
                  active ? "text-slate-500" : "text-slate-400"
                }`}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
