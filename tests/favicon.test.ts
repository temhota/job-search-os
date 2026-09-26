import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("dashboard favicon", () => {
  test("uses a local violet SVG favicon without external assets", () => {
    expect(readFileSync("index.html", "utf8")).toContain(
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg"'
    );
    const svg = readFileSync("public/favicon.svg", "utf8");
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain("#553bb3");
    expect(svg).not.toMatch(/<(?:script|image)\b|(?:xlink:)?href=/i);
  });
});
