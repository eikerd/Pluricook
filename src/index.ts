import { serve } from "bun";
import index from "./index.html";
import { DATASETS, overview, queryDataset } from "./lib/admin-queries";

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

    /** One page of one table. Sorting and paging happen in SQL, not the browser. */
    "/api/admin/data/:id": {
      GET: (req) => {
        const url = new URL(req.url);
        const result = queryDataset(req.params.id, {
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
