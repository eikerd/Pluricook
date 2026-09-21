/**
 * What counts as a hand-entered recipe, and how many a host already has.
 *
 * Two capture methods put a person rather than a fetcher between the page and
 * the corpus: `manual-transcription` and `personal-collection`. A host's
 * `manualCap` limits the PUBLIC total of both together. Counting them in two
 * places with two definitions let a personal import and a manual entry each
 * consume a full cap, doubling the limit the cap exists to enforce.
 */

import type { ExtractedRecipe } from "../types/provenance";

export function isHandEntered(r: ExtractedRecipe): boolean {
  return r.provenance.method === "manual-transcription" ||
    r.provenance.method === "personal-collection";
}

/**
 * Public hand-entered recipes already held from one host.
 *
 * Private records are excluded: the cap governs what is published from a source,
 * and the owner's private notes are not published. `exceptIdPrefix` leaves out
 * records a re-import is about to replace, so correcting a sheet is not refused
 * for being over a cap it is not actually adding to.
 */
export function countPublicHandEntered(
  recipes: ExtractedRecipe[],
  host: string,
  exceptIdPrefix?: string,
): number {
  return recipes.filter(
    (r) =>
      isHandEntered(r) &&
      r.provenance.host === host &&
      (r.visibility ?? "public") === "public" &&
      !(exceptIdPrefix && r.id.startsWith(exceptIdPrefix)),
  ).length;
}
