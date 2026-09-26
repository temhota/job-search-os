import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { createDatabase, migrate } from "../src/server/db/database.js";
import { exampleFixture, migrationOptions } from "./config-fixture.js";

const { exportMail } = vi.hoisted(() => ({ exportMail: vi.fn(async () => []) }));
vi.mock("../src/server/mail/apple-mail.js", () => ({ exportAppleMail: exportMail }));
const roots: string[] = [];
const originalArgv = process.argv;
afterEach(() => {
  process.argv = originalArgv;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  exportMail.mockClear();
  vi.resetModules();
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

test.each([
  { cursor: null, explicit: null, expected: "2026-02-01" },
  { cursor: "2026-03-05T12:00:00.000Z", explicit: null, expected: "2026-03-05" },
  { cursor: "2026-03-05T12:00:00.000Z", explicit: "2026-04-09", expected: "2026-04-09" }
])("sync uses configured accounts and date precedence: $expected", async ({ cursor, explicit, expected }) => {
  const root = mkdtempSync(join(tmpdir(), "sync-config-")); roots.push(root);
  const dataDir = join(root, "data"); mkdirSync(dataDir);
  const configPath = join(root, "config.json");
  writeFileSync(configPath, JSON.stringify({ ...exampleFixture,
    mail: { ...exampleFixture.mail, accounts: ["Demo Inbox"], initialSyncDate: "2026-02-01" },
    storage: { dataDir, outputDir: join(root, "output") }
  }));
  const db = createDatabase(join(dataDir, "jobs.db"));
  migrate(db, migrationOptions);
  if (cursor) db.prepare("INSERT INTO sync_state (source,cursor) VALUES (?,?)").run("apple_mail", cursor);
  db.close();
  vi.stubEnv("JOB_SEARCH_CONFIG", configPath);
  process.argv = ["node", "sync-mail.ts", ...(explicit ? [explicit] : [])];
  vi.spyOn(console, "log").mockImplementation(() => {});
  await import("../scripts/sync-mail.js");
  expect(exportMail).toHaveBeenCalledExactlyOnceWith(expected, ["Demo Inbox"]);
  const synced = createDatabase(join(dataDir, "jobs.db"));
  try { expect(synced.prepare("SELECT cursor FROM sync_state WHERE source='apple_mail'").get()).toMatchObject({ cursor: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) }); }
  finally { synced.close(); }
});
