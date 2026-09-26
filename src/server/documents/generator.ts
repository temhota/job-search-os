import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { JobRepository } from "../db/repository.js";
import { resumeContentForJob } from "./content.js";
import type { AppConfig } from "../config/schema.js";

export type DocumentLanguage = "English" | "German";
export type ProcessRunner = (command: string, args: string[]) => Promise<void>;
export type PayloadWriter = (path: string, content: string) => void;
export interface DocumentCommands {
  python: string;
  soffice: string;
}
export interface DocumentGenerator {
  generate(
    jobId: number,
    language: DocumentLanguage
  ): Promise<{
    docx: NonNullable<ReturnType<JobRepository["getDocument"]>>;
    pdf: NonNullable<ReturnType<JobRepository["getDocument"]>>;
  }>;
}

const execFileAsync = promisify(execFile);
export const runDocumentProcess: ProcessRunner = async (command, args) => {
  await execFileAsync(command, args, { maxBuffer: 1024 * 1024 });
};

const writePayload: PayloadWriter = (path, content) =>
  writeFileSync(path, content, { mode: 0o600 });

function companyFilenamePart(company: string) {
  const withoutLegalSuffix = company
    .trim()
    .replace(
      /\s+(?:GmbH(?:\s*&\s*Co\.?\s*(?:KG)?)?|AG|SE|UG|Ltd\.?|Limited|Inc\.?|LLC|Corp\.?|Corporation)\.?$/i,
      ""
    );
  return (
    withoutLegalSuffix
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "Company"
  );
}

export function resolveDocumentCommands(
  env: Partial<Pick<NodeJS.ProcessEnv, "DOCUMENT_PYTHON" | "DOCUMENT_SOFFICE">> = process.env,
  home = homedir(),
  exists: (path: string) => boolean = existsSync
): DocumentCommands {
  const bundledRoot = join(home, ".cache/codex-runtimes/codex-primary-runtime/dependencies");
  const bundledPython = join(bundledRoot, "python/bin/python3");
  const bundledSoffice = join(bundledRoot, "bin/override/soffice");
  return {
    python: env.DOCUMENT_PYTHON ?? (exists(bundledPython) ? bundledPython : "python3"),
    soffice: env.DOCUMENT_SOFFICE ?? (exists(bundledSoffice) ? bundledSoffice : "soffice")
  };
}

export function createDocumentGenerator(
  repo: JobRepository,
  outputRoot: string,
  run: ProcessRunner,
  candidate: Pick<AppConfig["candidate"], "filenameStem" | "resumes">,
  write: PayloadWriter = writePayload,
  commands: DocumentCommands = resolveDocumentCommands()
): DocumentGenerator {
  return {
    async generate(jobId, language) {
      const job = repo.getJob(jobId);
      if (!job) throw new Error("Job not found");
      const tmpDir = resolve(outputRoot, "tmp");
      const docxDir = resolve(outputRoot, "docx", String(jobId));
      const pdfDir = resolve(outputRoot, "pdf", String(jobId));
      for (const dir of [tmpDir, resolve(outputRoot, "docx"), resolve(outputRoot, "pdf")])
        mkdirSync(dir, { recursive: true });
      const stem = `${candidate.filenameStem}_${companyFilenamePart(String(job.company))}`;
      const stagingDir = join(tmpDir, randomUUID());
      mkdirSync(stagingDir, { recursive: true });
      const payloadPath = join(stagingDir, "payload.json");
      const stagedDocxPath = join(stagingDir, `${stem}.docx`);
      const stagedPdfPath = join(stagingDir, `${stem}.pdf`);
      const docxPath = join(docxDir, `${stem}.docx`);
      const pdfPath = join(pdfDir, `${stem}.pdf`);
      try {
        write(
          payloadPath,
          JSON.stringify(
            resumeContentForJob(
              {
                company: String(job.company),
                title: String(job.title),
                description: typeof job.description === "string" ? job.description : null
              },
              language,
              candidate.resumes
            )
          )
        );
        await run(commands.python, [
          resolve(process.cwd(), "scripts/generate-resume.py"),
          payloadPath,
          stagedDocxPath
        ]);
        if (!existsSync(stagedDocxPath)) throw new Error("DOCX generation produced no file");
        await run(commands.soffice, [
          "--headless",
          "--convert-to",
          "pdf",
          "--outdir",
          stagingDir,
          stagedDocxPath
        ]);
        if (!existsSync(stagedPdfPath)) throw new Error("PDF conversion produced no file");
        for (const dir of [docxDir, pdfDir]) mkdirSync(dir, { recursive: true });
        renameSync(stagedDocxPath, docxPath);
        renameSync(stagedPdfPath, pdfPath);
        const common = {
          documentType: "resume",
          language: language === "English" ? "en" : "de",
          version: "generated",
          filePath: ""
        };
        return repo.registerDocumentPair(
          jobId,
          { ...common, format: "docx", filePath: docxPath },
          { ...common, format: "pdf", filePath: pdfPath }
        );
      } catch (error) {
        if (isDependencyFailure(error))
          throw Object.assign(new Error("Document generation is unavailable on this Mac"), {
            code: "DOCUMENT_DEPENDENCY_UNAVAILABLE"
          });
        throw error;
      } finally {
        rmSync(stagingDir, { recursive: true, force: true });
      }
    }
  };
}

function isDependencyFailure(error: unknown) {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === "ENOENT" ||
    /ModuleNotFoundError|No module named ['"]docx|command not found|error while loading shared libraries/i.test(
      error.message
    )
  );
}
