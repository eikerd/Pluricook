/**
 * A recipe's lines as the comparison reads them, grouped by section: each line
 * as written, the USDA food it matched, how the parser read it, the grams it
 * came to and its share of the recipe.
 */

import type { DetailLine, RecipeDetail } from "../lib/recipe-detail";

interface RecipeLinesProps {
  detail: RecipeDetail;
  /** A line to mark: the one clicked on a chart. */
  highlight: string | null;
  /** Lines of the published recipe; any line not among them is the owner's. */
  published: Set<string> | null;
}

const grams = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const sectionName = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "3 cups · AP Flour · stated 360 g", the parser's reading, the way probe-lines prints it. */
function readAs(read: DetailLine["read"]): string {
  const quantity = read.quantity === null || Number.isNaN(read.quantity) ? "—" : String(read.quantity);
  const stated = read.statedGrams === null ? "" : ` · stated ${grams.format(read.statedGrams)} g`;
  return `${quantity} ${read.unit} · ${read.name}${stated}`;
}

export function RecipeLines({ detail, highlight, published }: RecipeLinesProps) {
  return (
    <>
      {detail.sections.map((section, k) => (
        <section key={section.name ?? k} className="recipe__section">
          {section.name && <h3 className="recipe__section-name">{sectionName(section.name)}</h3>}
          <table className="recipe-lines">
            <thead>
              <tr>
                <th scope="col">Ingredient</th>
                <th scope="col" className="recipe-lines__num">Grams</th>
                <th scope="col" className="recipe-lines__num">Share</th>
              </tr>
            </thead>
            <tbody>
              {section.lines.map((l, i) => (
                <tr key={i} className={l.line === highlight ? "is-highlighted" : undefined}>
                  <td>
                    <span className="recipe-lines__line">
                      {l.line}
                      {published && !published.has(l.line) && <span className="tag">edited</span>}
                    </span>
                    <span className="recipe-lines__food">{l.food ?? "not resolved"}</span>
                    <span className="recipe-lines__read">read as {readAs(l.read)}</span>
                  </td>
                  <td className="recipe-lines__num recipe-lines__grams">{l.grams === null ? "—" : `${grams.format(l.grams)} g`}</td>
                  <td className="recipe-lines__num muted">{l.share === null ? "—" : `${l.share.toFixed(1)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}
