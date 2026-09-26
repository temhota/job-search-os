import { useRef, useState } from "react";
import type { Row } from "../types.js";
import { uiText } from "../ui-text.js";

export interface GeneratedDocument {
  id: number;
  format: string;
  download_url: string;
}
export interface GeneratedDocumentPair {
  docx: GeneratedDocument;
  pdf: GeneratedDocument;
}
export interface DocumentSnapshot {
  documents: Row[];
  activity: Row[];
}

interface Attempt {
  language: "en" | "de";
  documentIds: Set<number>;
  activityIds: Set<number>;
}

interface Props {
  onGenerate: (language: "English" | "German") => Promise<GeneratedDocumentPair>;
  onRefreshDocuments: () => Promise<DocumentSnapshot>;
}

function recoverPair(snapshot: DocumentSnapshot, attempt: Attempt): GeneratedDocument[] {
  const documentsById = new Map(
    snapshot.documents.map((document) => [Number(document.id), document])
  );
  for (const activity of snapshot.activity) {
    if (activity.action !== "documents_generated" || attempt.activityIds.has(Number(activity.id)))
      continue;
    let details: { documentIds?: unknown; language?: unknown };
    try {
      details = JSON.parse(String(activity.details));
    } catch {
      continue;
    }
    if (
      details.language !== attempt.language ||
      !Array.isArray(details.documentIds) ||
      details.documentIds.length !== 2
    )
      continue;
    const ids = details.documentIds.map(Number);
    if (ids.some((id) => !Number.isSafeInteger(id) || attempt.documentIds.has(id))) continue;
    const pair = ids.map((id) => documentsById.get(id));
    if (
      pair.some(
        (document) =>
          !document || document.language !== attempt.language || document.document_type !== "resume"
      )
    )
      continue;
    const docx = pair.find((document) => document?.format === "docx");
    const pdf = pair.find((document) => document?.format === "pdf");
    if (!docx || !pdf) continue;
    return [docx, pdf].map((document) => ({
      id: Number(document.id),
      format: String(document.format),
      download_url: String(document.download_url ?? `/api/documents/${document.id}/download`)
    }));
  }
  return [];
}

export function DocumentPackageControls({ onGenerate, onRefreshDocuments }: Props) {
  const [language, setLanguage] = useState<"English" | "German">("English");
  const [busy, setBusy] = useState<"generate" | "refresh" | null>(null);
  const [error, setError] = useState("");
  const [generated, setGenerated] = useState<GeneratedDocument[]>([]);
  const attemptRef = useRef<Attempt | null>(null);

  async function generate() {
    if (busy) return;
    setBusy("generate");
    setError("");
    setGenerated([]);
    attemptRef.current = null;
    try {
      const baseline = await onRefreshDocuments();
      attemptRef.current = {
        language: language === "English" ? "en" : "de",
        documentIds: new Set(baseline.documents.map((document) => Number(document.id))),
        activityIds: new Set(baseline.activity.map((activity) => Number(activity.id)))
      };
      const pair = await onGenerate(language);
      setGenerated([pair.docx, pair.pdf]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : uiText.errors.documentGeneration);
    } finally {
      setBusy(null);
    }
  }

  async function retryRead() {
    if (busy || !attemptRef.current) return;
    setBusy("refresh");
    try {
      const snapshot = await onRefreshDocuments();
      const recovered = recoverPair(snapshot, attemptRef.current);
      if (recovered.length === 2) {
        setGenerated(recovered);
        setError("");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : uiText.errors.loadDetails);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="document-package-controls">
      <div className="document-generation">
        <label>
          {uiText.labels.documentLanguage}
          <select
            value={language}
            disabled={busy !== null}
            onChange={(event) => setLanguage(event.target.value as "English" | "German")}
          >
            <option value="English">English</option>
            <option value="German">German</option>
          </select>
        </label>
        <button type="button" disabled={busy !== null} onClick={() => void generate()}>
          {busy === "generate" ? uiText.labels.generatingPackage : uiText.labels.generatePackage}
        </button>
      </div>
      {error && (
        <p role="alert" className="detail-error">
          {error}{" "}
          {attemptRef.current && (
            <button type="button" disabled={busy !== null} onClick={() => void retryRead()}>
              {uiText.labels.retry}
            </button>
          )}
        </p>
      )}
      {generated.map((document) => (
        <a key={document.id} className="document-generated-link" href={document.download_url}>
          {uiText.labels.download} {document.format.toUpperCase()} resume
        </a>
      ))}
    </div>
  );
}
