/**
 * Equivalent USDA foods: ingredients one cook would swap for another, folded
 * into one USDA food so the comparison counts them as one.
 *
 * The matcher sends each line to its closest USDA record, so four lentil soups
 * that all use broth land on four records — vegetable broth, chicken-vegetable,
 * beef stock, a Swanson — and a chart draws four bands where a cook sees one.
 * A group names one USDA food and the ones it stands in for; the comparison
 * clusters by that food. Each line keeps its own match for its grams and its
 * sodium, so only the grouping changes, never a figure.
 *
 * The groups live in data/ingredients/equivalents.json, beside the aliases:
 * decisions, tracked, each with its reason.
 */

const EQUIVALENTS_PATH = "data/ingredients/equivalents.json";

export interface EquivalentGroup {
  name: string;
  /** The USDA food the group is counted as. */
  fdcId: number;
  /** USDA foods counted as it. */
  members: number[];
  note: string;
}

export interface EquivalentsFile {
  groups: EquivalentGroup[];
}

/** Member fdc id → the fdc id it is counted as. A food in no group is absent. */
export type Equivalents = ReadonlyMap<number, number>;

const isId = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;

/**
 * The lookup, refusing a file that could fold one food two ways: a food in two
 * groups, or a group's own food listed as another's member — which would make
 * the answer depend on the order the groups were read.
 */
export function buildEquivalents(file: EquivalentsFile): Equivalents {
  const map = new Map<number, number>();
  const groupOf = new Map<number, string>();
  const heads = new Map(file.groups.map((g) => [g.fdcId, g.name]));

  for (const g of file.groups) {
    if (!isId(g.fdcId)) throw new Error(`Equivalents group "${g.name}" has no USDA fdcId.`);
    for (const m of g.members) {
      if (!isId(m)) throw new Error(`Equivalents group "${g.name}" lists ${JSON.stringify(m)}, which is not an fdc id.`);
      if (groupOf.has(m)) throw new Error(`USDA food ${m} is in two equivalents groups: "${groupOf.get(m)}" and "${g.name}".`);
      if (heads.has(m)) throw new Error(`USDA food ${m} is the food of group "${heads.get(m)}" and a member of "${g.name}".`);
      groupOf.set(m, g.name);
      map.set(m, g.fdcId);
    }
  }
  return map;
}

export async function readEquivalents(path = EQUIVALENTS_PATH): Promise<Equivalents> {
  const file = Bun.file(path);
  if (!(await file.exists())) return new Map();
  return buildEquivalents((await file.json()) as EquivalentsFile);
}
