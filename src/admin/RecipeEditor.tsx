/**
 * Edit a recipe: its credit and source, servings and times, and its sections
 * and lines. Lines are one per row, so moving a line between sections is a cut
 * and a paste. What is saved is a correction beside the published recipe.
 */

import { useState } from "react";
import type { RecipePageData } from "../lib/compare-service";
import { correctionFrom, draftFrom, type Draft } from "./recipe-draft";

interface RecipeEditorProps {
  page: RecipePageData;
  saving: boolean;
  error: string | null;
  /** The correction to save, or null when the draft is the published recipe. */
  onSave: (correction: Record<string, unknown> | null) => void;
  onCancel: () => void;
}

const FIGURES: Array<[keyof Draft & ("servings" | "prepTimeMinutes" | "cookTimeMinutes" | "totalTimeMinutes"), string]> = [
  ["servings", "Serves"],
  ["prepTimeMinutes", "Prep, minutes"],
  ["cookTimeMinutes", "Cook, minutes"],
  ["totalTimeMinutes", "Total, minutes"],
];

export function RecipeEditor({ page, saving, error, onSave, onCancel }: RecipeEditorProps) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(page.detail));
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setSection = (i: number, patch: Partial<Draft["sections"][number]>) =>
    setDraft((d) => ({ ...d, sections: d.sections.map((s, k) => (k === i ? { ...s, ...patch } : s)) }));

  // A removed section's lines join its neighbour, so no ingredient is lost by it.
  const merge = (i: number) =>
    setDraft((d) => {
      const into = i === 0 ? 1 : i - 1;
      const sections = d.sections.map((s, k) =>
        k === into ? { ...s, text: [s.text, d.sections[i]!.text].filter((t) => t.trim() !== "").join("\n") } : s);
      return { ...d, sections: sections.filter((_, k) => k !== i) };
    });

  return (
    <form className="recipe-editor" onSubmit={(e) => { e.preventDefault(); onSave(correctionFrom(draft, page.published)); }}>
      <fieldset>
        <legend>Credit and source</legend>
        <label className="field">
          <span>Title</span>
          <input id="recipe-title" className="picker" required value={draft.sourceTitle} onChange={(e) => set({ sourceTitle: e.target.value })} />
        </label>
        <label className="field">
          <span>Author</span>
          <input id="recipe-author" className="picker" value={draft.author} onChange={(e) => set({ author: e.target.value })} />
        </label>
        <label className="field">
          <span>Source address</span>
          <input id="recipe-url" className="picker" type="url" placeholder="https://" value={draft.sourceUrl}
            onChange={(e) => set({ sourceUrl: e.target.value })} />
        </label>
      </fieldset>

      <fieldset>
        <legend>Servings and times</legend>
        <div className="recipe-editor__figures">
          {FIGURES.map(([key, label]) => (
            <label key={key} className="field">
              <span>{label}</span>
              <input id={`recipe-${key}`} className="picker" inputMode="numeric" value={draft[key]}
                onChange={(e) => set({ [key]: e.target.value } as Partial<Draft>)} />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Ingredients</legend>
        {draft.sections.map((s, i) => (
          <div key={i} className="recipe-editor__section">
            <label className="field">
              <span>Section</span>
              <input id={`recipe-section-${i}`} className="picker" value={s.name}
                placeholder={draft.sections.length === 1 ? "No sections" : "Name this section"}
                onChange={(e) => setSection(i, { name: e.target.value })} />
            </label>
            <label className="field">
              <span>Lines, one per row</span>
              <textarea id={`recipe-lines-${i}`} className="picker recipe-editor__lines" value={s.text}
                rows={Math.max(4, s.text.split("\n").length + 1)} onChange={(e) => setSection(i, { text: e.target.value })} />
            </label>
            {draft.sections.length > 1 && (
              <button type="button" className="button button--quiet" onClick={() => merge(i)}>
                Merge into the section {i === 0 ? "below" : "above"}
              </button>
            )}
          </div>
        ))}
        <button type="button" className="button button--quiet"
          onClick={() => set({ sections: [...draft.sections, { name: "", text: "" }] })}>
          Add a section
        </button>
      </fieldset>

      {error && <p className="failure" role="alert">{error}</p>}
      <div className="recipe-editor__actions">
        <button type="submit" className="button" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        <button type="button" className="button button--quiet" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
}
