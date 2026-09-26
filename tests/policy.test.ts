import { expect, test } from "vitest";
import { scoreJob, rankApplyToday, buildFollowUpDraft } from "../src/shared/domain.js";
import { isReplyableSender } from "../src/server/mail/address.js";
import { exampleFixture } from "./config-fixture.js";
const policy = exampleFixture.search;

test.each(["permanent", "freelance"] as const)("zero %s slots disables that employment category", (disabled) => {
  const jobs = ["permanent", "freelance"].map((employment, id) => ({ id, score: 90, employment_type: employment as "permanent" | "freelance", triage_status: "new" as const, duplicate_blocked: 0, application_id: null, url: null, posted_at: null, created_at: "2026-01-01" }));
  const result = rankApplyToday(jobs, { ...policy, dailySelection: { permanent: 1, freelance: 1, total: 5, [disabled]: 0 } });
  expect(result.map((job) => job.employment_type)).toEqual([disabled === "permanent" ? "freelance" : "permanent"]);
});

test("unknown compensation remains eligible and below-floor compensation earns no bonus", () => {
  const job = { title: "Engineer", employmentType: "permanent" as const };
  expect(scoreJob(job, policy)).toMatchObject({ excluded: false, total: 25 });
  expect(scoreJob({ ...job, salaryMin: 1 }, policy).total).toBe(10);
});

test("sponsorship exclusion follows the configured switch", () => {
  const job = { title: "Engineer", employmentType: "permanent" as const, requiresSponsorship: true };
  expect(scoreJob(job, policy).excluded).toBe(true);
  expect(scoreJob(job, { ...policy, excludeSponsorshipRequired: false }).excluded).toBe(false);
});

test("follow-up signature is supplied by configuration", () => {
  expect(buildFollowUpDraft("Example", "Engineer", 1, "Sample Signer")).toContain("Best regards,\nSample Signer");
});

test.each(["SELF@EXAMPLE.COM", "Sample Person <self@example.com>", "no-reply@example.com"])("rejects unsafe sender %s", (sender) => {
  expect(isReplyableSender(sender, new Set(["self@example.com"]))).toBe(false);
});

test("allows a human sender outside the configured self-addresses", () => {
  expect(isReplyableSender("Recruiter <recruiter@example.com>", new Set(["self@example.com"]))).toBe(true);
});
