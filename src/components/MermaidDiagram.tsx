import { useEffect, useId, useRef, useState } from "react";
import mermaid from "mermaid";
import { Check, Copy, Maximize2, Minimize2 } from "lucide-react";

let mermaidInitialized = false;

function sanitizeSvgToElement(svgText: string): SVGElement | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const svgEl = doc.documentElement;
  if (!svgEl || svgEl.tagName.toLowerCase() !== "svg") {
    return null;
  }
  const scripts = svgEl.querySelectorAll("script, foreignObject");
  scripts.forEach((el) => {
    if (el.tagName.toLowerCase() === "script") {
      el.remove();
    }
  });
  const allElements = svgEl.querySelectorAll("*");
  allElements.forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.toLowerCase().startsWith("on")) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return svgEl as unknown as SVGElement;
}

export function MermaidDiagram({
  title,
  code,
}: {
  title: string;
  code: string;
}) {
  const reactId = useId().replace(/:/g, "_");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    if (!code.trim()) {
      setRendering(false);
      return;
    }

    if (!mermaidInitialized) {
      mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        securityLevel: "strict",
        themeVariables: {
          fontFamily: "DM Sans, sans-serif",
          fontSize: "13px",
          primaryColor: "#eff6ff",
          primaryBorderColor: "#2563eb",
          primaryTextColor: "#0f172a",
          lineColor: "#64748b",
        },
      });
      mermaidInitialized = true;
    }

    const renderDiagram = async () => {
      try {
        setRendering(true);
        const result = await mermaid.render(`mermaid_${reactId}_${Date.now()}`, code);
        if (!active) return;
        const cleanSvg = sanitizeSvgToElement(result.svg);
        if (containerRef.current && cleanSvg) {
          containerRef.current.replaceChildren(document.importNode(cleanSvg, true));
        }
        setError(null);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to render Mermaid diagram.");
        }
      } finally {
        if (active) setRendering(false);
      }
    };

    renderDiagram();
    return () => {
      active = false;
    };
  }, [code, reactId]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-slate-200 bg-slate-50">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-600" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? "Copied Mermaid" : "Copy Source"}
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            {expanded ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
            {expanded ? "Compact View" : "Expand Diagram"}
          </button>
        </div>
      </div>
      <div
        className={`p-5 overflow-auto bg-white ${
          expanded ? "max-h-[900px]" : "max-h-[560px]"
        }`}
      >
        {error ? (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md p-3 font-mono">
            Mermaid Render Error: {error}
          </div>
        ) : (
          <>
            {rendering && (
              <div className="py-12 text-center text-xs text-slate-500">
                Rendering Mermaid diagram...
              </div>
            )}
            <div
              ref={containerRef}
              className="min-w-[680px] flex justify-center [&>svg]:max-w-full [&>svg]:h-auto"
            />
          </>
        )}
      </div>
    </div>
  );
}
