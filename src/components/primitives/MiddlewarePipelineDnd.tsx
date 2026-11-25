import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Plus,
  Trash2,
} from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { IngressRoute, MiddlewarePlugin, RouteMiddlewareBinding } from '../../core/ir/types';
import { SchemaDrivenForm } from './SchemaDrivenForm';

interface MiddlewarePipelineDndProps {
  route: IngressRoute;
  plugins: Record<string, MiddlewarePlugin>;
  selectedBindingId?: string | null;
  onSelectBinding?: (bindingId: string) => void;
  onReorder: (fromIdx: number, toIdx: number) => void;
  onToggle: (bindingId: string) => void;
  onRemove: (bindingId: string) => void;
  onAttach?: (pluginId: string) => void;
  onUpdateConfig?: (bindingId: string, config: Record<string, unknown>) => void;
  variant?: 'full' | 'drawer';
}

interface DragGhostState {
  binding: RouteMiddlewareBinding;
  sourceIdx: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
}

const TRANSPARENT_PIXEL_SRC =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function summarizeConfig(pluginId: string, config: Record<string, unknown>): string {
  if (pluginId === 'rate-limit') {
    const rps = config.requestsPerSecond ?? config.requestsPerMinute ?? config.limit ?? '—';
    const burst = config.burstSize ?? config.burst ?? '—';
    const keyBy = config.keyBy ?? 'client_ip';
    return `${rps} req/s · burst ${burst} · key ${keyBy}`;
  }
  if (pluginId === 'waf-ruleset') {
    const mode = config.mode ?? 'block';
    const level = config.paranoiaLevel ?? 2;
    return `OWASP CRS · paranoia L${level} · ${mode}`;
  }
  if (pluginId === 'jwt-auth') {
    const issuer = config.issuer ?? 'auth.internal';
    const scope = config.requiredScope ?? '';
    return scope ? `${issuer} · ${scope}` : `JWT · ${issuer}`;
  }
  if (pluginId === 'cors') {
    const origins = config.allowOrigins ?? '*';
    return `Origins ${origins}`;
  }
  if (pluginId === 'mtls-enforce' || pluginId === 'mtls') {
    const reqCert = config.requireClientCert ? 'required' : 'optional';
    const spiffe = config.allowedSpiffePrefix ?? '';
    return spiffe ? `mTLS ${reqCert} · ${spiffe}` : `Client cert · ${reqCert}`;
  }
  if (pluginId === 'header-transform') {
    const key = config.addHeaderKey ?? config.addHeader ?? '';
    const val = config.addHeaderValue ?? '';
    return key ? `Set ${String(key)}=${String(val)}` : 'Header mutation rules';
  }
  if (pluginId === 'circuit-breaker') {
    const maxErr = config.consecutiveErrors ?? config.consecutive5xx ?? 5;
    return `Trip on ${maxErr}× errors`;
  }
  const firstEntry = Object.entries(config)[0];
  return firstEntry ? `${firstEntry[0]}: ${String(firstEntry[1])}` : 'Configured';
}

