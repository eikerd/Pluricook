import { describe, expect, test } from "bun:test";
import {
  canonicalUrl,
  canonicalHost,
  deriveStance,
  openRegistry,
  recordFetchAttempt,
  recordSearchAppearance,
  setTrusted,
  siteStats,
  upsertPolicy,
} from "./site-registry";

const AT = "2026-09-20";

function freshDb() {
  return openRegistry(":memory:");
}

describe("canonicalHost", () => {
  test("strips www so one site does not become two records", () => {
    expect(canonicalHost("https://www.budgetbytes.com/classic-homemade-meatloaf/"))
      .toBe("budgetbytes.com");
    expect(canonicalHost("https://budgetbytes.com/other/")).toBe("budgetbytes.com");
  });

  test("lowercases and accepts a bare host", () => {
    expect(canonicalHost("WWW.Delish.COM")).toBe("delish.com");
  });

  test("keeps subdomains that are not www", () => {
    expect(canonicalHost("https://cooking.nytimes.com/recipes/1")).toBe(
      "cooking.nytimes.com",
    );
  });
});

describe("deriveStance", () => {
  test("a written prohibition outranks a permissive robots.txt", () => {
    // The People Inc. case: generic crawling allowed, data mining prohibited.
    expect(
      deriveStance({
        robotsGenericAllows: true,
        aiCrawlersBlocked: ["anthropic-ai"],
        writtenProhibition: true,
      }),
    ).toBe("prohibited");
  });

  test("named AI bans alone are ai-blocked, not prohibited", () => {
    expect(
      deriveStance({
        robotsGenericAllows: true,
        aiCrawlersBlocked: ["anthropic-ai", "CCbot"],
        writtenProhibition: false,
      }),
    ).toBe("ai-blocked");
  });

  test("permissive with no bans is open", () => {
    expect(
      deriveStance({
        robotsGenericAllows: true,
        aiCrawlersBlocked: [],
        writtenProhibition: false,
      }),
    ).toBe("open");
  });

  test("unchecked is unknown, never assumed open", () => {
    expect(deriveStance(null)).toBe("unknown");
    expect(
      deriveStance({
        robotsGenericAllows: null,
        aiCrawlersBlocked: [],
        writtenProhibition: false,
      }),
    ).toBe("unknown");
  });
});

describe("accumulating across searches", () => {
  test("a host seen in two dishes counts two appearances and one site", () => {
    const db = freshDb();
    recordSearchAppearance(db, {
      url: "https://www.delish.com/a/meatloaf/", query: "meatloaf",
      rank: 12, kind: "recipe", seenAt: AT,
    });
    recordSearchAppearance(db, {
      url: "https://delish.com/a/carbonara/", query: "carbonara",
      rank: 3, kind: "recipe", seenAt: "2026-09-21",
    });

    const [row] = siteStats(db);
    expect(row!.host).toBe("delish.com");
    expect(row!.queries).toBe(2);
    expect(row!.appearances).toBe(2);
    expect(row!.bestRank).toBe(3);
    expect(row!.medianRank).toBe(7.5);
    expect(row!.lastSeenAt).toBe("2026-09-21");
  });

  test("re-importing the same observation does not double the counts", () => {
    const db = freshDb();
    const appearance = {
      url: "https://natashaskitchen.com/meatloaf-recipe/", query: "meatloaf",
      rank: 1, kind: "recipe" as const, seenAt: AT,
    };
    recordSearchAppearance(db, appearance);
    recordSearchAppearance(db, appearance);

    expect(siteStats(db)[0]!.appearances).toBe(1);
  });
});

