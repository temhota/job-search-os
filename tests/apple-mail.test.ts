import { mailPolicy } from "./config-fixture.js";
// Break caught: the importer reads arbitrary personal mail bodies instead of job-search candidates only.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  buildAppleMailArgs,
  isCandidateHeader,
  parseAppleMailRows
} from "../src/server/mail/apple-mail.js";
import {
  buildAppleMailContextArgs,
  buildAppleMailDraftArgs,
  openAppleMailReplyDraft
} from "../src/server/mail/apple-mail-draft.js";

describe("Apple Mail candidate filtering", () => {
  test.each([
    ["Thank you for your application", "no-reply@greenhouse.example.com"],
    ["Einladung zum Gespräch", "talent@example.com"],
    ["Your interview schedule", "recruiting@acme.example.com"],
    ["Update", "notifications@ashbyhq.example.com"]
  ])("accepts job-search header %s", (subject, sender) => {
    expect(isCandidateHeader({ subject, sender })).toBe(true);
  });

  test("rejects unrelated personal mail", () => {
    expect(isCandidateHeader({ subject: "Kita Sommerfest", sender: "parents@example.org" })).toBe(
      false
    );
  });
});

describe("parseAppleMailRows", () => {
  test("parses the record and field separators without retaining full content", () => {
    const row = [
      "id@example.com",
      "Example Mail",
      "INBOX",
      "2026-08-02T09:00:00.000Z",
      "jobs@acme.example.com",
      "candidate@example.com",
      "Interview invitation",
      "Short relevant content"
    ].join("\u001f");
    const messages = parseAppleMailRows(`${row}\u001e`);
    expect(messages).toEqual([
      {
        messageId: "id@example.com",
        account: "Example Mail",
        mailbox: "INBOX",
        receivedAt: "2026-08-02T09:00:00.000Z",
        sender: "jobs@acme.example.com",
        recipients: "candidate@example.com",
        subject: "Interview invitation",
        content: "Short relevant content",
        attachmentNames: ""
      }
    ]);
  });
});

describe("buildAppleMailArgs", () => {
  test("exports the full range in one Apple Mail pass with an exclusive end date", () => {
    expect(
      buildAppleMailArgs("script.scpt", "2026-07-24", "2026-09-24", ["allowed-a", "allowed-b"])
    ).toEqual(["script.scpt", "2026-07-24", "2026-09-25", "allowed-a", "allowed-b"]);
  });
});

test("Apple Mail automation contains no mutating mail commands", () => {
  const script = readFileSync(
    resolve("scripts/export-apple-mail.applescript"),
    "utf8"
  ).toLowerCase();
  expect(script).not.toMatch(/\b(send|delete|move)\b/);
  expect(script).not.toContain("set read status");
  expect(script).not.toContain("set flagged status");
  expect(script).not.toContain("former@example.com");
  expect(script).not.toContain("whose date received");
  expect(script).toContain("messages messageindex thru batchend");
  expect(script).toContain("read status of mailmessage");
  expect(script).toContain("flagged status of mailmessage");
});

describe("Apple Mail follow-up drafts", () => {
  const target = {
    followUpId: 7,
    messageId: "thread@example.com",
    account: "Example Mail",
    mailbox: "INBOX",
    draft: "Hello,\n\nCould you share an update?",
    recipient: "alex@example.com",
    subject: "Re: Your application"
  };

  test("passes the inspected recipient and sender identity to the native reply script", () => {
    expect(buildAppleMailContextArgs("inspect.scpt", target)).toEqual([
      "inspect.scpt",
      "Example Mail",
      "INBOX",
      "thread@example.com"
    ]);
    expect(
      buildAppleMailDraftArgs(
        "compose.scpt",
        target,
        "replies@example.com",
        "candidate@example.com"
      )
    ).toEqual([
      "compose.scpt",
      "Example Mail",
      "INBOX",
      "thread@example.com",
      "replies@example.com",
      "candidate@example.com"
    ]);
  });

  test("uses a safe Reply-To and an approved identity from the source account", async () => {
    const calls: string[][] = [];
    await openAppleMailReplyDraft(target, mailPolicy, async (_file, args) => {
      calls.push(args);
      if (args[0].endsWith("inspect-apple-mail-message.applescript")) {
        return { stdout: "Recruiter <replies@example.com>\u001fcandidate@example.com", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });

    expect(calls).toHaveLength(2);
    expect(calls[1].slice(-2)).toEqual(["replies@example.com", "candidate@example.com"]);
  });

  test("rejects an unsafe Reply-To before creating the draft", async () => {
    const calls: string[][] = [];
    await expect(
      openAppleMailReplyDraft(target, mailPolicy, async (_file, args) => {
        calls.push(args);
        return { stdout: "No Reply <no_reply@example.com>\u001fcandidate@example.com", stderr: "" };
      })
    ).rejects.toThrow("Apple Mail reply address is not safe");
    expect(calls).toHaveLength(1);
  });

  test("rejects unapproved accounts before invoking Apple Mail", async () => {
    let invoked = false;
    await expect(
      openAppleMailReplyDraft(
        { ...target, account: "former@example.com" },
        mailPolicy,
        async () => {
          invoked = true;
          return { stdout: "", stderr: "" };
        }
      )
    ).rejects.toThrow("Apple Mail account is not approved");
    expect(invoked).toBe(false);
  });

  test("the draft script opens a native reply without replacing rich text or using UI automation", () => {
    const script = readFileSync(
      resolve("scripts/open-apple-mail-reply-draft.applescript"),
      "utf8"
    ).toLowerCase();
    expect(script).toContain("reply targetmessage opening window false reply to all false");
    expect(script).toContain("set sender of draftmessage to senderaddress");
    expect(script).toContain("address of first to recipient of draftmessage");
    expect(script.indexOf("set visible of draftmessage to true")).toBeGreaterThan(
      script.indexOf("native reply recipient does not match")
    );
    expect(script).not.toContain("make new outgoing message");
    expect(script).not.toContain("set content of draftmessage");
    expect(script).not.toContain('application "system events"');
    expect(script).not.toMatch(/\bsend\b/);
    const inspector = readFileSync(
      resolve("scripts/inspect-apple-mail-message.applescript"),
      "utf8"
    ).toLowerCase();
    expect(inspector).toContain("reply to of targetmessage");
    expect(inspector).toContain("email addresses of mailaccount");
    expect(inspector).toMatch(/end tell\s+repeat with accountaddress in accountaddresses/);
    expect(inspector).not.toMatch(/\bsend\b/);
  });
});
