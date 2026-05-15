import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

let mermaidInitialized = false;

function initMermaid() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    themeVariables: {
      // Global — flowchart nodes use a dark teal
      primaryColor: "#1a3a3a",
      primaryTextColor: "#e4e4e7",
      primaryBorderColor: "#2dd4bf50",
      lineColor: "#71717a",
      secondaryColor: "#1e293b",
      tertiaryColor: "#18181b",
      background: "#18181b",
      mainBkg: "#1a3a3a",
      nodeBorder: "#2dd4bf50",
      clusterBkg: "#0f1d2e",
      clusterBorder: "#1e3a5f",
      titleColor: "#e4e4e7",
      edgeLabelBackground: "#1e1e22",
      textColor: "#e4e4e7",
      // Sequence diagrams — actors use a dark blue
      actorBkg: "#172554",
      actorBorder: "#1d4ed8",
      actorTextColor: "#e4e4e7",
      actorLineColor: "#52525b",
      signalColor: "#e4e4e7",
      signalTextColor: "#e4e4e7",
      labelBoxBkgColor: "#27272a",
      labelBoxBorderColor: "#52525b",
      labelTextColor: "#e4e4e7",
      loopTextColor: "#a1a1aa",
      activationBorderColor: "#52525b",
      activationBkgColor: "#3f3f46",
      sequenceNumberColor: "#18181b",
      noteBkgColor: "#3f3f46",
      noteBorderColor: "#52525b",
      noteTextColor: "#e4e4e7",
    },
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    flowchart: { curve: "basis", padding: 16 },
    sequence: { mirrorActors: false },
  });
  mermaidInitialized = true;
}

let idCounter = 0;

/**
 * Quote node labels that start with `/` or `\` to avoid mermaid interpreting
 * them as parallelogram shape delimiters ([/text/] or [\text\]).
 */
export function fixAmbiguousLabels(src: string): string {
  return src.replace(/\[([/\\])([^\]]*[^/\\])\]/g, '["$1$2"]');
}