describe("fetch statistics", () => {
  test("reach and JSON-LD rates are computed over the right denominators", () => {
    const db = freshDb();
    const base = {
      url: "https://example.com/r/", fetcher: "raw" as const, cdn: null,
      bodyBytes: null, elapsedMs: null, ingredientCount: null, stepCount: null,
      yieldRaw: null, totalTimeRaw: null, note: null, attemptedAt: AT,
    };
    // Two ok (one with JSON-LD), one blocked — three different pages, since two
    // attempts identical in every keyed field are now, correctly, one attempt.
    recordFetchAttempt(db, { ...base, url: "https://example.com/a/", status: 200, outcome: "ok", jsonLd: true });
    recordFetchAttempt(db, { ...base, url: "https://example.com/b/", status: 200, outcome: "ok", jsonLd: false });
    recordFetchAttempt(db, { ...base, url: "https://example.com/c/", status: 403, outcome: "blocked", jsonLd: false });

    const [row] = siteStats(db);
    expect(row!.fetches).toBe(3);
    expect(row!.ok).toBe(2);
    expect(row!.blocked).toBe(1);
    expect(row!.reachRate).toBeCloseTo(0.67, 2); // ok / all attempts
    expect(row!.jsonLdRate).toBeCloseTo(0.5, 2); // JSON-LD / ok only
  });

  test("a managed success after a raw block counts as a rescue", () => {
    const db = freshDb();
    const base = {
      url: "https://preppykitchen.com/meatloaf/", cdn: null, bodyBytes: null,
      elapsedMs: null, ingredientCount: null, stepCount: null, yieldRaw: null,
      totalTimeRaw: null, note: null, attemptedAt: AT,
    };
    recordFetchAttempt(db, { ...base, fetcher: "raw", status: 403, outcome: "blocked", jsonLd: false });
    recordFetchAttempt(db, { ...base, fetcher: "managed", status: 200, outcome: "ok", jsonLd: true });

    expect(siteStats(db)[0]!.managedRescues).toBe(1);
  });

  test("a policy refusal is not counted as a rescuable block", () => {
    const db = freshDb();
    const base = {
      url: "https://www.allrecipes.com/recipe/1/", cdn: null, bodyBytes: null,
      elapsedMs: null, ingredientCount: null, stepCount: null, yieldRaw: null,
      totalTimeRaw: null, note: null, attemptedAt: AT, jsonLd: false,
    };
    recordFetchAttempt(db, { ...base, fetcher: "raw", status: 403, outcome: "blocked" });
    recordFetchAttempt(db, { ...base, fetcher: "managed", status: 0, outcome: "refused" });

    const [row] = siteStats(db);
    expect(row!.refused).toBe(1);
    expect(row!.managedRescues).toBe(0);
    expect(row!.reachRate).toBe(0);
  });

  test("a site never fetched reports null rates rather than zero", () => {
    const db = freshDb();
    recordSearchAppearance(db, {
      url: "https://www.seriouseats.com/x", query: "meatloaf",
      rank: 25, kind: "recipe", seenAt: AT,
    });

    const [row] = siteStats(db);
    expect(row!.fetches).toBe(0);
    expect(row!.reachRate).toBeNull();
    expect(row!.jsonLdRate).toBeNull();
  });
});

describe("policy records", () => {
  test("upsert replaces rather than duplicates, and survives a re-check", () => {
    const db = freshDb();
    const policy = {
      host: "www.budgetbytes.com", robotsGenericAllows: true,
      aiCrawlersBlocked: ["anthropic-ai"], adNetworkInjected: false,
      writtenProhibition: false, licensingContact: null,
      note: "first check", checkedAt: AT,
    };
    upsertPolicy(db, policy);
    upsertPolicy(db, {
      ...policy,
      aiCrawlersBlocked: ["anthropic-ai", "Bytespider"],
      note: "re-check",
      checkedAt: "2026-10-01",
    });

    const rows = siteStats(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.host).toBe("budgetbytes.com");
    expect(rows[0]!.aiCrawlersBlocked).toBe(2);
    expect(rows[0]!.stance).toBe("ai-blocked");
  });

  test("a licensing contact is carried through to the report", () => {
    const db = freshDb();
    upsertPolicy(db, {
      host: "allrecipes.com", robotsGenericAllows: true,
      aiCrawlersBlocked: ["anthropic-ai"], adNetworkInjected: false,
      writtenProhibition: true, licensingContact: "contentlicensing@people.inc",
      note: null, checkedAt: AT,
    });

    const [row] = siteStats(db);
    expect(row!.stance).toBe("prohibited");
    expect(row!.licensingContact).toBe("contentlicensing@people.inc");
  });
});

