import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { adapterRegistry } from '../../core/adapters/registry';
import { PRESET_ARCHITECTURES } from '../../core/ir/presets';
import { useControlPlane } from '../../store/ControlPlaneContext';

interface CommandItem {
  id: string;
  group: string;
  label: string;
  hint: string;
  action: () => void;
}

export const CommandPalette: React.FC = () => {
  const {
    ir,
    commandPaletteOpen,
    setCommandPaletteOpen,
    setActiveView,
    setSelection,
    setActiveAdapterId,
    loadPreset,
    setTracerOpen,
    setCustomPluginModalOpen,
    addRoute,
  } = useControlPlane();

  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery('');
      setSelectedIdx(0);
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [commandPaletteOpen]);

  const items = useMemo<CommandItem[]>(() => {
    const list: CommandItem[] = [
      {
        id: 'act-new-route',
        group: 'Actions',
        label: 'Create New Ingress Route',
        hint: 'Routes',
        action: () => {
          const firstListener = Object.keys(ir.listeners)[0] ?? '';
          const firstUpstream = Object.keys(ir.upstreams)[0] ?? '';
          const id = `rt-custom-${Date.now().toString(36)}`;
          addRoute({
            id,
            name: `edge-route-${Object.keys(ir.routes).length + 1}`,
            listenerId: firstListener,
            host: ir.listeners[firstListener]?.hostnames[0] ?? 'api.acme.internal',
            pathPrefix: `/v2/service-${Object.keys(ir.routes).length + 1}`,
            matchType: 'prefix',
            methods: ['GET', 'POST'],
            priority: 75,
            enabled: true,
            middlewares: [],
            targets: firstUpstream ? [{ upstreamId: firstUpstream, weight: 100, label: 'Primary' }] : [],
          });
          setActiveView('routes');
        },
      },
      {
        id: 'act-tracer',
        group: 'Actions',
        label: 'Toggle Live Request Tracer & Chaos Sandbox',
        hint: 'Cmd+J',
        action: () => setTracerOpen(true),
      },
      {
        id: 'act-plugin',
        group: 'Actions',
        label: 'Register Custom Middleware Plugin',
        hint: 'JSON Schema',
        action: () => {
          setActiveView('policies');
          setCustomPluginModalOpen(true);
        },
      },
    ];

    PRESET_ARCHITECTURES.forEach((p) => {
      list.push({
        id: `preset-${p.id}`,
        group: 'Presets',
        label: `Load Preset: ${p.name}`,
        hint: 'Architecture',
        action: () => loadPreset(p.id),
      });
    });

    adapterRegistry.list().forEach((a) => {
      list.push({
        id: `adapter-${a.id}`,
        group: 'Adapters',
        label: `Switch Compiler Adapter: ${a.name}`,
        hint: a.fileName,
        action: () => setActiveAdapterId(a.id),
      });
    });

    Object.values(ir.routes).forEach((rt) => {
      list.push({
        id: `rt-${rt.id}`,
        group: 'Routes',
        label: `${rt.name} (${rt.host}${rt.pathPrefix})`,
        hint: 'Route',
        action: () => {
          setSelection({ type: 'route', id: rt.id });
          setActiveView('topology');
        },
      });
    });

    Object.values(ir.upstreams).forEach((ups) => {
      list.push({
        id: `ups-${ups.id}`,
        group: 'Upstreams',
        label: `${ups.name} (${ups.lbAlgorithm})`,
        hint: `${ups.endpoints.length} endpoints`,
        action: () => {
          setSelection({ type: 'upstream', id: ups.id });
          setActiveView('upstreams');
        },
      });
    });

    Object.values(ir.certificates).forEach((cert) => {
      list.push({
        id: `cert-${cert.id}`,
        group: 'TLS',
        label: `${cert.name} (${cert.commonName})`,
        hint: cert.algorithm,
        action: () => {
          setSelection({ type: 'certificate', id: cert.id });
          setActiveView('security');
        },
      });
    });

    return list;
  }, [
    ir,
    addRoute,
    setActiveView,
    setTracerOpen,
    setCustomPluginModalOpen,
    loadPreset,
    setActiveAdapterId,
    setSelection,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 14);
    return items
      .filter(
        (i) =>
          i.label.toLowerCase().includes(q) ||
          i.group.toLowerCase().includes(q) ||
          i.hint.toLowerCase().includes(q)
      )
      .slice(0, 14);
  }, [items, query]);

  if (!commandPaletteOpen) return null;

  const runSelected = (item: CommandItem | undefined) => {
    if (!item) return;
    item.action();
    setCommandPaletteOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-start justify-center pt-24 px-4"
      onClick={() => setCommandPaletteOpen(false)}
    >
      <div
        className="w-full max-w-xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <Search className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setCommandPaletteOpen(false);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIdx((idx) => Math.min(filtered.length - 1, idx + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIdx((idx) => Math.max(0, idx - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                runSelected(filtered[selectedIdx]);
              }
            }}
            placeholder="Jump to route, upstream, adapter, preset, or action..."
            className="w-full bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder-slate-500 focus:outline-none"
          />
          <span className="text-[11px] font-mono text-slate-500 shrink-0">ESC</span>
        </div>

        <div className="max-h-80 overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No matching resources or commands.
            </div>
          ) : (
            filtered.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                onMouseEnter={() => setSelectedIdx(idx)}
                onClick={() => runSelected(item)}
                className={`w-full flex items-center justify-between gap-4 px-4 py-2 text-left text-xs transition-colors ${
                  idx === selectedIdx
                    ? 'bg-blue-50 dark:bg-sky-500/15 text-blue-800 dark:text-sky-200'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/50'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-[11px] font-mono text-slate-500 w-16 shrink-0">
                    {item.group}
                  </span>
                  <span className="truncate font-medium">{item.label}</span>
                </div>
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 shrink-0">{item.hint}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
