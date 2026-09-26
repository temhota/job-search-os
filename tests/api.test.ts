import { migrationOptions, repositoryOptions, testConfig } from "./config-fixture.js";
// Break caught: dashboard edits are not persisted or unsafe application fields are accepted.
import { afterEach, describe, expect, test } from "vitest";
import request from "supertest";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, migrate } from "../src/server/db/database.js";
import { JobRepository } from "../src/server/db/repository.js";
import { createApp } from "../src/server/app.js";
import { SearchSourceRepository } from "../src/server/search-sources/repository.js";
import type { DocumentGenerator } from "../src/server/documents/generator.js";
import { createDocumentGenerator } from "../src/server/documents/generator.js";

const databases: ReturnType<typeof createDatabase>[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

function setup() {
  const db = createDatabase(":memory:");
  databases.push(db);
  migrate(db, migrationOptions);
  const repo = new JobRepository(db, repositoryOptions);
  const job = repo.upsertJob({ company: "Acme", title: "Senior React Engineer", location: "Berlin", employmentType: "permanent", source: "web" });
  const applicationId = repo.upsertApplication(job.id, "applied", "2026-09-01T09:00:00.000Z");
  return { app: createApp(db, { repositoryOptions }), repo, applicationId, db };
}

function addReviewEvidence(repo: JobRepository, suffix: string) {
  return repo.recordEmailEvidence(null, {
    messageId: `review-${suffix}@example.com`,
    account: "Example Mail",
    mailbox: "INBOX",
    receivedAt: "2026-09-02T09:00:00.000Z",
    sender: "recruiter@example.com",
    recipients: "Alex Morgan",
    subject: "Quick chat",
    snippet: "Are you open to opportunities?",
    classification: "unknown",
    confidence: 0.35,
    needsReview: true
  });
}

describe("search source API", () => {
  test("exposes configured selection counts and excludes sponsorship-required jobs from the dashboard shortlist", async () => {
    const { db } = setup();
    const options = { ...repositoryOptions, search: { ...repositoryOptions.search, dailySelection: { permanent: 1, freelance: 2, total: 3 } } };
    const repo = new JobRepository(db, options);
    const excluded = repo.upsertJob({ company: "Example Sponsor", title: "Engineer", employmentType: "permanent", source: "web", requiresSponsorship: true });
    const response = await request(createApp(db, { repositoryOptions: options })).get("/api/dashboard").expect(200);
    expect(response.body.searchSelection).toEqual({ permanent: 1, freelance: 2, total: 3 });
    expect(response.body.today.applyToday.map((job: { id: number }) => job.id)).not.toContain(excluded.id);
    expect(response.body.jobs.map((job: { id: number }) => job.id)).toContain(excluded.id);
  });

  const sourceInput = { name: "React Native EU", searchUrl: "https://jobs.example.com/search?q=react-native&region=eu", category: "both", enabled: true };

  test("lists seeded sources, creates and disables a custom source, and includes the same rows in dashboard", async () => {
    const { app } = setup();
    const initial = await request(app).get("/api/search-sources").expect(200);
    expect(initial.body).toHaveLength(1);
    const created = await request(app).post("/api/search-sources").send(sourceInput).expect(201);
    expect(created.body).toMatchObject({ name: sourceInput.name, search_url: sourceInput.searchUrl, enabled: 1 });
    await request(app).patch(`/api/search-sources/${created.body.id}`).send({ enabled: false }).expect(200);
    const listed = (await request(app).get("/api/search-sources").expect(200)).body;
    expect(listed.find((row: { id: number }) => row.id === created.body.id).enabled).toBe(0);
    expect((await request(app).get("/api/dashboard").expect(200)).body.searchSources).toEqual(listed);
    expect(JSON.stringify(listed)).not.toContain("file_path");
  });

  test("rejects malformed sources, duplicate canonical URLs, and invalid or missing ids without writes", async () => {
    const { app, db } = setup();
    const created = await request(app).post("/api/search-sources").send(sourceInput).expect(201);
    const before = (db.prepare("SELECT COUNT(*) count FROM search_sources").get() as { count: number }).count;
    for (const searchUrl of ["javascript:alert(1)", "https://user:secret@jobs.example.com/search"]) {
      await request(app).post("/api/search-sources").send({ ...sourceInput, searchUrl }).expect(400);
    }
    await request(app).post("/api/search-sources").send({ ...sourceInput, category: "contract" }).expect(400);
    await request(app).post("/api/search-sources").send({ ...sourceInput, extra: true }).expect(400);
    await request(app).post("/api/search-sources").send({ ...sourceInput, searchUrl: "HTTPS://JOBS.EXAMPLE.COM:443/search/?region=eu&q=react-native#results" }).expect(409);
    await request(app).patch(`/api/search-sources/${created.body.id}`).send({ searchUrl: "javascript:alert(1)" }).expect(400);
    await request(app).patch(`/api/search-sources/${created.body.id}`).send({}).expect(400);
    await request(app).patch("/api/search-sources/999999").send({ enabled: false }).expect(404);
    await request(app).patch("/api/search-sources/not-an-id").send({ enabled: false }).expect(400);
    expect(db.prepare("SELECT COUNT(*) count FROM search_sources").get()).toMatchObject({ count: before });
    expect(new SearchSourceRepository(db).list().find((row) => row.id === created.body.id))
      .toMatchObject({ search_url: sourceInput.searchUrl, enabled: 1 });
  });

  test("records checks and rejects invalid checks without writes", async () => {
    const { app, db } = setup();
    const { body: source } = await request(app).post("/api/search-sources").send(sourceInput).expect(201);
    const valid = { status: "success", discoveredCount: 8, importedCount: 2, checkedAt: "2026-09-25T07:00:00.000Z" };
    await request(app).post(`/api/search-sources/${source.id}/checks`).send(valid).expect(201);
    await request(app).post(`/api/search-sources/${source.id}/checks`).send({ ...valid, discoveredCount: -1 }).expect(400);
    await request(app).post(`/api/search-sources/${source.id}/checks`).send({ ...valid, extra: true }).expect(400);
    await request(app).post("/api/search-sources/999999/checks").send(valid).expect(404);
    await request(app).post("/api/search-sources/not-an-id/checks").send(valid).expect(400);
    expect(db.prepare("SELECT COUNT(*) count FROM search_source_checks WHERE search_source_id=?").get(source.id)).toMatchObject({ count: 1 });
    expect(new SearchSourceRepository(db).list().find((row) => row.id === source.id))
      .toMatchObject({ last_discovered_count: 8, last_imported_count: 2, last_success_at: valid.checkedAt });
  });

  test("has no delete route and preserves source check history", async () => {
    const { app, db } = setup();
    const { body: source } = await request(app).post("/api/search-sources").send(sourceInput).expect(201);
    await request(app).post(`/api/search-sources/${source.id}/checks`).send({ status: "success", discoveredCount: 1, importedCount: 1, checkedAt: "2026-09-25T07:00:00.000Z" }).expect(201);
    await request(app).delete(`/api/search-sources/${source.id}`).expect(404);
    expect(new SearchSourceRepository(db).list().some((row) => row.id === source.id)).toBe(true);
    expect(db.prepare("SELECT COUNT(*) count FROM search_source_checks WHERE search_source_id=?").get(source.id)).toMatchObject({ count: 1 });
  });

  test("rejects foreign Origin for every search source mutation before writes", async () => {
    const { app, db } = setup();
    const { body: source } = await request(app).post("/api/search-sources").send(sourceInput).expect(201);
    const foreign = "https://attacker.example";
    await request(app).post("/api/search-sources").set("Origin", foreign).send({ ...sourceInput, searchUrl: "https://other.example/jobs" }).expect(403);
    await request(app).patch(`/api/search-sources/${source.id}`).set("Origin", foreign).send({ enabled: false }).expect(403);
    await request(app).post(`/api/search-sources/${source.id}/checks`).set("Origin", foreign).send({ status: "success", discoveredCount: 1, importedCount: 1, checkedAt: "2026-09-25T07:00:00.000Z" }).expect(403);
    expect(db.prepare("SELECT COUNT(*) count FROM search_sources").get()).toMatchObject({ count: 2 });
    expect(db.prepare("SELECT COUNT(*) count FROM search_source_checks").get()).toMatchObject({ count: 0 });
    expect(new SearchSourceRepository(db).list().find((row) => row.id === source.id)?.enabled).toBe(1);
  });
});

describe("dashboard API", () => {
  test("rejects non-loopback Host before serving dashboard or writing", async () => {
    const { app, repo, applicationId } = setup();
    await request(app).get("/api/dashboard").set("Host", "attacker.example").expect(400);
    await request(app).patch(`/api/applications/${applicationId}`).set("Host", "attacker.example").send({ notes: "injected" }).expect(400);
    expect(repo.listApplications()[0].notes).not.toBe("injected");
  });

  test("rejects foreign Origin for apply, bulk, document and application mutations before writes", async () => {
    const { db, repo, applicationId } = setup();
    const job = repo.upsertJob({ company: "NewCo", title: "Engineer", employmentType: "permanent", source: "web" });
    const evidenceId = addReviewEvidence(repo, "foreign-origin");
    let generated = 0;
    let openedDrafts = 0;
    const followUpId = Number((db.prepare("SELECT id FROM follow_ups WHERE application_id=? ORDER BY sequence LIMIT 1").get(applicationId) as { id: number }).id);
    const app = createApp(db, { repositoryOptions,
      documentGenerator: { generate: async () => { generated++; throw new Error("must not generate"); } },
      emailDraftOpener: async () => { openedDrafts++; }
    });
    const foreign = "https://attacker.example";
    await request(app).post(`/api/jobs/${job.id}/apply`).set("Origin", foreign).expect(403);
    await request(app).post("/api/evidence/bulk-ignore").set("Origin", foreign).send({ sender: "recruiter@example.com", evidenceIds: [evidenceId] }).expect(403);
    await request(app).post(`/api/jobs/${job.id}/documents`).set("Origin", foreign).send({ language: "English" }).expect(403);
    await request(app).post(`/api/follow-ups/${followUpId}/email-draft`).set("Origin", foreign).send({}).expect(403);
    await request(app).patch(`/api/applications/${applicationId}`).set("Origin", foreign).send({ notes: "injected" }).expect(403);
    expect(repo.listApplications()).toHaveLength(1);
    expect(repo.listApplications()[0].notes).not.toBe("injected");
    expect(repo.listEvidence().find((item) => item.id === evidenceId)?.needs_review).toBe(1);
    expect(generated).toBe(0);
    expect(openedDrafts).toBe(0);
  });

  test.each(["localhost:4311", "127.0.0.1:4311", "[::1]:4311"])("accepts matching local Host and Origin %s", async (host) => {
    const { app, repo, applicationId } = setup();
    await request(app).patch(`/api/applications/${applicationId}`).set("Host", host).set("Origin", `http://${host}`).send({ notes: "local edit" }).expect(200);
    expect(repo.listApplications()[0].notes).toBe("local edit");
  });
  test.each(["docx", "pdf"] as const)("missing %s output returns 500 without documents or activity", async (missing) => {
    const { db, repo } = setup();
    const root = mkdtempSync(join(tmpdir(), "api-documents-"));
    try {
      const job = repo.upsertJob({ company: "New Job", title: "React Native Engineer", employmentType: "permanent", source: "web" });
      const beforeApplications = repo.listApplications().length;
      const generator = createDocumentGenerator(repo, root, async (_command, args) => {
        if (missing === "pdf" && args.some((arg) => arg.endsWith("generate-resume.py"))) writeFileSync(args[2], "partial-docx");
      }, testConfig.candidate);
      await request(createApp(db, { repositoryOptions, documentGenerator: generator })).post(`/api/jobs/${job.id}/documents`).send({ language: "English" }).expect(500);
      expect(db.prepare("SELECT COUNT(*) AS count FROM documents WHERE job_id=?").get(job.id)).toMatchObject({ count: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM activity WHERE entity_type='job' AND entity_id=? AND action='documents_generated'").get(job.id)).toMatchObject({ count: 0 });
      expect(readdirSync(join(root, "tmp"))).toEqual([]);
      expect(readdirSync(join(root, "docx"))).toEqual([]);
      expect(readdirSync(join(root, "pdf"))).toEqual([]);
      expect(repo.listApplications()).toHaveLength(beforeApplications);
      expect(repo.getJob(job.id).triage_status).toBe("new");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test("downloads a registered document from a hidden worktree directory", async () => {
    const { app, repo } = setup();
    const hidden = mkdtempSync(join(tmpdir(), ".job-documents-"));
    try {
      const path = join(hidden, "resume.pdf");
      writeFileSync(path, "%PDF-test");
      const id = repo.registerDocument(1, { documentType: "resume", language: "en", format: "pdf", version: "v1", filePath: path });
      const response = await request(app).get(`/api/documents/${id}/download`).expect(200);
      expect(response.headers["content-disposition"]).toContain("resume.pdf");
    } finally {
      rmSync(hidden, { recursive: true, force: true });
    }
  });
  test("document endpoint validates language and exposes only download metadata", async () => {
    const { db, repo } = setup();
    const job = repo.listJobs()[0] as { id: number };
    const generator: DocumentGenerator = { generate: async (_id, language) => {
      const docxId = repo.registerDocument(job.id, { documentType: "resume", language: language === "English" ? "en" : "de", format: "docx", version: "v1", filePath: "/private/resume.docx" });
      const pdfId = repo.registerDocument(job.id, { documentType: "resume", language: language === "English" ? "en" : "de", format: "pdf", version: "v1", filePath: "/private/resume.pdf" });
      return { docx: repo.getDocument(docxId)!, pdf: repo.getDocument(pdfId)! };
    } };
    const app = createApp(db, { repositoryOptions, documentGenerator: generator });
    await request(app).post(`/api/jobs/${job.id}/documents`).send({ language: "French" }).expect(400);
    await request(app).post("/api/jobs/999999/documents").send({ language: "English" }).expect(404);
    const response = await request(app).post(`/api/jobs/${job.id}/documents`).send({ language: "German" }).expect(201);
    expect(response.body).toMatchObject({ docx: { format: "docx", language: "de" }, pdf: { format: "pdf", language: "de" } });
    expect(response.body.docx.download_url).toMatch(/^\/api\/documents\/\d+\/download$/);
    expect(JSON.stringify(response.body)).not.toContain("/private/");
  });

  test("document dependency failure returns 503 without database writes", async () => {
    const { db, repo } = setup();
    const job = repo.listJobs()[0] as { id: number };
    const generator: DocumentGenerator = { generate: async () => { throw Object.assign(new Error("Unavailable"), { code: "DOCUMENT_DEPENDENCY_UNAVAILABLE" }); } };
    const response = await request(createApp(db, { repositoryOptions, documentGenerator: generator })).post(`/api/jobs/${job.id}/documents`).send({ language: "English" }).expect(503);
    expect(response.body).toMatchObject({ error: "Document generation is unavailable on this Mac" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM documents").get()).toMatchObject({ count: 0 });
  });
  test("bulk-ignore resolves only the exact normalised sender, preserving rows and recording each decision", async () => {
    const { app, repo, db } = setup();
    const insert = (sender: string, suffix: string) => repo.recordEmailEvidence(null, {
      messageId: `bulk-${suffix}@example.com`, account: "Example Mail", mailbox: "INBOX", receivedAt: "2026-09-20T09:00:00.000Z",
      sender, recipients: "Alex Morgan", subject: "Job alert", snippet: "Original email", classification: "unknown", confidence: 0.3, needsReview: true
    });
    const first = insert("jobs@mail.example.com", "one");
    const display = insert("Jobs <jobs@mail.example.com>", "two");
    const plus = insert("jobs+other@mail.example.com", "three");
    const unseen = insert("jobs@mail.example.com", "arrived-after-confirmation");
    const ignored = await request(app).post("/api/evidence/bulk-ignore").send({ sender: "JOBS@mail.example.com", evidenceIds: [first, display] }).expect(200);
    expect(ignored.body).toMatchObject({ sender: "jobs@mail.example.com", count: 2, evidenceIds: [first, display] });
    const rows = repo.listEvidence() as Array<{ id: number; classification: string; needs_review: number; snippet: string }>;
    expect(rows).toHaveLength(4);
    expect(rows.filter((row) => [first, display].includes(row.id))).toEqual([
      expect.objectContaining({ classification: "ignored", needs_review: 0, snippet: "Original email" }),
      expect.objectContaining({ classification: "ignored", needs_review: 0, snippet: "Original email" })
    ]);
    expect(rows.find((row) => row.id === plus)).toMatchObject({ classification: "unknown", needs_review: 1 });
    expect((repo.listEvidence() as typeof rows).find((row) => row.id === unseen)).toMatchObject({ classification: "unknown", needs_review: 1 });
    const activities = db.prepare("SELECT entity_id,action FROM activity WHERE entity_type='email_evidence' AND action='review_bulk_ignored' ORDER BY entity_id").all();
    expect(activities).toEqual([{ entity_id: first, action: "review_bulk_ignored" }, { entity_id: display, action: "review_bulk_ignored" }]);
    await request(app).post("/api/evidence/bulk-ignore").send({ sender: "jobs@mail.example.com", evidenceIds: [display] }).expect(409);
    await request(app).post("/api/evidence/bulk-ignore").send({ sender: "jobs+other@mail.example.com", evidenceIds: [unseen] }).expect(409);
    await request(app).post("/api/evidence/bulk-ignore").send({ sender: "jobs+other@mail.example.com", evidenceIds: [plus, unseen] }).expect(409);
    expect((repo.listEvidence() as typeof rows).find((row) => row.id === plus)).toMatchObject({ classification: "unknown", needs_review: 1 });
    expect((repo.listEvidence() as typeof rows).find((row) => row.id === unseen)).toMatchObject({ classification: "unknown", needs_review: 1 });
    for (const sender of ["jobs@mail.example.com;other@mail.example.com", "Jobs <jobs@mail.example.com> extra", "a@@mail.example.com", "Jobs <jobs@mail.example.com>, Other <other@mail.example.com>"]) {
      await request(app).post("/api/evidence/bulk-ignore").send({ sender, evidenceIds: [unseen] }).expect(400);
    }
    await request(app).post("/api/evidence/bulk-ignore").send({ sender: "jobs@mail.example.com", evidenceIds: [unseen, unseen] }).expect(400);
    await request(app).post("/api/evidence/bulk-ignore").send({ sender: "Jobs <jobs@mail.example.com>", evidenceIds: [unseen] }).expect(200);
  });

  test("job details include only linked evidence, interviews, documents and activity", async () => {
    const { app, db, repo, applicationId } = setup();
    const other = repo.upsertJob({ company: "Other", title: "Engineer", employmentType: "permanent", source: "web" });
    const jobId = Number((repo.listApplications()[0] as { job_id: number }).job_id);
    const evidenceId = repo.recordEmailEvidence(jobId, { messageId: "linked@example.com", account: "Example Mail", mailbox: "INBOX", receivedAt: "2026-09-20T09:00:00.000Z", sender: "recruiter@example.com", recipients: "Alex Morgan", subject: "Antwort", snippet: "Wir sprechen morgen", classification: "recruiter_screen", confidence: 0.9 });
    repo.recordEmailEvidence(other.id, { messageId: "other@example.com", account: "Example Mail", mailbox: "INBOX", receivedAt: "2026-09-21T09:00:00.000Z", sender: "recruiter@example.com", recipients: "Alex Morgan", subject: "Other", snippet: "Unrelated", classification: "applied", confidence: 0.9 });
    repo.recordInterviewEvent(applicationId, evidenceId, { stage: "technical_interview", eventAt: "2026-09-22T09:00:00.000Z", participants: "recruiter@example.com" });
    const interview = db.prepare("SELECT id FROM interview_events WHERE application_id=?").get(applicationId) as { id: number };
    repo.addInterviewInsight(interview.id, { category: "system_design", text: "Meine Notiz" });
    repo.registerDocument(jobId, { documentType: "resume", language: "en", format: "pdf", version: "v1", filePath: "/private/secret.pdf" });
    repo.registerDocument(other.id, { documentType: "resume", language: "en", format: "pdf", version: "v1", filePath: "/private/other.pdf" });
    const response = await request(app).get(`/api/jobs/${jobId}/details`).expect(200);
    expect(response.body.application).toMatchObject({ id: applicationId, job_id: jobId, recruiter_contact: "recruiter@example.com" });
    expect(response.body.evidence).toEqual([expect.objectContaining({ id: evidenceId, snippet: "Wir sprechen morgen" })]);
    expect(response.body.interviews).toEqual([expect.objectContaining({ id: interview.id, application_id: applicationId })]);
    expect(response.body.insights).toEqual([expect.objectContaining({ interview_event_id: interview.id, text: "Meine Notiz" })]);
    expect(response.body.documents).toEqual([expect.objectContaining({ job_id: jobId, download_url: expect.stringMatching(/^\/api\/documents\/\d+\/download$/) })]);
    expect(JSON.stringify(response.body)).not.toContain("/private/");
    expect(response.body.activity.length).toBeGreaterThan(0);
    expect(response.body.activity.every((row: { entity_id: number }) => row.entity_id === applicationId || row.entity_id === interview.id)).toBe(true);
    await request(app).get("/api/jobs/999999/details").expect(404);
    await request(app).get("/api/jobs/not-a-number/details").expect(400);
  });

  test("job without an application still returns its linked evidence and documents", async () => {
    const { app, repo } = setup();
    const job = repo.upsertJob({ company: "Fresh", title: "Engineer", employmentType: "permanent", source: "web" });
    repo.recordEmailEvidence(job.id, { messageId: "fresh@example.com", account: "Example Mail", mailbox: "INBOX", receivedAt: "2026-09-20T09:00:00.000Z", sender: "jobs@example.com", recipients: "Alex Morgan", subject: "Stelle", snippet: "Interessant", classification: "unknown", confidence: 0.5 });
    repo.registerDocument(job.id, { documentType: "cover_letter", language: "de", format: "docx", version: "v1", filePath: "/private/letter.docx" });
    const response = await request(app).get(`/api/jobs/${job.id}/details`).expect(200);
    expect(response.body.application).toBeNull();
    expect(response.body.evidence).toHaveLength(1);
    expect(response.body.documents).toEqual([expect.objectContaining({ download_url: expect.stringMatching(/^\/api\/documents\/\d+\/download$/) })]);
    expect(response.body.interviews).toEqual([]);
  });
  test("detail IDs use canonical positive decimals", async () => {
    const { app } = setup();
    for (const id of ["0", "01", "+1", "1.0", "1e0", "-1", "abc", "9007199254740992"]) await request(app).get(`/api/jobs/${id}/details`).expect(400);
  });

  test("dashboard documents contain download metadata without private paths", async () => {
    const { app, repo } = setup();
    const jobId = Number((repo.listApplications()[0] as { job_id: number }).job_id);
    repo.registerDocument(jobId, { documentType: "resume", language: "en", format: "pdf", version: "v1", filePath: "/private/secret.pdf" });
    const response = await request(app).get("/api/dashboard").expect(200);
    expect(response.body.documents).toEqual([expect.objectContaining({ job_id: jobId, download_url: expect.stringMatching(/^\/api\/documents\/\d+\/download$/) })]);
    expect(JSON.stringify(response.body)).not.toContain("/private/secret.pdf");
    expect(response.body.documents[0]).not.toHaveProperty("file_path");
  });

  test("pipeline last activity follows linked interview, evidence and follow-up activity only", async () => {
    const { app, db, repo, applicationId } = setup();
    const jobId = Number((repo.listApplications()[0] as { job_id: number }).job_id);
    db.prepare("UPDATE applications SET updated_at='2026-09-01 00:00:00' WHERE id=?").run(applicationId);
    const evidenceId = repo.recordEmailEvidence(jobId, { messageId: "linked-activity@example.com", account: "Example Mail", mailbox: "INBOX", receivedAt: "2026-09-19T09:00:00.000Z", sender: "same@example.com", recipients: "Alex Morgan", subject: "Linked", snippet: "Linked", classification: "unknown", confidence: 0.5 });
    const other = repo.upsertJob({ company: "Other Activity", title: "Engineer", employmentType: "permanent", source: "web" });
    repo.recordEmailEvidence(other.id, { messageId: "other-activity@example.com", account: "Example Mail", mailbox: "INBOX", receivedAt: "2026-09-30T09:00:00.000Z", sender: "same@example.com", recipients: "Alex Morgan", subject: "Unrelated", snippet: "Unrelated", classification: "unknown", confidence: 0.5 });
    const imported = await request(app).get("/api/dashboard?today=2026-09-25T09:00:00.000Z").expect(200);
    expect(imported.body.pipeline.active[0].last_activity_at).toBe("2026-09-19T09:00:00.000Z");
    db.prepare("INSERT INTO interview_events (application_id,stage,event_at) VALUES (?, 'technical_interview', '2026-09-20T09:00:00.000Z')").run(applicationId);
    const interviewId = Number((db.prepare("SELECT id FROM interview_events WHERE application_id=?").get(applicationId) as { id: number }).id);
    const followUpId = Number((db.prepare("SELECT id FROM follow_ups WHERE application_id=? LIMIT 1").get(applicationId) as { id: number }).id);
    for (const [entityType, entityId, createdAt] of [["email_evidence", evidenceId, "2026-09-21 09:00:00"], ["interview_event", interviewId, "2026-09-22 09:00:00"], ["follow_up", followUpId, "2026-09-23 09:00:00"]] as const) {
      db.prepare("INSERT INTO activity (entity_type,entity_id,action,source,created_at) VALUES (?,?,'updated','manual',?)").run(entityType, entityId, createdAt);
      const response = await request(app).get("/api/dashboard?today=2026-09-25T09:00:00.000Z").expect(200);
      expect(response.body.pipeline.active[0].last_activity_at).toBe(createdAt);
    }
  });

  test("archive date comes from terminal status event rather than later edits", async () => {
    const { app, db, applicationId } = setup();
    db.prepare("UPDATE applications SET status='rejected', updated_at='2026-09-24 12:00:00' WHERE id=?").run(applicationId);
    db.prepare("INSERT INTO application_status_events (application_id,status,occurred_at,source) VALUES (?,'rejected','2026-09-20T09:00:00.000Z','manual')").run(applicationId);
    const response = await request(app).get("/api/dashboard?today=2026-09-25T09:00:00.000Z").expect(200);
    expect(response.body.pipeline.archive[0]).toMatchObject({ id: applicationId, archived_at: "2026-09-20T09:00:00.000Z" });
  });
  test("updates follow-ups through Done, Dismiss, and Snooze", async () => {
    const { app, db, applicationId } = setup();
    db.prepare("INSERT INTO follow_ups (application_id,sequence,due_at,draft) VALUES (?,?,?,?)")
      .run(applicationId, 3, "2026-09-29T09:00:00.000Z", "Third follow-up");
    const rows = db.prepare("SELECT id,due_at FROM follow_ups WHERE application_id=? ORDER BY sequence").all(applicationId) as Array<{ id: number; due_at: string }>;

    const done = await request(app).patch(`/api/follow-ups/${rows[0].id}`).send({ action: "done" }).expect(200);
    const dismissed = await request(app).patch(`/api/follow-ups/${rows[1].id}`).send({ action: "dismiss" }).expect(200);
    const snoozed = await request(app).patch(`/api/follow-ups/${rows[2].id}`).send({ action: "snooze", dueAt: "2026-09-30T09:00:00.000Z" }).expect(200);
    expect(done.body).toMatchObject({ status: "done", due_at: rows[0].due_at });
    expect(dismissed.body).toMatchObject({ status: "dismissed", due_at: rows[1].due_at });
    expect(snoozed.body).toMatchObject({ status: "pending", due_at: "2026-09-30T09:00:00.000Z" });
    expect(db.prepare("SELECT COUNT(*) count FROM activity WHERE entity_type='follow_up'").get()).toMatchObject({ count: 3 });
  });

  test("opens a reply draft without completing the follow-up", async () => {
    const { db, repo, applicationId } = setup();
    const jobId = Number((db.prepare("SELECT job_id FROM applications WHERE id=?").get(applicationId) as { job_id: number }).job_id);
    repo.recordEmailEvidence(jobId, {
      messageId: "recruiter-thread@example.com", account: "Example Mail", mailbox: "INBOX", receivedAt: "2026-09-20T09:00:00.000Z",
      sender: "Alex Recruiter <alex@example.com>", recipients: "Alex Morgan <candidate@example.com>", subject: "Re: Your application",
      snippet: "Thanks for applying", classification: "applied", confidence: 0.9
    });
    const followUp = db.prepare("SELECT id,draft FROM follow_ups WHERE application_id=? ORDER BY sequence LIMIT 1").get(applicationId) as { id: number; draft: string };
    const opened: unknown[] = [];
    const app = createApp(db, { repositoryOptions, emailDraftOpener: async (target) => { opened.push(target); } });

    await request(app).post(`/api/follow-ups/${followUp.id}/email-draft`).send({}).expect(201);

    expect(opened).toEqual([{
      followUpId: followUp.id,
      messageId: "recruiter-thread@example.com",
      account: "Example Mail",
      mailbox: "INBOX",
      draft: followUp.draft,
      recipient: "alex@example.com",
      subject: "Re: Your application"
    }]);
    expect(db.prepare("SELECT status FROM follow_ups WHERE id=?").get(followUp.id)).toMatchObject({ status: "pending" });
    expect(db.prepare("SELECT action FROM activity WHERE entity_type='follow_up' AND entity_id=?").all(followUp.id)).toEqual([{ action: "email_draft_opened" }]);
  });

  test("does not record a draft when there is no safe thread or Apple Mail fails", async () => {
    const { db, repo, applicationId } = setup();
    const jobId = Number((db.prepare("SELECT job_id FROM applications WHERE id=?").get(applicationId) as { job_id: number }).job_id);
    const followUpId = Number((db.prepare("SELECT id FROM follow_ups WHERE application_id=? ORDER BY sequence LIMIT 1").get(applicationId) as { id: number }).id);
    const app = createApp(db, { repositoryOptions, emailDraftOpener: async () => { throw new Error("Mail unavailable"); } });

    await request(app).post(`/api/follow-ups/${followUpId}/email-draft`).send({}).expect(409, { error: "No replyable email thread found" });
    repo.recordEmailEvidence(jobId, {
      messageId: "human@example.com", account: "Example Mail", mailbox: "INBOX", receivedAt: "2026-09-20T09:00:00.000Z",
      sender: "alex@example.com", recipients: "Alex Morgan", subject: "Application", snippet: "Update", classification: "applied", confidence: 0.9
    });
    await request(app).post(`/api/follow-ups/${followUpId}/email-draft`).send({}).expect(503, { error: "Unable to open Apple Mail draft" });
    expect(db.prepare("SELECT COUNT(*) count FROM activity WHERE action='email_draft_opened'").get()).toMatchObject({ count: 0 });
  });

  test("rejects invalid follow-up actions and missing IDs without side effects", async () => {
    const { app, db } = setup();
    const row = db.prepare("SELECT id,due_at FROM follow_ups ORDER BY id LIMIT 1").get() as { id: number; due_at: string };
    await request(app).patch(`/api/follow-ups/${row.id}`).send({ action: "snooze", dueAt: "tomorrow" }).expect(400);
    await request(app).patch(`/api/follow-ups/${row.id}`).send({ action: "unknown" }).expect(400);
    await request(app).patch(`/api/follow-ups/${row.id}`).send({ action: "done", dueAt: "2026-09-30T09:00:00.000Z" }).expect(400);
    await request(app).patch("/api/follow-ups/999999").send({ action: "done" }).expect(404);
    expect(db.prepare("SELECT status,due_at FROM follow_ups WHERE id=?").get(row.id)).toMatchObject({ status: "pending", due_at: row.due_at });
    expect(db.prepare("SELECT COUNT(*) count FROM activity WHERE entity_type='follow_up'").get()).toMatchObject({ count: 0 });
  });

  test("rejects a snooze that remains due on the current Berlin date", async () => {
    const { app, db } = setup();
    const row = db.prepare("SELECT id,due_at FROM follow_ups ORDER BY id LIMIT 1").get() as { id: number; due_at: string };
    const berlinToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    await request(app).patch(`/api/follow-ups/${row.id}`).send({ action: "snooze", dueAt: `${berlinToday}T12:00:00.000Z` }).expect(400);
    expect(db.prepare("SELECT due_at FROM follow_ups WHERE id=?").get(row.id)).toMatchObject({ due_at: row.due_at });
    expect(db.prepare("SELECT COUNT(*) count FROM activity WHERE entity_type='follow_up'").get()).toMatchObject({ count: 0 });
  });

  test("updates a vacancy's triage with only supported statuses", async () => {
    const { app, repo } = setup();
    const job = repo.upsertJob({ company: "TriageCo", title: "Frontend Engineer", employmentType: "permanent", source: "web" });

    const updated = await request(app).patch(`/api/jobs/${job.id}/triage`).send({ status: "shortlisted" }).expect(200);
    expect(updated.body).toMatchObject({ id: job.id, triage_status: "shortlisted" });
    await request(app).patch(`/api/jobs/${job.id}/triage`).send({ status: "maybe" }).expect(400);
    await request(app).patch(`/api/jobs/${job.id}/triage`).send({ status: "skipped", extra: true }).expect(400);
    await request(app).patch("/api/jobs/999999/triage").send({ status: "shortlisted" }).expect(404);
    expect(repo.listJobs().find((item) => item.id === job.id)).toMatchObject({ triage_status: "shortlisted" });
  });

  test("marks a vacancy as applied once while preserving its triage", async () => {
    const { app, repo, db } = setup();
    const job = repo.upsertJob({ company: "ApplyCo", title: "React Engineer", employmentType: "permanent", source: "web" });
    repo.updateJobTriage(job.id, "shortlisted");

    const first = await request(app).post(`/api/jobs/${job.id}/apply`).send({ appliedAt: "2026-09-24T09:00:00.000Z" }).expect(200);
    const second = await request(app).post(`/api/jobs/${job.id}/apply`).send({ appliedAt: "2026-09-25T09:00:00.000Z" }).expect(200);
    expect(first.body).toMatchObject({ job_id: job.id, status: "applied", applied_at: "2026-09-24T09:00:00.000Z", source: "manual" });
    expect(second.body).toEqual(first.body);
    expect(repo.listApplications().filter((row) => row.job_id === job.id)).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) count FROM follow_ups WHERE application_id=?").get(first.body.id)).toMatchObject({ count: 2 });
    expect(db.prepare("SELECT COUNT(*) count FROM activity WHERE entity_type='application' AND entity_id=? AND action='application_created'").get(first.body.id)).toMatchObject({ count: 1 });
    expect(repo.listJobs().find((item) => item.id === job.id)).toMatchObject({ triage_status: "shortlisted", application_status: "applied" });
  });

  test("rejects malformed application dates and missing jobs", async () => {
    const { app, repo } = setup();
    const job = repo.upsertJob({ company: "DateCo", title: "Engineer", employmentType: "permanent", source: "web" });
    await request(app).post(`/api/jobs/${job.id}/apply`).send({ appliedAt: "yesterday" }).expect(400);
    await request(app).post(`/api/jobs/${job.id}/apply`).send({ extra: true }).expect(400);
    await request(app).post("/api/jobs/999999/apply").send({ appliedAt: "2026-09-24T09:00:00.000Z" }).expect(404);
    expect(repo.listApplications().filter((row) => row.job_id === job.id)).toHaveLength(0);
  });

  test("uses the current time when marking applied without a request body", async () => {
    const { app, repo } = setup();
    const job = repo.upsertJob({ company: "NoBodyCo", title: "Engineer", employmentType: "permanent", source: "web" });
    const before = new Date().toISOString();

    const response = await request(app).post(`/api/jobs/${job.id}/apply`).expect(200);

    const after = new Date().toISOString();
    expect(response.body).toMatchObject({ job_id: job.id, status: "applied", source: "manual" });
    expect(response.body.applied_at >= before).toBe(true);
    expect(response.body.applied_at <= after).toBe(true);
  });

  test("returns the pipeline and due follow-ups", async () => {
    const { app } = setup();
    const response = await request(app).get("/api/dashboard?today=2026-09-10T09:00:00.000Z").expect(200);
    expect(response.body.summary).toMatchObject({ jobs: 1, applications: 1, interviews: 0 });
    expect(response.body.applications[0]).toMatchObject({ company: "Acme", status: "applied" });
    expect(response.body.followUps).toHaveLength(1);
    expect(response.body.sourceStats).toEqual([{ source: "email", count: 1 }]);
  });

  test("does not duplicate an application with only a due follow-up in Needs attention", async () => {
    const { app, applicationId } = setup();
    const response = await request(app).get("/api/dashboard?today=2026-09-10T09:00:00.000Z").expect(200);

    expect(response.body.today.followUpToday).toContainEqual(expect.objectContaining({ application_id: applicationId }));
    expect(response.body.today.needsAttention).not.toContainEqual(expect.objectContaining({
      kind: "application",
      application: expect.objectContaining({ id: applicationId })
    }));
  });

  test("does not return stale pending follow-ups for a terminal application", async () => {
    const { app, db, applicationId } = setup();
    db.prepare("UPDATE applications SET status='rejected' WHERE id=?").run(applicationId);

    const response = await request(app).get("/api/dashboard?today=2026-09-24T09:00:00.000Z").expect(200);

    expect(response.body.today.followUpToday.every((row: { application_id: number }) => row.application_id !== applicationId)).toBe(true);
    expect(response.body.followUps.every((row: { application_id: number }) => row.application_id !== applicationId)).toBe(true);
  });

  test("pipeline cards expose the next pending follow-up due date", async () => {
    const { app, applicationId, db } = setup();
    const first = db.prepare("SELECT due_at FROM follow_ups WHERE application_id=? AND sequence=1").get(applicationId) as { due_at: string };
    const response = await request(app).get("/api/dashboard?today=2026-09-10T09:00:00.000Z").expect(200);
    expect(response.body.pipeline.active[0]).toMatchObject({ id: applicationId, next_step_due_at: first.due_at, next_follow_up_sequence: 1 });
  });

  test("derives Today candidates, due work, attention and active/archive pipeline", async () => {
    const { app, repo, db, applicationId } = setup();
    const base = { title: "Senior TypeScript Engineer", location: "Berlin", employmentType: "permanent" as const, source: "web", postedAt: "2026-09-22" };
    Array.from({ length: 6 }, (_, index) => repo.upsertJob({ ...base, company: `Permanent ${index}`, url: `https://jobs.example/p${index}` }));
    Array.from({ length: 2 }, (_, index) => repo.upsertJob({ ...base, company: `Freelance ${index}`, employmentType: "freelance" as const, url: `https://jobs.example/f${index}` }));
    const invalid = repo.upsertJob({ ...base, company: "Invalid URL", url: "javascript:bad" });
    const blocked = repo.upsertJob({ ...base, company: "Blocked", url: "https://jobs.example/blocked" });
    db.prepare("UPDATE jobs SET duplicate_blocked=1 WHERE id=?").run(blocked.id);
    const alreadyApplied = repo.upsertJob({ ...base, company: "Already Applied", url: "https://jobs.example/applied" });
    repo.markJobApplied(alreadyApplied.id, "2026-09-20T09:00:00.000Z");
    const rejected = repo.upsertJob({ ...base, company: "Rejected", url: "https://jobs.example/rejected" });
    const withdrawn = repo.upsertJob({ ...base, company: "Withdrawn", url: "https://jobs.example/withdrawn" });
    const unknown = repo.upsertJob({ ...base, company: "Unknown", url: "https://jobs.example/unknown" });
    for (const [job, status] of [[rejected, "rejected"], [withdrawn, "withdrawn"], [unknown, "unknown"]] as const) {
      repo.upsertApplication(job.id, status, "2026-09-22T09:00:00.000Z");
    }
    db.prepare("UPDATE applications SET updated_at='2026-09-20T09:00:00.000Z', stage_entered_at='2026-09-20T09:00:00.000Z', next_step='Call recruiter' WHERE id=?").run(applicationId);
    db.prepare("INSERT INTO activity (entity_type,entity_id,action,source,details,created_at) VALUES ('application',?,'updated','manual','{}','2026-09-23T09:00:00.000Z')").run(applicationId);
    const response = await request(app).get("/api/dashboard?today=2026-09-24T12:00:00.000Z").expect(200);
    const dashboard = response.body;
    expect(dashboard.today.applyToday).toHaveLength(5);
    expect(dashboard.today.applyToday.filter((job: { employment_type: string }) => job.employment_type === "freelance")).toHaveLength(1);
    expect(dashboard.today.applyToday.some((job: { application_id: number | null }) => job.application_id)).toBe(false);
    expect(dashboard.today.applyToday.some((job: { duplicate_blocked: number }) => job.duplicate_blocked === 1)).toBe(false);
    expect(dashboard.today.applyToday.some((job: { id: number }) => job.id === invalid.id)).toBe(false);
    expect(dashboard.today.applyToday.some((job: { id: number }) => job.id === blocked.id)).toBe(false);
    expect(dashboard.today.followUpToday.length).toBeGreaterThan(0);
    expect(dashboard.pipeline.active.every((item: { status: string }) => !["rejected", "withdrawn", "unknown"].includes(item.status))).toBe(true);
    expect(dashboard.pipeline.archive.map((item: { status: string }) => item.status).sort()).toEqual(["rejected", "withdrawn"]);
    expect(dashboard.pipeline.needsAttention.map((item: { status: string }) => item.status)).toContain("unknown");
    expect(dashboard.today.needsAttention.some((item: { kind: string; application?: { status: string } }) => item.kind === "application" && item.application?.status === "unknown")).toBe(true);
    expect(dashboard.today.needsAttention.every((item: { kind: string; application?: { status: string } }) => item.kind !== "application" || !["rejected", "withdrawn"].includes(item.application?.status ?? ""))).toBe(true);
    expect(dashboard.pipeline.active.find((item: { id: number }) => item.id === applicationId)).toMatchObject({ last_activity_at: "2026-09-23T09:00:00.000Z", days_in_stage: 4 });
  });

  test("counts 7-day, 30-day, and all-time progress without future, unknown, or withdrawn responses", async () => {
    const { app, repo, db, applicationId } = setup();
    db.prepare("UPDATE applications SET applied_at='2026-09-20T09:00:00.000Z' WHERE id=?").run(applicationId);
    repo.upsertApplication(1, "recruiter_screen", "2026-09-22T09:00:00.000Z");
    const fixtures = [
      { company: "Rejected", status: "rejected", applied: "2026-09-10T09:00:00.000Z", updated: "2026-09-21T09:00:00.000Z" },
      { company: "Withdrawn", status: "withdrawn", applied: "2026-09-19T09:00:00.000Z", updated: "2026-09-23T09:00:00.000Z" },
      { company: "Unknown", status: "unknown", applied: "2026-09-18T09:00:00.000Z", updated: "2026-09-23T09:00:00.000Z" },
      { company: "Offer", status: "offer", applied: "2026-09-01T09:00:00.000Z", updated: "2026-09-05T09:00:00.000Z" }
    ];
    for (const item of fixtures) {
      const job = repo.upsertJob({ company: item.company, title: "Engineer", employmentType: "permanent", source: "web" });
      const id = repo.upsertApplication(job.id, "applied", item.applied);
      if (item.status !== "unknown") repo.upsertApplication(job.id, item.status, item.updated);
      else repo.updateApplication(id, { status: "unknown" });
    }
    const response = await request(app).get("/api/dashboard?today=2026-09-24T12:00:00.000Z").expect(200);
    expect(response.body.today.weeklyProgress).toEqual({
      last7Days: { applications: 3, responses: 1, interviews: 0, offers: 0, responseRate: 1 / 3 },
      last30Days: { applications: 5, responses: 3, interviews: 0, offers: 1, responseRate: 3 / 5 },
      allTime: { applications: 5, responses: 3, interviews: 0, offers: 1, responseRate: 3 / 5 }
    });
    expect(response.body.summary.responses).toBe(3);
  });

  test("all-time progress includes older history and excludes future-dated activity", async () => {
    const { app, repo, db } = setup();
    const oldJob = repo.upsertJob({ company: "Old response", title: "Engineer", employmentType: "permanent", source: "web" });
    const oldApplicationId = repo.upsertApplication(oldJob.id, "applied", "2026-07-01T09:00:00.000Z");
    repo.upsertApplication(oldJob.id, "recruiter_screen", "2026-07-03T09:00:00.000Z");
    db.prepare("INSERT INTO interview_events (application_id,stage,event_at) VALUES (?, 'technical_interview', '2026-07-04T09:00:00.000Z')").run(oldApplicationId);
    const futureJob = repo.upsertJob({ company: "Future response", title: "Engineer", employmentType: "permanent", source: "web" });
    repo.upsertApplication(futureJob.id, "applied", "2026-10-01T09:00:00.000Z");
    repo.upsertApplication(futureJob.id, "offer", "2026-10-02T09:00:00.000Z");
    const undatedJob = repo.upsertJob({ company: "Undated rejection", title: "Engineer", employmentType: "permanent", source: "email" });
    repo.upsertApplication(undatedJob.id, "rejected", "2026-08-01T09:00:00.000Z");

    const response = await request(app).get("/api/dashboard?today=2026-09-24T12:00:00.000Z").expect(200);
    expect(response.body.today.weeklyProgress.allTime).toEqual({
      applications: 3,
      responses: 2,
      interviews: 1,
      offers: 0,
      responseRate: 2 / 3
    });
  });

  test("includes due follow-ups through the Berlin calendar day and caps by date then priority", async () => {
    const { app, repo, db, applicationId } = setup();
    const high = repo.upsertJob({ company: "High Priority", title: "Engineer", employmentType: "permanent", source: "web" });
    const highId = repo.upsertApplication(high.id, "applied", "2026-09-01T09:00:00.000Z");
    db.prepare("UPDATE follow_ups SET status='done'").run();
    db.prepare("UPDATE applications SET priority=5 WHERE id=?").run(highId);
    db.prepare("UPDATE applications SET priority=1 WHERE id=?").run(applicationId);
    for (let index = 0; index < 12; index++) {
      db.prepare("INSERT INTO follow_ups (application_id,sequence,due_at,draft) VALUES (?,?,?,?)")
        .run(index % 2 ? highId : applicationId, index + 20, index === 0 ? "2026-09-23T20:00:00.000Z" : "2026-09-24T20:00:00.000Z", "Follow up");
    }
    db.prepare("INSERT INTO follow_ups (application_id,sequence,due_at,draft) VALUES (?,?,?,?)")
      .run(highId, 99, "2026-09-24T22:30:00.000Z", "Tomorrow in Berlin");
    const response = await request(app).get("/api/dashboard?today=2026-09-24T08:00:00.000Z").expect(200);
    expect(response.body.today.followUpToday).toHaveLength(10);
    expect(response.body.today.followUpRemainingCount).toBe(2);
    expect(response.body.today.followUpToday[0]).toMatchObject({ application_id: applicationId, due_at: "2026-09-23T20:00:00.000Z" });
    expect(response.body.today.followUpToday.slice(1, 7).every((item: { application_id: number }) => item.application_id === highId)).toBe(true);
    expect(response.body.followUps).toHaveLength(12);
  });

  test("places high-confidence lifecycle review evidence in a discriminated attention group", async () => {
    const { app, repo } = setup();
    const highId = repo.recordEmailEvidence(null, {
      messageId: "attention-high@example.com", account: "Example Mail", mailbox: "INBOX", receivedAt: "2026-09-24T07:00:00.000Z",
      sender: "recruiter@example.com", recipients: "Alex Morgan", subject: "Interview invitation", snippet: "Please choose a time",
      classification: "technical_interview", confidence: 0.95, needsReview: true
    });
    repo.recordEmailEvidence(null, {
      messageId: "attention-low@example.com", account: "Example Mail", mailbox: "INBOX", receivedAt: "2026-09-24T06:00:00.000Z",
      sender: "alert@example.com", recipients: "Alex Morgan", subject: "Jobs newsletter", snippet: "New jobs",
      classification: "unknown", confidence: 0.2, needsReview: true
    });
    const response = await request(app).get("/api/dashboard?today=2026-09-24T08:00:00.000Z").expect(200);
    expect(response.body.today.needsAttention).toContainEqual(expect.objectContaining({ kind: "review", evidence: expect.objectContaining({ id: highId }) }));
    expect(response.body.today.needsAttention.filter((item: { kind: string }) => item.kind === "review")).toHaveLength(1);
  });

  test("retains response and offer events after later status transitions and uses period cohorts", async () => {
    const { app, repo, db, applicationId } = setup();
    db.prepare("UPDATE applications SET applied_at='2026-09-18T09:00:00.000Z', stage_entered_at='2026-09-18T09:00:00.000Z' WHERE id=?").run(applicationId);
    repo.upsertApplication(1, "recruiter_screen", "2026-09-20T09:00:00.000Z");
    repo.upsertApplication(1, "offer", "2026-09-22T09:00:00.000Z");
    repo.upsertApplication(1, "rejected", "2026-09-23T09:00:00.000Z");
    const oldJob = repo.upsertJob({ company: "Old Cohort", title: "Engineer", employmentType: "permanent", source: "web" });
    const oldId = repo.upsertApplication(oldJob.id, "applied", "2026-08-01T09:00:00.000Z");
    repo.upsertApplication(oldJob.id, "recruiter_screen", "2026-09-21T09:00:00.000Z");
    const response = await request(app).get("/api/dashboard?today=2026-09-24T12:00:00.000Z").expect(200);
    expect(response.body.today.weeklyProgress.last7Days).toEqual({ applications: 1, responses: 1, interviews: 0, offers: 1, responseRate: 1 });
    expect(db.prepare("SELECT status FROM application_status_events WHERE application_id=? ORDER BY occurred_at").all(applicationId))
      .toEqual(expect.arrayContaining([expect.objectContaining({ status: "recruiter_screen" }), expect.objectContaining({ status: "offer" }), expect.objectContaining({ status: "rejected" })]));
    expect(db.prepare("SELECT COUNT(*) AS count FROM application_status_events WHERE application_id=?").get(oldId)).toMatchObject({ count: 2 });
  });

  test("records manual status transitions while leaving stage age unchanged for detail edits", async () => {
    const { app, repo, db, applicationId } = setup();
    db.prepare("UPDATE applications SET stage_entered_at='2026-09-10T09:00:00.000Z' WHERE id=?").run(applicationId);
    repo.updateApplication(applicationId, { notes: "Prepare", priority: 4 });
    expect(repo.dashboard("2026-09-24T12:00:00.000Z").pipeline.active.find((row) => row.id === applicationId)?.days_in_stage).toBe(14);
    await request(app).patch(`/api/applications/${applicationId}`).send({ status: "technical_interview" }).expect(200);
    expect(db.prepare("SELECT status FROM application_status_events WHERE application_id=? ORDER BY id DESC LIMIT 1").get(applicationId)).toMatchObject({ status: "technical_interview" });
    expect(db.prepare("SELECT stage_entered_at FROM applications WHERE id=?").get(applicationId)).not.toMatchObject({ stage_entered_at: "2026-09-10T09:00:00.000Z" });
  });

  test("rejects a malformed dashboard date", async () => {
    const { app } = setup();
    await request(app).get("/api/dashboard?today=not-a-date").expect(400);
  });

  test("persists allowed application changes", async () => {
    const { app, applicationId } = setup();
    await request(app)
      .patch(`/api/applications/${applicationId}`)
      .send({ status: "technical_interview", priority: 3, notes: "Prepare architecture examples", rejectionReason: "reason_unknown", decision: "review", appliedAt: "2026-09-02T09:30:00.000Z" })
      .expect(200);

    const response = await request(app).get("/api/dashboard").expect(200);
    expect(response.body.applications[0]).toMatchObject({
      status: "technical_interview",
      priority: 3,
      notes: "Prepare architecture examples",
      rejection_reason: "reason_unknown",
      decision: "review",
      applied_at: "2026-09-02T09:30:00.000Z"
    });
  });

  test("job application route is unavailable; application status uses its own route", async () => {
    const { app, repo } = setup();
    const job = repo.upsertJob({ company: "NewCo", title: "React Native Engineer", location: "Berlin", employmentType: "permanent", source: "web" });
    await request(app).put(`/api/jobs/${job.id}/application`).send({ status: "applied" }).expect(404);
    expect(repo.listApplications().filter((item) => item.job_id === job.id)).toHaveLength(0);
  });

  test("allows a user to override an automatic duplicate block", async () => {
    const { app, repo, db } = setup();
    const job = repo.listJobs()[0] as { id: number };
    db.prepare("UPDATE jobs SET duplicate_blocked=1 WHERE id=?").run(job.id);
    const updated = await request(app).patch(`/api/jobs/${job.id}`).send({ manualUnblock: true }).expect(200);
    expect(updated.body).toMatchObject({ id: job.id, manual_unblock: 1, duplicate_blocked: 0 });
    expect(repo.getJob(job.id)).toMatchObject({ duplicate_blocked: 0 });
    const response = await request(app).get("/api/dashboard").expect(200);
    expect(response.body.jobs[0].duplicate_blocked).toBe(0);
    expect(response.body.jobs[0].manual_unblock).toBe(1);
    await request(app).patch(`/api/jobs/${job.id}`).send({ manualUnblock: false }).expect(200);
    expect(repo.getJob(job.id)).toMatchObject({ duplicate_blocked: 1 });
  });

  test("rejects an unsupported status instead of storing it", async () => {
    const { app, applicationId } = setup();
    await request(app).patch(`/api/applications/${applicationId}`).send({ status: "emailed_everyone" }).expect(400);
  });

  test("marks a review email as not job-related without creating an application", async () => {
    const { app, repo, db } = setup();
    const evidenceId = addReviewEvidence(repo, "ignore");
    await request(app).post(`/api/evidence/${evidenceId}/review`).send({ action: "ignore" }).expect(200);
    const response = await request(app).get("/api/dashboard").expect(200);
    expect(response.body.reviewQueue).toHaveLength(0);
    expect(response.body.applications).toHaveLength(1);
    const evidence = repo.listEvidence() as Array<{ id: number; classification: string; needs_review: number; job_id: number | null }>;
    expect(evidence.find((item) => item.id === evidenceId)).toMatchObject({ classification: "ignored", needs_review: 0, job_id: null });
    expect(db.prepare("SELECT action FROM activity WHERE entity_type = 'email_evidence' AND entity_id = ?").get(evidenceId)).toMatchObject({ action: "review_ignored" });
  });

  test("links a review email to an existing application and updates its status", async () => {
    const { app, repo, applicationId, db } = setup();
    const evidenceId = addReviewEvidence(repo, "link");
    await request(app).post(`/api/evidence/${evidenceId}/review`).send({ action: "link", applicationId, status: "technical_interview" }).expect(200);
    const response = await request(app).get("/api/dashboard").expect(200);
    expect(response.body.reviewQueue).toHaveLength(0);
    expect(response.body.applications[0]).toMatchObject({ id: applicationId, status: "technical_interview" });
    const evidence = repo.listEvidence() as Array<{ id: number; classification: string; needs_review: number; job_id: number | null }>;
    expect(evidence.find((item) => item.id === evidenceId)).toMatchObject({ job_id: 1, classification: "technical_interview", needs_review: 0 });
    expect(db.prepare("SELECT action FROM activity WHERE entity_type = 'email_evidence' AND entity_id = ?").get(evidenceId)).toMatchObject({ action: "review_linked" });
  });

  test("creates an application from a review email", async () => {
    const { app, repo, db } = setup();
    const evidenceId = addReviewEvidence(repo, "create");
    await request(app).post(`/api/evidence/${evidenceId}/review`).send({ action: "create", company: "Orbit Learning", title: "Fullstack Engineer", status: "applied" }).expect(200);
    const response = await request(app).get("/api/dashboard").expect(200);
    expect(response.body.reviewQueue).toHaveLength(0);
    expect(response.body.applications).toEqual(expect.arrayContaining([expect.objectContaining({ company: "Orbit Learning", title: "Fullstack Engineer", status: "applied", source: "manual_review" })]));
    const orbitLearning = (response.body.jobs as Array<{ id: number; company: string }>).find((job) => job.company === "Orbit Learning");
    const evidence = repo.listEvidence() as Array<{ id: number; classification: string; needs_review: number; job_id: number | null }>;
    expect(evidence.find((item) => item.id === evidenceId)).toMatchObject({ job_id: orbitLearning?.id, classification: "applied", needs_review: 0 });
    expect(db.prepare("SELECT action FROM activity WHERE entity_type = 'email_evidence' AND entity_id = ?").get(evidenceId)).toMatchObject({ action: "review_created" });
  });

  test("stores a user-authored interview note separately from employer feedback", async () => {
    const { app, repo, applicationId } = setup();
    const evidenceId = repo.recordEmailEvidence(1, {
      messageId: "interview-note@example.com", account: "Example Mail", mailbox: "INBOX",
      receivedAt: "2026-09-03T09:00:00.000Z", sender: "talent@acme.example.com", recipients: "Alex Morgan",
      subject: "Technical interview", snippet: "Interview", classification: "technical_interview", confidence: 0.95
    });
    repo.recordInterviewEvent(applicationId, evidenceId, { stage: "technical_interview", eventAt: "2026-09-03T09:00:00.000Z", participants: "talent@acme.example.com" });
    const interviewId = (repo.dashboard().interviews[0] as { id: number }).id;
    await request(app).post(`/api/interviews/${interviewId}/insights`).send({ category: "system_design", text: "I rushed the architecture trade-off discussion." }).expect(201);
    const response = await request(app).get("/api/dashboard").expect(200);
    expect(response.body.insightDetails[0]).toMatchObject({ source_type: "user_note", category: "system_design", text: "I rushed the architecture trade-off discussion." });
  });
});
