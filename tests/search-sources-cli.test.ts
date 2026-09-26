import { migrationOptions } from "./config-fixture.js";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { runSearchSourcesCli } from "../scripts/search-sources.js";
import { createDatabase, migrate } from "../src/server/db/database.js";
import { SearchSourceRepository } from "../src/server/search-sources/repository.js";

const directories: string[] = [];
beforeEach(() => vi.stubEnv("JOB_SEARCH_CONFIG", resolve("config/example.json")));

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "search-sources-cli-"));
  directories.push(directory);
  const dbPath = join(directory, "sources.sqlite");
  const db = createDatabase(dbPath);
  migrate(db, migrationOptions);
  const repo = new SearchSourceRepository(db);
  const disabled = repo.create({
    name: "Disabled custom source",
    searchUrl: "https://disabled.example/jobs",
    category: "both",
    enabled: false
  });
  db.close();
  return { dbPath, disabled };
}

describe("search sources CLI", () => {
  test("list emits JSON for enabled sources only", () => {
    const { dbPath, disabled } = setup();
    const output: string[] = [];
    expect(runSearchSourcesCli(["list"], dbPath, (line) => output.push(line))).toBe(0);
    const rows = JSON.parse(output.join("")) as Array<{
      id: number;
      enabled: number;
      search_url: string;
    }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.enabled === 1)).toBe(true);
    expect(rows.some((row) => row.id === disabled.id)).toBe(false);
    expect(
      rows.find((row) => row.search_url.startsWith("https://jobs.example.com"))?.search_url
    ).toBe("https://jobs.example.com/search");
    expect(rows.every((row) => new URL(row.search_url).search === "")).toBe(true);
  });

  test("record stores success and error history and updates source state", () => {
    const { dbPath } = setup();
    const db = createDatabase(dbPath);
    const id = new SearchSourceRepository(db).listEnabled()[0].id;
    db.close();
    const errors: string[] = [];
    expect(
      runSearchSourcesCli(
        ["record", String(id), "success", "8", "2", "2026-09-25T07:00:00.000Z"],
        dbPath,
        () => {},
        (line) => errors.push(line)
      )
    ).toBe(0);
    expect(
      runSearchSourcesCli(
        ["record", String(id), "error", "0", "0", "2026-09-26T07:00:00.000Z", "Login required"],
        dbPath,
        () => {},
        (line) => errors.push(line)
      )
    ).toBe(0);
    expect(errors).toEqual([]);
    const checked = createDatabase(dbPath);
    expect(
      new SearchSourceRepository(checked).list().find((source) => source.id === id)
    ).toMatchObject({
      last_checked_at: "2026-09-26T07:00:00.000Z",
      last_success_at: "2026-09-25T07:00:00.000Z",
      last_discovered_count: 8,
      last_imported_count: 2,
      last_error: "Login required"
    });
    expect(
      checked
        .prepare(
          "SELECT status,discovered_count,imported_count,error_text FROM search_source_checks WHERE search_source_id=? ORDER BY id"
        )
        .all(id)
    ).toEqual([
      { status: "success", discovered_count: 8, imported_count: 2, error_text: null },
      { status: "error", discovered_count: 0, imported_count: 0, error_text: "Login required" }
    ]);
    checked.close();
  });

  test.each([
    ["invalid id", ["record", "abc", "success", "1", "0", "2026-09-25T07:00:00.000Z"]],
    ["zero id", ["record", "0", "success", "1", "0", "2026-09-25T07:00:00.000Z"]],
    ["invalid status", ["record", "1", "pending", "1", "0", "2026-09-25T07:00:00.000Z"]],
    [
      "invalid discovered count",
      ["record", "1", "success", "1.5", "0", "2026-09-25T07:00:00.000Z"]
    ],
    ["negative imported count", ["record", "1", "success", "1", "-1", "2026-09-25T07:00:00.000Z"]],
    [
      "imported count over discovered",
      ["record", "1", "success", "1", "2", "2026-09-25T07:00:00.000Z"]
    ],
    ["invalid timestamp", ["record", "1", "success", "1", "0", "yesterday"]],
    ["missing error text", ["record", "1", "error", "0", "0", "2026-09-25T07:00:00.000Z"]],
    ["unknown command", ["delete"]]
  ])("rejects %s without recording a check", (_label, args) => {
    const { dbPath } = setup();
    const errors: string[] = [];
    expect(
      runSearchSourcesCli(
        args,
        dbPath,
        () => {},
        (line) => errors.push(line)
      )
    ).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].length).toBeGreaterThan(0);
    const db = createDatabase(dbPath);
    expect(db.prepare("SELECT COUNT(*) AS count FROM search_source_checks").get()).toEqual({
      count: 0
    });
    expect(
      db
        .prepare("SELECT COUNT(*) AS count FROM search_sources WHERE last_checked_at IS NOT NULL")
        .get()
    ).toEqual({ count: 0 });
    db.close();
  });

  test.each([
    ["unknown command", ["delete"]],
    ["malformed record", ["record", "abc", "success", "1", "0", "2026-09-25T07:00:00.000Z"]]
  ])("rejects %s before creating a fresh database", (_label, args) => {
    const directory = mkdtempSync(join(tmpdir(), "search-sources-cli-fresh-"));
    directories.push(directory);
    const dbPath = join(directory, "missing.sqlite");
    const errors: string[] = [];
    expect(
      runSearchSourcesCli(
        args,
        dbPath,
        () => {},
        (line) => errors.push(line)
      )
    ).toBe(1);
    expect(errors).toHaveLength(1);
    expect(existsSync(dbPath)).toBe(false);
  });

  test("reports database-open failures through writeError", () => {
    const directory = mkdtempSync(join(tmpdir(), "search-sources-cli-open-"));
    directories.push(directory);
    const dbPath = join(directory, "nonexistent", "sources.sqlite");
    const errors: string[] = [];
    expect(
      runSearchSourcesCli(
        ["list"],
        dbPath,
        () => {},
        (line) => errors.push(line)
      )
    ).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("directory");
    expect(existsSync(dbPath)).toBe(false);
  });
});
