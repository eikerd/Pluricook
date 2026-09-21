/**
 * Classical multidimensional scaling: place points in k dimensions so their
 * straight-line distances approximate a given distance matrix. Written out
 * because n is a dozen recipes — a linear-algebra dependency would be absurd.
 */

const times = (m: number[][], v: number[]) => m.map((row) => row.reduce((s, x, j) => s + x * v[j]!, 0));

/**
 * The most POSITIVE eigenpair of a symmetric matrix. Plain power iteration finds
 * the eigenvalue largest in magnitude, which for a non-Euclidean distance matrix
 * can be negative — and its norm, always positive, would pass it off as a real
 * axis. Iterating on B + sI with s ≥ the spectral radius shifts every eigenvalue
 * to ≥ 0 while keeping their order, so the top one is the most positive; the
 * value is then the signed Rayleigh quotient on B itself.
 */
function topEigen(b: number[][], iterations = 300): { value: number; vector: number[] } {
  const n = b.length;
  const shift = Math.max(...b.map((row) => row.reduce((s, x) => s + Math.abs(x), 0)));   // Gershgorin bound
  const shifted = b.map((row, i) => row.map((x, j) => (i === j ? x + shift : x)));
  let v = Array.from({ length: n }, (_, i) => Math.sin(i + 1));   // deterministic start
  for (let it = 0; it < iterations; it++) {
    const w = times(shifted, v);
    const norm = Math.hypot(...w);
    if (norm < 1e-12) break;
    v = w.map((x) => x / norm);
  }
  const bv = times(b, v);
  return { value: v.reduce((s, x, i) => s + x * bv[i]!, 0), vector: v };
}

export interface Embedding { points: number[][]; explained: number }

export function classicalMds(distance: Array<Array<number | null>>, k = 3): Embedding {
  const n = distance.length;
  if (n < 2) return { points: distance.map(() => Array(k).fill(0)), explained: 1 };

  // An undefined distance (too few shared ingredients) is treated as the farthest
  // seen between two DIFFERENT recipes. The diagonal is all zeros and must not
  // count, or a matrix with no known distances would collapse to a single point.
  const known = distance.flatMap((row, i) => row.filter((d, j): d is number => i !== j && d !== null));
  const far = Math.max(0, ...known) || 1;
  const d2 = distance.map((row) => row.map((d) => (d ?? far) ** 2));

  const rowMean = d2.map((r) => r.reduce((s, x) => s + x, 0) / n);
  const total = rowMean.reduce((s, x) => s + x, 0) / n;
  let b = d2.map((r, i) => r.map((x, j) => -0.5 * (x - rowMean[i]! - rowMean[j]! + total)));

  const trace = b.reduce((s, r, i) => s + Math.max(0, r[i]!), 0);
  const axes: number[][] = [];
  let kept = 0;
  for (let a = 0; a < k; a++) {
    const { value, vector } = topEigen(b);
    // Nothing positive left: the remaining structure is non-Euclidean, not an axis.
    if (value <= 1e-9) { axes.push(vector.map(() => 0)); break; }
    kept += value;
    axes.push(vector.map((x) => x * Math.sqrt(value)));
    b = b.map((r, i) => r.map((x, j) => x - value * vector[i]! * vector[j]!));   // deflate
  }
  while (axes.length < k) axes.push(Array(n).fill(0));
  return {
    points: Array.from({ length: n }, (_, i) => axes.map((ax) => ax[i]!)),
    explained: trace > 0 ? Math.min(1, kept / trace) : 1,
  };
}
