import { Plus, Trash2 } from "lucide-react";
import type { OutputFieldDefinition, OutputFieldType } from "../../shared/contracts";

export interface OutputSchemaEditorProps {
  fields: OutputFieldDefinition[];
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<OutputFieldDefinition>) => void;
  onRemove: (index: number) => void;
}

export function OutputSchemaEditor({
  fields,
  onAdd,
  onUpdate,
  onRemove,
}: OutputSchemaEditorProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-slate-700">
          Structured Output Schema (<span className="font-mono">outputSchema</span>)
        </span>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-50 rounded transition-colors"
        >
          <Plus className="h-3 w-3" />
          Add Field
        </button>
      </div>
      <div className="space-y-2">
        {fields.map((field, idx) => (
          <div
            key={idx}
            className="grid grid-cols-12 gap-2 items-center bg-slate-50 border border-slate-200 rounded-md p-2"
          >
            <input
              type="text"
              value={field.key}
              onChange={(e) => onUpdate(idx, { key: e.target.value })}
              placeholder="fieldKey"
              aria-label="Output field key"
              className="col-span-4 px-2 py-1 text-[11px] font-mono bg-white border border-slate-200 rounded"
            />
            <select
              value={field.type}
              onChange={(e) => onUpdate(idx, { type: e.target.value as OutputFieldType })}
              aria-label="Output field type"
              className="col-span-3 px-2 py-1 text-[11px] bg-white border border-slate-200 rounded"
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
              <option value="string[]">string[]</option>
              <option value="object">object</option>
            </select>
            <input
              type="text"
              value={field.description}
              onChange={(e) => onUpdate(idx, { description: e.target.value })}
              placeholder="Field description"
              aria-label="Output field description"
              className="col-span-4 px-2 py-1 text-[11px] bg-white border border-slate-200 rounded"
            />
            <button
              type="button"
              onClick={() => onRemove(idx)}
              aria-label={`Remove ${field.key}`}
              className="col-span-1 flex justify-center text-slate-400 hover:text-red-600 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
