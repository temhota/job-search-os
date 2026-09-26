import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createDatabase, migrate } from "../src/server/db/database.js";
import { SearchSourceRepository } from "../src/server/search-sources/repository.js";
import type { SearchSourceCheckInput } from "../src/shared/types.js";
import { loadAppConfig } from "../src/server/config/load.js";
import { toRuntimeDependencies } from "../src/server/config/runtime.js";

const usage =
  "Usage: search-sources list | record SOURCE_ID STATUS DISCOVERED IMPORTED CHECKED_AT [ERROR]";

function parseWholeNumber(value: string, label: string, minimum: number): number {
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${label} must be ${minimum === 1 ? "a positive" : "a non-negative"} integer`);
  }
  return parsed;
}

function parseCommand(
  args: string[]
): { kind: "list" } | { kind: "record"; sourceId: number; input: SearchSourceCheckInput } {
  if (args[0] === "list" && args.length === 1) return { kind: "list" };
  if (args[0] === "record" && (args.length === 6 || args.length === 7)) {
    const [id, status, discovered, imported, checkedAt, errorText] = args.slice(1);
    const sourceId = parseWholeNumber(id, "Source id", 1);
    if (status !== "success" && status !== "error")
      throw new Error("Status must be success or error");
    const discoveredCount = parseWholeNumber(discovered, "Discovered count", 0);
    const importedCount = parseWholeNumber(imported, "Imported count", 0);
    if (importedCount > discoveredCount)
      throw new Error("Imported count must be between zero and discovered count");
    if (!z.iso.datetime().safeParse(checkedAt).success)
      throw new Error("Checked time must be an ISO timestamp");
    if (status === "error" && !errorText?.trim())
      throw new Error("Error text is required for a failed check");
    return {
      kind: "record",
      sourceId,
      input: {
        status,
        discoveredCount,
        importedCount,
        checkedAt,
        errorText: status === "error" ? errorText : null
      }
    };
  }
  throw new Error(usage);
}

export function runSearchSourcesCli(
  args: string[],
  dbPath: string | undefined = undefined,
  write = console.log,
  writeError = console.error
): number {
  let db: ReturnType<typeof createDatabase> | undefined;
  try {
    const command = parseCommand(args);
    const { config, dataDir } = toRuntimeDependencies(loadAppConfig());
    if (!dbPath) mkdirSync(dataDir, { recursive: true });
    db = createDatabase(dbPath ?? resolve(dataDir, "jobs.db"));
    migrate(db, {
      searchSources: config.search.sources,
      followUpSignature: config.candidate.signature
    });
    const repo = new SearchSourceRepository(db);
    if (command.kind === "list") {
      write(JSON.stringify(repo.listEnabled(), null, 2));
      return 0;
    }
    repo.recordCheck(command.sourceId, command.input);
    return 0;
  } catch (error) {
    writeError(error instanceof Error ? error.message : "Search source command failed");
    return 1;
  } finally {
    db?.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runSearchSourcesCli(process.argv.slice(2));
}
