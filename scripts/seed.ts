import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createDatabase, migrate } from "../src/server/db/database.js";
import { JobRepository } from "../src/server/db/repository.js";

mkdirSync("data", { recursive: true });
const db = createDatabase(resolve("data/jobs.db"));
migrate(db);
const repo = new JobRepository(db);

const jobs = [
  { company: "Northstar Health", title: "Senior React Native Engineer", url: "https://jobs.example.com/northstar-mobile", description: "React Native TypeScript Expo mobile application", location: "Germany Remote", employmentType: "permanent" as const },
  { company: "Orbit Learning", title: "Senior Frontend Engineer", url: "https://jobs.example.com/orbit-frontend", description: "React TypeScript accessible learning tools", location: "Berlin Hybrid", employmentType: "permanent" as const },
  { company: "Sample Systems", title: "Full-Stack Engineer", url: "https://jobs.example.com/sample-fullstack", description: "React TypeScript Node.js REST APIs", location: "Germany Remote", employmentType: "permanent" as const },
  { company: "Northstar Health", title: "Frontend Platform Engineer", url: "https://jobs.example.com/northstar-platform", description: "React TypeScript testing CI/CD", location: "Berlin Remote", employmentType: "permanent" as const },
  { company: "Orbit Learning", title: "Mobile Product Engineer", url: "https://jobs.example.com/orbit-mobile", description: "React Native TypeScript product engineering", location: "Europe Remote", employmentType: "permanent" as const },
  { company: "Sample Systems", title: "Freelance React Native Developer", url: "https://jobs.example.com/sample-contract", description: "React Native TypeScript iOS Android", location: "Europe Remote", employmentType: "freelance" as const, dayRate: 650 }
];

for (const job of jobs) repo.upsertJob({ ...job, source: "demo" });
console.log(JSON.stringify({ seeded: jobs.length, total: repo.listJobs().length }));
db.close();
