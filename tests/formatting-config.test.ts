import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const root = join(import.meta.dirname, "..");

describe("repository formatting", () => {
  test("provides reproducible Prettier commands and configuration", () => {
    const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const config = JSON.parse(readFileSync(join(root, ".prettierrc.json"), "utf8"));
    const ignored = readFileSync(join(root, ".prettierignore"), "utf8");

    expect(packageJson.devDependencies.prettier).toBeDefined();
    expect(packageJson.scripts.format).toBe("prettier --write .");
    expect(packageJson.scripts["format:check"]).toBe("prettier --check .");
    expect(config).toMatchObject({ printWidth: 100, trailingComma: "none" });
    for (const path of ["coverage/", "data/", "dist/", "dist-server/", "docs/media/", "output/"]) {
      expect(ignored).toContain(path);
    }
  });

  test("checks formatting in CI", () => {
    const workflow = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
    expect(workflow).toContain("- run: npm run format:check");
  });
});
