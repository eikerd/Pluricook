import { serve } from "bun";
import index from "./index.html";
import { DATASETS, overview, queryDataset, termPage, usdaFoodPage } from "./lib/admin-queries";
import { SLUG } from "./lib/search-terms";
import {
  cloneRecipe, compareDish, deleteClone, listDishes, recipePage, revertCorrection, saveCorrection, type PageOutcome,
} from "./lib/compare-service";
import { buildMatrix } from "./lib/visual-matrix";
import { setTier, type Tier } from "./lib/curated-sources";

const TIERS: Tier[] = ["required", "favorite", "normal", "blocked"];

const recipeIdOf = (req: Request) => new URL(req.url).searchParams.get("id") ?? "";
const pageResponse = (result: PageOutcome) =>
  result.ok ? Response.json(result.page) : Response.json({ error: result.error }, { status: result.status });

const server = serve({
  routes: {
    "/*": index,

    /** Headline counts and any standing warnings. */
    "/api/admin/overview": {
      GET: async () => Response.json(await overview()),
    },

    /** The sidebar: which tables exist and what they hold. */
    "/api/admin/datasets": {
      GET: () =>
        Response.json(
          DATASETS.map(({ id, label, searchable }) => ({
            id, label, searchable: Boolean(searchable?.length),
          })),
        ),
    },

    /** Dishes that have captured recipes, with the sections each one offers. */
    "/api/admin/dishes": {
      GET: async () => Response.json(await listDishes()),
    },

    /** Consensus, outliers and salinity for one dish, optionally one section of it. */
    "/api/admin/compare/:dish": {
      GET: async (req) => {
        const section = new URL(req.url).searchParams.get("section");
        const result = await compareDish(req.params.dish, section || null);
        return result.ok
          ? Response.json(result.comparison)
          : Response.json({ error: result.error }, { status: result.status });
      },
    },

    /** The one payload every chart reads: recipe × ingredient, plus distances. */
    "/api/admin/matrix/:dish": {
      GET: async (req) => {
        const section = new URL(req.url).searchParams.get("section");
        const result = await compareDish(req.params.dish, section || null);
        return result.ok
          ? Response.json(buildMatrix(result.comparison))
          : Response.json({ error: result.error }, { status: result.status });
      },
    },

    /**
     * One recipe's page: the owner's version, the published one, and the
     * correction between them. The id travels in the query — captured ids hold
     * colons and dots.
     */
    "/api/admin/recipe": {
      GET: async (req) => pageResponse(await recipePage(recipeIdOf(req))),
    },

    /**
     * Save or undo the owner's correction to one recipe. Like starring a source,
     * it writes a file in the repo — data/corrections/<dish>.json — so the
     * change lands in version control with its diff. The published recipe is
     * never touched.
     */
    "/api/admin/recipe/correction": {
      PUT: async (req) => {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "The correction must be JSON." }, { status: 400 });
        }
        return pageResponse(await saveCorrection(recipeIdOf(req), body));
      },
      DELETE: async (req) => pageResponse(await revertCorrection(recipeIdOf(req))),
    },

    /**
     * The owner's own copy of a recipe, to develop: POST makes one (answering
     * with its id), DELETE removes one. Written to data/clones/<dish>.json.
     */
    "/api/admin/recipe/clone": {
      POST: async (req) => {
        const result = await cloneRecipe(recipeIdOf(req));
        return result.ok
          ? Response.json({ id: result.id }, { status: 201 })
          : Response.json({ error: result.error }, { status: result.status });
      },
      DELETE: async (req) => {
        const result = await deleteClone(recipeIdOf(req));
        return result.ok ? Response.json({ ok: true }) : Response.json({ error: result.error }, { status: result.status });
      },
    },

    /**
     * Star a site, or clear its star.
     *
     * The only write in the admin. It edits data/sources/curated.json rather than
     * the database, so the decision lands in version control with the diff.
     */
    "/api/admin/sources/:host/tier": {
      POST: async (req) => {
        const { tier, displayName } = (await req.json()) as {
          tier?: string;
          displayName?: string;
        };
        if (!TIERS.includes(tier as Tier)) {
          return Response.json(
            { error: `tier must be one of ${TIERS.join(", ")}` },
            { status: 400 },
          );
        }
        const site = await setTier(req.params.host, tier as Tier, { displayName });
        return Response.json({ host: req.params.host, ...site });
      },
    },

    /** One search term's landing page: the term, and the recipes attached to it. */
    "/api/admin/term": {
      GET: async (req) => {
        const slug = new URL(req.url).searchParams.get("slug") ?? "";
        if (!SLUG.test(slug)) return Response.json({ error: "slug must be a dish key" }, { status: 400 });
        const page = await termPage(slug);
        return page ? Response.json(page) : Response.json({ error: `No search term "${slug}".` }, { status: 404 });
      },
    },

    /** One USDA food, whole: its record, its category named and classed, its portions and nutrients. */
    "/api/admin/usda/food": {
      GET: (req) => {
        const raw = new URL(req.url).searchParams.get("id") ?? "";
        const id = /^\d+$/.test(raw) ? Number(raw) : NaN;
        if (!Number.isSafeInteger(id)) return Response.json({ error: "id must be an FDC id" }, { status: 400 });
        const page = usdaFoodPage(id);
        if (page === "missing") return Response.json({ error: "usda.db has not been built yet." }, { status: 503 });
        return page ? Response.json(page) : Response.json({ error: `USDA has no food ${id}.` }, { status: 404 });
      },
    },

    /** One page of one table. Sorting and paging happen in SQL, not the browser. */
    "/api/admin/data/:id": {
      GET: async (req) => {
        const url = new URL(req.url);
        const result = await queryDataset(req.params.id, {
          sort: url.searchParams.get("sort") ?? undefined,
          dir: url.searchParams.get("dir") ?? undefined,
          page: Number(url.searchParams.get("page") ?? 1),
          pageSize: Number(url.searchParams.get("pageSize") ?? 50),
          q: url.searchParams.get("q") ?? undefined,
        });
        return result
          ? Response.json(result)
          : Response.json({ error: `Unknown dataset: ${req.params.id}` }, { status: 404 });
      },
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`🍳 Pluricook admin running at ${server.url}`);
