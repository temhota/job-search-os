import { migrationOptions, repositoryOptions } from "./config-fixture.js";
// Break caught: a repeated import creates duplicate jobs/applications instead of updating evidence.
import { afterEach, describe, expect, test } from "vitest";
import { createDatabase, migrate } from "../src/server/db/database.js";
import { JobRepository } from "../src/server/db/repository.js";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function setup() {
  const db = createDatabase(":memory:");
  databases.push(db);
  migrate(db, migrationOptions);
  return new JobRepository(db, repositoryOptions);
}

describe("JobRepository", () => {
  test("persists sponsorship requirements across partial imports and applies the current exclusion policy to Today", () => {
    const db = createDatabase(":memory:");
    databases.push(db);
    migrate(db, migrationOptions);
    const repo = new JobRepository(db, repositoryOptions);
    const input = { company: "Example Sponsor", title: "Engineer", employmentType: "permanent" as const, source: "web" };
    const job = repo.upsertJob({ ...input, requiresSponsorship: true });
    repo.upsertJob({ ...input, description: "Updated description" });
    const reopened = new JobRepository(db, repositoryOptions);
    expect(reopened.getJob(job.id).requires_sponsorship).toBe(1);
    expect(reopened.dashboard().today.applyToday).toEqual([]);
    expect(reopened.dashboard().jobs).toHaveLength(1);
    const allowed = new JobRepository(db, { ...repositoryOptions, search: { ...repositoryOptions.search, excludeSponsorshipRequired: false } });
    expect(allowed.dashboard().today.applyToday.map((item) => item.id)).toEqual([job.id]);
  });

  test("updates Today eligibility when an import changes the sponsorship requirement", () => {
    const repo = setup();
    const input = { company: "Example Requirement", title: "Engineer", employmentType: "permanent" as const, source: "web" };
    const job = repo.upsertJob(input);
    repo.upsertJob({ ...input, requiresSponsorship: true });
    expect(repo.dashboard().today.applyToday).toEqual([]);
    repo.upsertJob({ ...input, requiresSponsorship: false });
    expect(repo.dashboard().today.applyToday.map((item) => item.id)).toEqual([job.id]);
  });

  test("orders review evidence by likely action and suggests only reliable application matches", () => {
    const repo = setup();
    const acme = repo.upsertJob({ company: "Acme", title: "Engineer", employmentType: "permanent", source: "web" });
    const linked = repo.upsertApplication(acme.id, "applied", "2026-09-01T09:00:00.000Z");
    const other = repo.upsertJob({ company: "Other", title: "Engineer", employmentType: "permanent", source: "web" });
    const direct = repo.upsertApplication(other.id, "applied", "2026-09-01T09:00:00.000Z");
    const duplicate = repo.upsertJob({ company: " Acme ", title: "Designer", employmentType: "permanent", source: "web" });
    const second = repo.upsertApplication(duplicate.id, "applied", "2026-09-01T09:00:00.000Z");
    const uniqueJob = repo.upsertJob({ company: "Unique Labs", title: "Engineer", employmentType: "permanent", source: "web" });
    const uniqueApplication = repo.upsertApplication(uniqueJob.id, "applied", "2026-09-01T09:00:00.000Z");
    expect(second).not.toBe(linked);
    const insert = (subject: string, classification: string, jobId: number | null = null, snippet = "Source text") => repo.recordEmailEvidence(jobId, {
      messageId: `${subject}@test.example.com`, account: "Example Mail", mailbox: "INBOX", receivedAt: "2026-09-20T09:00:00.000Z",
      sender: "sender@example.com", recipients: "Alex Morgan", subject, snippet, classification: classification as "unknown", confidence: 0.7, needsReview: true
    });
    const unknown = insert("Question", "unknown", null, "Meet at Unique Labs");
    const newsletter = insert("Weekly job alert", "unknown");
    const recruiter = insert("Recruiter call at Acme", "recruiter_screen");
    const rejection = insert("Unfortunately at Acme", "rejected");
    const update = insert("Application update", "technical_interview", other.id);
    const unique = insert("Interview at Unique Labs", "unknown");
    const queue = repo.listReviewQueue() as Array<{ id: number; review_group: string; suggested_application_id: number | null }>;
    expect(queue.map((row) => [row.id, row.review_group])).toEqual([
      [unique, "application_update"], [update, "application_update"], [rejection, "rejection"], [recruiter, "recruiter_conversation"],
      [newsletter, "newsletter_alert"], [unknown, "unknown"]
    ]);
    expect(queue.find((row) => row.id === unique)?.suggested_application_id).toBe(uniqueApplication);
    expect(queue.find((row) => row.id === update)?.suggested_application_id).toBe(direct);
    expect(queue.find((row) => row.id === recruiter)?.suggested_application_id).toBeNull();
    expect(queue.find((row) => row.id === rejection)?.suggested_application_id).toBeNull();
    expect(queue.find((row) => row.id === unknown)?.suggested_application_id).toBeNull();
  });

  test("falls back to one exact company match when the evidence-linked job has no application", () => {
    const repo = setup();
    const candidate = repo.upsertJob({ company: "Unique Labs", title: "Engineer", employmentType: "permanent", source: "web" });
    const applicationId = repo.upsertApplication(candidate.id, "applied", "2026-09-01T09:00:00.000Z");
    const linked = repo.upsertJob({ company: "Other", title: "Designer", employmentType: "permanent", source: "web" });
    const evidenceId = repo.recordEmailEvidence(linked.id, {
      messageId: "linked-without-application@example.com", account: "Example Mail", mailbox: "INBOX", receivedAt: "2026-09-20T09:00:00.000Z",
      sender: "recruiter@example.com", recipients: "Alex Morgan", subject: "Interview at Unique Labs", snippet: "An unrelated excerpt", classification: "unknown", confidence: 0.7, needsReview: true
    });
    const queue = repo.listReviewQueue() as Array<{ id: number; suggested_application_id: number | null }>;
    expect(queue.find((row) => row.id === evidenceId)?.suggested_application_id).toBe(applicationId);
  });

  test("keeps stage age stable when notes and priority change", () => {
    const db = createDatabase(":memory:");
    databases.push(db);
    migrate(db, migrationOptions);
    const repo = new JobRepository(db, repositoryOptions);
    const job = repo.upsertJob({ company: "StageCo", title: "Engineer", employmentType: "permanent", source: "web" });
    const id = repo.upsertApplication(job.id, "applied", "2026-09-10T09:00:00.000Z");
    expect((repo.dashboard("2026-09-24T12:00:00.000Z").pipeline.active.find((row) => row.id === id))?.days_in_stage).toBe(14);
    repo.updateApplication(id, { notes: "Prepare examples", priority: 5, nextStep: "Call recruiter" });
    expect((repo.dashboard("2026-09-24T12:00:00.000Z").pipeline.active.find((row) => row.id === id))?.days_in_stage).toBe(14);
  });

  test("records a late-arriving earlier status without rewinding the current stage", () => {
    const db = createDatabase(":memory:");
    databases.push(db);
    migrate(db, migrationOptions);
    const repo = new JobRepository(db, repositoryOptions);
    const job = repo.upsertJob({ company: "Late Mail", title: "Engineer", employmentType: "permanent", source: "web" });
    const id = repo.upsertApplication(job.id, "applied", "2026-09-18T09:00:00.000Z");
    repo.upsertApplication(job.id, "rejected", "2026-09-23T09:00:00.000Z");
    repo.upsertApplication(job.id, "offer", "2026-09-22T09:00:00.000Z");
    expect(db.prepare("SELECT status,stage_entered_at FROM applications WHERE id=?").get(id))
      .toMatchObject({ status: "rejected", stage_entered_at: "2026-09-23T09:00:00.000Z" });
    expect(db.prepare("SELECT status FROM application_status_events WHERE application_id=? ORDER BY occurred_at").all(id))
      .toEqual([{ status: "applied" }, { status: "offer" }, { status: "rejected" }]);
  });

  test("keeps a newer recruiter screen current when older technical evidence arrives late", () => {
    const db = createDatabase(":memory:");
    databases.push(db);
    migrate(db, migrationOptions);
    const repo = new JobRepository(db, repositoryOptions);
    const job = repo.upsertJob({ company: "Chronology", title: "Engineer", employmentType: "permanent", source: "web" });
    const id = repo.upsertApplication(job.id, "applied", "2026-09-01T09:00:00.000Z");
    repo.upsertApplication(job.id, "recruiter_screen", "2026-09-23T09:00:00.000Z");
    repo.upsertApplication(job.id, "technical_interview", "2026-09-20T09:00:00.000Z");
    expect(db.prepare("SELECT status,stage_entered_at FROM applications WHERE id=?").get(id))
      .toMatchObject({ status: "recruiter_screen", stage_entered_at: "2026-09-23T09:00:00.000Z" });
    expect(repo.dashboard("2026-09-24T12:00:00.000Z").pipeline.active.find((row) => row.id === id)?.days_in_stage).toBe(1);
    expect(db.prepare("SELECT status FROM application_status_events WHERE application_id=? ORDER BY occurred_at").all(id))
      .toEqual([{ status: "applied" }, { status: "technical_interview" }, { status: "recruiter_screen" }]);
  });

  test("completes, dismisses, and snoozes follow-ups with one activity each", () => {
    const db = createDatabase(":memory:");
    databases.push(db);
    migrate(db, migrationOptions);
    const repo = new JobRepository(db, repositoryOptions);
    const job = repo.upsertJob({ company: "FollowCo", title: "Engineer", employmentType: "permanent", source: "web" });
    const applicationId = repo.upsertApplication(job.id, "applied", "2026-09-01T09:00:00.000Z");
    db.prepare("INSERT INTO follow_ups (application_id,sequence,due_at,draft) VALUES (?,?,?,?)")
      .run(applicationId, 3, "2026-09-29T09:00:00.000Z", "Third follow-up");
    const rows = db.prepare("SELECT id,due_at FROM follow_ups WHERE application_id=? ORDER BY sequence").all(applicationId) as Array<{ id: number; due_at: string }>;

    expect(repo.updateFollowUp(rows[0].id, { action: "done" })).toMatchObject({ status: "done", due_at: rows[0].due_at });
    expect(repo.updateFollowUp(rows[1].id, { action: "dismiss" })).toMatchObject({ status: "dismissed", due_at: rows[1].due_at });
    expect(repo.updateFollowUp(rows[2].id, { action: "snooze", dueAt: "2026-09-30T09:00:00.000Z" }))
      .toMatchObject({ status: "pending", due_at: "2026-09-30T09:00:00.000Z" });
    expect(repo.updateFollowUp(999999, { action: "done" })).toBeNull();

    const activities = db.prepare("SELECT entity_id,action,source,details FROM activity WHERE entity_type='follow_up' ORDER BY id").all() as Array<{ entity_id: number; action: string; source: string; details: string }>;
    expect(activities).toHaveLength(3);
    expect(activities.map((row) => row.entity_id)).toEqual(rows.map((row) => row.id));
    expect(activities.map((row) => JSON.parse(row.details))).toEqual([
      { action: "done", previousDueAt: rows[0].due_at },
      { action: "dismiss", previousDueAt: rows[1].due_at },
      { action: "snooze", previousDueAt: rows[2].due_at, dueAt: "2026-09-30T09:00:00.000Z" }
    ]);
    expect(activities.every((row) => row.source === "manual")).toBe(true);
  });

  test("selects the latest replyable inbound email for a follow-up draft", () => {
    const db = createDatabase(":memory:");
    databases.push(db);
    migrate(db, migrationOptions);
    const repo = new JobRepository(db, repositoryOptions);
    const job = repo.upsertJob({ company: "FollowCo", title: "Engineer", employmentType: "permanent", source: "web" });
    repo.upsertApplication(job.id, "applied", "2026-09-01T09:00:00.000Z");
    const evidence = (messageId: string, receivedAt: string, sender: string, options: { mailbox?: string; account?: string; needsReview?: boolean } = {}) => repo.recordEmailEvidence(job.id, {
      messageId, account: options.account ?? "Example Mail", mailbox: options.mailbox ?? "INBOX", receivedAt, sender, recipients: "Alex Morgan <candidate@example.com>",
      subject: "Re: Your application", snippet: "Application update", classification: "applied", confidence: 0.9, needsReview: options.needsReview
    });
    evidence("human@example.com", "2026-09-20T09:00:00.000Z", "Alex Recruiter <alex@example.com>");
    evidence("sent@example.com", "2026-09-24T09:00:00.000Z", "Alex Recruiter <alex@example.com>", { mailbox: "Sent" });
    evidence("self@example.com", "2026-09-23T09:00:00.000Z", "Alex Morgan <candidate@example.com>");
    evidence("automated@example.com", "2026-09-22T09:00:00.000Z", "Hiring Team <notifications@smartrecruiters.example.com>");
    evidence("bulk@example.com", "2026-09-25T09:00:00.000Z", "Job Platform <shortlist@jobgether.example.com>");
    evidence("underscore@example.com", "2026-09-26T09:00:00.000Z", "Automation <no_reply@example.com>");
    evidence("numeric@example.com", "2026-09-27T09:00:00.000Z", "Automation <noreply123@example.com>");
    const ignored = evidence("ignored@example.com", "2026-09-28T09:00:00.000Z", "Ignored Person <ignored@example.com>");
    db.prepare("UPDATE email_evidence SET classification='ignored' WHERE id=?").run(ignored);
    evidence("review@example.com", "2026-09-29T09:00:00.000Z", "Unreviewed Person <review@example.com>", { needsReview: true });
    evidence("unapproved@example.com", "2026-09-30T09:00:00.000Z", "Legacy Person <legacy@example.com>", { account: "former@example.com" });
    const followUp = repo.dashboard("2026-09-25T09:00:00.000Z").followUps[0] as { id: number; draft: string };

    expect(repo.getFollowUpDraftTarget(followUp.id, "2026-09-25T09:00:00.000Z")).toEqual({
      followUpId: followUp.id,
      messageId: "human@example.com",
      account: "Example Mail",
      mailbox: "INBOX",
      draft: followUp.draft,
      recipient: "alex@example.com",
      subject: "Re: Your application"
    });
    expect(repo.getFollowUpDraftTarget(999999, "2026-09-25T09:00:00.000Z")).toBeNull();

    db.prepare("UPDATE follow_ups SET status='done' WHERE id=?").run(followUp.id);
    expect(repo.getFollowUpDraftTarget(followUp.id, "2026-09-25T09:00:00.000Z")).toBeNull();
    db.prepare("UPDATE follow_ups SET status='pending',due_at='2026-09-26T09:00:00.000Z' WHERE id=?").run(followUp.id);
    expect(repo.getFollowUpDraftTarget(followUp.id, "2026-09-25T09:00:00.000Z")).toBeNull();
  });

  test.each(["rejected", "withdrawn"] as const)("manual %s dismisses only pending follow-ups", (status) => {
    const db = createDatabase(":memory:");
    databases.push(db);
    migrate(db, migrationOptions);
    const repo = new JobRepository(db, repositoryOptions);
    const job = repo.upsertJob({ company: "Terminal Co", title: "Engineer", employmentType: "permanent", source: "web" });
    const applicationId = repo.upsertApplication(job.id, "applied", "2026-09-01T09:00:00.000Z");
    db.prepare("UPDATE follow_ups SET status='done' WHERE application_id=? AND sequence=1").run(applicationId);

    repo.updateApplication(applicationId, { status });

    expect(db.prepare("SELECT sequence,status FROM follow_ups WHERE application_id=? ORDER BY sequence").all(applicationId))
      .toEqual([{ sequence: 1, status: "done" }, { sequence: 2, status: "dismissed" }]);
    expect(db.prepare("SELECT action FROM activity WHERE entity_type='follow_up' AND action='auto_dismissed_terminal_status'").all())
      .toHaveLength(1);
  });

  test("imported rejection dismisses pending follow-ups while an active stage preserves them", () => {
    const db = createDatabase(":memory:");
    databases.push(db);
    migrate(db, migrationOptions);
    const repo = new JobRepository(db, repositoryOptions);
    const job = repo.upsertJob({ company: "Imported Terminal", title: "Engineer", employmentType: "permanent", source: "web" });
    const applicationId = repo.upsertApplication(job.id, "applied", "2026-09-01T09:00:00.000Z");

    repo.upsertApplication(job.id, "technical_interview", "2026-09-10T09:00:00.000Z", "email");
    expect(db.prepare("SELECT COUNT(*) count FROM follow_ups WHERE application_id=? AND status='pending'").get(applicationId))
      .toMatchObject({ count: 2 });

    repo.upsertApplication(job.id, "rejected", "2026-09-12T09:00:00.000Z", "email");
    expect(db.prepare("SELECT COUNT(*) count FROM follow_ups WHERE application_id=? AND status='pending'").get(applicationId))
      .toMatchObject({ count: 0 });
  });

  test("migration backfills stale terminal follow-ups once", () => {
    const db = createDatabase(":memory:");
    databases.push(db);
    migrate(db, migrationOptions);
    const repo = new JobRepository(db, repositoryOptions);
    const job = repo.upsertJob({ company: "Legacy Terminal", title: "Engineer", employmentType: "permanent", source: "web" });
    const applicationId = repo.upsertApplication(job.id, "applied", "2026-09-01T09:00:00.000Z");
    db.prepare("UPDATE applications SET status='rejected' WHERE id=?").run(applicationId);

    migrate(db, migrationOptions);
    migrate(db, migrationOptions);

    expect(db.prepare("SELECT status FROM follow_ups WHERE application_id=? ORDER BY sequence").all(applicationId))
      .toEqual([{ status: "dismissed" }, { status: "dismissed" }]);
    expect(db.prepare("SELECT COUNT(*) count FROM activity WHERE action='auto_dismissed_terminal_status'").get())
      .toMatchObject({ count: 2 });
  });

  test("marks a job applied once and leaves existing applications untouched", () => {
    const db = createDatabase(":memory:");
    databases.push(db);
    migrate(db, migrationOptions);
    const repo = new JobRepository(db, repositoryOptions);
    const job = repo.upsertJob({ company: "ApplyCo", title: "Engineer", employmentType: "permanent", source: "web" });
    repo.updateJobTriage(job.id, "skipped");

    const first = repo.markJobApplied(job.id, "2026-09-24T09:00:00.000Z") as { id: number; applied_at: string; status: string };
    const second = repo.markJobApplied(job.id, "2026-09-25T09:00:00.000Z");
    expect(second).toEqual(first);
    expect(repo.listJobs().find((item) => item.id === job.id)).toMatchObject({ triage_status: "skipped", application_status: "applied" });
    expect(db.prepare("SELECT COUNT(*) count FROM follow_ups WHERE application_id=?").get(first.id)).toMatchObject({ count: 2 });
    expect(db.prepare("SELECT COUNT(*) count FROM activity WHERE entity_type='application' AND entity_id=? AND action='application_created'").get(first.id)).toMatchObject({ count: 1 });
    expect(repo.markJobApplied(999999, "2026-09-24T09:00:00.000Z")).toBeNull();
  });

  test("migrates legacy jobs with and without applications to new triage state twice", () => {
    const db = createDatabase(":memory:");
    databases.push(db);
    db.exec(`
      CREATE TABLE jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT,
        description TEXT,
        location TEXT,
        work_mode TEXT,
        employment_type TEXT NOT NULL CHECK(employment_type IN ('permanent','freelance')),
        salary_min INTEGER,
        salary_max INTEGER,
        day_rate INTEGER,
        source TEXT NOT NULL,
        posted_at TEXT,
        score INTEGER NOT NULL DEFAULT 0,
        fingerprint TEXT NOT NULL UNIQUE,
        duplicate_blocked INTEGER NOT NULL DEFAULT 0,
        manual_unblock INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        applied_at TEXT,
        source TEXT,
        resume_version TEXT,
        notes TEXT NOT NULL DEFAULT '',
        priority INTEGER NOT NULL DEFAULT 0,
        next_step TEXT,
        rejection_reason TEXT,
        decision TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE email_evidence (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        message_id TEXT NOT NULL UNIQUE,
        account TEXT NOT NULL,
        mailbox TEXT NOT NULL,
        received_at TEXT NOT NULL,
        sender TEXT NOT NULL,
        recipients TEXT NOT NULL,
        subject TEXT NOT NULL,
        snippet TEXT NOT NULL,
        classification TEXT NOT NULL,
        confidence REAL NOT NULL,
        needs_review INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO jobs (id,company,title,employment_type,source,fingerprint)
      VALUES (101,'Acme','Engineer','permanent','legacy','legacy-101'),
             (102,'Beta','Designer','permanent','legacy','legacy-102'),
             (103,'Gamma','Engineer','permanent','legacy','legacy-103');
      INSERT INTO applications (job_id,status) VALUES (102,'applied');
      INSERT INTO applications (job_id,status,applied_at,updated_at)
        VALUES (103,'rejected','2026-09-01T09:00:00.000Z','2026-09-23T09:00:00.000Z');
      INSERT INTO email_evidence (job_id,message_id,account,mailbox,received_at,sender,recipients,subject,snippet,classification,confidence)
        VALUES (103,'old-screen','Example Mail','INBOX','2026-09-10T09:00:00.000Z','recruiter@example.com','Alex Morgan','Screen','Screen','recruiter_screen',0.95),
               (103,'old-offer','Example Mail','INBOX','2026-09-20T09:00:00.000Z','recruiter@example.com','Alex Morgan','Offer','Offer','offer',0.95);
    `);

    migrate(db, migrationOptions);
    migrate(db, migrationOptions);

    const repo = new JobRepository(db, repositoryOptions);
    expect(repo.listJobs().find((job) => job.id === 101)).toMatchObject({ id: 101, triage_status: "new", application_id: null });
    expect(repo.listJobs().find((job) => job.id === 102)).toMatchObject({ id: 102, triage_status: "new", application_status: "applied" });
    expect(db.prepare("SELECT stage_entered_at FROM applications WHERE job_id=102").get()).toMatchObject({ stage_entered_at: expect.any(String) });
    expect(db.prepare("SELECT COUNT(*) AS count FROM application_status_events WHERE application_id=(SELECT id FROM applications WHERE job_id=102)").get()).toMatchObject({ count: 1 });
    expect(db.prepare("SELECT status FROM application_status_events WHERE application_id=(SELECT id FROM applications WHERE job_id=103) ORDER BY occurred_at").all())
      .toEqual([{ status: "recruiter_screen" }, { status: "offer" }, { status: "rejected" }]);
  });

  test("persists manual triage changes and records their previous state", () => {
    const db = createDatabase(":memory:");
    databases.push(db);
    migrate(db, migrationOptions);
    const repo = new JobRepository(db, repositoryOptions);
    const job = repo.upsertJob({ company: "Acme", title: "Engineer", employmentType: "permanent", source: "web" });

    expect(repo.listJobs().find((item) => item.id === job.id)).toMatchObject({ triage_status: "new" });
    expect(repo.updateJobTriage(job.id, "shortlisted")).toMatchObject({ triage_status: "shortlisted" });
    expect(repo.listJobs().find((item) => item.id === job.id)).toMatchObject({ triage_status: "shortlisted" });
    const activity = db.prepare("SELECT action,source,details FROM activity WHERE entity_type='job' AND entity_id=?").get(job.id) as { action: string; source: string; details: string };
    expect(activity).toMatchObject({ action: "triage_updated", source: "manual" });
    expect(JSON.parse(activity.details)).toEqual({ previousStatus: "new", status: "shortlisted" });
  });

  test("upserts the same vacancy without creating a duplicate", () => {
    const repo = setup();
    const first = repo.upsertJob({
      company: "Northstar Health",
      title: "Senior Software Engineer - React Native",
      url: "https://jobs.example.com/northstar-mobile?ref=mail",
      location: "Germany Remote",
      employmentType: "permanent",
      source: "email"
    });
    const second = repo.upsertJob({
      company: "Northstar Health",
      title: "Senior Software Engineer – React Native",
      url: "https://jobs.example.com/northstar-mobile",
      location: "Remote, Germany",
      employmentType: "permanent",
      source: "web"
    });

    expect(second.id).toBe(first.id);
    expect(repo.listJobs()).toHaveLength(1);
  });

  test("keeps a different role at the same company and marks company history", () => {
    const repo = setup();
    repo.upsertJob({ company: "Acme", title: "Senior React Native Engineer", location: "Berlin", employmentType: "permanent", source: "email" });
    const other = repo.upsertJob({ company: "Acme", title: "Staff Frontend Engineer", location: "Berlin", employmentType: "permanent", source: "web" });

    expect(repo.listJobs()).toHaveLength(2);
    expect(other.sameCompanyHistory).toBe(true);
    expect(other.duplicateBlocked).toBe(false);
  });

  test("blocks a semantically identical role even when the source URL changes", () => {
    const repo = setup();
    const first = repo.upsertJob({ company: "Acme", title: "Senior React Native Engineer", url: "https://jobs.acme.test/123", location: "Berlin", employmentType: "permanent", source: "email" });
    repo.upsertApplication(first.id, "applied", "2026-08-01T10:00:00.000Z");
    const repeated = repo.upsertJob({ company: "ACME", title: "React Native Senior Developer", url: "https://linkedin.test/jobs/999", location: "Berlin, Germany", employmentType: "permanent", source: "web" });

    expect(repeated.id).toBe(first.id);
    expect(repeated.duplicateBlocked).toBe(true);
    expect(repo.listJobs()).toHaveLength(1);
  });

  test("stores application evidence once by Apple Mail message id", () => {
    const repo = setup();
    const job = repo.upsertJob({ company: "Acme", title: "React Engineer", location: "Berlin", employmentType: "permanent", source: "email" });
    repo.recordEmailEvidence(job.id, {
      messageId: "message-1@example.com",
      account: "candidate@example.com",
      mailbox: "INBOX",
      receivedAt: "2026-08-20T10:00:00.000Z",
      sender: "jobs@acme.example.com",
      recipients: "Alex Morgan",
      subject: "We received your application",
      snippet: "Thank you for applying.",
      classification: "applied",
      confidence: 0.98
    });
    repo.recordEmailEvidence(job.id, {
      messageId: "message-1@example.com",
      account: "candidate@example.com",
      mailbox: "INBOX",
      receivedAt: "2026-08-20T10:00:00.000Z",
      sender: "jobs@acme.example.com",
      recipients: "Alex Morgan",
      subject: "We received your application",
      snippet: "Thank you for applying.",
      classification: "applied",
      confidence: 0.98
    });

    expect(repo.listEvidence()).toHaveLength(1);
  });
});
