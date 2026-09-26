// Break caught: generated application material invents unconfirmed release ownership or leaks the weak GitHub profile.
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { resumeContentForJob } from "../src/server/documents/content.js";
import { createDatabase, migrate } from "../src/server/db/database.js";
import { JobRepository } from "../src/server/db/repository.js";
import { createDocumentGenerator, resolveDocumentCommands } from "../src/server/documents/generator.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function fixture(company = "Northstar Health") {
  const root = mkdtempSync(join(tmpdir(), "job-documents-"));
  roots.push(root);
  const db = createDatabase(":memory:");
  migrate(db);
  const repo = new JobRepository(db);
  const job = repo.upsertJob({ company, title: "Senior React Native Engineer", description: "React Native Expo", employmentType: "permanent", source: "web" });
  return { root, db, repo, job };
}

describe("resumeContentForJob", () => {
  test("shows the example career break as completed in every generated CV language", () => {
    expect(resumeContentForJob({ company: "Example_Labs", title: "React Native Engineer" }, "English").careerNote)
      .toBe("Career Break | Jan 2025 - Jun 2025");
    expect(resumeContentForJob({ company: "Example_Labs", title: "React Native Engineer" }, "German").careerNote)
      .toBe("Berufliche Auszeit | Jan 2025 - Jun 2025");
  });

  test("uses confirmed React Native evidence for Northstar Health without unverified claims", () => {
    const content = resumeContentForJob({ company: "Northstar Health", title: "Senior Software Engineer (Mobile / React Native)", description: "React Native Expo EAS TypeScript" });
    expect(content.headline).toBe("SENIOR SOFTWARE ENGINEER - REACT NATIVE");
    expect(content.summary).toContain("7+ years");
    expect(content.skills[0]).toContain("React Native");
    expect(content.contactLine).not.toContain("GitHub");
    expect(JSON.stringify(content)).not.toMatch(/independently published|App Store ownership|Google Play ownership/i);
  });
  test("German package translates labels and factual experience without adding claims", () => {
    const content = resumeContentForJob({ company: "Northstar Health", title: "Senior React Native Engineer" }, "German");
    expect(content.language).toBe("German");
    expect(content.summary).toContain("7 Jahren");
    expect(content.experience[0].bullets[4]).toContain("bestehenden Expo/EAS-Prozess");
    expect(JSON.stringify(content)).not.toMatch(/github|App Store|Google Play|OTA|team lead/i);
  });
});

