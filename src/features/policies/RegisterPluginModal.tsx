import React, { useState } from 'react';
import { X } from 'lucide-react';
import { MiddlewarePlugin, PluginJsonSchema } from '../../core/ir/types';
import { useControlPlane } from '../../store/ControlPlaneContext';

const EXAMPLE_SCHEMA = JSON.stringify(
  {
    type: 'object',
    title: 'Geo-Fence & Bot Guard',
    required: ['blockedCountries', 'challengeScore'],
    properties: {
      blockedCountries: {
        type: 'string',
        title: 'Blocked ISO Country Codes',
        description: 'Comma-separated country codes rejected at the edge.',
        default: 'KP,IR',
      },
      challengeScore: {
        type: 'integer',
        title: 'Bot Risk Threshold',
        description: 'Requests exceeding this score receive a 403 block.',
        default: 75,
        minimum: 1,
        maximum: 100,
      },
      actionMode: {
        type: 'string',
        title: 'Action Mode',
        enum: ['block', 'shadow-log'],
        default: 'block',
      },
      enforceAsnLookup: {
        type: 'boolean',
        title: 'Enable ASN Reputation Lookup',
        default: true,
      },
    },
  },
  null,
  2
);

const EXAMPLE_DEFAULTS = JSON.stringify(
  {
    blockedCountries: 'KP,IR',
    challengeScore: 75,
    actionMode: 'block',
    enforceAsnLookup: true,
  },
  null,
  2
);

export const RegisterPluginModal: React.FC = () => {
  const { customPluginModalOpen, setCustomPluginModalOpen, registerCustomPlugin, ir } =
    useControlPlane();

  const [pluginId, setPluginId] = useState('geo-fence-guard');
  const [pluginName, setPluginName] = useState('Geo-Fence & Bot Guard');
  const [description, setDescription] = useState(
    'Custom edge plugin enforcing ISO country blocking and ASN risk scoring.'
  );
  const [schemaText, setSchemaText] = useState(EXAMPLE_SCHEMA);
  const [defaultText, setDefaultText] = useState(EXAMPLE_DEFAULTS);
  const [error, setError] = useState<string | null>(null);

  if (!customPluginModalOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanId = pluginId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-');
    if (!cleanId) {
      setError('Plugin ID is required.');
      return;
    }
    if (ir.plugins[cleanId]) {
      setError(`Plugin ID "${cleanId}" is already registered.`);
      return;
    }

    let parsedSchema: PluginJsonSchema;
    let parsedDefaults: Record<string, unknown>;
    try {
      parsedSchema = JSON.parse(schemaText) as PluginJsonSchema;
      if (!parsedSchema || parsedSchema.type !== 'object' || !parsedSchema.properties) {
        setError('JSON Schema must be an object with a "type": "object" and "properties" map.');
        return;
      }
    } catch (err) {
      setError(`Invalid JSON Schema: ${err instanceof Error ? err.message : 'parse error'}`);
      return;
    }

    try {
      parsedDefaults = JSON.parse(defaultText) as Record<string, unknown>;
      if (!parsedDefaults || typeof parsedDefaults !== 'object' || Array.isArray(parsedDefaults)) {
        setError('Default Config must be a JSON object.');
        return;
      }
    } catch (err) {
      setError(`Invalid Default Config JSON: ${err instanceof Error ? err.message : 'parse error'}`);
      return;
    }

    const plugin: MiddlewarePlugin = {
      id: cleanId,
      name: pluginName.trim() || cleanId,
      category: 'custom',
      description: description.trim() || 'Hot-registered custom middleware plugin.',
      builtIn: false,
      schema: parsedSchema,
      defaultConfig: parsedDefaults,
    };

    registerCustomPlugin(plugin);
    setCustomPluginModalOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={() => setCustomPluginModalOpen(false)}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Register Custom Middleware Plugin"
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Register Custom Plugin</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Hot-register a JSON Schema middleware into the control plane and all proxy adapters.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCustomPluginModalOpen(false)}
            className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4">
          {error && (
            <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300">Plugin ID</label>
              <input
                type="text"
                value={pluginId}
                onChange={(e) => setPluginId(e.target.value)}
                placeholder="custom-tenant-tagger"
                className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300">Display Name</label>
              <input
                type="text"
                value={pluginName}
                onChange={(e) => setPluginName(e.target.value)}
                placeholder="Geo-Fence & Bot Guard"
                className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300">
                JSON Schema Definition
              </label>
              <textarea
                rows={11}
                value={schemaText}
                onChange={(e) => setSchemaText(e.target.value)}
                className="w-full bg-slate-50 dark:bg-[#070A12] border border-slate-200 dark:border-slate-800 rounded-md p-2.5 text-[11px] font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:border-sky-400"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300">
                Default Configuration JSON
              </label>
              <textarea
                rows={11}
                value={defaultText}
                onChange={(e) => setDefaultText(e.target.value)}
                className="w-full bg-slate-50 dark:bg-[#070A12] border border-slate-200 dark:border-slate-800 rounded-md p-2.5 text-[11px] font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:border-sky-400"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => {
                setPluginId(`custom-plugin-${Object.keys(ir.plugins).length + 1}`);
                setSchemaText(EXAMPLE_SCHEMA);
                setDefaultText(EXAMPLE_DEFAULTS);
                setError(null);
              }}
              className="text-xs text-blue-600 dark:text-sky-400 hover:text-blue-700 dark:hover:text-sky-300 transition-colors"
            >
              Reset Example Template
            </button>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setCustomPluginModalOpen(false)}
                className="px-3.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-md bg-sky-500 text-slate-950 hover:bg-sky-400 text-xs font-semibold transition-colors"
              >
                Register Plugin
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
