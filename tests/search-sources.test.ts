import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createDatabase, migrate } from "../src/server/db/database.js";
import { normalizeSearchUrl } from "../src/server/search-sources/catalog.js";
import { SearchSourceRepository } from "../src/server/search-sources/repository.js";
import { JobRepository } from "../src/server/db/repository.js";

const databases: ReturnType<typeof createDatabase>[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function setup() {
  const db = createDatabase(":memory:");
  databases.push(db);
  migrate(db);
  return { db, repo: new SearchSourceRepository(db) };
}

describe("search source migration", () => {
  test("persists only unfiltered landing pages for the initial source catalog", () => {
    const { repo } = setup();
    expect(repo.list().map((source) => source.search_url)).toEqual([
      "https://www.linkedin.com/jobs",
      "https://www.arbeitsagentur.de/jobsuche",
      "https://berlinstartupjobs.com",
      "https://pegel.berlin",
      "https://germantechjobs.de/en/jobs",
      "https://wellfound.com/jobs",
      "https://www.stepstone.de",
      "https://de.indeed.com",
      "https://join.com/jobs",
      "https://www.xing.com/jobs",
      "https://www.freelancermap.de/projektboerse.html",
      "https://uplink.tech/freelancers",
      "https://www.malt.de/c/freelancers",
      "https://www.gulp.de/gulp2/g/projekte"
    ]);
  });

  test("seeds 14 enabled defaults once and preserves edits to a seeded source", () => {
    const { db } = setup();
    expect(db.prepare("SELECT COUNT(*) count FROM search_sources").get()).toMatchObject({ count: 14 });
    expect(db.prepare("SELECT COUNT(*) count FROM search_sources WHERE enabled=1").get()).toMatchObject({ count: 14 });
    migrate(db);
    expect(db.prepare("SELECT COUNT(*) count FROM search_sources").get()).toMatchObject({ count: 14 });

    db.prepare("UPDATE search_sources SET name=?, search_url=? WHERE seed_key='linkedin'")
      .run("My LinkedIn", "https://www.linkedin.com/jobs/search/?keywords=Custom");
    migrate(db);

    expect(db.prepare("SELECT seed_key,name,search_url FROM search_sources WHERE seed_key='linkedin'").get())
      .toEqual({ seed_key: "linkedin", name: "My LinkedIn", search_url: "https://www.linkedin.com/jobs/search/?keywords=Custom" });
    expect(db.prepare("SELECT COUNT(*) count FROM search_sources WHERE seed_key='linkedin'").get()).toMatchObject({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) count FROM search_sources").get()).toMatchObject({ count: 14 });
  });

  test("adds a nullable source reference to existing jobs only once", () => {
    const { db } = setup();
    migrate(db);
    const columns = db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string; notnull: number }>;
    expect(columns.filter((column) => column.name === "search_source_id"))
      .toEqual([expect.objectContaining({ name: "search_source_id", notnull: 0 })]);
  });
});

describe("search URL canonicalization", () => {
  test("normalizes case, default ports, trailing slashes, fragments and query ordering", () => {
    expect(normalizeSearchUrl("HTTPS://Example.com:443/jobs/?q=React#top"))
      .toBe("https://example.com/jobs?q=React");
    expect(normalizeSearchUrl("https://example.com/?z=2&a=1"))
      .toBe("https://example.com/?a=1&z=2");
  });

  test("rejects unsupported schemes and embedded credentials", () => {
    expect(() => normalizeSearchUrl("javascript:alert(1)")).toThrow("Search URL must use HTTP or HTTPS");
    expect(() => normalizeSearchUrl("https://user:secret@example.com/jobs")).toThrow("Search URL must not contain credentials");
  });
});

describe("SearchSourceRepository", () => {
  test("rejects canonically duplicate URLs and filters disabled sources", () => {
    const { repo } = setup();
    const source = repo.create({ name: "Example", searchUrl: "https://example.com:443/jobs/?q=React#top", category: "both" });
    expect(() => repo.create({ name: "Duplicate", searchUrl: "HTTPS://EXAMPLE.COM/jobs?q=React", category: "permanent" }))
      .toThrow("Search source URL already exists");

    const disabled = repo.update(source.id, { enabled: false });
    expect(disabled).toMatchObject({ id: source.id, enabled: 0, category: "both" });
    expect(repo.listEnabled().some((row) => row.id === source.id)).toBe(false);
    expect(repo.list().find((row) => row.id === source.id)).toMatchObject({ enabled: 0 });
  });

  test("updates source fields and rejects a duplicate URL on update", () => {
    const { repo } = setup();
    const first = repo.create({ name: "First", searchUrl: "https://first.example/jobs", category: "permanent" });
    const second = repo.create({ name: "Second", searchUrl: "https://second.example/jobs", category: "freelance" });
    expect(repo.update(first.id, { name: "Renamed", category: "both", searchUrl: "https://first.example/roles" }))
      .toMatchObject({ name: "Renamed", category: "both", search_url: "https://first.example/roles" });
    expect(() => repo.update(second.id, { searchUrl: "HTTPS://FIRST.EXAMPLE:443/roles/#section" }))
      .toThrow("Search source URL already exists");
  });

  test("keeps the last successful counts when a later check errors", () => {
    const { db, repo } = setup();
    const { id } = repo.create({ name: "Checked", searchUrl: "https://checked.example/jobs", category: "permanent" });
    repo.recordCheck(id, { status: "success", discoveredCount: 8, importedCount: 2, checkedAt: "2026-09-25T07:00:00.000Z" });
    repo.recordCheck(id, { status: "error", discoveredCount: 0, importedCount: 0, errorText: "Login required", checkedAt: "2026-09-26T07:00:00.000Z" });
    expect(repo.list().find((row) => row.id === id)).toMatchObject({
      last_checked_at: "2026-09-26T07:00:00.000Z",
      last_success_at: "2026-09-25T07:00:00.000Z",
      last_discovered_count: 8,
      last_imported_count: 2,
      last_error: "Login required"
    });
    expect(db.prepare("SELECT checked_at,status,discovered_count,imported_count,error_text FROM search_source_checks WHERE search_source_id=? ORDER BY id").all(id))
      .toEqual([
        { checked_at: "2026-09-25T07:00:00.000Z", status: "success", discovered_count: 8, imported_count: 2, error_text: null },
        { checked_at: "2026-09-26T07:00:00.000Z", status: "error", discovered_count: 0, imported_count: 0, error_text: "Login required" }
      ]);
  });

  test("persists created sources and check history across database reopen", () => {
    const directory = mkdtempSync(join(tmpdir(), "search-sources-"));
    directories.push(directory);
    const filename = join(directory, "sources.sqlite");
    const db = createDatabase(filename);
    databases.push(db);
    migrate(db);
    const repo = new SearchSourceRepository(db);
    const { id } = repo.create({ name: "Persistent", searchUrl: "https://persistent.example/jobs", category: "both" });
    repo.recordCheck(id, { status: "success", discoveredCount: 5, importedCount: 1, checkedAt: "2026-09-25T07:00:00.000Z" });
    repo.recordCheck(id, { status: "error", discoveredCount: 0, importedCount: 0, errorText: "Unavailable", checkedAt: "2026-09-26T07:00:00.000Z" });
    db.close();

    const reopened = createDatabase(filename);
    databases.push(reopened);
    migrate(reopened);
    expect(new SearchSourceRepository(reopened).list().find((row) => row.id === id))
      .toMatchObject({ name: "Persistent", last_success_at: "2026-09-25T07:00:00.000Z", last_error: "Unavailable" });
    expect(reopened.prepare("SELECT COUNT(*) count FROM search_source_checks WHERE search_source_id=?").get(id))
      .toMatchObject({ count: 2 });
  });
});

describe("job search source attribution", () => {
  test("stores an enabled registered source on insert and update", () => {
    const { db, repo } = setup();
    const first = repo.create({ name: "React Native EU", searchUrl: "https://jobs.example.com/search", category: "both" });
    const second = repo.create({ name: "EU Tech", searchUrl: "https://tech.example.com/search", category: "permanent" });
    const jobs = new JobRepository(db);
    const input = { company: "Example", title: "React Native Engineer", employmentType: "permanent" as const, source: "Imported feed", url: "https://example.com/job/1" };
    const inserted = jobs.upsertJob({ ...input, searchSourceId: first.id });
    expect(inserted).toMatchObject({ search_source_id: first.id, source: first.name });
    const updated = jobs.upsertJob({ ...input, searchSourceId: second.id });
    expect(updated).toMatchObject({ id: inserted.id, search_source_id: second.id, source: second.name });
    expect(db.prepare("SELECT COUNT(*) count FROM jobs").get()).toMatchObject({ count: 1 });
  });

  test("rejects unknown and disabled ids before touching an existing job", () => {
    const { db, repo } = setup();
    const disabled = repo.create({ name: "Disabled", searchUrl: "https://disabled.example.com/search", category: "both", enabled: false });
    const jobs = new JobRepository(db);
    const input = { company: "Example", title: "React Native Engineer", employmentType: "permanent" as const, source: "Legacy feed", url: "https://example.com/job/2" };
    const original = jobs.upsertJob(input);
    for (const searchSourceId of [999999, disabled.id]) {
      expect(() => jobs.upsertJob({ ...input, searchSourceId })).toThrow("Search source is unavailable");
    }
    expect(jobs.getJob(original.id)).toMatchObject({ source: "Legacy feed", search_source_id: null });
    expect(db.prepare("SELECT COUNT(*) count FROM jobs").get()).toMatchObject({ count: 1 });
  });

  test("keeps legacy imports without a search source id", () => {
    const { db } = setup();
    const job = new JobRepository(db).upsertJob({ company: "Legacy", title: "Engineer", employmentType: "freelance", source: "Manual import" });
    expect(job).toMatchObject({ source: "Manual import", search_source_id: null });
  });

  test("preserves registered provenance when a matching legacy import omits the id", () => {
    const { db, repo } = setup();
    const registered = repo.create({ name: "Registered feed", searchUrl: "https://registered.example/jobs", category: "both" });
    const jobs = new JobRepository(db);
    const input = { company: "Example", title: "React Native Engineer", employmentType: "permanent" as const, url: "https://example.com/job/3" };
    const first = jobs.upsertJob({ ...input, source: "Import", searchSourceId: registered.id });

    const updated = jobs.upsertJob({ ...input, source: "Legacy feed", description: "Updated description" });

    expect(updated).toMatchObject({ id: first.id, search_source_id: registered.id, source: "Registered feed", description: "Updated description" });
  });

  test("explicit null clears registered provenance and uses the incoming source", () => {
    const { db, repo } = setup();
    const registered = repo.create({ name: "Registered feed", searchUrl: "https://registered.example/jobs", category: "both" });
    const jobs = new JobRepository(db);
    const input = { company: "Example", title: "React Native Engineer", employmentType: "permanent" as const, url: "https://example.com/job/4" };
    const first = jobs.upsertJob({ ...input, source: "Import", searchSourceId: registered.id });

    const updated = jobs.upsertJob({ ...input, source: "Manual correction", searchSourceId: null });

    expect(updated).toMatchObject({ id: first.id, search_source_id: null, source: "Manual correction" });
  });
});
