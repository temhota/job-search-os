import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDatabase, migrate } from "../src/server/db/database.js";
import { JobRepository } from "../src/server/db/repository.js";
import { parseAppleMailRows } from "../src/server/mail/apple-mail.js";
import { syncMailMessages } from "../src/server/mail/sync.js";

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error("Usage: npm run import:mail-file -- path/to/export.dat");
const db = createDatabase(resolve("data/jobs.db"));
migrate(db);
try {
  const messages = parseAppleMailRows(readFileSync(resolve(sourcePath), "utf8"));
  const result = syncMailMessages(new JobRepository(db), messages);
  console.log(JSON.stringify({ sourcePath, candidates: messages.length, ...result }, null, 2));
} finally {
  db.close();
}
