/**
 * The switchboard every parsing, matching and extraction rule reports to.
 *
 * The owner, 2026-09-30: score each rule by how often it catches issues, "so
 * we know how good our regexes are". A rule caught something when the line
 * comes out differently with that rule switched off, so every rule needs an
 * id and an off switch. Ids are `kind:name`, the kinds being parse, line,
 * alias (exact), pattern, reject, gap and extract. (Gates, `gate:<denial>`,
 * share the naming but not the switch: see rule-scores.ts.) A rule asks
 * `rule(id)` at the moment it would act:
 *
 *     if (LEADING_BULLET.test(line) && rule("parse:leading-bullet")) { … }
 *
 * Outside a trace every rule is on and nothing is recorded, so the pipeline
 * runs as it always did. The scorer (rule-scores.ts) wraps a line in
 * `traceRules` to learn which rules acted, then again with one switched off.
 *
 * The active trace is module state rather than a parameter: the pipeline is
 * synchronous from parseLine to toGrams, and threading a context through every
 * signature would touch every caller to serve one scorer.
 */

interface Trace {
  disabled: ReadonlySet<string>;
  fired: Set<string>;
}

let active: Trace | null = null;

/** True when rule `id` may act. Within a trace, records that it did. */
export function rule(id: string): boolean {
  if (!active) return true;
  if (active.disabled.has(id)) return false;
  active.fired.add(id);
  return true;
}

/** Run `fn` with the given rules switched off, and report which rules acted. */
export function traceRules<T>(
  fn: () => T,
  disabled: ReadonlySet<string> = new Set(),
): { value: T; fired: Set<string> } {
  const previous = active;
  const trace: Trace = { disabled, fired: new Set() };
  active = trace;
  try {
    return { value: fn(), fired: trace.fired };
  } finally {
    active = previous;
  }
}
