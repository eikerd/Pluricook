import { afterEach, describe, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import {
  DEFAULT_MANUAL_CAP,
  curationFor,
  isListed,
  mayCaptureManually,
  mayFetch,
  mayStoreSourceText,
  readCurated,
  setTier,
  writeCurated,
} from "./curated-sources";

const TMP = "/tmp/pluricook-curated-test.json";

afterEach(async () => {
  await unlink(TMP).catch(() => {});
});

describe("curation lookup", () => {
  test("an unlisted site is NOT fetchable by default", async () => {
    // It used to default to "fetch", which opened the gate for exactly the sites
    // nobody had reviewed. It must now be cleared on evidence first.
    const file = await readCurated(TMP);
    const site = curationFor(file, "https://example.com/recipe/");
    expect(site.tier).toBe("normal");
    expect(site.acquisition).toBe("pending-review");
    expect(mayFetch(site)).toBe(false);
    expect(isListed(file, "https://example.com/recipe/")).toBe(false);
  });

  test("lookup is by canonical host, so www does not miss", async () => {
    await writeCurated(
      { sites: { "seriouseats.com": { tier: "required", acquisition: "pending-review" } } },
      TMP,
    );
    const file = await readCurated(TMP);
    expect(curationFor(file, "https://www.seriouseats.com/x").tier).toBe("required");
  });
});

describe("mayFetch is closed by default, not open", () => {
  test("a starred but unreviewed site may not be fetched", () => {
    // Starring says we want the site, not that we have cleared it.
    expect(mayFetch({ tier: "required", acquisition: "pending-review" })).toBe(false);
  });

  test("a blocked site may never be fetched, whatever its acquisition says", () => {
    expect(mayFetch({ tier: "blocked", acquisition: "fetch" })).toBe(false);
  });

  test("link-only means we take nothing from the page itself", () => {
    expect(mayFetch({ tier: "favorite", acquisition: "link-only" })).toBe(false);
  });

  test("cleared and licensed sites may be fetched", () => {
    expect(mayFetch({ tier: "normal", acquisition: "fetch" })).toBe(true);
    expect(mayFetch({ tier: "required", acquisition: "licensed" })).toBe(true);
  });
});

describe("mayStoreSourceText is stricter than mayFetch", () => {
  test("only a licence permits storing text from the page", () => {
    expect(mayStoreSourceText({ tier: "normal", acquisition: "fetch" })).toBe(false);
    expect(mayStoreSourceText({ tier: "required", acquisition: "licensed" })).toBe(true);
  });
});

describe("setTier", () => {
  test("starring a new site parks it at pending-review, never fetch", async () => {
    const site = await setTier("https://www.americastestkitchen.com/", "required", {
      displayName: "America's Test Kitchen",
      path: TMP,
    });
    expect(site.tier).toBe("required");
    expect(site.acquisition).toBe("pending-review");
    expect(mayFetch(site)).toBe(false);
  });

  test("blocking a site forces acquisition to none", async () => {
    await setTier("allrecipes.com", "favorite", { path: TMP });
    const site = await setTier("allrecipes.com", "blocked", { path: TMP });
    expect(site.acquisition).toBe("none");
  });

  test("a reviewed decision survives a later star", async () => {
    await writeCurated(
      {
        sites: {
          "example.com": {
            tier: "normal",
            acquisition: "link-only",
            note: "reviewed: facts and attribution only",
          },
        },
      },
      TMP,
    );
    const site = await setTier("example.com", "favorite", { path: TMP });
    expect(site.acquisition).toBe("link-only");
    expect(site.note).toBe("reviewed: facts and attribution only");
  });

  test("notes and licences are preserved across a tier change", async () => {
    await writeCurated(
      { sites: { "example.com": { tier: "normal", acquisition: "licensed", licence: "API 2026" } } },
      TMP,
    );
    const site = await setTier("example.com", "required", { path: TMP });
    expect(site.licence).toBe("API 2026");
    expect(site.acquisition).toBe("licensed");
  });

  test("hosts are written sorted, so a star click makes a small diff", async () => {
    await setTier("zzz.com", "favorite", { path: TMP });
    await setTier("aaa.com", "favorite", { path: TMP });
    const text = await Bun.file(TMP).text();
    expect(text.indexOf("aaa.com")).toBeLessThan(text.indexOf("zzz.com"));
  });
});

describe("manual capture cap", () => {
  const base = { tier: "required" as const, manualCap: 3 };

  test("a manual-limited site allows entry up to the cap", () => {
    const site = { ...base, acquisition: "manual-limited" as const };
    expect(mayCaptureManually(site, 0).ok).toBe(true);
    expect(mayCaptureManually(site, 2).ok).toBe(true);
    expect(mayCaptureManually(site, 2).reason).toBe("3 of 3");
  });

  test("refuses at the cap, and stays refused past it", () => {
    const site = { ...base, acquisition: "manual-limited" as const };
    expect(mayCaptureManually(site, 3).ok).toBe(false);
    expect(mayCaptureManually(site, 9).ok).toBe(false);
    expect(mayCaptureManually(site, 3).reason).toContain("cap of 3");
  });

  test("uses the default cap when a site names none", () => {
    const site = { tier: "required" as const, acquisition: "manual-limited" as const };
    expect(mayCaptureManually(site, 0).cap).toBe(DEFAULT_MANUAL_CAP);
    expect(mayCaptureManually(site, DEFAULT_MANUAL_CAP).ok).toBe(false);
  });

  test("an acquisition that does not permit hand entry refuses regardless of count", () => {
    for (const acquisition of ["none", "pending-review", "link-only"] as const) {
      const v = mayCaptureManually({ tier: "required", acquisition }, 0);
      expect(v.ok).toBe(false);
      expect(v.reason).toContain(acquisition);
    }
  });

  test("a blocked site refuses even when set to manual-limited", () => {
    expect(
      mayCaptureManually({ tier: "blocked", acquisition: "manual-limited", manualCap: 99 }, 0).ok,
    ).toBe(false);
  });

  test("no cap applies where we already have a broader basis", () => {
    expect(mayCaptureManually({ tier: "normal", acquisition: "fetch" }, 500).ok).toBe(true);
    expect(mayCaptureManually({ tier: "required", acquisition: "licensed" }, 500).ok).toBe(true);
  });
});

describe("manual-limited is not a fetching basis", () => {
  test("mayFetch stays false — it permits a person, not a fetcher", () => {
    expect(mayFetch({ tier: "required", acquisition: "manual-limited", manualCap: 10 })).toBe(false);
  });

  test("and it never permits storing the page's own text", () => {
    expect(mayStoreSourceText({ tier: "required", acquisition: "manual-limited" })).toBe(false);
  });
});