export default function MermaidDiagram({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(`mermaid-${Date.now()}-${idCounter++}`);

  useEffect(() => {
    if (!containerRef.current) return;
    initMermaid();

    let cancelled = false;

    // mermaid.render appends a temp <div id="d<id>"> to body. It removes
    // the div on success but leaves it on parse error, pinning the default
    // "Syntax error" SVG to the page. Strip it ourselves.
    const cleanupOrphan = () => {
      document.getElementById("d" + idRef.current)?.remove();
    };

    mermaid
      .render(idRef.current, fixAmbiguousLabels(chart))
      .then(({ svg }) => {
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          // Force dark theme on mermaid SVG elements that ignore themeVariables
          const el = containerRef.current;

          // --- Flowchart: color nodes by subgraph cluster ---
          const clusterPalette = [
            { fill: "#1a2a2a", stroke: "#0e7490", clusterBg: "#0c1f1f", clusterBorder: "#164e63" }, // cyan
            { fill: "#2a1a1a", stroke: "#dc2626", clusterBg: "#1c0f0f", clusterBorder: "#7f1d1d" }, // red
            { fill: "#1a2a1a", stroke: "#16a34a", clusterBg: "#0f1c0f", clusterBorder: "#14532d" }, // green
            { fill: "#172554", stroke: "#1d4ed8", clusterBg: "#0f1730", clusterBorder: "#1e3a5f" }, // blue
            { fill: "#271a2a", stroke: "#9333ea", clusterBg: "#1a0f1f", clusterBorder: "#4c1d95" }, // purple
            { fill: "#2a2a1a", stroke: "#ca8a04", clusterBg: "#1c1c0f", clusterBorder: "#713f12" }, // yellow
          ];
          const neutralNode = { fill: "#1a3a3a", stroke: "#2dd4bf80" }; // teal for root nodes
          const clusters = el.querySelectorAll(".cluster");
          const clusterMap = new Map<string, number>(); // cluster DOM id → palette index
          clusters.forEach((c, i) => {
            clusterMap.set(c.id, i);
            const rect = c.querySelector("rect");
            if (rect) {
              const p = clusterPalette[i % clusterPalette.length];
              rect.style.fill = p.clusterBg;
              rect.style.stroke = p.clusterBorder;
            }
          });
          // Color each node by which cluster it overlaps
          el.querySelectorAll(".node").forEach((n) => {
            const shape = n.querySelector("rect, polygon") as SVGElement | null;
            if (!shape) return;
            const t = n.getAttribute("transform") || "";
            const m = t.match(/translate\(([\d.]+),\s*([\d.]+)\)/);
            if (!m) { shape.style.fill = neutralNode.fill; shape.style.stroke = neutralNode.stroke; return; }
            const nx = +m[1], ny = +m[2];
            let matched = false;
            clusters.forEach((c) => {
              const cr = c.querySelector("rect");
              if (!cr) return;
              const cx = +cr.getAttribute("x")!, cy = +cr.getAttribute("y")!;
              const cw = +cr.getAttribute("width")!, ch = +cr.getAttribute("height")!;
              if (nx > cx && nx < cx + cw && ny > cy && ny < cy + ch) {
                const p = clusterPalette[clusterMap.get(c.id)! % clusterPalette.length];
                shape.style.fill = p.fill;
                shape.style.stroke = p.stroke;
                matched = true;
              }
            });
            if (!matched) { shape.style.fill = neutralNode.fill; shape.style.stroke = neutralNode.stroke; }
          });

          // Sequence diagram section rects — each gets a distinct color
          const sectionPalette = [
            { fill: "#1c0f0f", stroke: "#7f1d1d" },  // red — first section
            { fill: "#0f1c0f", stroke: "#14532d" },  // green — second section
            { fill: "#0f1730", stroke: "#1e3a5f" },  // blue
            { fill: "#1a0f1f", stroke: "#4c1d95" },  // purple
            { fill: "#1c1c0f", stroke: "#713f12" },  // yellow
            { fill: "#0c1f1f", stroke: "#164e63" },  // cyan
          ];
          const sectionRects = Array.from(el.querySelectorAll<SVGRectElement>("rect.rect"));
          // Sort by Y position so visual order matches palette order
          sectionRects.sort((a, b) => +(a.getAttribute("y") || 0) - +(b.getAttribute("y") || 0));
          sectionRects.forEach((r, i) => {
            const p = sectionPalette[i % sectionPalette.length];
            r.style.fill = p.fill;
            r.style.stroke = p.stroke;
          });
          // Actor boxes — each actor gets a distinct hue
          const actorPalette = [
            { fill: "#2a1a1a", stroke: "#b45309", line: "#78350f" },  // amber/warm
            { fill: "#1a2a1a", stroke: "#15803d", line: "#14532d" },  // green
            { fill: "#172554", stroke: "#1d4ed8", line: "#1e3a5f" },  // blue
            { fill: "#1a2a2a", stroke: "#0e7490", line: "#164e63" },  // cyan
            { fill: "#271a2a", stroke: "#7c3aed", line: "#4c1d95" },  // violet
            { fill: "#2a1a24", stroke: "#be185d", line: "#831843" },  // pink
            { fill: "#1a2420", stroke: "#059669", line: "#064e3b" },  // emerald
            { fill: "#2a2a1a", stroke: "#a16207", line: "#713f12" },  // yellow
          ];
          // Collect unique actor indices — actors appear as top + bottom pairs
          const actorRects = el.querySelectorAll<SVGRectElement>("rect.actor");
          const actorLines = el.querySelectorAll<SVGLineElement>("line[class*='actor-line']");
          const actorCount = actorLines.length; // one lifeline per actor
          actorRects.forEach((r, i) => {
            const actorIdx = i % actorCount;
            const p = actorPalette[actorIdx % actorPalette.length];
            r.style.fill = p.fill;
            r.style.stroke = p.stroke;
          });
          // Actor lifelines — match their actor color
          actorLines.forEach((l, i) => {
            const p = actorPalette[i % actorPalette.length];
            l.style.stroke = p.stroke;
            l.style.opacity = "0.6";
            l.style.strokeWidth = "1.5";
          });
          // Note boxes — dark teal
          el.querySelectorAll<SVGRectElement>("rect.note").forEach((r) => {
            r.setAttribute("fill", "#1a3a3a");
            r.setAttribute("stroke", "#2dd4bf50");
          });
          // All text in the SVG
          el.querySelectorAll<SVGTextElement>("text").forEach((t) => {
            t.setAttribute("fill", "#e4e4e7");
          });
          // Note text slightly dimmer
          el.querySelectorAll<SVGTextElement>(".noteText").forEach((t) => {
            t.setAttribute("fill", "#a1a1aa");
          });
          // Lines
          el.querySelectorAll<SVGLineElement>("line").forEach((l) => {
            if (l.getAttribute("stroke") !== "none") {
              l.setAttribute("stroke", "#52525b");
            }
          });
          // Activation bars — try to match the actor they sit on
          el.querySelectorAll<SVGRectElement>("rect.activation0, rect.activation1, rect.activation2").forEach((r) => {
            // Find which actor lifeline this activation overlaps by x position
            const rx = parseFloat(r.getAttribute("x") || "0") + parseFloat(r.getAttribute("width") || "0") / 2;
            let closest = 0;
            let minDist = Infinity;
            actorLines.forEach((l, i) => {
              const lx = parseFloat(l.getAttribute("x1") || "0");
              const d = Math.abs(lx - rx);
              if (d < minDist) { minDist = d; closest = i; }
            });
            const p = actorPalette[closest % actorPalette.length];
            r.setAttribute("fill", p.line);
            r.setAttribute("stroke", p.stroke);
          });
          // Signal arrows — color by source actor
          // Collect actor lifeline X positions for matching
          const actorXPositions: number[] = [];
          actorLines.forEach((l) => {
            actorXPositions.push(parseFloat(l.getAttribute("x1") || "0"));
          });
          const findSourceActor = (x: number): number => {
            let closest = 0;
            let minDist = Infinity;
            actorXPositions.forEach((ax, i) => {
              const d = Math.abs(ax - x);
              if (d < minDist) { minDist = d; closest = i; }
            });
            return closest;
          };
          // For dotted (response) lines, brighten the actor color
          const brightenColor = (hex: string): string => {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            // Lighten by mixing 40% toward white
            return `rgb(${Math.round(r + (255 - r) * 0.4)}, ${Math.round(g + (255 - g) * 0.4)}, ${Math.round(b + (255 - b) * 0.4)})`;
          };
          // Helper: get or create a marker clone for a given color, for a given attr
          const markerCache = new Map<string, string>();
          const recolorMarker = (line: SVGLineElement, attr: string, color: string): void => {
            const markerUrl = line.getAttribute(attr);
            if (!markerUrl) return;
            const id = markerUrl.replace(/^url\(#|\)$/g, "");
            const cacheKey = `${id}-${color.replace(/[^a-zA-Z0-9]/g, "")}`;
            if (markerCache.has(cacheKey)) {
              line.setAttribute(attr, `url(#${markerCache.get(cacheKey)})`);
              return;
            }
            const orig = el.querySelector(`#${CSS.escape(id)}`);
            if (!orig) return;
            const cloneId = cacheKey;
            const clone = orig.cloneNode(true) as SVGMarkerElement;
            clone.id = cloneId;
            clone.querySelectorAll("path, circle, polygon, line").forEach((c) => {
              (c as HTMLElement).style.setProperty("fill", color, "important");
              (c as HTMLElement).style.setProperty("stroke", color, "important");
            });
            orig.parentNode!.appendChild(clone);
            markerCache.set(cacheKey, cloneId);
            line.setAttribute(attr, `url(#${cloneId})`);
          };
          const colorLineMarkers = (line: SVGLineElement, color: string): void => {
            recolorMarker(line, "marker-end", color);
            recolorMarker(line, "marker-start", color);
          };
          // Color solid message lines (requests/calls) by source actor
          el.querySelectorAll<SVGLineElement>("line.messageLine0").forEach((l) => {
            const x1 = parseFloat(l.getAttribute("x1") || "0");
            const srcIdx = findSourceActor(x1);
            const p = actorPalette[srcIdx % actorPalette.length];
            l.style.stroke = p.stroke;
            colorLineMarkers(l, p.stroke);
          });
          // Color dotted message lines (responses/returns) — brightened source actor color
          el.querySelectorAll<SVGLineElement>("line.messageLine1").forEach((l) => {
            const x1 = parseFloat(l.getAttribute("x1") || "0");
            const srcIdx = findSourceActor(x1);
            const p = actorPalette[srcIdx % actorPalette.length];
            const muted = brightenColor(p.stroke);
            l.style.stroke = muted;
            colorLineMarkers(l, muted);
          });
          // Paths (arrows, connections) — fallback for non-sequence diagrams
          const fallbackColor = "#3b82f6";
          const isSequenceDiagram = actorLines.length > 0;
          el.querySelectorAll<SVGPathElement>("path").forEach((p) => {
            // Skip paths inside markers for sequence diagrams — already colored per-actor
            if (isSequenceDiagram && p.closest("marker")) return;
            const s = p.getAttribute("stroke");
            if (s === "black" || s === "#000000" || s === "#000") {
              p.setAttribute("stroke", fallbackColor);
            }
            const f = p.getAttribute("fill");
            if (f === "black" || f === "#000000" || f === "#000") {
              p.setAttribute("fill", fallbackColor);
            }
          });
          if (!isSequenceDiagram) {
            // Marker arrowheads — only for non-sequence diagrams
            el.querySelectorAll<SVGElement>("marker path, marker circle").forEach((m) => {
              const s = m.getAttribute("stroke");
              if (!s || s === "black" || s === "#000000") (m as HTMLElement).style.stroke = fallbackColor;
              const f = m.getAttribute("fill");
              if (!f || f === "black" || f === "#000000") (m as HTMLElement).style.fill = fallbackColor;
            });
          }
          setError(null);
        }
      })
      .catch((err) => {
        cleanupOrphan();
        if (!cancelled) {
          setError(err?.message || "Failed to render diagram");
        }
      });

    return () => {
      cancelled = true;
      cleanupOrphan();
    };
  }, [chart]);

  if (error) {
    return (
      <div className="rounded border border-red-800 bg-red-950/30 p-4 text-sm text-red-400">
        <p className="mb-2 font-medium">Mermaid render error</p>
        <pre className="whitespace-pre-wrap text-xs">{error}</pre>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-zinc-500">
            Source
          </summary>
          <pre className="mt-1 whitespace-pre-wrap text-xs text-zinc-400">
            {chart}
          </pre>
        </details>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-4 flex justify-center [&_svg]:max-w-full"
    />
  );
}
