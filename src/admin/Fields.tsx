/**
 * A record's fields as label and value, for the detail pages (a USDA food, a
 * search term). An empty value shows as a muted dash, as in the tables.
 */

export function Fields({ rows }: { rows: Array<[string, string | number | null]> }) {
  return (
    <dl className="fields">
      {rows.map(([label, value]) => {
        const empty = value === null || value === "";
        return (
          <div className="fields__row" key={label}>
            <dt>{label}</dt>
            <dd className={empty ? "muted" : undefined}>{empty ? "—" : value}</dd>
          </div>
        );
      })}
    </dl>
  );
}
