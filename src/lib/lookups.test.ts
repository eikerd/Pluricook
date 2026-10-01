import { describe, expect, test } from "bun:test";
import { denialForStatus, mergeLookups, type DeniedPage, type Lookup } from "./lookups";

const LEITE: DeniedPage = {
  url: "https://leitesculinaria.com/416811/garlic-noodles.html",
  site: "Leite's Culinaria",
  denial: "refused",
  detail: "HTTP 403",
  acquisition: "fetch",
};
const NYT: DeniedPage = {
  url: "https://cooking.nytimes.com/recipes/1023012-garlic-noodles",
  site: "NYT Cooking",
  denial: "policy",
  detail: "normal · none",
  acquisition: "none",
};

describe("denialForStatus", () => {
  test("a site saying no is 'refused'", () => {
    expect(denialForStatus(403)).toBe("refused");
    expect(denialForStatus(401)).toBe("refused");
    expect(denialForStatus(429)).toBe("refused");
  });
  test("anything else is 'unreachable'", () => {
    expect(denialForStatus(500)).toBe("unreachable");
    expect(denialForStatus(404)).toBe("unreachable");
    expect(denialForStatus(0)).toBe("unreachable");
  });
});

describe("mergeLookups", () => {
  test("a first run lists every denied page, dated today, unhandled", () => {
    const out = mergeLookups([], [NYT, LEITE], [], "2026-09-30");
    expect(out.map((l) => l.site)).toEqual(["Leite's Culinaria", "NYT Cooking"]);
    expect(out[0]).toMatchObject({ firstDeniedAt: "2026-09-30", lastDeniedAt: "2026-09-30", handledAt: null, note: null });
  });

  test("a re-run keeps the first date and the person's note", () => {
    const held: Lookup[] = [
      { ...LEITE, firstDeniedAt: "2026-09-30", lastDeniedAt: "2026-09-30", handledAt: "2026-10-01", note: "typed in by hand" },
    ];
    const [l] = mergeLookups(held, [{ ...LEITE, detail: "HTTP 429" }], [], "2026-10-05");
    expect(l).toMatchObject({ firstDeniedAt: "2026-09-30", lastDeniedAt: "2026-10-05", detail: "HTTP 429", handledAt: "2026-10-01", note: "typed in by hand" });
  });

  test("a page extracted this run leaves the list", () => {
    const held = mergeLookups([], [LEITE, NYT], [], "2026-09-30");
    const out = mergeLookups(held, [NYT], ["https://www.leitesculinaria.com/416811/garlic-noodles.html"], "2026-10-01");
    expect(out.map((l) => l.site)).toEqual(["NYT Cooking"]);
  });

  test("a page this run never touched is kept as it was", () => {
    const held = mergeLookups([], [LEITE], [], "2026-09-30");
    expect(mergeLookups(held, [], [], "2026-10-01")).toEqual(held);
  });

  test("the same page under two spellings is one entry", () => {
    const out = mergeLookups([], [LEITE, { ...LEITE, url: "https://www.leitesculinaria.com/416811/garlic-noodles.html/" }], [], "2026-09-30");
    expect(out).toHaveLength(1);
  });
});
