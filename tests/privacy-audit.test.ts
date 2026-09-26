import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { auditPaths, auditRepository, auditText } from "../src/privacy/audit.js";

const roots: string[] = [];
const approved = "123+demo@users.noreply.github.com";
const privateMarker = ["SYNTHETIC", "DENYLIST", "MARKER"].join("_");
const personalEmail = ["person", "real-domain.test"].join("@");
const credentialExamples = [
  ...["Bearer", "Basic"].flatMap((scheme) => {
    const value = `${scheme} ${Buffer.from("synthetic:credential-only").toString("base64")}`;
    return [
      { label: `${scheme} header`, source: ["Authorization", value].join(": "), credentialValue: value, code: "authorization-header" },
      { label: `${scheme} JSON header`, source: JSON.stringify({ headers: Object.fromEntries([["Authorization", value]]) }), credentialValue: value, code: "authorization-header" }
    ];
  }),
  ...["ghp", "gho", "ghu", "ghs", "ghr", "github_pat"].map((prefix) => {
    const value = [prefix, "A".repeat(36)].join("_");
    return { label: `${prefix} token format`, source: `const token = "${value}";`, credentialValue: value, code: "access-token" };
  })
];
function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), "privacy-audit-"));
  roots.push(root);
  return root;
}
function git(root: string, ...args: string[]) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function repository() {
  const root = temporaryRoot();
  git(root, "init", "-q");
  git(root, "config", "user.name", "Example Contributor");
  git(root, "config", "user.email", approved);
  git(root, "config", "commit.gpgsign", "false");
  return root;
}
function put(root: string, path: string, text: string | Buffer) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
  git(root, "add", "--", path);
}
function commit(root: string, message = "test: fixture") {
  git(root, "commit", "-qm", message);
  return git(root, "rev-parse", "HEAD");
}
function denylist() {
  const path = join(temporaryRoot(), "terms.txt");
  writeFileSync(path, `${privateMarker}\n`);
  return path;
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

test.each(credentialExamples)("redacts recognized credential material: $label", ({ source, credentialValue, code }) => {
  const findings = auditText(source, "request.txt");
  expect(findings).toContainEqual(expect.objectContaining({ code }));
  expect(JSON.stringify(findings)).not.toContain(credentialValue);
});

test.each(credentialExamples)("scans checkout credential material: $label", ({ source, credentialValue, code }) => {
  const root = repository();
  put(root, "request.txt", "Public example");
  commit(root);
  writeFileSync(join(root, "request.txt"), source);
  const findings = auditRepository(root);
  expect(findings).toContainEqual(expect.objectContaining({ code, path: "request.txt" }));
  expect(JSON.stringify(findings)).not.toContain(credentialValue);
});

test.each(credentialExamples)("scans deleted historical credential material: $label", ({ source, credentialValue, code }) => {
  const root = repository();
  put(root, "request.txt", source);
  const first = commit(root);
  git(root, "rm", "request.txt");
  put(root, "README.md", "Public example");
  commit(root);
  const findings = auditRepository(root);
  expect(findings).toContainEqual(expect.objectContaining({ code, path: "request.txt", commit: first }));
  expect(JSON.stringify(findings)).not.toContain(credentialValue);
});

test.each([
  "data/backups/run/jobs.db", "output/generated/resume.pdf", "nested/.env", "nested/.env.production",
  "nested/config/local.json", "nested/settings.local.json", "nested/jobs.sqlite3-wal", "nested/jobs.db-shm",
  "nested/jobs.db-journal", "nested/backups/file.txt", "nested/resume.docx", "nested/file.bak"
])("rejects local artifacts at any depth: %s", (path) => {
  expect(auditPaths([path])).toContainEqual(expect.objectContaining({ code: "local-artifact" }));
});
test("allows source, example config, and empty environment templates", () => {
  expect(auditPaths(["src/app.ts", "config/example.json", ".env.example"])).toEqual([]);
});
test.each([
  ["/Users", "example", "private/file"].join("/"),
  ["/home", "example", "private/file"].join("/"),
  ["C:", "Users", "example", "private"].join("\\")
])("detects an absolute user path", (value) => {
  expect(auditText(value, "README.md")).toContainEqual(expect.objectContaining({ code: "absolute-user-path" }));
});
test.each(["doubled separators", "JSON object", "nested JSON"])("detects serialized Windows user paths: %s", (representation) => {
  const plain = ["C:", "Users", "example", "private", "file.txt"].join("\\");
  const value = representation === "doubled separators" ? plain.replaceAll("\\", "\\\\")
    : representation === "JSON object" ? JSON.stringify({ location: plain }) : JSON.stringify(JSON.stringify({ location: plain }));
  expect(auditText(value, "fixture.json")).toContainEqual(expect.objectContaining({ code: "absolute-user-path" }));
});
test("allows only example and GitHub noreply email domains", () => {
  expect(auditText("candidate@example.com demo@example.org demo@example.net " + approved, "fixture.ts")).toEqual([]);
  expect(auditText(personalEmail, "fixture.ts")).toContainEqual(expect.objectContaining({ code: "non-example-email" }));
  expect(auditText(["demo", "example.com.evil.test"].join("@"), "fixture.ts")).toHaveLength(1);
});
test("accepts reserved example subdomains while rejecting domain lookalikes", () => {
  expect(auditText("jobs@careers.example.com demo@mail.example.org demo@deep.mail.example.net", "fixture.ts")).toEqual([]);
  expect(auditText(["jobs", "careers.example.com.evil.test"].join("@"), "fixture.ts"))
    .toContainEqual(expect.objectContaining({ code: "non-example-email" }));
  expect(auditText(["jobs", "notexample.com"].join("@"), "fixture.ts"))
    .toContainEqual(expect.objectContaining({ code: "non-example-email" }));
});
test.each([
  ["API_KEY", "=", "synthetic-secret-value"].join(""),
  ["const password", " = ", '"synthetic-secret-value"'].join(""),
  ["-----BEGIN", "PRIVATE KEY-----"].join(" ")
])("detects credential material without returning it", (value) => {
  const findings = auditText(value, "fixture.txt");
  expect(findings.length).toBeGreaterThan(0);
  expect(JSON.stringify(findings)).not.toContain(value);
});
test.each(["OPENAI_API_KEY", "AWS_SECRET_ACCESS_KEY", "GITHUB_ACCESS_TOKEN", "serviceClientSecret", "database_password"])("detects assigned prefixed credential keys: %s", (key) => {
    const value = `${key}=${"synthetic-secret-value"}`;
    const findings = auditText(value, "fixture.txt");
    expect(findings).toContainEqual(expect.objectContaining({ code: "credential-assignment" }));
    expect(JSON.stringify(findings)).not.toContain("synthetic-secret-value");
});
test("checks quoted credential keys while leaving unrelated identifiers alone", () => {
  expect(auditText(JSON.stringify(Object.fromEntries([["OPENAI_API_KEY", "synthetic-secret-value"]])), "fixture.json"))
    .toContainEqual(expect.objectContaining({ code: "credential-assignment" }));
  for (const key of ["API_KEY_LABEL", "passwordLength", "secretary", "tokenCount", "accessTokenEnabled"]) {
    expect(auditText(`${key}=${"synthetic-metadata"}`, "fixture.txt")).toEqual([]);
  }
});
test.each(["password", "OPENAI_API_KEY", '"AWS_SECRET_ACCESS_KEY"', "'GITHUB_ACCESS_TOKEN'"])("detects credential keys inside compact object assignments: %s", (key) => {
  const value = "synthetic-secret-value";
  const source = `const options = {${key}: "${value}" };`;
  const findings = auditText(source, "fixture.ts");
  expect(findings).toContainEqual(expect.objectContaining({ code: "credential-assignment" }));
  expect(JSON.stringify(findings)).not.toContain(value);
});
test("allows ordinary keys inside compact object assignments", () => {
  for (const key of ["timeout", "API_KEY_LABEL", "passwordLength", '"secretary"']) {
    const source = `const options = {${key}: "synthetic-metadata" };`;
    expect(auditText(source, "fixture.ts")).toEqual([]);
  }
});
test.each(["array", "function call"])("detects nested credential keys after an assigned %s", (container) => {
  const object = `{${"password"}: "${"synthetic-secret-value"}"}`;
  const source = container === "array" ? `const options = [${object}];` : `const options = configure(${object});`;
  expect(auditText(source, "fixture.ts")).toContainEqual(expect.objectContaining({ code: "credential-assignment" }));
});
test("redacts denylisted content and filenames", () => {
  const findings = auditText(privateMarker.toLowerCase(), `${privateMarker}.txt`, [privateMarker]);
  expect(findings).toContainEqual(expect.objectContaining({ code: "private-identifier" }));
  expect(JSON.stringify(findings).toLowerCase()).not.toContain(privateMarker.toLowerCase());
});
test("finds deleted private content in reachable history", () => {
  const root = repository();
  put(root, "removed.txt", privateMarker);
  const first = commit(root);
  git(root, "rm", "removed.txt");
  put(root, "README.md", "Public example");
  commit(root);
  const findings = auditRepository(root, { privateDenylistPath: denylist() });
  expect(findings).toContainEqual(expect.objectContaining({ code: "historical-private-identifier", commit: first }));
  expect(JSON.stringify(findings)).not.toContain(privateMarker);
});
test("scans commit messages and annotated tags as reachable objects", () => {
  const root = repository();
  put(root, "README.md", "Public example");
  commit(root, privateMarker);
  git(root, "tag", "-a", "example", "-m", privateMarker);
  expect(auditRepository(root, { privateDenylistPath: denylist() }).filter((f) => f.code === "historical-private-identifier").length).toBeGreaterThanOrEqual(2);
});
test("scans private annotated tag names while exempting only identity headers", () => {
  const root = repository();
  put(root, "README.md", "Public example");
  commit(root);
  git(root, "tag", "-a", privateMarker, "-m", "Public tag message");
  const tag = git(root, "rev-parse", privateMarker);
  const findings = auditRepository(root, { privateDenylistPath: denylist() });
  expect(findings).toContainEqual(expect.objectContaining({ code: "historical-private-identifier", commit: tag }));
  expect(JSON.stringify(findings)).not.toContain(privateMarker);
});
test("scans reachable tree names even when a tag points directly to a tree", () => {
  const root = repository();
  put(root, "README.md", "Public example");
  commit(root);
  const empty = execFileSync("git", ["-C", root, "mktree"], { input: "", encoding: "utf8" }).trim();
  const tree = execFileSync("git", ["-C", root, "mktree"], {
    input: `040000 tree ${empty}\t${privateMarker}\n`, encoding: "utf8"
  }).trim();
  git(root, "tag", "tree-example", tree);
  const findings = auditRepository(root, { privateDenylistPath: denylist() });
  expect(findings).toContainEqual(expect.objectContaining({ code: "historical-private-identifier", commit: tree }));
  expect(JSON.stringify(findings)).not.toContain(privateMarker);
});
test("validates approved identities separately from private content matching", () => {
  const root = repository();
  put(root, "README.md", "Public example");
  commit(root);
  git(root, "tag", "-a", "example", "-m", "Public tag");
  const path = join(temporaryRoot(), "terms.txt");
  writeFileSync(path, approved);
  expect(auditRepository(root, { privateDenylistPath: path, allowedAuthorEmail: approved })).toEqual([]);
});
test("rejects non-noreply commit identities and enforces an explicit approved author", () => {
  const root = repository();
  git(root, "config", "user.email", personalEmail);
  put(root, "README.md", "Public example");
  const sha = commit(root);
  expect(auditRepository(root)).toContainEqual(expect.objectContaining({ code: "commit-author-email", commit: sha }));
  const safe = repository();
  put(safe, "README.md", "Public example");
  commit(safe);
  expect(auditRepository(safe)).toEqual([]);
  expect(auditRepository(safe, { allowedAuthorEmail: "456+other@users.noreply.github.com" })).toContainEqual(expect.objectContaining({ code: "commit-author-email" }));
});
test("checks index blobs, working files, binary data and historical artifact paths", () => {
  const root = repository();
  put(root, "nested/file.pdf", "synthetic document");
  const first = commit(root);
  git(root, "rm", "nested/file.pdf");
  put(root, "README.md", "Public example");
  commit(root);
  put(root, "staged.txt", personalEmail);
  writeFileSync(join(root, "staged.txt"), "Safe working copy");
  put(root, "binary.dat", Buffer.from([0, 1, 255]));
  writeFileSync(join(root, "README.md"), personalEmail);
  const findings = auditRepository(root);
  expect(findings).toContainEqual(expect.objectContaining({ code: "local-artifact", commit: first }));
  expect(findings).toContainEqual(expect.objectContaining({ code: "non-example-email", path: "staged.txt" }));
  expect(findings).toContainEqual(expect.objectContaining({ code: "non-example-email", path: "README.md" }));
  expect(findings).toContainEqual(expect.objectContaining({ code: "unexpected-binary", path: "binary.dat" }));
});
test("allows recognized screenshot media only inside docs/media", () => {
  const root = repository();
  put(root, "README.md", "Public example");
  commit(root);
  const media = resolve(import.meta.dirname, "..", "docs", "media");
  const png = readFileSync(join(media, "today.png"));
  put(root, "docs/media/today.png", png);
  put(root, "docs/media/overview.mp4", Buffer.from([0, 0, 0, 24, 102, 116, 121, 112]));
  put(root, "public/today.png", png);
  put(root, "docs/media/extra.png", png);
  put(root, "docs/media/broken.png", Buffer.from([0, 1, 255]));
  const shapedButInvalidPng = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.from([0, 0, 0, 13]), Buffer.from("IHDR"), Buffer.alloc(13), Buffer.alloc(4),
    Buffer.from([0, 0, 0, 0]), Buffer.from("IEND"), Buffer.alloc(4)
  ]);
  put(root, "docs/media/pipeline.png", shapedButInvalidPng);
  const sensitivePayload = Buffer.from([
    "person", "@", "outside.invalid", " pass", "word", "=", "'", "synthetic", "-value", "'"
  ].join(""));
  put(root, "docs/media/jobs.png", Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), sensitivePayload]));
  put(root, "docs/media/review.png", Buffer.concat([png, sensitivePayload]));

  const findings = auditRepository(root);
  expect(findings).not.toContainEqual(expect.objectContaining({ code: "unexpected-binary", path: "docs/media/today.png" }));
  expect(findings).toContainEqual(expect.objectContaining({ code: "unexpected-binary", path: "docs/media/overview.mp4" }));
  expect(findings).toContainEqual(expect.objectContaining({ code: "unexpected-binary", path: "public/today.png" }));
  expect(findings).toContainEqual(expect.objectContaining({ code: "unexpected-binary", path: "docs/media/extra.png" }));
  expect(findings).toContainEqual(expect.objectContaining({ code: "unexpected-binary", path: "docs/media/broken.png" }));
  expect(findings).toContainEqual(expect.objectContaining({ code: "unexpected-binary", path: "docs/media/pipeline.png" }));
  expect(findings).toContainEqual(expect.objectContaining({ code: "unexpected-binary", path: "docs/media/jobs.png" }));
  expect(findings).toContainEqual(expect.objectContaining({ code: "non-example-email", path: "docs/media/review.png" }));
  expect(findings).toContainEqual(expect.objectContaining({ code: "credential-assignment", path: "docs/media/review.png" }));
});
test("fails closed with redacted errors for unreadable denylist or invalid repository", () => {
  expect(auditRepository(temporaryRoot())).toContainEqual(expect.objectContaining({ code: "audit-error" }));
  const root = repository();
  const findings = auditRepository(root, { privateDenylistPath: join(root, privateMarker) });
  expect(findings).toContainEqual(expect.objectContaining({ code: "audit-error" }));
  expect(JSON.stringify(findings)).not.toContain(privateMarker);
});
test("CLI passes a clean repository and fails with redacted findings and environment options", () => {
  const root = repository();
  put(root, "README.md", "Public example");
  commit(root);
  const run = (env: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, ["--import", resolve("node_modules/tsx/dist/loader.mjs"), resolve("scripts/privacy-audit.ts")], {
    cwd: root, encoding: "utf8", env: { ...process.env, PRIVATE_DENYLIST_PATH: "", ALLOWED_AUTHOR_EMAIL: "", ...env }
  });
  const clean = run();
  expect(clean.status).toBe(0);
  expect(clean.stdout).toContain("Privacy audit passed");
  put(root, `${privateMarker}.txt`, privateMarker);
  const path = denylist();
  const dirty = run({ PRIVATE_DENYLIST_PATH: path, ALLOWED_AUTHOR_EMAIL: approved });
  expect(dirty.status).toBe(1);
  expect(dirty.stdout + dirty.stderr).toContain("private-identifier");
  expect(dirty.stdout + dirty.stderr).not.toContain(privateMarker);
  expect(dirty.stdout + dirty.stderr).not.toContain(path);
  expect(dirty.stdout + dirty.stderr).not.toContain(approved);
});
