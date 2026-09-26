import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { FollowUpDraftTarget } from "../app.js";
import type { MailPolicy } from "../../shared/types.js";
import { isReplyableSender, parseSingleSenderAddress } from "./address.js";

const execFileAsync = promisify(execFile);

type ExecRunner = (file: string, args: string[], options: { timeout: number; maxBuffer: number }) => Promise<{ stdout: string; stderr: string }>;

export function buildAppleMailContextArgs(scriptPath: string, target: FollowUpDraftTarget) {
  return [scriptPath, target.account, target.mailbox, target.messageId];
}

export function buildAppleMailDraftArgs(scriptPath: string, target: FollowUpDraftTarget, recipient: string, senderAddress: string) {
  return [scriptPath, target.account, target.mailbox, target.messageId, recipient, senderAddress];
}

export async function openAppleMailReplyDraft(target: FollowUpDraftTarget, policy: MailPolicy, run: ExecRunner = execFileAsync) {
  if (!policy.accounts.has(target.account)) throw new Error("Apple Mail account is not approved");
  if (target.mailbox.toLowerCase() !== "inbox") throw new Error("Apple Mail mailbox is not approved");
  const inspectPath = resolve(process.cwd(), "scripts/inspect-apple-mail-message.applescript");
  const composePath = resolve(process.cwd(), "scripts/open-apple-mail-reply-draft.applescript");
  const { stdout } = await run("osascript", buildAppleMailContextArgs(inspectPath, target), { timeout: 30_000, maxBuffer: 1024 * 1024 });
  const [rawReplyTo = "", ...rawSenderAddresses] = stdout.replace(/[\r\n]+$/, "").split("\u001f");
  const effectiveRecipient = rawReplyTo.trim() ? parseSingleSenderAddress(rawReplyTo) : target.recipient;
  if (!effectiveRecipient || !isReplyableSender(effectiveRecipient, policy.senderAddresses)) throw new Error("Apple Mail reply address is not safe");
  const senderAddress = rawSenderAddresses.map(parseSingleSenderAddress).find((address) => address && policy.senderAddresses.has(address));
  if (!senderAddress) throw new Error("Apple Mail sender identity is not approved");
  await run("osascript", buildAppleMailDraftArgs(composePath, target, effectiveRecipient, senderAddress), { timeout: 30_000, maxBuffer: 1024 * 1024 });
}
