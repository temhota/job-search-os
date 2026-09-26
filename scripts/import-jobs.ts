import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { createDatabase, migrate } from "../src/server/db/database.js";
import { JobRepository } from "../src/server/db/repository.js";
import { loadAppConfig } from "../src/server/config/load.js";
import { toRuntimeDependencies } from "../src/server/config/runtime.js";

const input = z.array(
  z.object({
    company: z.string().min(1),
    title: z.string().min(1),
    url: z.string().url().nullable().optional(),
    description: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    workMode: z.string().nullable().optional(),
    employmentType: z.enum(["permanent", "freelance"]),
    salaryMin: z.number().int().nullable().optional(),
    salaryMax: z.number().int().nullable().optional(),
    dayRate: z.number().int().nullable().optional(),
    source: z.string().min(1),
    searchSourceId: z.number().int().positive().nullable().optional(),
    postedAt: z.string().nullable().optional(),
    requiresSponsorship: z.boolean().optional(),
    language: z.string().nullable().optional()
  })
);

const sourcePath = process.argv[2];
const { config, dataDir, repositoryOptions } = toRuntimeDependencies(loadAppConfig());
if (!sourcePath) throw new Error("Usage: npm run import:jobs -- path/to/jobs.json");
const jobs = input.parse(JSON.parse(readFileSync(resolve(sourcePath), "utf8")));
mkdirSync(dataDir, { recursive: true });
const db = createDatabase(resolve(dataDir, "jobs.db"));
migrate(db, {
  searchSources: config.search.sources,
  followUpSignature: config.candidate.signature
});
try {
  const repo = new JobRepository(db, repositoryOptions);
  const imported = jobs.map((job) => repo.upsertJob(job));
  console.log(
    JSON.stringify({ processed: imported.length, ids: imported.map((job) => job.id) }, null, 2)
  );
} finally {
  db.close();
}
