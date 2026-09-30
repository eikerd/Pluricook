import { describe, expect, mock, test } from "bun:test";
import { rowLinkHandlers } from "./row-link";

// Stand-ins for DOM nodes: all the handlers ask of a target is closest().
const plain = { closest: () => null };
const inLink = { closest: () => ({}) };

describe("a row that opens its own page", () => {
  test("opens on a click in the row, and on Enter while the row itself has focus", () => {
    const open = mock(() => {});
    const row = { ...plain };
    const handlers = rowLinkHandlers(open);
    handlers.onClick({ target: plain });
    handlers.onKeyDown({ key: "Enter", target: row, currentTarget: row });
    expect(open).toHaveBeenCalledTimes(2);
  });

  test("leaves a link inside it to do its own job, by click or by Enter", () => {
    // Codex, PR #3 round 2: Enter on a Source URL bubbled up and opened the recipe too.
    const open = mock(() => {});
    const handlers = rowLinkHandlers(open);
    handlers.onClick({ target: inLink });
    handlers.onKeyDown({ key: "Enter", target: inLink, currentTarget: { ...plain } });
    expect(open).not.toHaveBeenCalled();
  });

  test("answers only Enter", () => {
    const open = mock(() => {});
    const row = { ...plain };
    rowLinkHandlers(open).onKeyDown({ key: " ", target: row, currentTarget: row });
    expect(open).not.toHaveBeenCalled();
  });
});