describe("trusted sites", () => {
  test("a site can be marked trusted and stays trusted after more evidence", () => {
    const db = freshDb();
    recordSearchAppearance(db, {
      url: "https://www.recipetineats.com/meatloaf-recipe/", query: "meatloaf",
      rank: 19, kind: "recipe", seenAt: AT,
    });
    setTrusted(db, "recipetineats.com", true);
    recordSearchAppearance(db, {
      url: "https://www.recipetineats.com/carbonara/", query: "carbonara",
      rank: 2, kind: "recipe", seenAt: "2026-09-21",
    });

    expect(siteStats(db)[0]!.trusted).toBe(true);
  });
});

describe("canonicalUrl", () => {
  test("collapses the spellings one page turns up under", () => {
    const forms = [
      "https://www.delish.com/cooking/meatloaf/",
      "https://delish.com/cooking/meatloaf",
      "https://DELISH.com/cooking/meatloaf?utm_source=pinterest",
      "https://www.delish.com/cooking/meatloaf/#recipe",
    ];
    expect(new Set(forms.map(canonicalUrl)).size).toBe(1);
  });

  test("keeps genuinely different pages apart", () => {
    expect(canonicalUrl("https://delish.com/a")).not.toBe(canonicalUrl("https://delish.com/b"));
  });
});

describe("import idempotence", () => {
  test("recording the same fetch attempt twice counts it once", () => {
    // The importer is documented as safe to re-run. It was not: a second import
    // took the log from 18 rows to 36 and inflated every rate built on it.
    const db = freshDb();
    const attempt = {
      url: "https://www.budgetbytes.com/meatloaf/", fetcher: "raw" as const, status: 403,
      outcome: "blocked" as const, cdn: "Cloudflare", bodyBytes: 6144, elapsedMs: 57,
      jsonLd: false, ingredientCount: null, stepCount: null, yieldRaw: null,
      totalTimeRaw: null, note: null, attemptedAt: AT,
    };
    recordFetchAttempt(db, attempt);
    recordFetchAttempt(db, attempt);

    const [row] = siteStats(db);
    expect(row!.fetches).toBe(1);
    expect(row!.blocked).toBe(1);
  });

  test("a different outcome for the same page is still a separate attempt", () => {
    const db = freshDb();
    const base = {
      url: "https://preppykitchen.com/meatloaf/", cdn: null, bodyBytes: null, elapsedMs: null,
      ingredientCount: null, stepCount: null, yieldRaw: null, totalTimeRaw: null,
      note: null, attemptedAt: AT,
    };
    recordFetchAttempt(db, { ...base, fetcher: "raw", status: 403, outcome: "blocked", jsonLd: false });
    recordFetchAttempt(db, { ...base, fetcher: "managed", status: 200, outcome: "ok", jsonLd: true });
    expect(siteStats(db)[0]!.fetches).toBe(2);
  });
});

describe("managed rescues exclude policy refusals", () => {
  test("a managed success after a raw REFUSAL is not a rescue", () => {
    // A refusal is a policy decision that must not be retried. If the data ever
    // holds a later success there, that is a contract violation to notice, not
    // a win for managed fetching to be credited with.
    const db = freshDb();
    const base = {
      url: "https://www.allrecipes.com/recipe/1/", cdn: null, bodyBytes: null, elapsedMs: null,
      ingredientCount: null, stepCount: null, yieldRaw: null, totalTimeRaw: null,
      note: null, attemptedAt: AT,
    };
    recordFetchAttempt(db, { ...base, fetcher: "raw", status: 403, outcome: "refused", jsonLd: false });
    recordFetchAttempt(db, { ...base, fetcher: "managed", status: 200, outcome: "ok", jsonLd: true });

    expect(siteStats(db)[0]!.managedRescues).toBe(0);
  });
});
