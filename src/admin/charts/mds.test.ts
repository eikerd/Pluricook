import { expect, test } from "bun:test";
import { classicalMds } from "./mds";

test("recovers distances that really are three-dimensional", () => {
  const pts = [[0, 0, 0], [3, 0, 0], [0, 4, 0], [0, 0, 5], [1, 1, 1]];
  const d = pts.map((a) => pts.map((b) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)));
  const { points, explained } = classicalMds(d, 3);
  expect(explained).toBeGreaterThan(0.999);
  pts.forEach((_, i) => pts.forEach((__, j) => {
    const got = Math.hypot(...points[i]!.map((x, a) => x - points[j]![a]!));
    expect(got).toBeCloseTo(d[i]![j]!, 4);
  }));
});

test("an undefined distance does not produce NaN", () => {
  const { points } = classicalMds([[0, 1, null], [1, 0, 2], [null, 2, 0]], 3);
  expect(points.flat().every(Number.isFinite)).toBe(true);
});

test("a matrix with no known distances between recipes still spreads them out", () => {
  const { points } = classicalMds([[0, null, null], [null, 0, null], [null, null, 0]], 3);
  const spread = Math.hypot(...points[0]!.map((x, a) => x - points[1]![a]!));
  expect(spread).toBeGreaterThan(0.5);   // the fallback is 1, not 0
});

test("a non-Euclidean matrix yields no axis from a negative eigenvalue", () => {
  // d(0,2) = 3 > d(0,1) + d(1,2): impossible in any Euclidean space.
  const d = [[0, 1, 3], [1, 0, 1], [3, 1, 0]];
  const { points, explained } = classicalMds(d, 3);
  expect(points.flat().every(Number.isFinite)).toBe(true);
  expect(explained).toBeLessThanOrEqual(1);
  // Three points span at most two real axes; the third must be empty, not a
  // phantom made from the negative eigenvalue.
  expect(points.every((p) => Math.abs(p[2]!) < 1e-6)).toBe(true);
});
