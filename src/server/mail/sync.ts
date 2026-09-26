import type { JobRepository } from "../db/repository.js";
import { classifyEmail, isPlausibleCompany, isPlausibleRole } from "./classifier.js";

export interface MailMessage {
  messageId: string;
  account: string;
  mailbox: string;
  receivedAt: string;
  sender: string;
  recipients: string;
  subject: string;
  content: string;
  attachmentNames?: string;
}

function fallbackRole(subject: string) {
  const afterSeparator = subject.match(/[-–—:]\s*(.+)$/);
  return afterSeparator?.[1]?.trim() || null;
}

function fallbackCompany(sender: string) {
  const domain = sender.match(/@([a-z0-9.-]+)/i)?.[1];
  if (!domain) return null;
  const ignored = new Set(["gmail.com", "googlemail.com", "outlook.com", "greenhouse.io", "lever.co", "ashbyhq.com", "personio.de", "personio.com"]);
  if (ignored.has(domain.toLowerCase())) return null;
  const part = domain.split(".")[0];
  return part ? part.charAt(0).toUpperCase() + part.slice(1) : null;
}

export function syncMailMessages(repo: JobRepository, messages: MailMessage[]) {
  let imported = 0;
  let duplicates = 0;
  let needsReview = 0;

  for (const message of messages) {
    if (repo.hasEvidence(message.messageId)) {
      duplicates++;
      continue;
    }
    const classification = classifyEmail(message);
    const company = classification.company ?? fallbackCompany(message.sender);
    const role = classification.role ?? fallbackRole(message.subject);
    const review = classification.needsReview || !isPlausibleCompany(company) || !isPlausibleRole(role);
    let jobId: number | null = null;

    if (!review && company && role) {
      const job = repo.upsertJob({
        company,
        title: role,
        location: null,
        employmentType: "permanent",
        source: "email"
      });
      jobId = job.id;
      const applicationId = repo.upsertApplication(jobId, classification.stage, message.receivedAt);
      const resumeFilename = message.attachmentNames?.split(/,\s*/).find((name) => /(?:resume|cv|lebenslauf).*\.(?:pdf|docx?)$/i.test(name));
      if (resumeFilename) repo.setApplicationResumeVersion(applicationId, resumeFilename);
      const evidenceId = repo.recordEmailEvidence(jobId, {
        messageId: message.messageId,
        account: message.account,
        mailbox: message.mailbox,
        receivedAt: message.receivedAt,
        sender: message.sender,
        recipients: message.recipients,
        subject: message.subject,
        snippet: message.content.replace(/\s+/g, " ").trim().slice(0, 320),
        classification: classification.stage,
        confidence: classification.confidence,
        needsReview: review
      });
      if (["recruiter_screen", "technical_interview", "take_home", "onsite_final"].includes(classification.stage)) {
        repo.recordInterviewEvent(applicationId, evidenceId, { stage: classification.stage, eventAt: message.receivedAt, participants: message.sender });
      } else if (classification.stage === "rejected") {
        repo.recordRejection(applicationId, classification.explicitFeedback, classification.feedbackCategory ?? "reason_unknown", classification.confidence);
      }
    } else {
      needsReview++;
      repo.recordEmailEvidence(jobId, {
        messageId: message.messageId,
        account: message.account,
        mailbox: message.mailbox,
        receivedAt: message.receivedAt,
        sender: message.sender,
        recipients: message.recipients,
        subject: message.subject,
        snippet: message.content.replace(/\s+/g, " ").trim().slice(0, 320),
        classification: classification.stage,
        confidence: classification.confidence,
        needsReview: review
      });
    }
    imported++;
  }

  return { imported, duplicates, needsReview };
}
