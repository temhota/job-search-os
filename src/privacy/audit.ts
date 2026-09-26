import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface AuditFinding {
  code: string;
  path?: string;
  commit?: string;
  detail: string;
}
export interface AuditOptions {
  privateDenylistPath?: string;
  allowedAuthorEmail?: string;
}

function containsPrivate(value: string, terms: string[]) {
  return terms.some((term) => value.toLowerCase().includes(term.toLowerCase()));
}
function safePath(path: string, terms: string[]) {
  return containsPrivate(path, terms) ? "[redacted path]" : path;
}
export function auditPaths(paths: string[]): AuditFinding[] {
  return paths.flatMap((path) => {
    const normalized = path.replaceAll("\\", "/");
    const local = /(?:^|\/)(?:data|output|backups?|tmp)(?:\/|$)/i.test(normalized)
      || /(?:^|\/)\.env(?:$|\.(?!example$))/i.test(normalized)
      || /(?:^|\/)config\/local\.json$/i.test(normalized)
      || /\.local\.json$/i.test(normalized)
      || /\.(?:db|sqlite3?)(?:-(?:wal|shm|journal))?$/i.test(normalized)
      || /\.(?:docx|pdf|bak|backup)$/i.test(normalized);
    return local ? [{ code: "local-artifact", path, detail: "Local artifact must not be published." }] : [];
  });
}
export function auditText(text: string, path: string, privateTerms: string[] = []): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const location = safePath(path, privateTerms);
  const add = (code: string, detail: string) => findings.push({ code, path: location, detail });
  if (/(?:\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/|[A-Za-z]:\\+Users\\+[^\\\s]+\\+)/.test(text)) {
    add("absolute-user-path", "Absolute user directory found.");
  }
  const emails = text.match(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g) ?? [];
  if (emails.some((email) => {
    const domain = email.split("@")[1].toLowerCase();
    return domain !== "users.noreply.github.com" && !["example.com", "example.org", "example.net"]
      .some((reserved) => domain === reserved || domain.endsWith(`.${reserved}`));
  })) {
    add("non-example-email", "Email outside approved public domains found.");
  }
  const assignments = text.matchAll(/(?:^|[^\w$])(?:["']([A-Za-z_$][\w$-]*)["']|([A-Za-z_$][\w$-]*))\s*[:=]\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s"'`,;{}()[\]]+))/gm);
  if ([...assignments].some((match) => {
    const key = (match[1] ?? match[2]).replace(/([a-z0-9])([A-Z])/g, "$1_$2").replaceAll("-", "_").toLowerCase();
    const value = match[3] ?? match[4] ?? match[5];
    return /(?:^|_)(?:api_?key|access_?token|secret(?:_access)?_?key|client_?secret|password|passwd|secret)$/.test(key) && value.length >= 4;
  })) {
    add("credential-assignment", "Possible credential assignment found.");
  }
  if (/\bauthorization["']?\s*[:=]\s*["']?(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/i.test(text)) {
    add("authorization-header", "Possible authorization credential found (redacted).");
  }
  if (/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/.test(text)) {
    add("access-token", "Recognized access token format found (redacted).");
  }
  if (/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(text)) {
    add("private-key", "Private key material found.");
  }
  if (containsPrivate(text, privateTerms) || containsPrivate(path, privateTerms)) {
    add("private-identifier", "Private identifier found (redacted).");
  }
  return findings;
}

export function auditRepository(root: string, options: AuditOptions = {}): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  const text = (...args: string[]) => git(...args).toString("utf8");
  const splitPaths = (value: string) => value.split("\0").filter(Boolean);
  try {
    const terms = options.privateDenylistPath
      ? readFileSync(options.privateDenylistPath, "utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"))
      : [];
    const scan = (path: string, content: Buffer, commit?: string) => {
      const location = safePath(path, terms);
      findings.push(...auditPaths([path]).map((finding) => ({ ...finding, path: location, ...(commit ? { commit } : {}) })));
      const decoded = content.toString("utf8");
      if (content.includes(0) || !Buffer.from(decoded).equals(content)) {
        findings.push({ code: "unexpected-binary", path: location, ...(commit ? { commit } : {}), detail: "Unexpected binary content found." });
      }
      findings.push(...auditText(decoded, path, terms).map((finding) => ({ ...finding, ...(commit ? { commit } : {}),
        code: commit && finding.code === "private-identifier" ? "historical-private-identifier" : finding.code })));
    };
    const paths = splitPaths(text("ls-files", "-z"));
    for (const path of paths) {
      try { scan(path, readFileSync(join(root, path))); } catch {
        findings.push({ code: "audit-error", path: safePath(path, terms), detail: "Tracked working file could not be read." });
      }
    }
    // Index blobs may differ from the working copy, including staged secrets.
    for (const entry of splitPaths(text("ls-files", "--stage", "-z"))) {
      const [metadata, path] = entry.split("\t");
      const oid = metadata.split(" ")[1];
      scan(path, git("cat-file", "blob", oid));
    }
    const commits = text("rev-list", "--all").trim().split("\n").filter(Boolean);
    for (const commit of commits) {
      const identities = text("show", "-s", "--format=%ae%n%ce", commit).trim().split("\n");
      if (identities.some((email) => !/^[^@\s]+@users\.noreply\.github\.com$/i.test(email)
        || (options.allowedAuthorEmail && email !== options.allowedAuthorEmail))) {
        findings.push({ code: "commit-author-email", commit, detail: "Commit identity is not approved." });
      }
      for (const path of splitPaths(text("ls-tree", "-r", "--name-only", "-z", commit))) {
        scan(path, git("show", `${commit}:${path}`), commit);
      }
    }
    // Scan all reachable commit/tag payloads as well as blobs, including
    // annotated tag messages and objects reached only through tag refs.
    for (const line of text("rev-list", "--objects", "--all").trim().split("\n").filter(Boolean)) {
      const oid = line.split(" ")[0];
      const type = text("cat-file", "-t", oid).trim();
      if (type === "tree") {
        for (const path of splitPaths(text("ls-tree", "-r", "-t", "--name-only", "-z", oid))) {
          findings.push(...auditPaths([path]).map((finding) => ({ ...finding, path: safePath(path, terms), commit: oid })));
          findings.push(...auditText(path, path, terms).map((finding) => ({ ...finding, commit: oid,
            code: finding.code === "private-identifier" ? "historical-private-identifier" : finding.code })));
        }
        continue;
      }
      if (type === "blob") {
        scan(line.slice(oid.length + 1) || "[reachable blob]", git("cat-file", type, oid), oid);
      } else {
        const payload = text("cat-file", type, oid);
        // Exempt only identity fields from private matching; tag names and
        // other headers as well as every message line still receive it.
        const separator = payload.indexOf("\n\n");
        const headers = payload.slice(0, separator).split("\n")
          .filter((line) => !/^(?:author|committer|tagger) /.test(line)).join("\n");
        const privatePayload = headers + payload.slice(separator);
        const metadataFindings = [...auditText(payload, "[git metadata]"), ...auditText(privatePayload, "[git metadata]", terms)];
        findings.push(...metadataFindings.map((finding) => ({ ...finding, commit: oid,
          code: finding.code === "private-identifier" ? "historical-private-identifier" : finding.code })));
      }
    }
  } catch {
    findings.push({ code: "audit-error", detail: "Audit could not complete; repository or external inputs unavailable." });
  }
  return [...new Map(findings.map((finding) => [JSON.stringify(finding), finding])).values()];
}
