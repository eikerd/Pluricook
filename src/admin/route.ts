/**
 * The admin's addresses. A recipe has one of its own — /recipes/<id>, the home
 * provenance.ts names for every recipe — and so do a search term, at
 * /terms/<slug>, and a USDA food, at /usda/<fdc id>, so each can be linked to,
 * opened in a new tab, or opened from another computer. Everything else is
 * state inside the page.
 */

import { useEffect, useState } from "react";

const RECIPE = "/recipes/";
const TERM = "/terms/";
const USDA_FOOD = "/usda/";
/** A dish key, as SLUG in search-terms.ts holds it; kept here so the page bundle needs no server module. */
const DISH_KEY = /^[a-z0-9][a-z0-9-]*$/;

export const recipePath = (id: string) => `${RECIPE}${encodeURIComponent(id)}`;
export const termPath = (slug: string) => `${TERM}${slug}`;
export const usdaFoodPath = (fdcId: number) => `${USDA_FOOD}${fdcId}`;

/** The search term the address names, or null. */
export function termSlugFromPath(path: string): string | null {
  if (!path.startsWith(TERM)) return null;
  const rest = path.slice(TERM.length);
  return DISH_KEY.test(rest) ? rest : null;
}

/** The recipe the address names, or null. */
export function recipeIdFromPath(path: string): string | null {
  if (!path.startsWith(RECIPE)) return null;
  try {
    return decodeURIComponent(path.slice(RECIPE.length)) || null;
  } catch {
    return null;   // a malformed escape names no recipe
  }
}

/** The USDA food the address names, or null. FDC ids are whole numbers. */
export function usdaFoodIdFromPath(path: string): number | null {
  if (!path.startsWith(USDA_FOOD)) return null;
  const rest = path.slice(USDA_FOOD.length);
  return /^\d{1,15}$/.test(rest) ? Number(rest) : null;
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
