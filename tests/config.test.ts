import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { inspect } from "node:util";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { parseAppConfig } from "../src/server/config/schema.js";
import { loadAppConfig } from "../src/server/config/load.js";
import { toRuntimeDependencies } from "../src/server/config/runtime.js";
import { startServer } from "../src/server/index.js";
import { exampleFixture } from "./config-fixture.js";
import { createDatabase } from "../src/server/db/database.js";
import request from "supertest";

const roots: string[] = [];
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
  vi.unstubAllEnvs();
});
function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), "config-test-"));
  roots.push(root);
  return root;
}

test("loads complete fictitious configuration", () => {
  const config = parseAppConfig(exampleFixture);
  expect(config.candidate.filenameStem).toBe("Alex_Morgan_CV");
  expect(config.mail.accounts).toEqual(["candidate@example.com", "Example Mail"]);
  expect(config.search.dailySelection).toEqual({ permanent: 4, freelance: 1, total: 5 });
});

test("reports paths without echoing values", () => {
  expect(() =>
    parseAppConfig({ ...exampleFixture, mail: { ...exampleFixture.mail, accounts: [] } })
  ).toThrow(/mail\.accounts/);
  const invalid = () =>
    parseAppConfig({
      ...exampleFixture,
      candidate: { ...exampleFixture.candidate, filenameStem: "SECRET/private" }
    });
  expect(invalid).toThrow(/candidate.filenameStem/);
  expect(invalid).not.toThrow(/SECRET/);
});

test.each(["SECRET_PRIVATE_SOURCE", "https://SECRET_PRIVATE_SOURCE invalid"])(
  "malformed source URL produces a sanitized field issue: %s",
  (searchUrl) => {
    const invalid = {
      ...exampleFixture,
      search: {
        ...exampleFixture.search,
        sources: [{ ...exampleFixture.search.sources[0], searchUrl }]
      }
    };
    let caught: unknown;
    try {
      parseAppConfig(invalid);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(inspect(caught)).not.toContain(searchUrl);
    expect(String(caught)).toContain("search.sources.0.searchUrl");
  }
);

test.each(["sync-mail", "import-jobs", "import-mail-file", "seed"])(
  "%s startup does not expose malformed configuration in stderr",
  (script) => {
    const root = temporaryRoot();
    const configPath = join(root, "invalid.json");
    const searchUrl = "SECRET_PRIVATE_SOURCE";
    const dataDir = join(root, "data");
    writeFileSync(
      configPath,
      JSON.stringify({
        ...exampleFixture,
        search: {
          ...exampleFixture.search,
          sources: [{ ...exampleFixture.search.sources[0], searchUrl }]
        },
        storage: { dataDir, outputDir: join(root, "output") }
      })
    );
    // Prevent real Mail/process execution even if a future regression accepts this invalid config.
    const guard =
      'import cp from "node:child_process"; import { syncBuiltinESMExports } from "node:module"; cp.execFile = () => { throw new Error("External command blocked by configuration test"); }; syncBuiltinESMExports();';
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--import",
        `data:text/javascript,${encodeURIComponent(guard)}`,
        resolve(`scripts/${script}.ts`)
      ],
      {
        env: { ...process.env, JOB_SEARCH_CONFIG: configPath },
        encoding: "utf8",
        timeout: 10_000
      }
    );
    expect(child.error).toBeUndefined();
    expect(child.status).not.toBe(0);
    expect(child.stderr + child.stdout).not.toContain(searchUrl);
    expect(child.stderr).toContain("search.sources.0.searchUrl");
    expect(existsSync(dataDir)).toBe(false);
  }
);

test("rejects unsafe configuration before runtime", () => {
  for (const search of [
    { ...exampleFixture.search, dailySelection: { permanent: 4, freelance: 2, total: 5 } },
    { ...exampleFixture.search, dailySelection: { permanent: -1, freelance: 0, total: 5 } }
  ])
    expect(() => parseAppConfig({ ...exampleFixture, search })).toThrow(/search.dailySelection/);
});

test("resolves storage and normalizes configured sender identities", () => {
  const runtime = toRuntimeDependencies(
    parseAppConfig({
      ...exampleFixture,
      mail: { ...exampleFixture.mail, senderAddresses: ["Candidate@Example.com"] }
    }),
    "/example-root"
  );
  expect(runtime.dataDir).toBe("/example-root/data");
  expect(runtime.outputDir).toBe("/example-root/output");
  expect(runtime.mailPolicy.senderAddresses.has("candidate@example.com")).toBe(true);
});

test("loads explicit and environment paths without leaking invalid JSON", () => {
  const path = join(temporaryRoot(), "local.json");
  writeFileSync(path, JSON.stringify(exampleFixture));
  vi.stubEnv("JOB_SEARCH_CONFIG", path);
  expect(loadAppConfig().candidate.signature).toBe("Alex Morgan");
  writeFileSync(path, '{"SECRET_INVALID_JSON');
  expect(() => loadAppConfig(path)).toThrow(/configuration/i);
  try {
    loadAppConfig(path);
  } catch (error) {
    expect(String(error)).not.toContain("SECRET");
  }
});

test("fails before storage or Mail side effects", async () => {
  const dependencies = { mkdir: vi.fn(), openDatabase: vi.fn(), listen: vi.fn() };
  await expect(
    startServer({ configPath: join(temporaryRoot(), "missing.json"), dependencies })
  ).rejects.toThrow(/configuration/i);
  expect(dependencies.mkdir).not.toHaveBeenCalled();
  expect(dependencies.openDatabase).not.toHaveBeenCalled();
  expect(dependencies.listen).not.toHaveBeenCalled();
});

test("invalid configuration also fails before creating storage", async () => {
  const configPath = join(temporaryRoot(), "invalid.json");
  writeFileSync(
    configPath,
    JSON.stringify({ ...exampleFixture, mail: { ...exampleFixture.mail, accounts: [] } })
  );
  const dependencies = { mkdir: vi.fn(), openDatabase: vi.fn(), listen: vi.fn() };
  await expect(startServer({ configPath, dependencies })).rejects.toThrow(/mail.accounts/);
  expect(dependencies.mkdir).not.toHaveBeenCalled();
  expect(dependencies.openDatabase).not.toHaveBeenCalled();
  expect(dependencies.listen).not.toHaveBeenCalled();
});

test("valid startup creates configured storage and an empty dashboard", async () => {
  const root = temporaryRoot();
  const configPath = join(root, "startup.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      ...exampleFixture,
      storage: { dataDir: join(root, "data"), outputDir: join(root, "output") }
    })
  );
  const events: string[] = [];
  let db: ReturnType<typeof createDatabase> | undefined;
  try {
    await startServer({
      configPath,
      dependencies: {
        mkdir: (path) => {
          events.push("mkdir");
          mkdirSync(path, { recursive: true });
        },
        openDatabase: (path) => {
          events.push("database");
          db = createDatabase(path);
          return db;
        },
        listen: async (app) => {
          events.push("listen");
          const response = await request(app).get("/api/dashboard").expect(200);
          expect(response.body.jobs).toEqual([]);
          expect(response.body.applications).toEqual([]);
          expect(response.body.searchSources).toHaveLength(1);
          expect(JSON.stringify(response.body)).not.toContain("candidate@example.com");
        }
      }
    });
    expect(events).toEqual(["mkdir", "mkdir", "database", "listen"]);
  } finally {
    db?.close();
  }
});
