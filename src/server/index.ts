import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import { createApp } from "./app.js";
import { createDatabase, migrate, type SqliteDatabase } from "./db/database.js";
import { JobRepository } from "./db/repository.js";
import { createDocumentGenerator, runDocumentProcess } from "./documents/generator.js";
import { openAppleMailReplyDraft } from "./mail/apple-mail-draft.js";
import { loadAppConfig } from "./config/load.js";
import { toRuntimeDependencies } from "./config/runtime.js";

export interface StartupDependencies {
  mkdir(path: string): void;
  openDatabase(path: string): SqliteDatabase;
  listen(app: Express, port: number): Promise<void>;
}

const defaultDependencies: StartupDependencies = {
  mkdir: (path) => { mkdirSync(path, { recursive: true }); },
  openDatabase: createDatabase,
  listen: (app, port) => new Promise((resolveListen, reject) => {
    const server = app.listen(port, "127.0.0.1", () => {
      console.log(`Job Search OS running at http://127.0.0.1:${port}`);
      resolveListen();
    });
    server.once("error", reject);
  })
};

export async function startServer(input: { configPath?: string; dependencies?: StartupDependencies }): Promise<void> {
  const runtime = toRuntimeDependencies(loadAppConfig(input.configPath));
  const dependencies = input.dependencies ?? defaultDependencies;
  dependencies.mkdir(runtime.dataDir);
  dependencies.mkdir(runtime.outputDir);
  const db = dependencies.openDatabase(resolve(runtime.dataDir, "jobs.db"));
  try {
    migrate(db, { searchSources: runtime.config.search.sources, followUpSignature: runtime.config.candidate.signature });
    const repo = new JobRepository(db, runtime.repositoryOptions);
    const app = createApp(db, {
      repositoryOptions: runtime.repositoryOptions,
      documentGenerator: createDocumentGenerator(repo, runtime.outputDir, runDocumentProcess, runtime.config.candidate),
      emailDraftOpener: (target) => openAppleMailReplyDraft(target, runtime.mailPolicy)
    });
    const dist = resolve("dist");
    app.use(express.static(dist));
    app.get("/{*path}", (_request, response) => response.sendFile(resolve(dist, "index.html")));
    await dependencies.listen(app, Number(process.env.PORT ?? 4174));
  } catch (error) { db.close(); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer({}).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Server startup failed");
    process.exitCode = 1;
  });
}
