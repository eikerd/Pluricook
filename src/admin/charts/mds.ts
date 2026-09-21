/**
 * Classical multidimensional scaling: place points in k dimensions so their
 * straight-line distances approximate a given distance matrix. Written out
 * because n is a dozen recipes — a linear-algebra dependency would be absurd.
 */

function powerIteration(b: number[][], iterations = 200): { value: number; vector: number[] } {
  const n = b.length;
  let v = Array.from({ length: n }, (_, i) => Math.sin(i + 1));   // deterministic start
  let value = 0;
  for (let it = 0; it < iterations; it++) {
    const w = b.map((row) => row.reduce((s, x, j) => s + x * v[j]!, 0));
    const norm = Math.hypot(...w);
    if (norm < 1e-12) return { value: 0, vector: v.map(() => 0) };
    v = w.map((x) => x / norm);
    value = norm;
  }
  return { value, vector: v };
}

export interface Embedding { points: number[][]; explained: number }

export function classicalMds(distance: Array<Array<number | null>>, k = 3): Embedding {
  const n = distance.length;
  if (n < 2) return { points: distance.map(() => Array(k).fill(0)), explained: 1 };

  // An undefined distance (too few shared ingredients) is treated as the farthest seen.
  const known = distance.flat().filter((d): d is number => d !== null);
  const far = known.length ? Math.max(...known) : 1;
  const d2 = distance.map((row) => row.map((d) => (d ?? far) ** 2));

  const rowMean = d2.map((r) => r.reduce((s, x) => s + x, 0) / n);
  const total = rowMean.reduce((s, x) => s + x, 0) / n;
  let b = d2.map((r, i) => r.map((x, j) => -0.5 * (x - rowMean[i]! - rowMean[j]! + total)));

  const trace = b.reduce((s, r, i) => s + Math.max(0, r[i]!), 0);
  const axes: number[][] = [];
  let kept = 0;
  for (let a = 0; a < k; a++) {
    const { value, vector } = powerIteration(b);
    if (value <= 1e-9) { axes.push(vector.map(() => 0)); continue; }
    kept += value;
    axes.push(vector.map((x) => x * Math.sqrt(value)));
    b = b.map((r, i) => r.map((x, j) => x - value * vector[i]! * vector[j]!));   // deflate
  }
  return {
    points: Array.from({ length: n }, (_, i) => axes.map((ax) => ax[i]!)),
    explained: trace > 0 ? Math.min(1, kept / trace) : 1,
  };
}
