/**
 * The admin's addresses. Only a recipe has one of its own — /recipes/<id>, the
 * home provenance.ts names for every recipe — so a recipe can be linked to,
 * opened in a new tab, or opened from another computer. Everything else is
 * state inside the page.
 */

import { useEffect, useState } from "react";

const PREFIX = "/recipes/";

export const recipePath = (id: string) => `${PREFIX}${encodeURIComponent(id)}`;

/** The recipe the address names, or null. */
export function recipeIdFromPath(path: string): string | null {
  if (!path.startsWith(PREFIX)) return null;
  try {
    return decodeURIComponent(path.slice(PREFIX.length)) || null;
  } catch {
    return null;   // a malformed escape names no recipe
  }
}

/** Go to an address, carrying anything the page there should know. */
export function navigate(path: string, state: unknown = null): void {
  history.pushState(state, "", path);
  window.dispatchEvent(new PopStateEvent("popstate", { state }));
}

/** The current path, following Back and Forward. */
export function usePath(): string {
  const [path, setPath] = useState(() => location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return path;
}
