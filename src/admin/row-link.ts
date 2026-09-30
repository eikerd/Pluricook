/**
 * What makes a table row open its own page: a click in it, or Enter while the
 * row itself has focus. A link or button inside the row keeps its own click
 * and key, so Enter on a Source URL opens the source and nothing else — the
 * key had bubbled up to the row and opened the recipe as well.
 */

const CONTROLS = "a, button, input, select, textarea";

/** Whether an event began on a control inside the row. Duck-typed, so tests need no DOM. */
function fromControl(target: unknown): boolean {
  const node = target as { closest?: (selector: string) => unknown } | null;
  return typeof node?.closest === "function" && node.closest(CONTROLS) !== null;
}

export function rowLinkHandlers(open: () => void) {
  return {
    tabIndex: 0,
    onClick: (e: { target: unknown }) => {
      if (!fromControl(e.target)) open();
    },
    onKeyDown: (e: { key: string; target: unknown; currentTarget: unknown }) => {
      if (e.key === "Enter" && e.target === e.currentTarget) open();
    },
  };
}
