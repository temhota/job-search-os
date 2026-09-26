import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const mediaDir = join(root, "docs", "media");

function pngDimensions(path: string) {
  const bytes = readFileSync(path);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("README product demo", () => {
  test("shows the four feature screenshots without a video", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");

    expect(readme).toContain("## Demo");
    for (const name of ["today", "jobs", "pipeline", "review"]) {
      expect(readme).toContain(`docs/media/${name}.png`);
    }
    expect(readme).not.toContain("overview.mp4");
    expect(readme).not.toContain("overview-poster.png");
  });

  test("ships only the four readable screenshots", () => {
    for (const name of ["today", "jobs", "pipeline", "review"]) {
      const path = join(mediaDir, `${name}.png`);
      expect(pngDimensions(path)).toMatchObject({ width: 1440, height: 900 });
    }

    expect(existsSync(join(mediaDir, "overview.mp4"))).toBe(false);
    expect(existsSync(join(mediaDir, "overview-poster.png"))).toBe(false);
  });
});
