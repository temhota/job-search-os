import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createDatabase, migrate } from "../src/server/db/database.js";
import { JobRepository } from "../src/server/db/repository.js";
import { exportAppleMail } from "../src/server/mail/apple-mail.js";
import { syncMailMessages } from "../src/server/mail/sync.js";

const dataDir = resolve("data");
mkdirSync(dataDir, { recursive: true });
const db = createDatabase(resolve(dataDir, "jobs.db"));
migrate(db);
const repo = new JobRepository(db);
const since = process.argv[2] ?? repo.getSyncCursor("apple_mail")?.slice(0, 10) ?? "2026-07-24";

try {
  const messages = await exportAppleMail(since, ["candidate@example.com", "Example Mail"]);
  const result = syncMailMessages(repo, messages);
  repo.setSyncCursor("apple_mail", new Date().toISOString());
  console.log(JSON.stringify({ since, candidates: messages.length, ...result }, null, 2));
} finally {
  db.close();
}
