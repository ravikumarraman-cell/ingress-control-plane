import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Menu, ShieldCheck, X } from "lucide-react";

export interface NavItemConfig {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  count?: number;
  matchPrefix?: string;
}

export interface BaseLayoutProps {
  brandTitle?: string;
  brandTo?: string;
  navItems: NavItemConfig[];
  breadcrumb?: string;
  headerActions?: ReactNode;
  sidebarFooter?: ReactNode;
  fullBleed?: boolean;
  children?: ReactNode;
}

export function BaseLayout({
  brandTitle = "Ingress Control Plane",
  brandTo = "/workflows",
  navItems,
  breadcrumb,
  headerActions,
  sidebarFooter,
  fullBleed = false,
  children,
}: BaseLayoutProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileNavOpen]);

  const isNavActive = (item: NavItemConfig) => {
    if (pathname === item.to) return true;
    if (item.matchPrefix && (pathname === "/" || pathname.startsWith(item.matchPrefix))) {
      return true;
    }
    return pathname.startsWith(`${item.to}/`);
  };

  const renderNavLinks = (onNavigate?: () => void) => (
    <nav className="p-3 space-y-1" aria-label="Primary Navigation">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = isNavActive(item);
        return (
          <Link
            key={item.to}
            to={item.to as never}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`group flex items-center justify-between px-3 py-2 text-sm rounded-md transition-all duration-150 whitespace-nowrap ${
              active
                ? "bg-slate-900/[0.05] dark:bg-[#131B2E] text-slate-950 dark:text-sky-300 font-semibold ring-1 ring-slate-900/[0.06] dark:ring-slate-800"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800/50 font-medium"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Icon
                className={`h-4 w-4 shrink-0 transition-colors ${
                  active
                    ? "text-blue-700 dark:text-sky-400"
                    : "text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300"
                }`}
              />
              <span>{item.label}</span>
            </span>
            {typeof item.count === "number" && item.count > 0 && (
              <span className="text-xs font-mono tabular-nums text-amber-700 dark:text-amber-400 font-semibold">
                {item.count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-[#090D16] text-slate-900 dark:text-slate-100">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-3 focus:py-2 focus:text-xs focus:font-medium focus:bg-blue-700 focus:text-white focus:rounded-md"
      >
        Skip to main content
      </a>

      {/* Desktop Sticky Navigation Sidebar */}
      <aside
        className="hidden lg:flex lg:sticky lg:top-0 lg:h-screen w-[248px] shrink-0 bg-white dark:bg-[#0B101B] border-r border-slate-200 dark:border-slate-800/80 flex-col justify-between"
        aria-label="Control Plane Sidebar"
      >
        <div className="overflow-y-auto">
          <div className="h-14 px-4 flex items-center border-b border-slate-200 dark:border-slate-800/80">
            <Link
              to={brandTo as never}
              className="flex items-center gap-2.5 text-sm font-bold tracking-tight text-slate-950 dark:text-slate-100 whitespace-nowrap"
            >
              <span className="h-7 w-7 rounded-md bg-blue-700 dark:bg-sky-500 text-white dark:text-slate-950 flex items-center justify-center shadow-xs shrink-0">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <span>{brandTitle}</span>
            </Link>
          </div>
          {renderNavLinks()}
        </div>

        {sidebarFooter && (
          <div className="p-4 border-t border-slate-200 dark:border-slate-800/80 bg-slate-50/70 dark:bg-[#090D16]/60 shrink-0">
            {sidebarFooter}
          </div>
        )}
      </aside>

      {/* Mobile Slide-Over Navigation Sidebar */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden flex bg-slate-950/40 dark:bg-black/70 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile Navigation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMobileNavOpen(false);
          }}
        >
          <aside className="w-[264px] max-w-[85vw] bg-white dark:bg-[#0B101B] h-full border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between shadow-xl">
            <div>
              <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
                <Link
                  to={brandTo as never}
                  onClick={() => setMobileNavOpen(false)}
                  className="flex items-center gap-2 text-sm font-bold tracking-tight text-slate-950 dark:text-slate-100 whitespace-nowrap"
                >
                  <span className="h-7 w-7 rounded-md bg-blue-700 dark:bg-sky-500 text-white dark:text-slate-950 flex items-center justify-center shadow-xs shrink-0">
                    <ShieldCheck className="h-4 w-4" />
                  </span>
                  <span>{brandTitle}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  aria-label="Close navigation menu"
                  className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {renderNavLinks(() => setMobileNavOpen(false))}
            </div>

            {sidebarFooter && (
              <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#090D16]/60">
                {sidebarFooter}
              </div>
            )}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 h-14 bg-white/90 dark:bg-[#0B101B]/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800/80 px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={mobileNavOpen}
              className="lg:hidden p-1.5 -ml-1 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="text-sm font-medium text-slate-600 dark:text-slate-300 truncate">
              {breadcrumb ?? "Control Plane"}
            </div>
          </div>

          {headerActions && (
            <div className="flex items-center gap-3 shrink-0">{headerActions}</div>
          )}
        </header>

        <main
          id="main-content"
          className={
            fullBleed
              ? "flex-1 w-full min-h-0 overflow-hidden"
              : "flex-1 p-4 sm:p-6 max-w-[1280px] w-full mx-auto"
          }
        >
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
  );
}
