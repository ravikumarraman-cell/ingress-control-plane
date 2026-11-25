import React from 'react';
import { JsonSchemaProperty, PluginJsonSchema } from '../../core/ir/types';

interface SchemaDrivenFormProps {
  schema: PluginJsonSchema;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  compact?: boolean;
}

export const SchemaDrivenForm: React.FC<SchemaDrivenFormProps> = ({
  schema,
  value,
  onChange,
  compact = false,
}) => {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  const handleFieldChange = (key: string, nextVal: unknown) => {
    onChange({ ...value, [key]: nextVal });
  };

  const renderControl = (key: string, prop: JsonSchemaProperty) => {
    const current = value[key] !== undefined ? value[key] : prop.default;
    const label = prop.title ?? key;
    const isRequired = required.has(key);

    if (prop.type === 'boolean') {
      const checked = Boolean(current);
      return (
        <div
          key={key}
          className="flex items-center justify-between gap-4 py-2 border-b border-slate-200 dark:border-slate-800/70 last:border-b-0"
        >
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <span>{label}</span>
              {isRequired && <span className="text-rose-600 dark:text-rose-400">*</span>}
            </div>
            {prop.description && !compact && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">{prop.description}</p>
            )}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            onClick={() => handleFieldChange(key, !checked)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
              checked
                ? 'bg-sky-500/90 border-sky-400'
                : 'bg-slate-300 dark:bg-slate-800 border-slate-300 dark:border-slate-700'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform duration-150 ${
                checked ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      );
    }

    if (prop.enum && prop.enum.length > 0) {
      return (
        <div key={key} className="space-y-1">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
            {label}
            {isRequired && <span className="text-rose-600 dark:text-rose-400 ml-1">*</span>}
          </label>
          <select
            value={String(current ?? prop.enum[0])}
            onChange={(e) => {
              const raw = e.target.value;
              const typed = prop.type === 'integer' || prop.type === 'number' ? Number(raw) : raw;
              handleFieldChange(key, typed);
            }}
            className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
          >
            {prop.enum.map((opt) => (
              <option key={String(opt)} value={String(opt)}>
                {String(opt)}
              </option>
            ))}
          </select>
          {prop.description && !compact && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">{prop.description}</p>
          )}
        </div>
      );
    }

    if (prop.type === 'integer' || prop.type === 'number') {
      return (
        <div key={key} className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
              {label}
              {isRequired && <span className="text-rose-600 dark:text-rose-400 ml-1">*</span>}
            </label>
            {(prop.minimum !== undefined || prop.maximum !== undefined) && (
              <span className="text-[11px] font-mono tabular-nums text-slate-500">
                {prop.minimum ?? 0}..{prop.maximum ?? '∞'}
              </span>
            )}
          </div>
          <input
            type="number"
            min={prop.minimum}
            max={prop.maximum}
            value={current !== undefined && current !== '' ? Number(current) : ''}
            onChange={(e) => {
              const val = e.target.value === '' ? 0 : Number(e.target.value);
              handleFieldChange(key, val);
            }}
            className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
          />
          {prop.description && !compact && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">{prop.description}</p>
          )}
        </div>
      );
    }

    if (prop.type === 'array') {
      const arrVal = Array.isArray(current) ? current.join(', ') : String(current ?? '');
      return (
        <div key={key} className="space-y-1">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
            {label}
            {isRequired && <span className="text-rose-600 dark:text-rose-400 ml-1">*</span>}
          </label>
          <input
            type="text"
            value={arrVal}
            placeholder="Comma-separated values"
            onChange={(e) =>
              handleFieldChange(
                key,
                e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
              )
            }
            className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
          />
        </div>
      );
    }

    return (
      <div key={key} className="space-y-1">
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
          {label}
          {isRequired && <span className="text-rose-600 dark:text-rose-400 ml-1">*</span>}
        </label>
        <input
          type="text"
          value={String(current ?? '')}
          onChange={(e) => handleFieldChange(key, e.target.value)}
          className="w-full bg-slate-50 dark:bg-[#090D16] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
        />
        {prop.description && !compact && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">{prop.description}</p>
        )}
      </div>
    );
  };

  const entries = Object.entries(properties);
  if (entries.length === 0) {
    return (
      <div className="text-xs text-slate-500 dark:text-slate-400 py-2">
        This plugin exposes no configurable schema fields.
      </div>
    );
  }

  return (
    <div className={compact ? 'space-y-2.5' : 'space-y-3.5'}>
      {entries.map(([key, prop]) => renderControl(key, prop))}
    </div>
  );
};
