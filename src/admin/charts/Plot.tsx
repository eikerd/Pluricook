/**
 * Plotly, loaded only when a chart is first shown. It is ~4 MB; the rest of the
 * admin must not pay for it.
 */

import { useEffect, useRef, useState } from "react";

export const INK = "#2b211c";
export const PAPRIKA = "#8c2f1e";
export const SAFFRON = "#d99a2b";
export const OLIVE = "#5f6b3c";
export const PLUM = "#6b3a52";
export const LINE = "#e3d6bf";
export const COLORWAY = [PAPRIKA, OLIVE, SAFFRON, PLUM, "#3f6f7a", "#a0522d", "#7a7a3a", "#b0413e"];

/** Low → parchment → high, so "same as baseline" reads as paper. */
export const DIVERGING = [[0, OLIVE], [0.5, "#fbf6ec"], [1, PAPRIKA]];

export interface PlotClick { x: unknown; y: unknown; pointNumber: number; curveNumber: number; customdata?: unknown }

interface PlotProps {
  data: unknown[];
  layout?: Record<string, unknown>;
  height?: number;
  label: string;
  onPointClick?: (p: PlotClick) => void;
  /** A click on a y-axis label, with the label's text. */
  onTickClick?: (label: string) => void;
}

export function Plot({ data, layout, height = 460, label, onPointClick, onTickClick }: PlotProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const clickRef = useRef(onPointClick);
  clickRef.current = onPointClick;
  const tickRef = useRef(onTickClick);
  tickRef.current = onTickClick;
  const ticksClickable = Boolean(onTickClick);

  // Plotly redraws its axes on every resize, so a listener on a label itself
  // would be lost; one on the container catches whichever label is there now.
  useEffect(() => {
    const el = ref.current;
    if (!el || !ticksClickable) return;
    const handler = (e: MouseEvent) => {
      const tick = (e.target as Element | null)?.closest(".ytick");
      if (tick?.textContent) tickRef.current?.(tick.textContent);
    };
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [ticksClickable]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;

    import("plotly.js-dist-min")
      .then(async ({ default: Plotly }) => {
        if (cancelled) return;
        await Plotly.react(
          el,
          data,
          {
            height,
            margin: { l: 60, r: 20, t: 20, b: 60 },
            paper_bgcolor: "rgba(0,0,0,0)",
            plot_bgcolor: "#fff",
            font: { family: "Inter, sans-serif", size: 12, color: INK },
            colorway: COLORWAY,
            ...layout,
          },
          { displaylogo: false, responsive: true },
        );
        const plot = el as unknown as {
          removeAllListeners?: (e: string) => void;
          on?: (e: string, f: (ev: { points: PlotClick[] }) => void) => void;
        };
        plot.removeAllListeners?.("plotly_click");
        plot.on?.("plotly_click", (ev) => { const p = ev.points[0]; if (p) clickRef.current?.(p); });
      })
      .catch((e: unknown) => setFailure(e instanceof Error ? e.message : "The chart library failed to load"));

    return () => { cancelled = true; };
  }, [data, layout, height]);

  useEffect(() => {
    const el = ref.current;
    return () => { if (el) import("plotly.js-dist-min").then(({ default: P }) => P.purge(el)).catch(() => {}); };
  }, []);

  if (failure) return <p className="failure" role="alert">{failure}</p>;
  return <div ref={ref} className={ticksClickable ? "plot plot--ticks" : "plot"} role="img" aria-label={label} />;
}
