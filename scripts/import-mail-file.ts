import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDatabase, migrate } from "../src/server/db/database.js";
import { JobRepository } from "../src/server/db/repository.js";
import { parseAppleMailRows } from "../src/server/mail/apple-mail.js";
import { syncMailMessages } from "../src/server/mail/sync.js";
import { loadAppConfig } from "../src/server/config/load.js";
import { toRuntimeDependencies } from "../src/server/config/runtime.js";

const sourcePath = process.argv[2];
const { config, dataDir, repositoryOptions } = toRuntimeDependencies(loadAppConfig());
if (!sourcePath) throw new Error("Usage: npm run import:mail-file -- path/to/export.dat");
mkdirSync(dataDir, { recursive: true });
const db = createDatabase(resolve(dataDir, "jobs.db"));
migrate(db, { searchSources: config.search.sources, followUpSignature: config.candidate.signature });
try {
  const messages = parseAppleMailRows(readFileSync(resolve(sourcePath), "utf8"));
  const result = syncMailMessages(new JobRepository(db, repositoryOptions), messages);
  console.log(JSON.stringify({ sourcePath, candidates: messages.length, ...result }, null, 2));
} finally {
  db.close();
}
