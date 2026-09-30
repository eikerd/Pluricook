/**
 * One USDA food's page, at /usda/<fdc id>: every field of its record, its
 * category named and classed, and all of its portions and nutrients, each a
 * sortable sheet. Read-only: USDA's data is the reference, not ours to correct.
 */

import { useEffect, useState } from "react";
import type { UsdaFoodPage as FoodPage } from "../lib/usda-food";
import { Fields } from "./Fields";
import { SortableGrid, type GridColumn } from "./SortableGrid";

type Portion = FoodPage["portions"][number];
type Nutrient = FoodPage["nutrients"][number];

interface UsdaFoodPageProps {
  fdcId: number;
  /** Where Back goes when the page was opened by its address rather than from the admin. */
  onLeave: () => void;
}

type Load = { fdcId: number; page: FoodPage } | { fdcId: number; error: string };

const figure = (v: number | null) => (v === null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: 4 }));

// USDA's own field names, one column each. The three datasets fill different
// portion fields — survey foods keep a code in modifier and the words in
// description — so all of them show.
const PORTION_COLUMNS: GridColumn<Portion>[] = [
  { key: "id", label: "ID", numeric: true, value: (p) => p.id },
  { key: "amount", label: "Amount", numeric: true, value: (p) => p.amount, render: (p) => figure(p.amount) },
  { key: "unit", label: "Unit", value: (p) => p.unit },
  { key: "modifier", label: "Modifier", value: (p) => p.modifier },
  { key: "description", label: "Description", value: (p) => p.description },
  { key: "gramWeight", label: "Grams", numeric: true, value: (p) => p.gramWeight, render: (p) => figure(p.gramWeight) },
];

const NUTRIENT_COLUMNS: GridColumn<Nutrient>[] = [
  { key: "rank", label: "Rank", numeric: true, value: (n) => n.rank },
  { key: "name", label: "Nutrient", value: (n) => n.name },
  { key: "amount", label: "Amount", numeric: true, value: (n) => n.amount, render: (n) => figure(n.amount) },
  { key: "unit", label: "Unit", value: (n) => n.unit },
  { key: "id", label: "ID", numeric: true, value: (n) => n.id },
];

export function UsdaFoodPage({ fdcId, onLeave }: UsdaFoodPageProps) {
  const [load, setLoad] = useState<Load | null>(null);

  useEffect(() => {
    let stale = false;
    fetch(`/api/admin/usda/food?id=${fdcId}`)
      .then(async (r) => {
        const body = (await r.json()) as FoodPage | { error: string };
        if (!r.ok) throw new Error("error" in body ? body.error : `HTTP ${r.status}`);
        if (!stale) setLoad({ fdcId, page: body as FoodPage });
      })
      .catch((e: unknown) => { if (!stale) setLoad({ fdcId, error: e instanceof Error ? e.message : "Could not load the food" }); });
    return () => { stale = true; };
  }, [fdcId]);

  const back = () => ((history.state as { from?: string } | null)?.from ? history.back() : onLeave());
  const current = load?.fdcId === fdcId ? load : null;

  if (current && "error" in current) {
    return (
      <div className="pane">
        <p><button type="button" className="link" onClick={back}>← Back</button></p>
        <p className="failure" role="alert">{current.error}</p>
      </div>
    );
  }
  if (!current) return <div className="pane"><p className="muted">Loading…</p></div>;

  const { food, category, portions, nutrients } = current.page;

  return (
    <div className="pane usda-food">
      <header className="pane__head">
        <div>
          <p className="recipe__crumb">
            <button type="button" className="link" onClick={back}>← Back</button>
          </p>
          <h2>{food.description}</h2>
        </div>
      </header>

      <div className="detail__cards">
        <section className="detail__card">
          <h3 className="recipe__section-name">Record</h3>
          <Fields rows={[
            ["FDC ID", food.fdcId],
            ["Dataset", food.dataset],
            ["Data type", food.dataType],
            ["Description", food.description],
            ["Category ID", food.categoryId],
          ]} />
        </section>
        <section className="detail__card">
          <h3 className="recipe__section-name">Category</h3>
          {category ? (
            <Fields rows={[
              ["System", category.system],
              ["Code", category.code],
              ["Description", category.description],
              ["Class", category.klass],
            ]} />
          ) : (
            <p className="muted">None.</p>
          )}
        </section>
      </div>

      <section className="detail__sheet">
        <h3 className="recipe__section-name">Portions</h3>
        {portions.length ? (
          <SortableGrid label="Portions" columns={PORTION_COLUMNS} rows={portions}
            rowKey={(p) => String(p.id)} initialSort={{ key: "id", dir: "asc" }} />
        ) : (
          <p className="muted">None.</p>
        )}
      </section>

      <section className="detail__sheet">
        <h3 className="recipe__section-name">Nutrients</h3>
        {nutrients.length ? (
          <SortableGrid label="Nutrients" columns={NUTRIENT_COLUMNS} rows={nutrients}
            rowKey={(n) => String(n.id)} initialSort={{ key: "rank", dir: "asc" }} />
        ) : (
          <p className="muted">None.</p>
        )}
      </section>
    </div>
  );
}
