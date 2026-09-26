import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { MailMessage } from "./sync.js";

const execFileAsync = promisify(execFile);

const subjectTerms = [
  "application", "bewerbung", "interview", "gespräch", "recruiter", "recruiting",
  "talent acquisition", "candidate", "candidacy", "coding challenge", "coding task",
  "take-home", "offer", "absage", "rejection", "job", "position", "role"
];
const senderTerms = ["greenhouse", "lever.co", "ashbyhq", "personio", "workable", "smartrecruiters", "teamtailor", "recruitee", "jobs@", "careers@", "talent@", "recruit"];

export function isCandidateHeader(header: { subject: string; sender: string }) {
  const subject = header.subject.toLowerCase();
  const sender = header.sender.toLowerCase();
  return subjectTerms.some((term) => subject.includes(term)) || senderTerms.some((term) => sender.includes(term));
}

export function parseAppleMailRows(output: string): MailMessage[] {
  return output
    .split("\u001e")
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const [messageId, account, mailbox, receivedAt, sender, recipients, subject, content, attachmentNames = ""] = row.split("\u001f");
      return { messageId, account, mailbox, receivedAt, sender, recipients, subject, content, attachmentNames };
    })
    .filter((message) => Boolean(message.messageId && message.receivedAt && isCandidateHeader(message)));
}

export function buildAppleMailArgs(scriptPath: string, since: string, through: string, accounts: string[]) {
  const exclusiveEnd = new Date(`${through}T12:00:00Z`);
  exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
  return [scriptPath, since, exclusiveEnd.toISOString().slice(0, 10), ...accounts];
}

export async function exportAppleMail(since: string, accounts: string[], through = new Date().toISOString().slice(0, 10)): Promise<MailMessage[]> {
  const scriptPath = fileURLToPath(new URL("../../../scripts/export-apple-mail.applescript", import.meta.url));
  const byMessageId = new Map<string, MailMessage>();
  const { stdout } = await execFileAsync("osascript", buildAppleMailArgs(scriptPath, since, through, accounts), {
    maxBuffer: 30 * 1024 * 1024,
    timeout: 900_000
  });
  for (const message of parseAppleMailRows(stdout)) byMessageId.set(message.messageId, message);
  return [...byMessageId.values()].sort((left, right) => left.receivedAt.localeCompare(right.receivedAt));
}
