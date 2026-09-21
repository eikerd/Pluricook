import { describe, expect, test } from "bun:test";
import { evaluateRobots, verdictForStatus } from "./robots";

// The opening of People Inc.'s real robots.txt, as served by allrecipes.com.
const PEOPLE_INC = `#People Inc. content is made available for your non-commercial use subject to our
#Terms of Use here: https://www.people.inc/brands-termsofservice.
#Use of any crawler or other tool, device, or process to data mine or scrape the
#content on this website using automated means for any purpose other than
#directing traffic to this website is prohibited without prior written permission.

User-agent: *
Disallow: /embed?
Disallow: /cdn-cgi/
`;

describe("evaluateRobots", () => {
  test("People Inc: generic crawling is ALLOWED, and the host is still not cleared", () => {
    // The whole reason prohibition language is checked. Read by its rules alone,
    // this file permits the recipe path; read by its words, it forbids the use.
    const v = evaluateRobots(PEOPLE_INC, "/recipe/16354/easy-meatloaf/");
    expect(v.genericAllows).toBe(true);
    expect(v.prohibitionLanguage).toBe(true);
    expect(v.cleared).toBe(false);
    expect(v.prohibitionQuote).toBeTruthy();
  });

  test("a plain WordPress robots.txt clears", () => {
    const v = evaluateRobots(
      "User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n",
      "/meatloaf-recipe/",
    );
    expect(v.cleared).toBe(true);
  });

  test("an empty Disallow means nothing is disallowed (RecipeTin Eats' own block)", () => {
    expect(evaluateRobots("User-agent: *\nDisallow:\n", "/lentil-soup/").cleared).toBe(true);
  });

  test("a ban aimed at a NAMED bot does not bind a generic crawler", () => {
    const v = evaluateRobots(
      "User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow: /search\n",
      "/recipes/x/",
    );
    expect(v.genericAllows).toBe(true);
    expect(v.cleared).toBe(true);
  });

  test("Disallow: / for everyone is not cleared", () => {
    const v = evaluateRobots("User-agent: *\nDisallow: /\n", "/recipes/x/");
    expect(v.genericAllows).toBe(false);
    expect(v.cleared).toBe(false);
  });

  test("the longest matching rule wins, and Allow wins a tie", () => {
    const text = "User-agent: *\nDisallow: /recipes/\nAllow: /recipes/public/\n";
    expect(evaluateRobots(text, "/recipes/public/soup").genericAllows).toBe(true);
    expect(evaluateRobots(text, "/recipes/private/soup").genericAllows).toBe(false);
  });

  test("wildcards and end anchors", () => {
    const text = "User-agent: *\nDisallow: /*?s=\nDisallow: /*.pdf$\n";
    expect(evaluateRobots(text, "/page?s=meatloaf").genericAllows).toBe(false);
    expect(evaluateRobots(text, "/files/menu.pdf").genericAllows).toBe(false);
    expect(evaluateRobots(text, "/files/menu.pdf.html").genericAllows).toBe(true);
  });

  test("consecutive User-agent lines share one group", () => {
    const text = "User-agent: Bingbot\nUser-agent: *\nDisallow: /private/\n";
    expect(evaluateRobots(text, "/private/x").genericAllows).toBe(false);
  });

  test("prohibition words in a RULE line are not a statement of terms", () => {
    // Only comments carry terms; a path that happens to contain "scraping" is a path.
    expect(evaluateRobots("User-agent: *\nDisallow: /scraping-guide/\n", "/recipes/").cleared).toBe(true);
  });
});

describe("verdictForStatus — when robots.txt cannot be read", () => {
  test("404 means no rules are published, which permits crawling", () => {
    expect(verdictForStatus(404).cleared).toBe(true);
  });

  test("a 403, a timeout or a server error is not evidence of permission", () => {
    for (const status of [0, 403, 429, 500, 503]) expect(verdictForStatus(status).cleared).toBe(false);
  });
});
