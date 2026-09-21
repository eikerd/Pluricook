import { afterEach, describe, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import {
  curationFor,
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
  test("an unlisted site gets the permissive default, matching search behaviour", async () => {
    const file = await readCurated(TMP);
    const site = curationFor(file, "https://example.com/recipe/");
    expect(site.tier).toBe("normal");
    expect(site.acquisition).toBe("fetch");
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
