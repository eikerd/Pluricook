import { serve } from "bun";
import index from "./index.html";
import { DATASETS, overview, queryDataset } from "./lib/admin-queries";
import { compareDish, listDishes, recipeDetail } from "./lib/compare-service";
import { buildMatrix } from "./lib/visual-matrix";
import { setTier, type Tier } from "./lib/curated-sources";

const TIERS: Tier[] = ["required", "favorite", "normal", "blocked"];

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
     * One recipe of a dish, line by line: what the recipe detail view shows.
     * The id travels in the query — captured ids hold colons and dots.
     */
    "/api/admin/recipe/:dish": {
      GET: async (req) => {
        const id = new URL(req.url).searchParams.get("id") ?? "";
        const result = await recipeDetail(req.params.dish, id);
        return result.ok
          ? Response.json(result.detail)
          : Response.json({ error: result.error }, { status: result.status });
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
