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
