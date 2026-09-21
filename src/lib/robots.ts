/**
 * Clearing a host we have never reviewed, by evidence rather than by default.
 *
 * An unlisted host used to inherit `acquisition: "fetch"`, which made the
 * permission gate open for exactly the sites nobody had looked at — the opposite
 * of what the gate claimed. Flipping the default to "deny" alone would be honest
 * but would stop the search-and-extract workflow dead for every new dish.
 *
 * So an unlisted host is cleared mechanically, and only on positive evidence:
 * its robots.txt must permit a generic crawler on the recipe's path, AND must
 * carry no prohibition language. robots.txt has little legal force of its own
 * (RFC 9309: "not a form of access authorization"), but it is where publishers
 * state their position — People Inc. puts its data-mining and RAG prohibition
 * in the comments — so it is the right place to look before the first request.
 *
 * Anything short of a clean pass stays uncleared and waits for a person.
 */

export interface RobotsVerdict {
  /** Does `User-agent: *` permit this path? */
  genericAllows: boolean;
  /** Does the file state a prohibition in words, as People Inc.'s does? */
  prohibitionLanguage: boolean;
  /** The line that triggered `prohibitionLanguage`, for the record. */
  prohibitionQuote: string | null;
  cleared: boolean;
  reason: string;
}

/**
 * Words that signal a publisher is stating terms, not just routing crawlers.
 * Matched only inside comment lines, where such statements live.
 */
const PROHIBITION =
  /\b(prohibited|not permitted|without (prior )?(written )?permission|data[- ]min(e|ing)|scrap(e|ing)|machine learning|large language model|\bLLM\b|retrieval[- ]augmented|text and data mining)\b/i;

interface Rule { allow: boolean; path: string }

/** Rules that apply to a generic crawler: every `User-agent: *` group. */
function genericRules(text: string): Rule[] {
  const rules: Rule[] = [];
  let agents: string[] = [];
  let sawRule = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (field === "user-agent") {
      // Consecutive User-agent lines share one group; a rule line closes it.
      if (sawRule) { agents = []; sawRule = false; }
      agents.push(value.toLowerCase());
    } else if (field === "allow" || field === "disallow") {
      sawRule = true;
      if (agents.includes("*")) rules.push({ allow: field === "allow", path: value });
    }
  }
  return rules;
}

/** Does a robots path pattern (with `*` and a trailing `$`) match this path? */
function matches(pattern: string, path: string): boolean {
  if (pattern === "") return false;   // an empty Disallow means "nothing is disallowed"
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}

/**
 * Evaluate a robots.txt body for one path.
 *
 * Longest matching rule wins, and Allow wins a tie — RFC 9309's precedence.
 * No matching rule means allowed.
 */
export function evaluateRobots(text: string, path: string): RobotsVerdict {
  const hits = genericRules(text).filter((r) => matches(r.path, path));
  hits.sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  const genericAllows = hits.length === 0 ? true : hits[0]!.allow;

  const quote =
    text
      .split(/\r?\n/)
      .filter((l) => l.trim().startsWith("#"))
      .find((l) => PROHIBITION.test(l))
      ?.replace(/^#\s*/, "")
      .trim() ?? null;

  const cleared = genericAllows && quote === null;
  return {
    genericAllows,
    prohibitionLanguage: quote !== null,
    prohibitionQuote: quote,
    cleared,
    reason: quote !== null
      ? `robots.txt states terms: "${quote.slice(0, 90)}"`
      : genericAllows
        ? "robots.txt permits a generic crawler on this path and states no prohibition"
        : "robots.txt disallows this path for generic crawlers",
  };
}

/**
 * What to conclude when robots.txt could not be read.
 *
 * A 404 means the site publishes no rules, which by convention permits crawling.
 * Anything else — a 403, a timeout, a server error — is not evidence of
 * permission, so the host stays uncleared.
 */
export function verdictForStatus(status: number): RobotsVerdict {
  const none = { prohibitionLanguage: false, prohibitionQuote: null };
  if (status === 404 || status === 410) {
    return { ...none, genericAllows: true, cleared: true, reason: "no robots.txt published" };
  }
  return {
    ...none, genericAllows: false, cleared: false,
    reason: `robots.txt unreadable (HTTP ${status}) — not evidence of permission`,
  };
}
