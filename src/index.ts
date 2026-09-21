import { serve } from "bun";
import index from "./index.html";
import { DATASETS, overview, queryDataset } from "./lib/admin-queries";
import { setTier, type Tier } from "./lib/curated-sources";

const TIERS: Tier[] = ["required", "favorite", "normal", "blocked"];

const server = serve({
  routes: {
    "/*": index,

    /** Headline counts and any standing warnings. */
    "/api/admin/overview": {
      GET: () => Response.json(overview()),
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
