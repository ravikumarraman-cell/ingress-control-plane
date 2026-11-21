import { useState } from "react";

export interface SupervisorRevisePanelProps {
  iteration: number;
  maxIterations: number;
  currentPort: number;
  isPending: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onSubmit: (payload: { instruction: string; backendPort?: number }) => void;
}

export function SupervisorRevisePanel({
  iteration,
  maxIterations,
  currentPort,
  isPending,
  errorMessage,
  onCancel,
  onSubmit,
}: SupervisorRevisePanelProps) {
  const [instruction, setInstruction] = useState("");
  const [portText, setPortText] = useState("");

  const handleSubmit = () => {
    const portNum = Number(portText);
    onSubmit({
      instruction: instruction.trim(),
      backendPort:
        portText.trim() && Number.isFinite(portNum) && portNum > 0 ? portNum : undefined,
    });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">
          Supervisor Agent Feedback Loop (Iteration {iteration}/{maxIterations})
        </h2>
        <p className="text-xs text-slate-500">
          Steer the agents with new instructions or parameter tweaks—re-runs Phase A & B and seals a
          fresh ChangePlan & RollbackPlan.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <input
          type="text"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="e.g., Switch backend port to 9443 and verify strict TLS posture"
          className="md:col-span-3 px-3 py-2 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
        />
        <input
          type="number"
          min={1}
          max={65535}
          value={portText}
          onChange={(e) => setPortText(e.target.value)}
          placeholder={`Port override (now ${currentPort})`}
          className="px-3 py-2 text-xs font-mono border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 tabular-nums"
        />
      </div>
      {errorMessage && <p className="text-xs text-red-700">{errorMessage}</p>}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={instruction.trim().length < 4 || isPending}
          onClick={handleSubmit}
          className="px-4 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50"
        >
          {isPending ? "Re-Planning..." : "Re-Run Agents"}
        </button>
      </div>
    </div>
  );
}
