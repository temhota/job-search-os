import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createDatabase, migrate } from "../src/server/db/database.js";
import { JobRepository } from "../src/server/db/repository.js";
import { exportAppleMail } from "../src/server/mail/apple-mail.js";
import { syncMailMessages } from "../src/server/mail/sync.js";
import { loadAppConfig } from "../src/server/config/load.js";
import { toRuntimeDependencies } from "../src/server/config/runtime.js";

const { config, dataDir, repositoryOptions } = toRuntimeDependencies(loadAppConfig());
mkdirSync(dataDir, { recursive: true });
const db = createDatabase(resolve(dataDir, "jobs.db"));
migrate(db, { searchSources: config.search.sources, followUpSignature: config.candidate.signature });
const repo = new JobRepository(db, repositoryOptions);
const since = process.argv[2] ?? repo.getSyncCursor("apple_mail")?.slice(0, 10) ?? config.mail.initialSyncDate;

try {
  const messages = await exportAppleMail(since, config.mail.accounts);
  const result = syncMailMessages(repo, messages);
  repo.setSyncCursor("apple_mail", new Date().toISOString());
  console.log(JSON.stringify({ since, candidates: messages.length, ...result }, null, 2));
} finally {
  db.close();
}
