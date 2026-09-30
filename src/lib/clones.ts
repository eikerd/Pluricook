/**
 * The owner's own copies of captured recipes, to develop.
 *
 * A clone is a whole recipe of its own: the lines as the owner saw them,
 * corrections included, kept in data/clones/<dish>.json and read beside the
 * dish's captured recipes, so every chart shows it next to its original. It is
 * private, and it is edited directly — there is no published version of it to
 * keep — while `clonedFrom` names the recipe it began as.
 */

import { applyCorrections, readCorrections } from "./corrections";
import type { ExtractedRecipe } from "../types/provenance";

const DIR = "data/clones";
const FILE_COMMENT = [
  "The owner's own copies of captured recipes, to develop. Written by the admin's recipe page and read",
  "beside the dish's captured recipes. Private; clonedFrom names the recipe each began as.",
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "recipe";

export async function readClones(dish: string): Promise<ExtractedRecipe[]> {
  const file = Bun.file(`${DIR}/${dish}.json`);
  if (!(await file.exists())) return [];
  const body = (await file.json()) as { recipes?: ExtractedRecipe[] };
  return body.recipes ?? [];
}

export async function writeClones(dish: string, recipes: ExtractedRecipe[]): Promise<void> {
  await Bun.write(`${DIR}/${dish}.json`, `${JSON.stringify({ _comment: FILE_COMMENT, dish, recipes }, null, 2)}\n`);
}

/**
 * The owner's copy of a recipe, with an id no recipe in the dish holds yet.
 * Pass the recipe as the owner sees it — corrected — since that is what they
 * are copying. Arrays are copied too, so the clone can never edit its original.
 */
export function makeClone(original: ExtractedRecipe, dish: string, taken: ReadonlySet<string>, today: string): ExtractedRecipe {
  const base = `mine:${dish}:${slug(original.provenance.siteName)}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;

  return {
    ...original,
    id,
    dish,
    ingredientLines: [...original.ingredientLines],
    sections: original.sections?.map((s) => ({ name: s.name, ingredientLines: [...s.ingredientLines] })),
    visibility: "private",
    visibilityReason: `your own copy of ${original.provenance.siteName}'s recipe`,
    clonedFrom: original.id,
    provenance: {
      host: null,
      siteName: `Mine · ${original.provenance.siteName}`,
      sourceUrl: null,
      author: null,
      sourceTitle: original.provenance.sourceTitle,
      capturedAt: today,
      method: "owner-copy",
      acquisitionAtCapture: original.provenance.acquisitionAtCapture,
      licence: null,
    },
  };
}

/**
 * A dish's recipes as the owner has them: the captured ones with their
 * corrections applied, then the owner's own copies. Everything that reads a
 * dish reads it through here, so no two readers can disagree.
 */
export async function ownersView(dish: string, published: ExtractedRecipe[]): Promise<ExtractedRecipe[]> {
  return [...applyCorrections(published, await readCorrections(dish)), ...(await readClones(dish))];
}
