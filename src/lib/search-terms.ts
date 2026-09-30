/**
 * Search terms: what people type to find a dish ("Meatloaf Recipe"), each the
 * landing page its recipes attach to.
 *
 * A term's slug is the dish key everything already uses — a recipe's `dish`,
 * its file data/recipes/<slug>.json, the search log's query — so attaching a
 * recipe to a term is naming its dish. The terms live in data/search-terms.json,
 * in version control like curated.json: sources.db is rebuilt from files, and a
 * seed kept only there would be lost on the next rebuild.
 */

export const SEARCH_TERMS_PATH = "data/search-terms.json";

/** The dish-key shape the compare route already holds a dish to. */
export const SLUG = /^[a-z0-9][a-z0-9-]*$/;

export interface SearchTerm {
  /** The key a recipe attaches by, and the landing page's address. */
  slug: string;
  /** The phrase as people search it. */
  term: string;
  /** Place on the ranked list the terms were seeded from; null for a dish of ours it lacks. */
  rank: number | null;
  /** The list's band, e.g. "The Global Staples". */
  group: string | null;
  /** Other names the same page answers to. */
  aliases?: string[];
  note?: string;
}

/** One numbered line of a ranked list, under its band's heading. */
export interface ListedTerm {
  rank: number;
  group: string | null;
  listed: string;
}

/**
 * The owner's call on a line that names two things: two different dishes
 * split into a term each at the same rank; variants of one dish stay one term,
 * the variants kept as its aliases.
 */
export type SlashDecision = { split: string[] } | { term: string; aliases: string[] };

const BAND = /^Rank\s+\d+\s*[–-]\s*\d+\s*:\s*(.+)$/;
const NUMBERED = /^(\d+)\.\s+(.+)$/;

/** "Rank 1 – 20: The Global Staples" opens a band; "1. Pancake Recipe" is a term in it. */
export function parseRankedList(text: string): ListedTerm[] {
  let group: string | null = null;
  const out: ListedTerm[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const band = BAND.exec(line);
    if (band) {
      group = band[1]!.trim();
      continue;
    }
    const item = NUMBERED.exec(line);
    if (item) out.push({ rank: Number(item[1]), group, listed: item[2]!.trim() });
  }
  return out;
}

/** "Pancake Recipe (consistently #1 worldwide)": the aside is a note, not part of the search. */
export function splitNote(listed: string): { term: string; note?: string } {
  const m = /^(.*?)\s*\(([^)]*)\)$/.exec(listed);
  return m ? { term: m[1]!, note: m[2]! } : { term: listed };
}

/** "Shepherd’s Pie Recipe" → "shepherds-pie"; "Crème Brûlée Recipe" → "creme-brulee". */
export function slugOf(term: string): string {
  return term
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // the accents NFD split off
    .replace(/\s+recipes?$/i, "")
    .replace(/['’]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A ranked list as terms, applying a decision to every line that names two things. */
export function termsFromList(list: ListedTerm[], slashes: Record<number, SlashDecision>): SearchTerm[] {
  const out: SearchTerm[] = [];
  for (const { rank, group, listed } of list) {
    const { term, note } = splitNote(listed);
    if (!term.includes("/")) {
      out.push({ slug: slugOf(term), term, rank, group, ...(note ? { note } : {}) });
      continue;
    }
    const decision = slashes[rank];
    if (!decision) throw new Error(`#${rank} "${listed}" names two things and has no decision`);
    const listedAs = `Listed as “${listed}”.`;
    if ("split" in decision) {
      for (const t of decision.split) {
        out.push({ slug: slugOf(t), term: t, rank, group, note: `${listedAs} Different dishes, so a term each.` });
      }
    } else {
      out.push({
        slug: slugOf(decision.term), term: decision.term, rank, group,
        aliases: decision.aliases, note: `${listedAs} One dish; the variants are aliases.`,
      });
    }
  }
  return out;
}

/** Throws, naming every problem, unless each term is one a recipe can attach to. */
export function validateTerms(terms: readonly SearchTerm[]): void {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const t of terms) {
    if (!SLUG.test(t.slug)) problems.push(`"${t.slug}" is not a dish key (${SLUG})`);
    if (seen.has(t.slug)) problems.push(`"${t.slug}" is used by two terms`);
    seen.add(t.slug);
    if (!t.term.trim()) problems.push(`"${t.slug}" has no term`);
    if (t.rank !== null && !(Number.isInteger(t.rank) && t.rank >= 1)) problems.push(`"${t.slug}" has rank ${t.rank}`);
  }
  if (problems.length) throw new Error(`Search terms:\n  ${problems.join("\n  ")}`);
}

export async function readSearchTerms(path = SEARCH_TERMS_PATH): Promise<SearchTerm[]> {
  const { terms } = (await Bun.file(path).json()) as { terms: SearchTerm[] };
  validateTerms(terms);
  return terms;
}