export const MiddlewarePipelineDnd: React.FC<MiddlewarePipelineDndProps> = ({
  route,
  plugins,
  selectedBindingId = null,
  onSelectBinding,
  onReorder,
  onToggle,
  onRemove,
  onAttach,
  onUpdateConfig,
  variant = 'full',
}) => {
  const layoutGroupId = useId();
  const prefersReducedMotion = useReducedMotion();

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [insertIdx, setInsertIdx] = useState<number | null>(null);
  const [ghost, setGhost] = useState<DragGhostState | null>(null);
  const [snappedId, setSnappedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const blankDragImgRef = useRef<HTMLImageElement | null>(null);
  const snapTimerRef = useRef<number | null>(null);

  const pluginList = useMemo(() => Object.values(plugins), [plugins]);
  const [attachPluginId, setAttachPluginId] = useState<string>(
    () => pluginList[0]?.id ?? 'rate-limit'
  );

  const isDrawer = variant === 'drawer';

  // Prepare transparent 1x1 drag image to suppress the browser's blurry default screenshot
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const img = new window.Image();
    img.src = TRANSPARENT_PIXEL_SRC;
    blankDragImgRef.current = img;
    return () => {
      if (snapTimerRef.current !== null) {
        window.clearTimeout(snapTimerRef.current);
      }
    };
  }, []);

  const triggerSnapFeedback = (bindingId: string) => {
    setSnappedId(bindingId);
    if (snapTimerRef.current !== null) {
      window.clearTimeout(snapTimerRef.current);
    }
    snapTimerRef.current = window.setTimeout(() => {
      setSnappedId((curr) => (curr === bindingId ? null : curr));
    }, 460);
  };

  const resetDragState = () => {
    setDragIdx(null);
    setInsertIdx(null);
    setGhost(null);
  };

  const commitReorder = (sourceIdx: number, targetInsertIdx: number) => {
    if (
      sourceIdx < 0 ||
      sourceIdx >= route.middlewares.length ||
      targetInsertIdx === sourceIdx ||
      targetInsertIdx === sourceIdx + 1
    ) {
      return;
    }
    const toIdx = targetInsertIdx > sourceIdx ? targetInsertIdx - 1 : targetInsertIdx;
    if (toIdx !== sourceIdx && toIdx >= 0 && toIdx < route.middlewares.length) {
      const movedBinding = route.middlewares[sourceIdx];
      onReorder(sourceIdx, toIdx);
      if (movedBinding) {
        triggerSnapFeedback(movedBinding.id);
      }
    }
  };

  const handleReorderStep = (fromIdx: number, toIdx: number) => {
    const moved = route.middlewares[fromIdx];
    onReorder(fromIdx, toIdx);
    if (moved) {
      triggerSnapFeedback(moved.id);
    }
  };

  const updateGhostCoords = (clientX: number, clientY: number) => {
    if (clientX === 0 && clientY === 0) return;
    setGhost((prev) =>
      prev && (prev.x !== clientX || prev.y !== clientY)
        ? { ...prev, x: clientX, y: clientY }
        : prev
    );
  };

  const handleCardDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    mw: RouteMiddlewareBinding,
    idx: number
  ) => {
    const target = e.target as HTMLElement | null;
    if (target && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)) {
      if (!target.dataset.dragHandle) {
        e.preventDefault();
        return;
      }
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const pointerX = e.clientX || rect.left + rect.width / 2;
    const pointerY = e.clientY || rect.top + rect.height / 2;

    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
      if (e.dataTransfer.setDragImage && blankDragImgRef.current) {
        e.dataTransfer.setDragImage(blankDragImgRef.current, 0, 0);
      }
    }

    setDragIdx(idx);
    setInsertIdx(idx);
    setGhost({
      binding: mw,
      sourceIdx: idx,
      width: rect.width,
      height: rect.height,
      offsetX: Math.max(12, Math.min(rect.width - 12, pointerX - rect.left)),
      offsetY: Math.max(12, Math.min(rect.height - 12, pointerY - rect.top)),
      x: pointerX,
      y: pointerY,
    });
  };

  const handleCardDrag = (e: React.DragEvent<HTMLDivElement>) => {
    updateGhostCoords(e.clientX, e.clientY);
  };

  const handleCardDragOver = (e: React.DragEvent<HTMLDivElement>, idx: number) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    updateGhostCoords(e.clientX, e.clientY);

    const rect = e.currentTarget.getBoundingClientRect();
    const isTopHalf = e.clientY - rect.top < rect.height / 2;
    const nextInsert = isTopHalf ? idx : idx + 1;
    if (nextInsert !== insertIdx) {
      setInsertIdx(nextInsert);
    }
  };

  const handleCardDrop = (e: React.DragEvent<HTMLDivElement>, fallbackIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    const rawFrom = e.dataTransfer?.getData('text/plain') ?? '';
    const sourceIdx = dragIdx !== null ? dragIdx : Number(rawFrom);
    if (!Number.isNaN(sourceIdx)) {
      const targetInsert =
        insertIdx !== null
          ? insertIdx
          : fallbackIdx > sourceIdx
            ? fallbackIdx + 1
            : fallbackIdx;
      commitReorder(sourceIdx, targetInsert);
    }
    resetDragState();
  };

  const handleListDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    updateGhostCoords(e.clientX, e.clientY);
  };

  const handleListDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rawFrom = e.dataTransfer?.getData('text/plain') ?? '';
    const sourceIdx = dragIdx !== null ? dragIdx : Number(rawFrom);
    if (!Number.isNaN(sourceIdx) && insertIdx !== null) {
      commitReorder(sourceIdx, insertIdx);
    }
    resetDragState();
  };

  const handleKeyReorder = (e: React.KeyboardEvent<HTMLDivElement>, idx: number) => {
    if (!e.altKey && !e.metaKey && !e.ctrlKey) return;
    if (e.key === 'ArrowUp' && idx > 0) {
      e.preventDefault();
      handleReorderStep(idx, idx - 1);
    } else if (e.key === 'ArrowDown' && idx < route.middlewares.length - 1) {
      e.preventDefault();
      handleReorderStep(idx, idx + 1);
    }
  };

  const toggleExpand = (bindingId: string) => {
    setExpandedIds((prev) => ({ ...prev, [bindingId]: !prev[bindingId] }));
  };

  const activeCount = route.middlewares.filter((m) => m.enabled).length;

  const springTransition = prefersReducedMotion
    ? { duration: 0.01 }
    : {
        layout: { type: 'spring' as const, stiffness: 520, damping: 34, mass: 0.72 },
        scale: { type: 'spring' as const, stiffness: 500, damping: 28 },
        opacity: { duration: 0.14 },
      };

  const ghostPlugin = ghost ? plugins[ghost.binding.pluginId] : undefined;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-slate-700 dark:text-slate-300 truncate">
            Middleware Pipeline
          </span>
          <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
            {activeCount}/{route.middlewares.length} active
          </span>
        </div>
        <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
          Drag cards to reorder
        </span>
      </div>

      {route.middlewares.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-[#090D16] p-4 text-center text-xs text-slate-500 dark:text-slate-400">
          No middleware policies attached to this route yet. Add a policy below to build the execution pipeline.
        </div>
      ) : (
        <LayoutGroup id={layoutGroupId}>
          <div
            className="space-y-2"
            onDragOver={handleListDragOver}
            onDrop={handleListDrop}
            role="list"
            aria-label="Route middleware execution pipeline"
          >
            {route.middlewares.map((mw: RouteMiddlewareBinding, idx: number) => {
              const plugin = plugins[mw.pluginId];
              const isSelected = !isDrawer && selectedBindingId === mw.id;
              const isDragging = dragIdx === idx;
              const isSnapped = snappedId === mw.id;
              const isExpanded = isDrawer && Boolean(expandedIds[mw.id]);
              const showDropBefore =
                dragIdx !== null && insertIdx === idx && dragIdx !== idx && dragIdx + 1 !== idx;
              const showDropAfter =
                dragIdx !== null &&
                idx === route.middlewares.length - 1 &&
                insertIdx === route.middlewares.length &&
                dragIdx !== idx;

              return (
                <motion.div
                  key={mw.id}
                  layout="position"
                  initial={false}
                  animate={{
                    scale: isDragging
                      ? prefersReducedMotion
                        ? 1
                        : 0.985
                      : isSnapped && !prefersReducedMotion
                        ? [1.022, 1]
                        : 1,
                    opacity: isDragging ? 0.36 : 1,
                  }}
                  transition={springTransition}
                  className="relative"
                  role="listitem"
                >
                  <AnimatePresence>
                    {showDropBefore && (
                      <motion.div
                        layoutId={`snap-rail-${layoutGroupId}`}
                        initial={{ opacity: 0, scaleX: 0.92 }}
                        animate={{ opacity: 1, scaleX: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.12 }}
                        className="relative flex items-center mb-1.5"
                        aria-hidden="true"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-sky-400 shrink-0" />
                        <div className="h-0.5 flex-1 rounded-full bg-blue-600 dark:bg-sky-400" />
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-sky-400 shrink-0" />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div
                    draggable
                    tabIndex={0}
                    onKeyDown={(e) => handleKeyReorder(e, idx)}
                    onDragStart={(e) => handleCardDragStart(e, mw, idx)}
                    onDrag={handleCardDrag}
                    onDragOver={(e) => handleCardDragOver(e, idx)}
                    onDrop={(e) => handleCardDrop(e, idx)}
                    onDragEnd={resetDragState}
                    onClick={() => onSelectBinding?.(mw.id)}
                    className={`group rounded-lg border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:focus-visible:ring-sky-400 ${
                      isDragging
                        ? 'border-dashed border-blue-500/75 dark:border-sky-400/75 bg-blue-50/40 dark:bg-sky-500/5'
                        : isSnapped
                          ? 'bg-blue-50/80 dark:bg-[#131B2E] border-blue-500 dark:border-sky-400 ring-2 ring-blue-500/25 dark:ring-sky-400/25 shadow-sm'
                          : isSelected
                            ? 'bg-blue-50/70 dark:bg-[#131B2E] border-blue-500 dark:border-sky-400/80'
                            : mw.enabled
                              ? 'bg-white dark:bg-[#0F172A] border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                              : 'bg-slate-50/80 dark:bg-[#0B111E] border-slate-200/80 dark:border-slate-800/70 opacity-75 hover:opacity-100'
                    }`}
                  >
                    <div
                      className={`flex items-center justify-between gap-2 ${
                        isDrawer ? 'px-2.5 py-2' : 'px-3 py-2.5'
                      } ${onSelectBinding ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          data-drag-handle="true"
                          className="text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300 cursor-grab active:cursor-grabbing shrink-0"
                          title="Drag to reorder (or Alt+Up / Alt+Down)"
                        >
                          <GripVertical className="w-3.5 h-3.5" />
                        </span>

                        <span className="font-mono tabular-nums text-[11px] font-semibold text-slate-500 dark:text-slate-400 w-5 shrink-0">
                          {String(idx + 1).padStart(2, '0')}
                        </span>

                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {plugin?.name ?? mw.pluginId}
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                            {plugin?.category ?? 'middleware'}
                            <span className="mx-1" aria-hidden="true">
                              ·
                            </span>
                            <span>{summarizeConfig(mw.pluginId, mw.config)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleReorderStep(idx, idx - 1);
                          }}
                          className="p-1 rounded text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-25 transition-colors"
                          aria-label={`Move ${plugin?.name ?? mw.pluginId} earlier`}
                          title="Move up"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === route.middlewares.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleReorderStep(idx, idx + 1);
                          }}
                          className="p-1 rounded text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-25 transition-colors"
                          aria-label={`Move ${plugin?.name ?? mw.pluginId} later`}
                          title="Move down"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>

                        {isDrawer && plugin && onUpdateConfig && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpand(mw.id);
                            }}
                            className="p-1 rounded text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                            aria-label={isExpanded ? 'Collapse policy settings' : 'Configure policy'}
                            title="Configure policy"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggle(mw.id);
                          }}
                          className={`ml-0.5 px-2 py-0.5 rounded text-[11px] font-medium border transition-colors whitespace-nowrap ${
                            mw.enabled
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              : 'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {mw.enabled ? 'On' : 'Off'}
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemove(mw.id);
                          }}
                          className="p-1 rounded text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                          aria-label={`Remove ${plugin?.name ?? mw.pluginId}`}
                          title="Remove policy"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {isExpanded && plugin && onUpdateConfig && (
                      <div
                        className="px-3 pb-3 pt-2 border-t border-slate-200 dark:border-slate-800/80 bg-slate-50/70 dark:bg-[#090D16]/70 rounded-b-lg"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <SchemaDrivenForm
                          compact
                          schema={plugin.schema}
                          value={mw.config}
                          onChange={(nextCfg) => onUpdateConfig(mw.id, nextCfg)}
                        />
                      </div>
                    )}
                  </div>

                  <AnimatePresence>
                    {showDropAfter && (
                      <motion.div
                        layoutId={`snap-rail-${layoutGroupId}`}
                        initial={{ opacity: 0, scaleX: 0.92 }}
                        animate={{ opacity: 1, scaleX: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.12 }}
                        className="relative flex items-center mt-1.5"
                        aria-hidden="true"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-sky-400 shrink-0" />
                        <div className="h-0.5 flex-1 rounded-full bg-blue-600 dark:bg-sky-400" />
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-sky-400 shrink-0" />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        </LayoutGroup>
      )}

      {onAttach && pluginList.length > 0 && (
        <div className="flex items-center gap-2 pt-1">
          <select
            value={attachPluginId}
            onChange={(e) => setAttachPluginId(e.target.value)}
            aria-label="Select middleware policy to attach"
            className="flex-1 min-w-0 bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-600 dark:focus:border-sky-400"
          >
            {pluginList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.builtIn ? '' : '(Custom)'}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onAttach(attachPluginId)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#090D16] text-xs font-medium text-slate-800 dark:text-slate-200 hover:border-blue-500 dark:hover:border-sky-400 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Policy</span>
          </button>
        </div>
      )}

      {/* Floating Translucent Drag Ghost Card */}
      {typeof document !== 'undefined' &&
        ghost &&
        createPortal(
          <div
            aria-hidden="true"
            style={{
              position: 'fixed',
              left: 0,
              top: 0,
              width: `${ghost.width}px`,
              transform: `translate3d(${ghost.x - ghost.offsetX}px, ${ghost.y - ghost.offsetY}px, 0) scale(1.02) rotate(${prefersReducedMotion ? 0 : -0.6}deg)`,
              transformOrigin: 'center center',
            }}
            className="pointer-events-none z-50 rounded-lg border border-blue-500/80 dark:border-sky-400/80 bg-white/90 dark:bg-[#131B2E]/90 backdrop-blur-xs shadow-2xl ring-1 ring-blue-500/20 dark:ring-sky-400/25 px-3 py-2.5 opacity-95"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <GripVertical className="w-3.5 h-3.5 text-blue-600 dark:text-sky-400 shrink-0" />
                <span className="font-mono tabular-nums text-[11px] font-semibold text-blue-700 dark:text-sky-300 w-5 shrink-0">
                  {String(ghost.sourceIdx + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {ghostPlugin?.name ?? ghost.binding.pluginId}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                    {ghostPlugin?.category ?? 'middleware'}
                    <span className="mx-1">·</span>
                    <span>{summarizeConfig(ghost.binding.pluginId, ghost.binding.config)}</span>
                  </div>
                </div>
              </div>
              <span className="text-[11px] font-mono font-medium text-blue-700 dark:text-sky-300 shrink-0">
                Moving
              </span>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
