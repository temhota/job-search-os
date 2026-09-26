import { createHash } from "node:crypto";
import type {
  DashboardApplication,
  DashboardJob,
  EmailEvidenceInput,
  EvidenceReviewAction,
  FollowUpAction,
  ISODateString,
  JobInput,
  JobTriageStatus,
  PipelineView,
  ReviewAttentionEvidence,
  TodayAttentionItem,
  WeeklyProgressPeriod
} from "../../shared/types.js";
import {
  buildFollowUpDraft,
  buildFollowUps,
  rankApplyToday,
  scoreJob
} from "../../shared/domain.js";
import { classifyEmail } from "../mail/classifier.js";
import type { RepositoryOptions } from "../../shared/types.js";
import { isReplyableSender, parseSingleSenderAddress } from "../mail/address.js";
import type { SqliteDatabase } from "./database.js";

function normalizeText(value?: string | null) {
  return (value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9а-яё+.#/-]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function reviewGroup(row: { classification: string; subject: string; sender: string }) {
  const subject = row.subject.toLowerCase();
  if (
    row.classification === "rejected" ||
    /\b(?:rejection|unfortunately|absage|leider)\b/.test(subject)
  )
    return "rejection";
  if (
    ["applied", "technical_interview", "take_home", "onsite_final", "offer"].includes(
      row.classification
    ) ||
    /\b(?:application update|interview|offer)\b/.test(subject)
  )
    return "application_update";
  if (
    row.classification === "recruiter_screen" ||
    /\b(?:recruiter|quick chat|conversation|phone screen)\b/.test(subject)
  )
    return "recruiter_conversation";
  if (
    /\b(?:newsletter|job alert|jobs alert|digest|weekly jobs)\b/.test(
      `${subject} ${row.sender.toLowerCase()}`
    )
  )
    return "newsletter_alert";
  return "unknown";
}

const reviewGroupOrder = [
  "application_update",
  "rejection",
  "recruiter_conversation",
  "newsletter_alert",
  "unknown"
];

function canonicalUrl(value?: string | null) {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return `${url.origin}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return normalizeText(value);
  }
}

function similarity(left: string, right: string) {
  const leftTokens = new Set(
    normalizeText(left)
      .split(" ")
      .filter((token) => token.length > 1)
  );
  const rightTokens = new Set(
    normalizeText(right)
      .split(" ")
      .filter((token) => token.length > 1)
  );
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / new Set([...leftTokens, ...rightTokens]).size;
}

function timestamp(value: string) {
  return Date.parse(value.includes(" ") ? `${value.replace(" ", "T")}Z` : value);
}

function berlinCalendarDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function fingerprintJob(job: Pick<JobInput, "company" | "title" | "url" | "location">) {
  const key =
    canonicalUrl(job.url) ||
    [normalizeText(job.company), normalizeText(job.title), normalizeText(job.location)].join("|");
  return createHash("sha256").update(key).digest("hex");
}

export class JobRepository {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly options: RepositoryOptions
  ) {}

  upsertJob(input: JobInput) {
    const registeredSource =
      input.searchSourceId == null
        ? null
        : (this.db
            .prepare("SELECT id,name FROM search_sources WHERE id=? AND enabled=1")
            .get(input.searchSourceId) as { id: number; name: string } | undefined);
    if (input.searchSourceId != null && !registeredSource)
      throw new Error("Search source is unavailable");
    const fingerprint = fingerprintJob(input);
    let existing = this.db
      .prepare(
        "SELECT id,source,search_source_id,requires_sponsorship FROM jobs WHERE fingerprint = ?"
      )
      .get(fingerprint) as
      | {
          id: number;
          source: string;
          search_source_id: number | null;
          requires_sponsorship: number;
        }
      | undefined;
    if (!existing) {
      const companyJobs = this.db
        .prepare(
          "SELECT id,title,location,description,source,search_source_id,requires_sponsorship FROM jobs WHERE lower(company) = lower(?)"
        )
        .all(input.company) as Array<{
        id: number;
        title: string;
        location: string | null;
        description: string | null;
        source: string;
        search_source_id: number | null;
        requires_sponsorship: number;
      }>;
      const likely = companyJobs.find((job) => {
        const titleMatch = similarity(job.title, input.title);
        const locationCompatible =
          !job.location || !input.location || similarity(job.location, input.location) >= 0.25;
        const requirementsMatch =
          !job.description ||
          !input.description ||
          similarity(job.description, input.description) >= 0.5;
        return titleMatch >= 0.6 && locationCompatible && requirementsMatch;
      });
      if (likely) existing = likely;
    }
    const requiresSponsorship = input.requiresSponsorship ?? existing?.requires_sponsorship === 1;
    const score = scoreJob({ ...input, requiresSponsorship }, this.options.search).total;
    const retainedSource =
      input.searchSourceId === undefined && existing?.search_source_id != null ? existing : null;
    const source = retainedSource
      ? retainedSource.source
      : (registeredSource?.name ?? input.source);
    const searchSourceId = retainedSource
      ? retainedSource.search_source_id
      : (registeredSource?.id ?? null);
    if (existing) {
      this.db
        .prepare(
          `UPDATE jobs SET source = ?, search_source_id = ?, description = COALESCE(?, description), location = COALESCE(?, location),
        employment_type = ?, salary_min = COALESCE(?, salary_min), salary_max = COALESCE(?, salary_max), day_rate = COALESCE(?, day_rate),
        requires_sponsorship = ?, score = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        )
        .run(
          source,
          searchSourceId,
          input.description ?? null,
          input.location ?? null,
          input.employmentType,
          input.salaryMin ?? null,
          input.salaryMax ?? null,
          input.dayRate ?? null,
          Number(requiresSponsorship),
          score,
          existing.id
        );
      return this.getJob(existing.id);
    }

    const sameCompany = this.db
      .prepare("SELECT 1 FROM jobs WHERE lower(company) = lower(?) LIMIT 1")
      .get(input.company);
    const result = this.db
      .prepare(
        `
      INSERT INTO jobs (company,title,url,description,location,work_mode,employment_type,salary_min,salary_max,day_rate,source,search_source_id,posted_at,requires_sponsorship,score,fingerprint)
      VALUES (@company,@title,@url,@description,@location,@workMode,@employmentType,@salaryMin,@salaryMax,@dayRate,@source,@searchSourceId,@postedAt,@requiresSponsorship,@score,@fingerprint)
    `
      )
      .run({
        ...input,
        url: input.url ?? null,
        description: input.description ?? null,
        location: input.location ?? null,
        workMode: input.workMode ?? null,
        salaryMin: input.salaryMin ?? null,
        salaryMax: input.salaryMax ?? null,
        dayRate: input.dayRate ?? null,
        source,
        searchSourceId,
        postedAt: input.postedAt ?? null,
        requiresSponsorship: Number(requiresSponsorship),
        score,
        fingerprint
      });
    const job = this.getJob(Number(result.lastInsertRowid));
    return { ...job, sameCompanyHistory: Boolean(sameCompany) };
  }

  getJob(id: number) {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as
      Record<string, unknown> | undefined;
    if (!row) throw new Error(`Job ${id} not found`);
    const effectiveBlock = Number(row.manual_unblock) === 1 ? 0 : Number(row.duplicate_blocked);
    return {
      ...row,
      id: Number(row.id),
      raw_duplicate_blocked: row.duplicate_blocked,
      duplicate_blocked: effectiveBlock,
      duplicateBlocked: effectiveBlock === 1,
      sameCompanyHistory: false
    } as Record<string, unknown> & {
      id: number;
      duplicateBlocked: boolean;
      sameCompanyHistory: boolean;
    };
  }

  updateJobTriage(id: number, status: JobTriageStatus) {
    return this.db.transaction(() => {
      const current = this.db.prepare("SELECT triage_status FROM jobs WHERE id = ?").get(id) as
        { triage_status: JobTriageStatus } | undefined;
      if (!current) return null;
      this.db
        .prepare("UPDATE jobs SET triage_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(status, id);
      this.db
        .prepare(
          "INSERT INTO activity (entity_type,entity_id,action,source,details) VALUES ('job',?,'triage_updated','manual',?)"
        )
        .run(id, JSON.stringify({ previousStatus: current.triage_status, status }));
      return this.getJob(id);
    })();
  }

  listJobs() {
    return this.db
      .prepare(
        `
      SELECT jobs.*, jobs.duplicate_blocked AS raw_duplicate_blocked, CASE WHEN manual_unblock = 1 THEN 0 ELSE duplicate_blocked END AS duplicate_blocked,
        job_application.id AS application_id,
        job_application.status AS application_status,
        EXISTS(
          SELECT 1 FROM jobs history_job JOIN applications history_application ON history_application.job_id = history_job.id
          WHERE lower(history_job.company) = lower(jobs.company) AND history_job.id != jobs.id
        ) AS same_company_history
      FROM jobs
      LEFT JOIN applications job_application ON job_application.job_id = jobs.id
      ORDER BY score DESC, created_at DESC
    `
      )
      .all();
  }

  recordEmailEvidence(
    jobId: number | null,
    evidence: EmailEvidenceInput & { needsReview?: boolean }
  ) {
    this.db
      .prepare(
        `
      INSERT INTO email_evidence (job_id,message_id,account,mailbox,received_at,sender,recipients,subject,snippet,classification,confidence,needs_review)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(message_id) DO UPDATE SET
        job_id = COALESCE(excluded.job_id, email_evidence.job_id),
        classification = excluded.classification,
        confidence = excluded.confidence,
        needs_review = excluded.needs_review
    `
      )
      .run(
        jobId,
        evidence.messageId,
        evidence.account,
        evidence.mailbox,
        evidence.receivedAt,
        evidence.sender,
        evidence.recipients,
        evidence.subject,
        evidence.snippet,
        evidence.classification,
        evidence.confidence,
        evidence.needsReview ? 1 : 0
      );
    return (
      this.db
        .prepare("SELECT id FROM email_evidence WHERE message_id = ?")
        .get(evidence.messageId) as { id: number }
    ).id;
  }

  listEvidence() {
    return this.db.prepare("SELECT * FROM email_evidence ORDER BY received_at DESC").all();
  }

  hasEvidence(messageId: string) {
    return Boolean(
      this.db.prepare("SELECT 1 FROM email_evidence WHERE message_id = ?").get(messageId)
    );
  }

  upsertApplication(jobId: number, status: string, occurredAt: string, source = "email") {
    return this.db.transaction(() => {
      const order = [
        "unknown",
        "applied",
        "recruiter_screen",
        "take_home",
        "technical_interview",
        "onsite_final",
        "offer",
        "rejected",
        "withdrawn"
      ];
      const current = this.db.prepare("SELECT * FROM applications WHERE job_id = ?").get(jobId) as
        | { id: number; status: string; applied_at: string | null; stage_entered_at: string | null }
        | undefined;
      if (!current) {
        const appliedAt = status === "applied" ? occurredAt : null;
        const result = this.db
          .prepare(
            "INSERT INTO applications (job_id,status,applied_at,source,stage_entered_at) VALUES (?,?,?,?,?)"
          )
          .run(jobId, status, appliedAt, source, occurredAt);
        this.recordStatusEvent(Number(result.lastInsertRowid), status, occurredAt, source);
        this.db.prepare("UPDATE jobs SET duplicate_blocked = 1 WHERE id = ?").run(jobId);
        if (appliedAt) this.ensureFollowUps(Number(result.lastInsertRowid), appliedAt);
        return Number(result.lastInsertRowid);
      }
      const isCurrentOrLater =
        !current.stage_entered_at || timestamp(occurredAt) >= timestamp(current.stage_entered_at);
      const nextStatus =
        isCurrentOrLater && order.indexOf(status) >= order.indexOf(current.status)
          ? status
          : current.status;
      const appliedAt = current.applied_at ?? (status === "applied" ? occurredAt : null);
      if (nextStatus !== current.status) {
        this.db
          .prepare(
            "UPDATE applications SET status = ?, applied_at = ?, stage_entered_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
          )
          .run(nextStatus, appliedAt, occurredAt, current.id);
      } else if (appliedAt !== current.applied_at) {
        this.db
          .prepare(
            "UPDATE applications SET applied_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
          )
          .run(appliedAt, current.id);
      }
      this.recordStatusEvent(current.id, status, occurredAt, source);
      if (appliedAt) this.ensureFollowUps(current.id, appliedAt);
      if (nextStatus === "rejected" || nextStatus === "withdrawn")
        this.dismissPendingFollowUps(current.id, nextStatus, source);
      return current.id;
    })();
  }

  private recordStatusEvent(
    applicationId: number,
    status: string,
    occurredAt: string,
    source: string
  ) {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO application_status_events (application_id,status,occurred_at,source) VALUES (?,?,?,?)"
      )
      .run(applicationId, status, occurredAt, source);
  }

  markJobApplied(jobId: number, appliedAt: ISODateString) {
    return this.db.transaction(() => {
      const current = this.db.prepare("SELECT * FROM applications WHERE job_id = ?").get(jobId);
      if (current) return current;
      const job = this.db.prepare("SELECT id FROM jobs WHERE id = ?").get(jobId);
      if (!job) return null;

      const applicationId = this.upsertApplication(jobId, "applied", appliedAt, "manual");
      this.db
        .prepare(
          "INSERT INTO activity (entity_type,entity_id,action,source,details) VALUES ('application',?,'application_created','manual',?)"
        )
        .run(applicationId, JSON.stringify({ status: "applied", jobId }));
      return this.db.prepare("SELECT * FROM applications WHERE id = ?").get(applicationId);
    })();
  }

  private ensureFollowUps(applicationId: number, appliedAt: string) {
    const application = this.db
      .prepare(
        "SELECT jobs.company,jobs.title FROM applications JOIN jobs ON jobs.id = applications.job_id WHERE applications.id = ?"
      )
      .get(applicationId) as { company: string; title: string };
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO follow_ups (application_id,sequence,due_at,draft) VALUES (?,?,?,?)"
    );
    for (const followUp of buildFollowUps(appliedAt)) {
      insert.run(
        applicationId,
        followUp.sequence,
        followUp.dueAt,
        buildFollowUpDraft(
          application.company,
          application.title,
          followUp.sequence,
          this.options.followUpSignature
        )
      );
    }
  }

  private dismissPendingFollowUps(
    applicationId: number,
    terminalStatus: "rejected" | "withdrawn",
    source: string
  ) {
    const pending = this.db
      .prepare("SELECT id FROM follow_ups WHERE application_id=? AND status='pending'")
      .all(applicationId) as Array<{ id: number }>;
    const dismiss = this.db.prepare(
      "UPDATE follow_ups SET status='dismissed' WHERE id=? AND status='pending'"
    );
    const activity = this.db.prepare(
      "INSERT INTO activity (entity_type,entity_id,action,source,details) VALUES ('follow_up',?,'auto_dismissed_terminal_status',?,?)"
    );
    for (const row of pending) {
      if (dismiss.run(row.id).changes)
        activity.run(row.id, source, JSON.stringify({ applicationId, terminalStatus }));
    }
  }

  getFollowUpDraftTarget(id: number, today = new Date().toISOString()) {
    const rows = this.db
      .prepare(
        `
      SELECT follow_ups.id AS follow_up_id, follow_ups.draft,
             email_evidence.message_id, email_evidence.account, email_evidence.mailbox,
             email_evidence.sender, email_evidence.subject
      FROM follow_ups
      JOIN applications ON applications.id = follow_ups.application_id
      JOIN email_evidence ON email_evidence.job_id = applications.job_id
      WHERE follow_ups.id = ? AND follow_ups.status = 'pending'
        AND email_evidence.needs_review = 0 AND email_evidence.classification <> 'ignored'
      ORDER BY email_evidence.received_at DESC, email_evidence.id DESC
    `
      )
      .all(id) as Array<{
      follow_up_id: number;
      draft: string;
      message_id: string;
      account: string;
      mailbox: string;
      sender: string;
      subject: string;
    }>;
    const target = rows.find(
      (row) =>
        this.options.mail.accounts.has(row.account) &&
        row.mailbox.toLowerCase() === "inbox" &&
        isReplyableSender(row.sender, this.options.mail.senderAddresses)
    );
    const followUp = this.db
      .prepare("SELECT due_at FROM follow_ups WHERE id=? AND status='pending'")
      .get(id) as { due_at: string } | undefined;
    if (!followUp || berlinCalendarDay(followUp.due_at) > berlinCalendarDay(today)) return null;
    return target
      ? {
          followUpId: target.follow_up_id,
          messageId: target.message_id,
          account: target.account,
          mailbox: target.mailbox,
          draft: target.draft,
          recipient: parseSingleSenderAddress(target.sender)!,
          subject: /^re:/i.test(target.subject.trim())
            ? target.subject.trim()
            : `Re: ${target.subject.trim()}`
        }
      : null;
  }

  recordFollowUpDraftOpened(id: number, messageId: string) {
    this.db
      .prepare(
        "INSERT INTO activity (entity_type,entity_id,action,source,details) VALUES ('follow_up',?,'email_draft_opened','manual',?)"
      )
      .run(id, JSON.stringify({ messageId }));
  }

  updateFollowUp(id: number, input: FollowUpAction) {
    return this.db.transaction(() => {
      const current = this.db.prepare("SELECT * FROM follow_ups WHERE id = ?").get(id) as
        { due_at: string } | undefined;
      if (!current) return null;

      if (input.action === "snooze") {
        this.db.prepare("UPDATE follow_ups SET due_at = ? WHERE id = ?").run(input.dueAt, id);
      } else {
        this.db
          .prepare("UPDATE follow_ups SET status = ? WHERE id = ?")
          .run(input.action === "done" ? "done" : "dismissed", id);
      }
      this.db
        .prepare(
          "INSERT INTO activity (entity_type,entity_id,action,source,details) VALUES ('follow_up',?,?,'manual',?)"
        )
        .run(id, input.action, JSON.stringify({ ...input, previousDueAt: current.due_at }));
      return this.db.prepare("SELECT * FROM follow_ups WHERE id = ?").get(id);
    })();
  }

  setApplicationResumeVersion(applicationId: number, filename: string) {
    this.db
      .prepare(
        "UPDATE applications SET resume_version = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      )
      .run(filename, applicationId);
  }

  listApplications() {
    return this.db
      .prepare(
        `
      SELECT applications.*, jobs.company, jobs.title, jobs.location, jobs.score,
        (SELECT evidence.sender FROM email_evidence evidence
          WHERE evidence.job_id = jobs.id
          ORDER BY evidence.received_at LIMIT 1) AS recruiter_contact
      FROM applications JOIN jobs ON jobs.id = applications.job_id
      ORDER BY COALESCE(applications.applied_at, applications.updated_at) DESC
    `
      )
      .all();
  }

  getJobDetails(jobId: number) {
    if (!this.db.prepare("SELECT 1 FROM jobs WHERE id = ?").get(jobId)) return null;
    const job = this.getJob(jobId);
    const application = this.db
      .prepare(
        `SELECT applications.*, jobs.company, jobs.title,
      (SELECT sender FROM email_evidence WHERE job_id = jobs.id ORDER BY received_at DESC, id DESC LIMIT 1) AS recruiter_contact
      FROM applications JOIN jobs ON jobs.id = applications.job_id WHERE applications.job_id = ?`
      )
      .get(jobId) as { id: number } | undefined;
    const evidence = this.db
      .prepare("SELECT * FROM email_evidence WHERE job_id = ? ORDER BY received_at DESC, id DESC")
      .all(jobId);
    const interviews = application
      ? this.db
          .prepare(
            "SELECT * FROM interview_events WHERE application_id = ? ORDER BY event_at DESC, id DESC"
          )
          .all(application.id)
      : [];
    const insights = application
      ? this.db
          .prepare(
            "SELECT interview_insights.*, interview_events.event_at FROM interview_insights JOIN interview_events ON interview_events.id = interview_insights.interview_event_id WHERE interview_events.application_id = ? ORDER BY interview_events.event_at DESC, interview_insights.id DESC"
          )
          .all(application.id)
      : [];
    const documents = (
      this.db
        .prepare(
          "SELECT id,job_id,document_type,language,format,version,created_at FROM documents WHERE job_id = ? ORDER BY created_at DESC, id DESC"
        )
        .all(jobId) as Array<{ id: number }>
    ).map((document) => ({ ...document, download_url: `/api/documents/${document.id}/download` }));
    const activity = this.db
      .prepare(
        `
      SELECT activity.* FROM activity
      WHERE (entity_type = 'job' AND entity_id = ?)
         OR (entity_type = 'application' AND entity_id = ?)
         OR (entity_type = 'email_evidence' AND entity_id IN (SELECT id FROM email_evidence WHERE job_id = ?))
         OR (entity_type = 'interview_event' AND entity_id IN (SELECT id FROM interview_events WHERE application_id = ?))
         OR (entity_type = 'follow_up' AND entity_id IN (SELECT id FROM follow_ups WHERE application_id = ?))
      ORDER BY created_at DESC, id DESC
    `
      )
      .all(jobId, application?.id ?? -1, jobId, application?.id ?? -1, application?.id ?? -1);
    return {
      job,
      application: application ?? null,
      evidence,
      interviews,
      insights,
      documents,
      activity
    };
  }

  listReviewQueue() {
    const rows = this.db
      .prepare(
        "SELECT * FROM email_evidence WHERE needs_review = 1 ORDER BY received_at DESC, id DESC"
      )
      .all() as Array<
      Record<string, unknown> & {
        id: number;
        job_id: number | null;
        classification: string;
        subject: string;
        sender: string;
        snippet: string;
        confidence: number;
        received_at: string;
      }
    >;
    const applications = this.db
      .prepare(
        "SELECT applications.id, applications.job_id, jobs.company FROM applications JOIN jobs ON jobs.id = applications.job_id"
      )
      .all() as Array<{ id: number; job_id: number; company: string }>;
    return rows
      .map((row) => {
        const direct =
          row.job_id == null
            ? []
            : applications.filter((application) => application.job_id === row.job_id);
        const company = classifyEmail({
          subject: row.subject,
          sender: row.sender,
          content: ""
        }).company;
        const companyMatches = company
          ? applications.filter(
              (application) => normalizeText(application.company) === normalizeText(company)
            )
          : [];
        const suggested =
          direct.length === 1
            ? direct[0]
            : direct.length === 0 && companyMatches.length === 1
              ? companyMatches[0]
              : null;
        return {
          ...row,
          review_group: reviewGroup(row),
          suggested_application_id: suggested?.id ?? null,
          sender_address: parseSingleSenderAddress(row.sender)
        };
      })
      .sort(
        (left, right) =>
          reviewGroupOrder.indexOf(left.review_group) -
            reviewGroupOrder.indexOf(right.review_group) ||
          String(right.received_at).localeCompare(String(left.received_at)) ||
          right.id - left.id
      );
  }

  bulkIgnoreEvidence(sender: string, evidenceIds: number[]) {
    const normalized = parseSingleSenderAddress(sender);
    if (!normalized || !evidenceIds.length || new Set(evidenceIds).size !== evidenceIds.length)
      return null;
    return this.db.transaction(() => {
      const select = this.db.prepare(
        "SELECT id,sender,needs_review FROM email_evidence WHERE id = ?"
      );
      const matching = evidenceIds.map(
        (id) => select.get(id) as { id: number; sender: string; needs_review: number } | undefined
      );
      if (
        matching.some(
          (row) =>
            !row || row.needs_review !== 1 || parseSingleSenderAddress(row.sender) !== normalized
        )
      )
        return null;
      const update = this.db.prepare(
        "UPDATE email_evidence SET classification = 'ignored', needs_review = 0 WHERE id = ? AND needs_review = 1"
      );
      for (const row of matching) {
        update.run(row!.id);
        this.recordReviewActivity(row!.id, "review_bulk_ignored", { sender: normalized });
      }
      return { sender: normalized, count: matching.length, evidenceIds };
    })();
  }

  updateEvidenceReview(id: number, needsReview: boolean) {
    const result = this.db
      .prepare("UPDATE email_evidence SET needs_review = ? WHERE id = ?")
      .run(needsReview ? 1 : 0, id);
    if (!result.changes) return null;
    this.db
      .prepare(
        "INSERT INTO activity (entity_type,entity_id,action,source,details) VALUES ('email_evidence',?,?,'manual',?)"
      )
      .run(
        id,
        needsReview ? "review_reopened" : "review_resolved",
        JSON.stringify({ needsReview })
      );
    return this.db.prepare("SELECT * FROM email_evidence WHERE id = ?").get(id);
  }

  reviewEvidence(id: number, input: EvidenceReviewAction) {
    const review = this.db.transaction(() => {
      const evidence = this.db.prepare("SELECT * FROM email_evidence WHERE id = ?").get(id) as
        { id: number; received_at: string } | undefined;
      if (!evidence) return null;

      if (input.action === "ignore") {
        this.db
          .prepare(
            "UPDATE email_evidence SET job_id = NULL, classification = 'ignored', needs_review = 0 WHERE id = ?"
          )
          .run(id);
        this.recordReviewActivity(id, "review_ignored", input);
        return this.db.prepare("SELECT * FROM email_evidence WHERE id = ?").get(id);
      }

      let jobId: number;
      if (input.action === "link") {
        const application = this.db
          .prepare("SELECT job_id FROM applications WHERE id = ?")
          .get(input.applicationId) as { job_id: number } | undefined;
        if (!application) return null;
        jobId = application.job_id;
      } else {
        const job = this.upsertJob({
          company: input.company,
          title: input.title,
          employmentType: "permanent",
          source: "manual_review"
        });
        jobId = job.id;
      }

      const applicationId = this.upsertApplication(
        jobId,
        input.status,
        evidence.received_at,
        "manual_review"
      );
      this.db
        .prepare(
          "UPDATE email_evidence SET job_id = ?, classification = ?, needs_review = 0 WHERE id = ?"
        )
        .run(jobId, input.status, id);
      this.recordReviewActivity(id, input.action === "link" ? "review_linked" : "review_created", {
        ...input,
        jobId,
        applicationId
      });
      return this.db.prepare("SELECT * FROM email_evidence WHERE id = ?").get(id);
    });
    return review();
  }

  private recordReviewActivity(id: number, action: string, details: unknown) {
    this.db
      .prepare(
        "INSERT INTO activity (entity_type,entity_id,action,source,details) VALUES ('email_evidence',?,?,'manual',?)"
      )
      .run(id, action, JSON.stringify(details));
  }

  updateApplication(
    id: number,
    input: {
      status?: string;
      priority?: number;
      notes?: string;
      nextStep?: string | null;
      rejectionReason?: string | null;
      decision?: string | null;
      appliedAt?: string | null;
    }
  ) {
    return this.db.transaction(() => {
      const current = this.db.prepare("SELECT * FROM applications WHERE id = ?").get(id) as
        Record<string, unknown> | undefined;
      if (!current) return null;
      const statusChanged = input.status !== undefined && input.status !== current.status;
      const changedAt = statusChanged ? new Date().toISOString() : current.stage_entered_at;
      this.db
        .prepare(
          `
        UPDATE applications SET status = ?, priority = ?, notes = ?, next_step = ?, rejection_reason = ?, decision = ?, applied_at = ?, stage_entered_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
        )
        .run(
          input.status ?? current.status,
          input.priority ?? current.priority,
          input.notes ?? current.notes,
          input.nextStep === undefined ? current.next_step : input.nextStep,
          input.rejectionReason === undefined ? current.rejection_reason : input.rejectionReason,
          input.decision === undefined ? current.decision : input.decision,
          input.appliedAt === undefined ? current.applied_at : input.appliedAt,
          changedAt,
          id
        );
      if (statusChanged) this.recordStatusEvent(id, input.status!, changedAt as string, "manual");
      const finalStatus = String(input.status ?? current.status);
      if (finalStatus === "rejected" || finalStatus === "withdrawn")
        this.dismissPendingFollowUps(id, finalStatus, "manual");
      this.db
        .prepare(
          "INSERT INTO activity (entity_type,entity_id,action,source,details) VALUES ('application',?,'updated','manual',?)"
        )
        .run(id, JSON.stringify(input));
      return this.db.prepare("SELECT * FROM applications WHERE id = ?").get(id);
    })();
  }

  setManualUnblock(id: number, manualUnblock: boolean) {
    const result = this.db
      .prepare("UPDATE jobs SET manual_unblock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(manualUnblock ? 1 : 0, id);
    if (!result.changes) return null;
    this.db
      .prepare(
        "INSERT INTO activity (entity_type,entity_id,action,source,details) VALUES ('job',?,'duplicate_override','manual',?)"
      )
      .run(id, JSON.stringify({ manualUnblock }));
    return this.getJob(id);
  }

  recordInterviewEvent(
    applicationId: number,
    evidenceId: number,
    input: { stage: string; eventAt: string; participants: string }
  ) {
    this.db
      .prepare(
        `
      INSERT OR IGNORE INTO interview_events (application_id,stage,event_at,participants,source_evidence_id)
      VALUES (?,?,?,?,?)
    `
      )
      .run(applicationId, input.stage, input.eventAt, input.participants, evidenceId);
  }

  addInterviewInsight(interviewId: number, input: { category: string; text: string }) {
    const event = this.db.prepare("SELECT id FROM interview_events WHERE id = ?").get(interviewId);
    if (!event) return null;
    const result = this.db
      .prepare(
        "INSERT INTO interview_insights (interview_event_id,category,text,source_type,confidence) VALUES (?,?,?,'user_note',1)"
      )
      .run(interviewId, input.category, input.text);
    this.db
      .prepare(
        "INSERT INTO activity (entity_type,entity_id,action,source,details) VALUES ('interview_event',?,'note_added','manual',?)"
      )
      .run(interviewId, JSON.stringify(input));
    return this.db
      .prepare("SELECT * FROM interview_insights WHERE id = ?")
      .get(Number(result.lastInsertRowid));
  }

  recordRejection(
    applicationId: number,
    feedback: string | null,
    category: string,
    confidence: number
  ) {
    const event = this.db
      .prepare(
        "SELECT id FROM interview_events WHERE application_id = ? ORDER BY event_at DESC LIMIT 1"
      )
      .get(applicationId) as { id: number } | undefined;
    if (!event) return;
    this.db
      .prepare(
        "UPDATE interview_events SET result = 'rejected', explicit_feedback = ? WHERE id = ?"
      )
      .run(feedback, event.id);
    const exists = this.db
      .prepare("SELECT 1 FROM interview_insights WHERE interview_event_id = ? AND category = ?")
      .get(event.id, category);
    if (!exists) {
      const sourceType = feedback ? "employer_feedback" : "system_inference";
      const insightText = feedback ?? "No specific reason was provided by the employer.";
      this.db
        .prepare(
          "INSERT INTO interview_insights (interview_event_id,category,text,source_type,confidence) VALUES (?,?,?,?,?)"
        )
        .run(event.id, category, insightText, sourceType, confidence);
    }
  }

  private selectApplyToday() {
    return rankApplyToday(this.listJobs() as DashboardJob[], this.options.search);
  }

  private selectPipeline(now: string): PipelineView {
    const rows = this.listApplications() as DashboardApplication[];
    const activityDates = this.db
      .prepare(
        `
      SELECT id AS application_id, updated_at AS occurred_at FROM applications
      UNION ALL SELECT id, stage_entered_at FROM applications WHERE stage_entered_at IS NOT NULL
      UNION ALL SELECT application_id, occurred_at FROM application_status_events
      UNION ALL SELECT applications.id, activity.created_at FROM applications JOIN activity ON activity.entity_type = 'application' AND activity.entity_id = applications.id
      UNION ALL SELECT applications.id, activity.created_at FROM applications JOIN activity ON activity.entity_type = 'job' AND activity.entity_id = applications.job_id
      UNION ALL SELECT application_id, event_at FROM interview_events
      UNION ALL SELECT interview_events.application_id, activity.created_at FROM interview_events JOIN activity ON activity.entity_type = 'interview_event' AND activity.entity_id = interview_events.id
      UNION ALL SELECT applications.id, email_evidence.received_at FROM applications JOIN email_evidence ON email_evidence.job_id = applications.job_id
      UNION ALL SELECT applications.id, activity.created_at FROM applications JOIN email_evidence ON email_evidence.job_id = applications.job_id JOIN activity ON activity.entity_type = 'email_evidence' AND activity.entity_id = email_evidence.id
      UNION ALL SELECT follow_ups.application_id, activity.created_at FROM follow_ups JOIN activity ON activity.entity_type = 'follow_up' AND activity.entity_id = follow_ups.id
    `
      )
      .all() as Array<{ application_id: number; occurred_at: string }>;
    const activityByApplication = new Map<number, string>();
    for (const event of activityDates) {
      const prior = activityByApplication.get(event.application_id);
      if (!prior || timestamp(event.occurred_at) > timestamp(prior))
        activityByApplication.set(event.application_id, event.occurred_at);
    }
    const terminalEvents = this.db
      .prepare(
        `
      SELECT application_id, status, occurred_at FROM application_status_events
      WHERE status IN ('rejected','withdrawn') ORDER BY occurred_at DESC, id DESC
    `
      )
      .all() as Array<{ application_id: number; status: string; occurred_at: string }>;
    const archiveByApplication = new Map<number, string>();
    for (const event of terminalEvents) {
      const row = rows.find((item) => item.id === event.application_id);
      if (row?.status === event.status && !archiveByApplication.has(row.id))
        archiveByApplication.set(row.id, event.occurred_at);
    }
    const nextFollowUps = this.db
      .prepare(
        `
      SELECT application_id, sequence, due_at FROM follow_ups
      WHERE status = 'pending'
      ORDER BY due_at, sequence
    `
      )
      .all() as Array<{ application_id: number; sequence: number; due_at: string }>;
    const nextFollowUpByApplication = new Map<number, { sequence: number; due_at: string }>();
    for (const followUp of nextFollowUps)
      if (!nextFollowUpByApplication.has(followUp.application_id))
        nextFollowUpByApplication.set(followUp.application_id, followUp);
    const nowMs = Date.parse(now);
    const enriched = rows.map((row) => {
      const stageMs = timestamp(row.stage_entered_at);
      return {
        ...row,
        next_step_due_at: nextFollowUpByApplication.get(row.id)?.due_at ?? null,
        next_follow_up_sequence: nextFollowUpByApplication.get(row.id)?.sequence ?? null,
        archived_at: archiveByApplication.get(row.id) ?? null,
        last_activity_at: activityByApplication.get(row.id) ?? row.updated_at,
        days_in_stage: Number.isFinite(stageMs)
          ? Math.max(0, Math.floor((nowMs - stageMs) / 86_400_000))
          : 0
      };
    });
    return {
      active: enriched.filter((row) => !["rejected", "withdrawn", "unknown"].includes(row.status)),
      needsAttention: enriched.filter((row) => row.status === "unknown"),
      archive: enriched.filter((row) => row.status === "rejected" || row.status === "withdrawn")
    };
  }

  private selectNeedsAttention(
    pipeline: PipelineView,
    reviewQueue: ReviewAttentionEvidence[]
  ): TodayAttentionItem[] {
    const applications = [
      ...pipeline.needsAttention,
      ...pipeline.active.filter(
        (row) =>
          ["take_home", "onsite_final"].includes(row.status) ||
          (row.next_step && row.days_in_stage >= 7)
      )
    ].sort(
      (left, right) => right.priority - left.priority || right.days_in_stage - left.days_in_stage
    );
    const review = reviewQueue.filter(
      (row) =>
        row.confidence >= 0.7 &&
        [
          "recruiter_screen",
          "technical_interview",
          "take_home",
          "onsite_final",
          "offer",
          "rejected"
        ].includes(row.classification)
    );
    return [
      ...applications.map((application) => ({ kind: "application" as const, application })),
      ...review.map((evidence) => ({ kind: "review" as const, evidence }))
    ];
  }

  private selectWeeklyProgress(now: string) {
    const applications = this.db.prepare("SELECT id,applied_at FROM applications").all() as Array<{
      id: number;
      applied_at: string | null;
    }>;
    const statusEvents = this.db
      .prepare("SELECT application_id,status,occurred_at FROM application_status_events")
      .all() as Array<{ application_id: number; status: string; occurred_at: string }>;
    const interviews = this.db.prepare("SELECT event_at FROM interview_events").all() as Array<{
      event_at: string;
    }>;
    const nowMs = Date.parse(now);
    const inPeriod = (value: string | null, days?: number) => {
      if (!value) return false;
      const stamp = timestamp(value);
      return (
        Number.isFinite(stamp) &&
        stamp <= nowMs &&
        (days === undefined || stamp >= nowMs - days * 86_400_000)
      );
    };
    const calculate = (days?: number): WeeklyProgressPeriod => {
      const cohortApplications = applications.filter((row) =>
        days === undefined
          ? row.applied_at === null || inPeriod(row.applied_at)
          : inPeriod(row.applied_at, days)
      );
      const submitted = cohortApplications.length;
      const cohort = new Set(cohortApplications.map((row) => row.id));
      const responses = new Set(
        statusEvents
          .filter(
            (row) =>
              cohort.has(row.application_id) &&
              inPeriod(row.occurred_at, days) &&
              [
                "recruiter_screen",
                "technical_interview",
                "take_home",
                "onsite_final",
                "offer",
                "rejected"
              ].includes(row.status)
          )
          .map((row) => row.application_id)
      ).size;
      return {
        applications: submitted,
        responses,
        interviews: interviews.filter((row) => inPeriod(row.event_at, days)).length,
        offers: new Set(
          statusEvents
            .filter(
              (row) =>
                cohort.has(row.application_id) &&
                row.status === "offer" &&
                inPeriod(row.occurred_at, days)
            )
            .map((row) => row.application_id)
        ).size,
        responseRate: submitted ? responses / submitted : 0
      };
    };
    return { last7Days: calculate(7), last30Days: calculate(30), allTime: calculate() };
  }

  dashboard(today = new Date().toISOString()) {
    const jobs = this.listJobs();
    const applications = this.listApplications();
    const followUps = this.db
      .prepare(
        `
      SELECT follow_ups.*, jobs.company, jobs.title, applications.priority AS application_priority
      FROM follow_ups
      JOIN applications ON applications.id = follow_ups.application_id
      JOIN jobs ON jobs.id = applications.job_id
      WHERE follow_ups.status = 'pending' AND applications.status NOT IN ('rejected','withdrawn')
      ORDER BY follow_ups.due_at, applications.priority DESC, follow_ups.id
    `
      )
      .all()
      .filter((row) => {
        const day = berlinCalendarDay((row as { due_at: string }).due_at);
        return day !== "" && day <= berlinCalendarDay(today);
      });
    const interviews = this.db
      .prepare(
        `
      SELECT interview_events.*, jobs.company, jobs.title
      FROM interview_events
      JOIN applications ON applications.id = interview_events.application_id
      JOIN jobs ON jobs.id = applications.job_id
      ORDER BY interview_events.event_at DESC
    `
      )
      .all();
    const insights = this.db
      .prepare(
        "SELECT category, COUNT(*) AS count FROM interview_insights GROUP BY category ORDER BY count DESC"
      )
      .all();
    const sourceStats = this.db
      .prepare(
        "SELECT COALESCE(source, 'unknown') AS source, COUNT(*) AS count FROM applications GROUP BY COALESCE(source, 'unknown') ORDER BY count DESC, source"
      )
      .all();
    const insightDetails = this.db
      .prepare(
        `
      SELECT interview_insights.*, interview_events.event_at, jobs.company, jobs.title
      FROM interview_insights
      JOIN interview_events ON interview_events.id = interview_insights.interview_event_id
      JOIN applications ON applications.id = interview_events.application_id
      JOIN jobs ON jobs.id = applications.job_id
      ORDER BY interview_events.event_at DESC
    `
      )
      .all();
    const documents = (
      this.db
        .prepare(
          "SELECT documents.id, documents.job_id, documents.document_type, documents.language, documents.format, documents.version, documents.created_at, jobs.company, jobs.title FROM documents LEFT JOIN jobs ON jobs.id = documents.job_id ORDER BY documents.created_at DESC, documents.id DESC"
        )
        .all() as Array<{ id: number }>
    ).map((document) => ({ ...document, download_url: `/api/documents/${document.id}/download` }));
    const pipeline = this.selectPipeline(today);
    const dueFollowUps = followUps as Array<Record<string, unknown>>;
    const followUpToday = dueFollowUps.slice(0, 10);
    const reviewQueue = this.listReviewQueue() as ReviewAttentionEvidence[];
    return {
      searchSelection: { ...this.options.search.dailySelection },
      summary: {
        jobs: jobs.length,
        applications: applications.length,
        interviews: interviews.length,
        responses: applications.filter((item) =>
          [
            "recruiter_screen",
            "technical_interview",
            "take_home",
            "onsite_final",
            "offer",
            "rejected"
          ].includes((item as { status: string }).status)
        ).length,
        offers: applications.filter((item) => (item as { status: string }).status === "offer")
          .length,
        review: reviewQueue.length
      },
      jobs,
      applications,
      followUps,
      today: {
        applyToday: this.selectApplyToday(),
        followUpToday,
        followUpRemainingCount: Math.max(0, dueFollowUps.length - followUpToday.length),
        needsAttention: this.selectNeedsAttention(pipeline, reviewQueue),
        weeklyProgress: this.selectWeeklyProgress(today)
      },
      pipeline,
      interviews,
      insights,
      insightDetails,
      sourceStats,
      documents,
      reviewQueue
    };
  }

  registerDocument(
    jobId: number,
    input: {
      documentType: string;
      language: string;
      format: string;
      version: string;
      filePath: string;
    }
  ) {
    const result = this.db
      .prepare(
        `
      INSERT INTO documents (job_id,document_type,language,format,version,file_path)
      VALUES (?,?,?,?,?,?)
    `
      )
      .run(jobId, input.documentType, input.language, input.format, input.version, input.filePath);
    return Number(result.lastInsertRowid);
  }

  registerDocumentPair(
    jobId: number,
    docxInput: {
      documentType: string;
      language: string;
      format: string;
      version: string;
      filePath: string;
    },
    pdfInput: {
      documentType: string;
      language: string;
      format: string;
      version: string;
      filePath: string;
    }
  ) {
    return this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM documents WHERE job_id = ? AND document_type = ?")
        .run(jobId, docxInput.documentType);
      const docxId = this.registerDocument(jobId, docxInput);
      const pdfId = this.registerDocument(jobId, pdfInput);
      this.db
        .prepare(
          "INSERT INTO activity (entity_type,entity_id,action,source,details) VALUES ('job',?,'documents_generated','manual',?)"
        )
        .run(jobId, JSON.stringify({ documentIds: [docxId, pdfId], language: docxInput.language }));
      return { docx: this.getDocument(docxId)!, pdf: this.getDocument(pdfId)! };
    })();
  }

  getDocument(id: number) {
    return this.db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as
      { id: number; file_path: string; format: string } | undefined;
  }

  getSyncCursor(source: string) {
    return (
      (
        this.db.prepare("SELECT cursor FROM sync_state WHERE source = ?").get(source) as
          { cursor: string | null } | undefined
      )?.cursor ?? null
    );
  }

  setSyncCursor(source: string, cursor: string) {
    this.db
      .prepare(
        `
      INSERT INTO sync_state (source,cursor,last_synced_at) VALUES (?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(source) DO UPDATE SET cursor = excluded.cursor, last_synced_at = CURRENT_TIMESTAMP
    `
      )
      .run(source, cursor);
  }
}