describe("document generator", () => {
  test("keeps distinct jobs at the same company in separate storage while preserving download filenames", async () => {
    const { root, db, repo, job } = fixture("Example Labs");
    const other = repo.upsertJob({ company: "Example Labs", title: "Web Platform Developer", employmentType: "permanent", source: "web" });
    expect(other.id).not.toBe(job.id);
    let generation = 0;
    const generator = createDocumentGenerator(repo, root, async (_command, args) => {
      if (args.some((arg) => arg.endsWith("generate-resume.py"))) {
        generation += 1;
        writeFileSync(args[2], `docx-${generation}`);
      } else {
        const outDir = args[args.indexOf("--outdir") + 1];
        writeFileSync(join(outDir, basename(args.at(-1)!).replace(/\.docx$/, ".pdf")), `pdf-${generation}`);
      }
    });
    const first = await generator.generate(job.id, "English");
    const second = await generator.generate(other.id, "German");
    expect(first.docx.file_path).not.toBe(second.docx.file_path);
    expect(first.pdf.file_path).not.toBe(second.pdf.file_path);
    expect(readFileSync(first.docx.file_path, "utf8")).toBe("docx-1");
    expect(readFileSync(first.pdf.file_path, "utf8")).toBe("pdf-1");
    expect(readFileSync(second.docx.file_path, "utf8")).toBe("docx-2");
    expect(readFileSync(second.pdf.file_path, "utf8")).toBe("pdf-2");
    expect(basename(second.docx.file_path)).toBe("Alex_Morgan_CV_Example_Labs.docx");
    expect(basename(second.pdf.file_path)).toBe("Alex_Morgan_CV_Example_Labs.pdf");
    expect(repo.getDocument(first.docx.id)).toMatchObject({ job_id: job.id });
    expect(repo.getDocument(second.docx.id)).toMatchObject({ job_id: other.id });
    expect(db.prepare("SELECT COUNT(*) AS count FROM documents").get()).toEqual({ count: 4 });
    db.close();
  });

  test("replaces generated files and records under one readable company filename", async () => {
    const { root, db, repo, job } = fixture("Example Labs");
    let generation = 0;
    const generator = createDocumentGenerator(repo, root, async (_command, args) => {
      if (args.some((arg) => arg.endsWith("generate-resume.py"))) {
        generation += 1;
        writeFileSync(args[2], `docx-${generation}`);
      } else {
        const outDir = args[args.indexOf("--outdir") + 1];
        const input = args.at(-1)!;
        writeFileSync(join(outDir, basename(input).replace(/\.docx$/, ".pdf")), `pdf-${generation}`);
      }
    });

    const first = await generator.generate(job.id, "English");
    const second = await generator.generate(job.id, "German");

    expect(basename(first.docx.file_path)).toBe("Alex_Morgan_CV_Example_Labs.docx");
    expect(basename(first.pdf.file_path)).toBe("Alex_Morgan_CV_Example_Labs.pdf");
    expect(second.docx.file_path).toBe(first.docx.file_path);
    expect(second.pdf.file_path).toBe(first.pdf.file_path);
    expect(readFileSync(second.docx.file_path, "utf8")).toBe("docx-2");
    expect(readFileSync(second.pdf.file_path, "utf8")).toBe("pdf-2");
    expect(db.prepare("SELECT format,language FROM documents ORDER BY format").all()).toEqual([
      { format: "docx", language: "de" },
      { format: "pdf", language: "de" }
    ]);
    db.close();
  });

  test("uses the bundled Codex document runtime during an ordinary local start", () => {
    const home = "/example-home";
    const bundledRoot = join(home, ".cache/codex-runtimes/codex-primary-runtime/dependencies");
    const existing = new Set([
      join(bundledRoot, "python/bin/python3"),
      join(bundledRoot, "bin/override/soffice")
    ]);

    expect(resolveDocumentCommands({}, home, (path) => existing.has(path))).toEqual({
      python: join(bundledRoot, "python/bin/python3"),
      soffice: join(bundledRoot, "bin/override/soffice")
    });
  });

  test("keeps explicit document runtime overrides ahead of bundled commands", () => {
    expect(resolveDocumentCommands(
      { DOCUMENT_PYTHON: "/custom/python", DOCUMENT_SOFFICE: "/custom/soffice" },
      "/example-home",
      () => true
    )).toEqual({ python: "/custom/python", soffice: "/custom/soffice" });
  });

  test("passes verified content to Python, converts locally, and registers one pair", async () => {
    const { root, db, repo, job } = fixture();
    const calls: Array<{ command: string; args: string[] }> = [];
    const generator = createDocumentGenerator(repo, root, async (command, args) => {
      calls.push({ command, args });
      if (args.some((arg) => arg.endsWith("generate-resume.py"))) {
        const payload = JSON.parse(readFileSync(args[1], "utf8"));
        expect(payload.name).toBe("ALEX MORGAN");
        expect(payload.contactLine).toBe("Berlin, Germany | candidate@example.com | linkedin.com/in/example-candidate");
        expect(payload.experience.map((item: { company: string }) => item.company)).toEqual([
          "Example Labs", "Demo Commerce", "Sample University"
        ]);
        expect(payload.language).toBe("English");
        expect(JSON.stringify(payload)).not.toMatch(/github\.com|independently published|app store ownership/i);
        mkdirSync(join(root, "docx"), { recursive: true });
        writeFileSync(args[2], "docx");
      } else {
        expect(args.slice(0, 4)).toEqual(["--headless", "--convert-to", "pdf", "--outdir"]);
        const outDir = args[args.indexOf("--outdir") + 1];
        writeFileSync(join(outDir, args.at(-1)!.split("/").at(-1)!.replace(/\.docx$/, ".pdf")), "pdf");
      }
    });
    const pair = await generator.generate(job.id, "English");
    expect(calls).toHaveLength(2);
    expect(pair.docx).toMatchObject({ job_id: job.id, format: "docx", language: "en" });
    expect(pair.pdf).toMatchObject({ job_id: job.id, format: "pdf", language: "en" });
    expect(db.prepare("SELECT format FROM documents ORDER BY id").all()).toEqual([{ format: "docx" }, { format: "pdf" }]);
    expect(db.prepare("SELECT action,source FROM activity WHERE entity_type='job' AND entity_id=? AND action='documents_generated'").all(job.id))
      .toEqual([{ action: "documents_generated", source: "manual" }]);
    expect(readdirSync(join(root, "tmp"))).toEqual([]);
    db.close();
  });

  test("does not register either document if PDF conversion produces no file", async () => {
    const { root, db, repo, job } = fixture();
    const generator = createDocumentGenerator(repo, root, async (_command, args) => {
      if (args.some((arg) => arg.endsWith("generate-resume.py"))) writeFileSync(args[2], "docx");
    });
    await expect(generator.generate(job.id, "German")).rejects.toThrow();
    expect(db.prepare("SELECT COUNT(*) AS count FROM documents").get()).toMatchObject({ count: 0 });
    expect(readdirSync(join(root, "tmp"))).toEqual([]);
    db.close();
  });

  test("does not register either document if Python produces no DOCX", async () => {
    const { root, db, repo, job } = fixture();
    const generator = createDocumentGenerator(repo, root, async () => {});
    await expect(generator.generate(job.id, "English")).rejects.toThrow("DOCX generation produced no file");
    expect(db.prepare("SELECT COUNT(*) AS count FROM documents").get()).toMatchObject({ count: 0 });
    expect(readdirSync(join(root, "tmp"))).toEqual([]);
    db.close();
  });

  test("removes a partially written payload when the filesystem write fails", async () => {
    const { root, db, repo, job } = fixture();
    let processes = 0;
    const generator = createDocumentGenerator(repo, root, async () => { processes += 1; }, (path, content) => {
      writeFileSync(path, content.slice(0, 12));
      throw new Error("disk full during payload write");
    });
    await expect(generator.generate(job.id, "English")).rejects.toThrow("disk full during payload write");
    expect(processes).toBe(0);
    expect(readdirSync(join(root, "tmp"))).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM documents").get()).toMatchObject({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM activity WHERE action='documents_generated'").get()).toMatchObject({ count: 0 });
    db.close();
  });

  test("passes translated verified German payload into the document process", async () => {
    const { root, db, repo, job } = fixture();
    const generator = createDocumentGenerator(repo, root, async (_command, args) => {
      if (args.some((arg) => arg.endsWith("generate-resume.py"))) {
        const payload = JSON.parse(readFileSync(args[1], "utf8"));
        expect(payload.language).toBe("German");
        expect(payload.summary).toContain("7 Jahren");
        expect(payload.experience[0].bullets[4]).toContain("bestehenden Expo/EAS-Prozess");
        expect(JSON.stringify(payload)).not.toMatch(/github|app store|google play|OTA|team lead/i);
        writeFileSync(args[2], "docx");
      } else {
        const outDir = args[args.indexOf("--outdir") + 1];
        writeFileSync(join(outDir, args.at(-1)!.split("/").at(-1)!.replace(/\.docx$/, ".pdf")), "pdf");
      }
    });
    const pair = await generator.generate(job.id, "German");
    expect(pair.docx).toMatchObject({ language: "de" });
    expect(pair.pdf).toMatchObject({ language: "de" });
    db.close();
  });
});
