import express from "express";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { z } from "zod";
import { applicationStatuses, jobTriageStatuses } from "../shared/types.js";
import type { RepositoryOptions } from "../shared/types.js";
import { berlinCalendarDay } from "../shared/berlin-date.js";
import type { SqliteDatabase } from "./db/database.js";
import { JobRepository } from "./db/repository.js";
import { parseSingleSenderAddress } from "./mail/address.js";
import type { DocumentGenerator } from "./documents/generator.js";
import { normalizeSearchUrl } from "./search-sources/catalog.js";
import { SearchSourceRepository } from "./search-sources/repository.js";

const sourceInput = z.object({
  name: z.string().trim().min(1).max(120),
  searchUrl: z.string().trim().min(1).max(2048),
  category: z.enum(["permanent", "freelance", "both"]),
  enabled: z.boolean().optional()
}).strict();
const sourcePatch = sourceInput.partial().refine((value) => Object.keys(value).length > 0);
const checkInput = z.object({
  status: z.enum(["success", "error"]),
  discoveredCount: z.number().int().min(0),
  importedCount: z.number().int().min(0),
  checkedAt: z.string().datetime(),
  errorText: z.string().max(1000).nullable().optional()
}).strict();

function sourceId(rawId: string): number | null {
  if (!/^[1-9]\d*$/.test(rawId)) return null;
  const id = Number(rawId);
  return Number.isSafeInteger(id) ? id : null;
}

function validSearchUrl(value: string): boolean {
  try { normalizeSearchUrl(value); return true; } catch { return false; }
}

function isDuplicateSearchUrl(error: unknown): boolean {
  return error instanceof Error && error.message === "Search source URL already exists";
}

const applicationUpdate = z.object({
  status: z.enum(applicationStatuses).optional(),
  priority: z.number().int().min(0).max(5).optional(),
  notes: z.string().max(10_000).optional(),
  nextStep: z.string().max(1_000).nullable().optional(),
  rejectionReason: z.string().max(1_000).nullable().optional(),
  decision: z.enum(["apply", "skip", "review"]).nullable().optional(),
  appliedAt: z.iso.datetime().nullable().optional()
}).strict();

const jobUpdate = z.object({ manualUnblock: z.boolean() }).strict();
const jobTriageUpdate = z.object({ status: z.enum(jobTriageStatuses) }).strict();
const jobApply = z.object({ appliedAt: z.iso.datetime().optional() }).strict();
const followUpAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("done") }).strict(),
  z.object({ action: z.literal("dismiss") }).strict(),
  z.object({ action: z.literal("snooze"), dueAt: z.iso.datetime() }).strict()
]);
const evidenceUpdate = z.object({ needsReview: z.boolean() }).strict();
const evidenceBulkIgnore = z.object({ sender: z.string().trim().min(3).max(320), evidenceIds: z.array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)).min(1).max(1000).refine((ids) => new Set(ids).size === ids.length) }).strict();
const evidenceReview = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ignore") }).strict(),
  z.object({ action: z.literal("link"), applicationId: z.number().int().positive(), status: z.enum(applicationStatuses) }).strict(),
  z.object({ action: z.literal("create"), company: z.string().trim().min(1).max(200), title: z.string().trim().min(1).max(200), status: z.enum(applicationStatuses) }).strict()
]);
const interviewInsight = z.object({
  category: z.enum(["react_typescript_fundamentals", "react_native_mobile_architecture", "system_design", "coding_task", "communication_leadership", "product_thinking", "language", "constraints", "reason_unknown"]),
  text: z.string().trim().min(1).max(2_000)
}).strict();

export interface FollowUpDraftTarget {
  followUpId: number;
  messageId: string;
  account: string;
  mailbox: string;
  draft: string;
  recipient: string;
  subject: string;
}

export type EmailDraftOpener = (target: FollowUpDraftTarget) => Promise<void>;

