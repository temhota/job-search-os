// Break caught: scoring or follow-up logic silently violates the agreed search policy.
import { describe, expect, test } from "vitest";
import { buildFollowUpDraft, buildFollowUps, rankApplyToday, scoreJob } from "../src/shared/domain.js";

describe("scoreJob", () => {
  test("ranks a demo React Native match highly in a fictitious location", () => {
    const result = scoreJob({
      title: "Senior React Native Engineer",
      description: "React Native TypeScript Expo mobile app",
      location: "Sample Harbor",
      employmentType: "permanent",
      salaryMin: 80000,
      requiresSponsorship: false,
      language: "English",
      postedAt: "2026-09-22"
    }, new Date("2026-09-24T08:00:00Z"));

    expect(result.total).toBeGreaterThanOrEqual(85);
    expect(result.excluded).toBe(false);
    expect(result.reasons).toContain("Strong React Native/TypeScript match");
  });

  test("gives equal demo scores to all locations", () => {
    const base = { title: "Senior React Native Engineer", description: "TypeScript", employmentType: "permanent" as const };
    const now = new Date("2026-09-24T08:00:00Z");
    const scores = ["Sample Harbor", "Example Valley", "Remote", ""].map((location) => scoreJob({ ...base, location }, now).total);
    expect(scores).toEqual([95, 95, 95, 95]);
  });

  test.each(["permanent", "freelance"] as const)("uses a zero demo compensation floor for %s roles", (employmentType) => {
    const base = { title: "Senior React Native Engineer", description: "TypeScript", location: "Remote", employmentType };
    const now = new Date("2026-09-24T08:00:00Z");
    const unset = scoreJob(base, now).total;
    expect(scoreJob({ ...base, salaryMin: 0, dayRate: 0 }, now).total).toBe(unset);
    expect(scoreJob({ ...base, salaryMin: 1, dayRate: 1 }, now).total).toBe(unset);
  });

  test("excludes a role that requires sponsorship", () => {
    const result = scoreJob({
      title: "Senior React Engineer",
      description: "React TypeScript",
      location: "Berlin",
      employmentType: "permanent",
      requiresSponsorship: true
    }, new Date("2026-09-24T08:00:00Z"));

    expect(result.excluded).toBe(true);
    expect(result.total).toBe(0);
  });
});

describe("buildFollowUps", () => {
  test("creates reminders exactly seven and fourteen days after application", () => {
    expect(buildFollowUps("2026-09-01T09:00:00.000Z")).toEqual([
      { sequence: 1, dueAt: "2026-09-08T09:00:00.000Z" },
      { sequence: 2, dueAt: "2026-09-15T09:00:00.000Z" }
    ]);
  });

  test("prepares a draft without sending it", () => {
    expect(buildFollowUpDraft("Acme", "Senior React Engineer", 1)).toContain("Senior React Engineer at Acme");
    expect(buildFollowUpDraft("Acme", "Senior React Engineer", 1)).toContain("Best regards,\nAlex Morgan");
  });
});

describe("rankApplyToday", () => {
  test("keeps one freelance slot and excludes applied, blocked and archived leads", () => {
    const base = { triage_status: "new", duplicate_blocked: 0, application_id: null, url: "https://jobs.example/role", posted_at: "2026-09-23", created_at: "2026-09-20", location: "Berlin", work_mode: "remote" };
    const jobs = [
      ...[95, 94, 93, 92, 91, 90].map((score, index) => ({ ...base, id: index + 1, score, employment_type: "permanent" })),
      ...[89, 88].map((score, index) => ({ ...base, id: index + 7, score, employment_type: "freelance" })),
      { ...base, id: 9, score: 80, url: "javascript:bad", employment_type: "permanent" },
      { ...base, id: 10, score: 100, duplicate_blocked: 1, employment_type: "permanent" },
      { ...base, id: 11, score: 100, application_id: 4, employment_type: "permanent" },
      { ...base, id: 12, score: 100, triage_status: "skipped", employment_type: "permanent" }
    ];
    const ranked = rankApplyToday(jobs);
    expect(ranked.map((job) => job.id)).toEqual([1, 2, 3, 4, 7]);
    expect(ranked.filter((job) => job.employment_type === "freelance")).toHaveLength(1);
  });

  test("prefers a working URL and fresher posting when scores tie, then fills unused slots", () => {
    const base = { triage_status: "shortlisted", duplicate_blocked: 0, application_id: null, created_at: "2026-09-20", employment_type: "permanent" };
    const jobs = [
      { ...base, id: 1, score: 80, url: null, posted_at: "2026-09-24" },
      { ...base, id: 2, score: 80, url: "https://jobs.example/2", posted_at: "2026-09-22" },
      { ...base, id: 3, score: 80, url: "http://jobs.example/3", posted_at: "2026-09-23" },
      { ...base, id: 4, score: 79, url: null, posted_at: "2026-09-21" },
      { ...base, id: 5, score: 78, url: null, posted_at: "2026-09-21" }
    ];
    expect(rankApplyToday(jobs).map((job) => job.id)).toEqual([3, 2, 1, 4, 5]);
  });

  test("does not treat malformed HTTP URLs as working links", () => {
    const base = { triage_status: "new", duplicate_blocked: 0, application_id: null, posted_at: "2026-09-23", created_at: "2026-09-20", employment_type: "permanent", score: 80 };
    expect(rankApplyToday([
      { ...base, id: 1, url: "https://bad host" },
      { ...base, id: 2, url: "https://jobs.example/valid" }
    ]).map((job) => job.id)).toEqual([2, 1]);
  });
});
