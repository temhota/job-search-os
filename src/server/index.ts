import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { createApp } from "./app.js";
import { createDatabase, migrate } from "./db/database.js";
import { JobRepository } from "./db/repository.js";
import { createDocumentGenerator, runDocumentProcess } from "./documents/generator.js";
import { openAppleMailReplyDraft } from "./mail/apple-mail-draft.js";

const root = resolve(process.cwd());
const dataDir = resolve(root, "data");
mkdirSync(dataDir, { recursive: true });
const db = createDatabase(resolve(dataDir, "jobs.db"));
migrate(db);

const app = createApp(db, {
  documentGenerator: createDocumentGenerator(new JobRepository(db), resolve(root, "output"), runDocumentProcess),
  emailDraftOpener: openAppleMailReplyDraft
});
const dist = resolve(root, "dist");
app.use(express.static(dist));
app.get("/{*path}", (_request, response) => response.sendFile(resolve(dist, "index.html")));

const port = Number(process.env.PORT ?? 4174);
app.listen(port, "127.0.0.1", () => {
  console.log(`Job Search OS running at http://127.0.0.1:${port}`);
});
