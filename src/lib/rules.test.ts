import { describe, expect, test } from "bun:test";
import { rule, traceRules } from "./rules";

describe("rule", () => {
  test("outside a trace every rule is on and nothing is recorded", () => {
    expect(rule("parse.anything")).toBe(true);
  });

  test("a trace records each rule that acted", () => {
    const { value, fired } = traceRules(() => {
      rule("a");
      rule("b");
      return 7;
    });
    expect(value).toBe(7);
    expect([...fired].sort()).toEqual(["a", "b"]);
  });

  test("a rule switched off does not act, and is not recorded as firing", () => {
    const { value, fired } = traceRules(() => (rule("a") ? "on" : "off"), new Set(["a"]));
    expect(value).toBe("off");
    expect(fired.has("a")).toBe(false);
  });

  test("traces nest, and the outer one is restored after an inner one throws", () => {
    const outer = traceRules(() => {
      expect(() => traceRules(() => { throw new Error("x"); })).toThrow("x");
      rule("after");
    });
    expect(outer.fired.has("after")).toBe(true);
  });
});
