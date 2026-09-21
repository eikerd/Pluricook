/**
 * Recipes and the ingredients they list, as a graph. three.js is large, so the
 * whole view — library included — loads only when this tab is opened.
 */

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { recipeLabel, type ViewProps } from "./views";

const ForceGraph3D = lazy(() => import("react-force-graph-3d"));

interface Node { id: string; name: string; kind: "recipe" | "ingredient"; index: number; val: number }
interface Link { source: string; target: string }

export function Network({ m, focus, onPick }: ViewProps) {
  const [hideUbiquitous, setHideUbiquitous] = useState(true);
  const [dims, setDims] = useState<2 | 3>(3);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const graph = useMemo(() => {
    const n = m.recipes.length;
    // An ingredient every recipe lists joins everything to everything and says nothing.
    const keep = m.ingredients.map((_, j) => j).filter((j) => !hideUbiquitous || m.ingredients[j]!.recipeCount < n);
    const nodes: Node[] = [
      ...m.recipes.map((_, i) => ({ id: `r${i}`, name: recipeLabel(m, i), kind: "recipe" as const, index: i, val: i === focus ? 10 : 5 })),
      ...keep.map((j) => ({ id: `i${j}`, name: m.ingredients[j]!.label, kind: "ingredient" as const, index: j, val: 1 + m.ingredients[j]!.recipeCount })),
    ];
    const links: Link[] = [];
    m.values.forEach((row, i) => keep.forEach((j) => { if (row[j] != null) links.push({ source: `r${i}`, target: `i${j}` }); }));
    return { nodes, links, hidden: m.ingredients.length - keep.length };
  }, [m, focus, hideUbiquitous]);

  return (
    <>
      <div className="pickers pickers--inline">
        <label className="check">
          <input type="checkbox" checked={hideUbiquitous} onChange={(e) => setHideUbiquitous(e.target.checked)} />
          Hide ingredients every recipe lists{graph.hidden > 0 ? ` (${graph.hidden})` : ""}
        </label>
        <select className="picker" aria-label="Dimensions" value={dims} onChange={(e) => setDims(Number(e.target.value) as 2 | 3)}>
          <option value={3}>3D</option>
          <option value={2}>2D</option>
        </select>
      </div>
      <div ref={box} className="network" role="img"
        aria-label={`Network of ${m.recipes.length} recipes and ${graph.nodes.length - m.recipes.length} ingredients`}>
        <Suspense fallback={<p className="muted">Loading 3D…</p>}>
          <ForceGraph3D
            key={dims}
            graphData={graph}
            numDimensions={dims}
            width={width}
            height={560}
            backgroundColor="#fbf6ec"
            nodeLabel="name"
            nodeVal="val"
            nodeColor={(o) => {
              const n = o as Node;
              return n.kind === "recipe" ? (n.index === focus ? "#8c2f1e" : "#2b211c") : "#d99a2b";
            }}
            // three.js ignores alpha inside a colour string; opacity is its own prop.
            linkColor={() => "#4a3b33"}
            linkOpacity={0.45}
            linkWidth={1.2}
            onNodeClick={(o) => {
              const n = o as Node;
              if (n.kind !== "ingredient") return;
              const recipe = m.values.findIndex((row) => row[n.index] != null);
              if (recipe >= 0) onPick({ recipe, ingredient: n.index });
            }}
          />
        </Suspense>
      </div>
    </>
  );
}
