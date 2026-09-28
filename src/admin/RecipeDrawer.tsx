/**
 * One recipe, line by line, in a panel over the right of the page: each line
 * as published, the grams it came to and the USDA food it matched, grouped the
 * way the source grouped them. Opened from a chart; the line that was clicked
 * is marked. The numbers come from /api/admin/recipe, which reads each line the
 * way the comparison does.
 */

import { useEffect, useRef, useState } from "react";
import type { RecipeDetail } from "../lib/recipe-detail";

interface RecipeDrawerProps {
  dish: string;
  recipeId: string;
  /** The published line to mark, when the click landed on one ingredient. */
  highlight: string | null;
  onClose: () => void;
}

type Outcome = { key: string; detail: RecipeDetail } | { key: string; error: string };

const grams = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const sectionName = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function RecipeDrawer({ dish, recipeId, highlight, onClose }: RecipeDrawerProps) {
  const key = `${dish}\n${recipeId}`;
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    let stale = false;
    fetch(`/api/admin/recipe/${dish}?id=${encodeURIComponent(recipeId)}`)
      .then(async (r) => {
        const body = (await r.json()) as RecipeDetail | { error: string };
        if (!r.ok) throw new Error("error" in body ? body.error : `HTTP ${r.status}`);
        if (!stale) setOutcome({ key, detail: body as RecipeDetail });
      })
      .catch((e: unknown) => {
        if (!stale) setOutcome({ key, error: e instanceof Error ? e.message : "Could not load the recipe" });
      });
    return () => { stale = true; };
  }, [dish, recipeId, key]);

  // Focus starts on the close button, and Escape closes, so the keyboard can
  // always find its way back out.
  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key]);

  const current = outcome?.key === key ? outcome : null;
  const detail = current && "detail" in current ? current.detail : null;

  return (
    <aside className="drawer" role="dialog" aria-label={detail ? `Recipe: ${detail.siteName}` : "Recipe"}>
      <header className="drawer__head">
        <div>
          <h3>{detail?.siteName ?? "Loading…"}</h3>
          {detail && <p className="muted">{detail.sourceTitle}{detail.author ? ` · ${detail.author}` : ""}</p>}
          {detail?.sourceUrl && <a href={detail.sourceUrl} target="_blank" rel="noreferrer noopener">Open the source</a>}
        </div>
        <button ref={closeButton} type="button" className="drawer__close" aria-label="Close" onClick={onClose}>×</button>
      </header>

      {current && "error" in current && <p className="failure" role="alert">{current.error}</p>}

      {detail?.sections.map((section, k) => (
        <section key={section.name ?? k} className="drawer__section">
          {section.name && <h4>{sectionName(section.name)}</h4>}
          <table className="drawer__lines">
            <tbody>
              {section.lines.map((l, i) => (
                <tr key={i} className={l.line === highlight ? "is-highlighted" : undefined}>
                  <td>
                    {l.line}
                    <span className="drawer__food">{l.food ?? "not resolved"}</span>
                  </td>
                  <td className="drawer__grams">{l.grams === null ? "—" : `${grams.format(l.grams)} g`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </aside>
  );
}