export function createApp(db: SqliteDatabase, options: { repositoryOptions: RepositoryOptions; documentGenerator?: DocumentGenerator; emailDraftOpener?: EmailDraftOpener }) {
  const app = express();
  const repo = new JobRepository(db, options.repositoryOptions);
  const sourceRepo = new SearchSourceRepository(db);
  app.use((request, response, next) => {
    const host = request.headers.host;
    if (!host || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) return response.status(400).json({ error: "Invalid local Host" });
    let localUrl: URL;
    try {
      localUrl = new URL(`http://${host}`);
      if (localUrl.port && (Number(localUrl.port) < 1 || Number(localUrl.port) > 65535)) throw new Error("Invalid port");
    } catch { return response.status(400).json({ error: "Invalid local Host" }); }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.origin) {
      try {
        const origin = new URL(request.headers.origin);
        if (origin.origin !== localUrl.origin || request.headers.origin !== origin.origin) return response.status(403).json({ error: "Foreign Origin" });
      } catch { return response.status(403).json({ error: "Foreign Origin" }); }
    }
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_request, response) => response.json({ ok: true }));
  app.get("/api/dashboard", (request, response) => {
    const parsed = z.iso.datetime().safeParse(request.query.today);
    if (request.query.today !== undefined && !parsed.success) return response.status(400).json({ error: "Invalid dashboard date" });
    const today = parsed.success ? parsed.data : new Date().toISOString();
    response.json({ ...repo.dashboard(today), searchSources: sourceRepo.list() });
  });
  app.get("/api/search-sources", (_request, response) => response.json(sourceRepo.list()));
  app.post("/api/search-sources", (request, response) => {
    const parsed = sourceInput.safeParse(request.body);
    if (!parsed.success || !validSearchUrl(parsed.data.searchUrl)) return response.status(400).json({ error: "Invalid search source" });
    try {
      return response.status(201).json(sourceRepo.create(parsed.data));
    } catch (error) {
      if (isDuplicateSearchUrl(error)) return response.status(409).json({ error: "Search source URL already exists" });
      throw error;
    }
  });
  app.patch("/api/search-sources/:id", (request, response) => {
    const id = sourceId(request.params.id);
    if (id === null) return response.status(400).json({ error: "Invalid search source ID" });
    const parsed = sourcePatch.safeParse(request.body);
    if (!parsed.success || (parsed.data.searchUrl !== undefined && !validSearchUrl(parsed.data.searchUrl))) {
      return response.status(400).json({ error: "Invalid search source update" });
    }
    try {
      const updated = sourceRepo.update(id, parsed.data);
      if (!updated) return response.status(404).json({ error: "Search source not found" });
      return response.json(updated);
    } catch (error) {
      if (isDuplicateSearchUrl(error)) return response.status(409).json({ error: "Search source URL already exists" });
      throw error;
    }
  });
  app.post("/api/search-sources/:id/checks", (request, response) => {
    const id = sourceId(request.params.id);
    if (id === null) return response.status(400).json({ error: "Invalid search source ID" });
    const parsed = checkInput.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Invalid search source check" });
    if (!sourceRepo.list().some((source) => source.id === id)) return response.status(404).json({ error: "Search source not found" });
    sourceRepo.recordCheck(id, parsed.data);
    return response.status(201).json(sourceRepo.list().find((source) => source.id === id));
  });
  app.get("/api/jobs/:id/details", (request, response) => {
    const rawId = request.params.id;
    if (!/^[1-9]\d*$/.test(rawId)) return response.status(400).json({ error: "Invalid job ID" });
    const id = Number(rawId);
    if (!Number.isSafeInteger(id)) return response.status(400).json({ error: "Invalid job ID" });
    const details = repo.getJobDetails(id);
    if (!details) return response.status(404).json({ error: "Job not found" });
    return response.json(details);
  });
  app.post("/api/jobs/:id/documents", async (request, response) => {
    const parsed = z.object({ language: z.enum(["English", "German"]) }).strict().safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Invalid document language" });
    const rawId = request.params.id;
    if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(Number(rawId))) return response.status(400).json({ error: "Invalid job ID" });
    const id = Number(rawId);
    if (!db.prepare("SELECT 1 FROM jobs WHERE id = ?").get(id)) return response.status(404).json({ error: "Job not found" });
    if (!options.documentGenerator) return response.status(503).json({ error: "Document generation is unavailable on this Mac" });
    try {
      const pair = await options.documentGenerator.generate(id, parsed.data.language);
      const publicRow = (row: { id: number; format: string }) => ({ id: row.id, format: row.format, language: parsed.data.language === "English" ? "en" : "de", download_url: `/api/documents/${row.id}/download` });
      return response.status(201).json({ docx: publicRow(pair.docx), pdf: publicRow(pair.pdf) });
    } catch (error) {
      if ((error as { code?: string }).code === "DOCUMENT_DEPENDENCY_UNAVAILABLE") return response.status(503).json({ error: "Document generation is unavailable on this Mac" });
      return response.status(500).json({ error: "Document generation failed" });
    }
  });
  app.patch("/api/applications/:id", (request, response) => {
    const parsed = applicationUpdate.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Invalid application update", issues: parsed.error.issues });
    const updated = repo.updateApplication(Number(request.params.id), parsed.data);
    if (!updated) return response.status(404).json({ error: "Application not found" });
    return response.json(updated);
  });
  app.patch("/api/jobs/:id", (request, response) => {
    const parsed = jobUpdate.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Invalid job update", issues: parsed.error.issues });
    const updated = repo.setManualUnblock(Number(request.params.id), parsed.data.manualUnblock);
    if (!updated) return response.status(404).json({ error: "Job not found" });
    return response.json(updated);
  });
  app.patch("/api/jobs/:id/triage", (request, response) => {
    const parsed = jobTriageUpdate.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Invalid job triage", issues: parsed.error.issues });
    const updated = repo.updateJobTriage(Number(request.params.id), parsed.data.status);
    if (!updated) return response.status(404).json({ error: "Job not found" });
    return response.json(updated);
  });
  app.post("/api/jobs/:id/apply", (request, response) => {
    const parsed = jobApply.safeParse(request.body ?? {});
    if (!parsed.success) return response.status(400).json({ error: "Invalid application date", issues: parsed.error.issues });
    const application = repo.markJobApplied(Number(request.params.id), parsed.data.appliedAt ?? new Date().toISOString());
    if (!application) return response.status(404).json({ error: "Job not found" });
    return response.json(application);
  });
  app.patch("/api/follow-ups/:id", (request, response) => {
    const parsed = followUpAction.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Invalid follow-up action", issues: parsed.error.issues });
    if (parsed.data.action === "snooze" && berlinCalendarDay(parsed.data.dueAt) <= berlinCalendarDay()) {
      return response.status(400).json({ error: "Snooze date must be after today in Berlin" });
    }
    const updated = repo.updateFollowUp(Number(request.params.id), parsed.data);
    if (!updated) return response.status(404).json({ error: "Follow-up not found" });
    return response.json(updated);
  });
  app.post("/api/follow-ups/:id/email-draft", async (request, response) => {
    const id = sourceId(request.params.id);
    if (id === null) return response.status(400).json({ error: "Invalid follow-up ID" });
    if (!db.prepare("SELECT 1 FROM follow_ups WHERE id=?").get(id)) return response.status(404).json({ error: "Follow-up not found" });
    const target = repo.getFollowUpDraftTarget(id);
    if (!target) return response.status(409).json({ error: "No replyable email thread found" });
    if (!options.emailDraftOpener) return response.status(503).json({ error: "Unable to open Apple Mail draft" });
    try {
      await options.emailDraftOpener(target);
      repo.recordFollowUpDraftOpened(id, target.messageId);
      return response.status(201).json({ opened: true });
    } catch {
      return response.status(503).json({ error: "Unable to open Apple Mail draft" });
    }
  });
  app.patch("/api/evidence/:id", (request, response) => {
    const parsed = evidenceUpdate.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Invalid evidence update", issues: parsed.error.issues });
    const updated = repo.updateEvidenceReview(Number(request.params.id), parsed.data.needsReview);
    if (!updated) return response.status(404).json({ error: "Email evidence not found" });
    return response.json(updated);
  });
  app.post("/api/evidence/bulk-ignore", (request, response) => {
    const parsed = evidenceBulkIgnore.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Invalid bulk-ignore request", issues: parsed.error.issues });
    if (!parseSingleSenderAddress(parsed.data.sender)) return response.status(400).json({ error: "Invalid sender address" });
    const result = repo.bulkIgnoreEvidence(parsed.data.sender, parsed.data.evidenceIds);
    if (!result) return response.status(409).json({ error: "Review items changed; refresh before confirming" });
    return response.json(result);
  });
  app.post("/api/evidence/:id/review", (request, response) => {
    const parsed = evidenceReview.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Invalid review decision", issues: parsed.error.issues });
    const updated = repo.reviewEvidence(Number(request.params.id), parsed.data);
    if (!updated) return response.status(404).json({ error: "Email evidence or application not found" });
    return response.json(updated);
  });
  app.post("/api/interviews/:id/insights", (request, response) => {
    const parsed = interviewInsight.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Invalid interview note", issues: parsed.error.issues });
    const insight = repo.addInterviewInsight(Number(request.params.id), parsed.data);
    if (!insight) return response.status(404).json({ error: "Interview not found" });
    return response.status(201).json(insight);
  });
  app.get("/api/documents/:id/download", (request, response) => {
    const document = repo.getDocument(Number(request.params.id));
    if (!document || !existsSync(document.file_path)) return response.status(404).json({ error: "Document not found" });
    return response.download(document.file_path, basename(document.file_path), { dotfiles: "allow" });
  });

  return app;
}
