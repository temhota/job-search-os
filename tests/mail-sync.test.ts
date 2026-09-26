// Break caught: incremental Apple Mail sync duplicates evidence or overwrites a later stage with an earlier acknowledgement.
import { afterEach, describe, expect, test } from "vitest";
import { createDatabase, migrate } from "../src/server/db/database.js";
import { JobRepository } from "../src/server/db/repository.js";
import { syncMailMessages } from "../src/server/mail/sync.js";
import { SearchSourceRepository } from "../src/server/search-sources/repository.js";

const openDatabases: ReturnType<typeof createDatabase>[] = [];
afterEach(() => openDatabases.splice(0).forEach((db) => db.close()));

function setup() {
  const db = createDatabase(":memory:");
  openDatabases.push(db);
  migrate(db);
  return new JobRepository(db);
}

const base = {
  account: "candidate@example.com",
  mailbox: "INBOX",
  sender: "jobs@acme.example.com",
  recipients: "Alex Morgan <candidate@example.com>"
};

describe("syncMailMessages", () => {
  test("preserves registered discovery provenance when matching mail arrives", () => {
    const db = createDatabase(":memory:");
    openDatabases.push(db);
    migrate(db);
    const repo = new JobRepository(db);
    const source = new SearchSourceRepository(db).create({ name: "Registered feed", searchUrl: "https://registered.example/jobs", category: "both" });
    const job = repo.upsertJob({ company: "Acme", title: "Senior React Native Engineer", employmentType: "permanent", source: "Import", searchSourceId: source.id });

    const result = syncMailMessages(repo, [{
      ...base,
      messageId: "registered-ack@acme.example.com",
      receivedAt: "2026-08-01T09:00:00.000Z",
      subject: "Thank you for your application - Senior React Native Engineer",
      content: "We received your application for Senior React Native Engineer at Acme."
    }]);

    expect(result).toEqual({ imported: 1, duplicates: 0, needsReview: 0 });
    expect(repo.getJob(job.id)).toMatchObject({ search_source_id: source.id, source: "Registered feed" });
    expect(repo.listJobs()).toHaveLength(1);
    expect(repo.listApplications()).toHaveLength(1);
  });

  test("creates one application timeline from acknowledgement and rejection", () => {
    const db = createDatabase(":memory:");
    openDatabases.push(db);
    migrate(db);
    const repo = new JobRepository(db);
    const result = syncMailMessages(repo, [
      {
        ...base,
        messageId: "ack@acme.example.com",
        receivedAt: "2026-08-01T09:00:00.000Z",
        subject: "Thank you for your application - Senior React Native Engineer",
        content: "We received your application for Senior React Native Engineer at Acme."
      },
      {
        ...base,
        messageId: "reject@acme.example.com",
        receivedAt: "2026-08-12T09:00:00.000Z",
        subject: "Update on your application - Senior React Native Engineer",
        content: "At Acme, we decided not to proceed with your application."
      }
    ]);

    expect(result).toEqual({ imported: 2, duplicates: 0, needsReview: 0 });
    expect(repo.listApplications()).toHaveLength(1);
    expect(repo.listApplications()[0]).toMatchObject({ status: "rejected", applied_at: "2026-08-01T09:00:00.000Z" });
    expect(repo.listEvidence()).toHaveLength(2);
    expect(repo.dashboard("2026-08-20T00:00:00.000Z").followUps).toEqual([]);
    const followUps = db.prepare("SELECT status,draft FROM follow_ups ORDER BY sequence").all() as Array<{ status: string; draft: string }>;
    expect(followUps.every((row) => row.status === "dismissed")).toBe(true);
    expect(followUps[0].draft).toContain("Senior React Native Engineer at Acme");
  });

  test("is idempotent and reports existing message ids as duplicates", () => {
    const repo = setup();
    const message = {
      ...base,
      messageId: "same@acme.example.com",
      receivedAt: "2026-08-01T09:00:00.000Z",
      subject: "Thank you for your application - React Engineer",
      content: "We received your application for React Engineer at Acme."
    };
    syncMailMessages(repo, [message]);
    const second = syncMailMessages(repo, [message]);

    expect(second).toEqual({ imported: 0, duplicates: 1, needsReview: 0 });
    expect(repo.listEvidence()).toHaveLength(1);
  });

  test("captures the visible resume filename without copying the attachment", () => {
    const repo = setup();
    syncMailMessages(repo, [{
      ...base,
      messageId: "resume@acme.example.com",
      receivedAt: "2026-08-01T09:00:00.000Z",
      subject: "Thank you for your application - React Engineer",
      content: "We received your application for React Engineer at Acme.",
      attachmentNames: "Alex_Morgan_CV_React.pdf"
    }]);
    expect(repo.listApplications()[0]).toMatchObject({
      resume_version: "Alex_Morgan_CV_React.pdf",
      recruiter_contact: "jobs@acme.example.com"
    });
  });

  test("stores an ambiguous recruiting email in the review queue without creating a job", () => {
    const repo = setup();
    const result = syncMailMessages(repo, [{
      ...base,
      messageId: "chat@agency.example.com",
      receivedAt: "2026-08-02T09:00:00.000Z",
      subject: "Quick chat",
      content: "Are you open to opportunities?"
    }]);

    expect(result.needsReview).toBe(1);
    expect(repo.listJobs()).toHaveLength(0);
    expect(repo.listReviewQueue()).toHaveLength(1);
  });

  test("creates an interview timeline and records an unknown rejection reason without inventing feedback", () => {
    const repo = setup();
    syncMailMessages(repo, [{
      ...base,
      messageId: "interview@acme.example.com",
      receivedAt: "2026-08-05T09:00:00.000Z",
      subject: "Technical interview - Senior React Native Engineer",
      content: "Technical interview for Senior React Native Engineer at Acme."
    }, {
      ...base,
      messageId: "rejected@acme.example.com",
      receivedAt: "2026-08-08T09:00:00.000Z",
      subject: "Update on your application - Senior React Native Engineer",
      content: "At Acme, unfortunately we decided not to proceed."
    }]);

    const dashboard = repo.dashboard("2026-08-09T00:00:00.000Z");
    expect(dashboard.interviews).toHaveLength(1);
    expect(dashboard.interviews[0]).toMatchObject({ stage: "technical_interview", result: "rejected", explicit_feedback: null });
    expect(dashboard.insightDetails).toEqual([
      expect.objectContaining({ category: "reason_unknown", source_type: "system_inference" })
    ]);
  });

  test("attaches explicit employer feedback to the latest interview", () => {
    const repo = setup();
    syncMailMessages(repo, [{
      ...base,
      messageId: "architecture-interview@acme.example.com",
      receivedAt: "2026-08-05T09:00:00.000Z",
      subject: "Technical interview - Senior React Native Engineer",
      content: "Technical interview for Senior React Native Engineer at Acme."
    }, {
      ...base,
      messageId: "architecture-feedback@acme.example.com",
      receivedAt: "2026-08-08T09:00:00.000Z",
      subject: "Update on your application - Senior React Native Engineer",
      content: "At Acme, we decided not to proceed. Feedback: We need stronger React Native architecture experience."
    }]);

    const dashboard = repo.dashboard("2026-08-09T00:00:00.000Z");
    expect(dashboard.interviews[0]).toMatchObject({ result: "rejected", explicit_feedback: "We need stronger React Native architecture experience." });
    expect(dashboard.insightDetails).toEqual([
      expect.objectContaining({
        category: "react_native_mobile_architecture",
        text: "We need stronger React Native architecture experience.",
        source_type: "employer_feedback"
      })
    ]);
  });

  test("routes generic ATS status messages to review instead of inventing a job", () => {
    const repo = setup();
    const result = syncMailMessages(repo, [{
      ...base,
      sender: "notifications@myworkday.example.com",
      messageId: "generic-status@workday.example.com",
      receivedAt: "2026-08-08T09:00:00.000Z",
      subject: "Your application update - applying for the",
      content: "At this time, unfortunately we decided not to proceed."
    }]);
    expect(result.needsReview).toBe(1);
    expect(repo.listJobs()).toHaveLength(0);
    expect(repo.listReviewQueue()).toHaveLength(1);
  });
});
