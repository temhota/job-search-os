import { useEffect, useRef, useState } from "react";
import type { DashboardData, JobDetails, Row } from "../types.js";
import { uiText } from "../ui-text.js";
import {
  DocumentPackageControls,
  type DocumentSnapshot,
  type GeneratedDocumentPair
} from "./DocumentPackageControls.js";

const statuses = [
  "applied",
  "recruiter_screen",
  "technical_interview",
  "take_home",
  "onsite_final",
  "offer",
  "rejected",
  "withdrawn",
  "unknown"
];

function value(row: Row, key: string) {
  return row[key] == null ? "" : String(row[key]);
}

interface Props {
  application: Row;
  data: DashboardData;
  details?: JobDetails;
  onClose: () => void;
  onSave: (application: Row, input: Record<string, unknown>) => Promise<void>;
  onAddInterviewNote: (interview: Row, input: { category: string; text: string }) => Promise<void>;
  onRefresh: () => Promise<void>;
  onGenerateDocuments?: (language: "English" | "German") => Promise<GeneratedDocumentPair>;
  onRefreshDocuments?: () => Promise<DocumentSnapshot>;
  noteLocked?: boolean;
  applicationLocked?: boolean;
}

export function ApplicationDetailDrawer({
  application,
  data,
  details,
  onClose,
  onSave,
  onAddInterviewNote,
  onRefresh,
  onGenerateDocuments,
  onRefreshDocuments,
  noteLocked = false,
  applicationLocked = false
}: Props) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [status, setStatus] = useState(value(application, "status"));
  const [priority, setPriority] = useState(Number(application.priority ?? 0));
  const [nextStep, setNextStep] = useState(value(application, "next_step"));
  const [notes, setNotes] = useState(value(application, "notes"));
  const [appliedDate, setAppliedDate] = useState(value(application, "applied_at").slice(0, 10));
  const [rejectionReason, setRejectionReason] = useState(value(application, "rejection_reason"));
  const [decision, setDecision] = useState(value(application, "decision"));
  const [noteByInterview, setNoteByInterview] = useState<Record<number, string>>({});
  const [categoryByInterview, setCategoryByInterview] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState<(() => Promise<boolean>) | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)"
        )
      ];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const interviews =
    details?.interviews ??
    data.interviews.filter((item) => Number(item.application_id) === application.id);
  const insights =
    details?.insights ??
    data.insightDetails?.filter((item) =>
      interviews.some((interview) => interview.id === Number(item.interview_event_id))
    ) ??
    [];
  const documents =
    details?.documents ??
    data.documents.filter((item) => Number(item.job_id) === Number(application.job_id));
  const evidence = details?.evidence ?? [];
  const activity = details?.activity ?? [];

  async function save() {
    if (applicationLocked || busy) return false;
    setBusy(true);
    setError("");
    setRetry(null);
    try {
      await onSave(application, {
        status,
        priority,
        nextStep: nextStep || null,
        notes,
        appliedAt: appliedDate ? new Date(`${appliedDate}T00:00:00.000Z`).toISOString() : null,
        rejectionReason: rejectionReason || null,
        decision: decision || null
      });
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : uiText.errors.saveApplication;
      setError(message);
      setRetry(() =>
        message === uiText.errors.refreshAfterSave
          ? async () => {
              await onRefresh();
              return true;
            }
          : save
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addNote(interview: Row) {
    const note = noteByInterview[interview.id]?.trim();
    if (!note) return false;
    setBusy(true);
    setError("");
    setRetry(null);
    try {
      await onAddInterviewNote(interview, {
        category: categoryByInterview[interview.id] ?? "system_design",
        text: note
      });
      setNoteByInterview((current) => ({ ...current, [interview.id]: "" }));
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : uiText.errors.saveInsight;
      setError(message);
      if (message === uiText.errors.refreshAfterSave)
        setNoteByInterview((current) => ({ ...current, [interview.id]: "" }));
      setRetry(() =>
        message === uiText.errors.refreshAfterSave
          ? async () => {
              await onRefresh();
              return true;
            }
          : () => addNote(interview)
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="detail-backdrop">
      <section
        ref={dialogRef}
        className="detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${value(application, "company")} application details`}
      >
        <div className="detail-heading">
          <div>
            <small>{uiText.labels.applicationDetails}</small>
            <h2>{value(application, "company")}</h2>
            <p>{value(application, "title")}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={uiText.labels.closeDetails}
          >
            ×
          </button>
        </div>
        {application.recruiter_contact && (
          <p className="detail-contact">
            {uiText.pipeline.recruiterContact}: {value(application, "recruiter_contact")}
          </p>
        )}
        <div className="detail-fields">
          <label>
            {uiText.labels.status}
            <select
              value={status}
              disabled={applicationLocked}
              onChange={(event) => setStatus(event.target.value)}
            >
              {statuses.map((item) => (
                <option value={item} key={item}>
                  {uiText.statuses[item]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {uiText.labels.priority}
            <input
              type="number"
              min="0"
              max="5"
              value={priority}
              disabled={applicationLocked}
              onChange={(event) => setPriority(Number(event.target.value))}
            />
          </label>
          <label>
            {uiText.labels.nextStep}
            <input
              value={nextStep}
              disabled={applicationLocked}
              onChange={(event) => setNextStep(event.target.value)}
            />
          </label>
          <label>
            {uiText.labels.appliedDate}
            <input
              type="date"
              value={appliedDate}
              disabled={applicationLocked}
              onChange={(event) => setAppliedDate(event.target.value)}
            />
          </label>
          <label>
            {uiText.labels.rejectionReason}
            <input
              value={rejectionReason}
              disabled={applicationLocked}
              onChange={(event) => setRejectionReason(event.target.value)}
            />
          </label>
          <label>
            {uiText.labels.decision}
            <select
              value={decision}
              disabled={applicationLocked}
              onChange={(event) => setDecision(event.target.value)}
            >
              <option value="">{uiText.labels.decisionUnset}</option>
              <option value="apply">{uiText.labels.decisionApply}</option>
              <option value="skip">{uiText.labels.decisionSkip}</option>
              <option value="review">{uiText.labels.decisionReview}</option>
            </select>
          </label>
          <label className="wide">
            {uiText.labels.notes}
            <textarea
              value={notes}
              disabled={applicationLocked}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </div>
        <button
          type="button"
          className="detail-save"
          disabled={busy || applicationLocked}
          onClick={save}
        >
          {busy || applicationLocked ? uiText.labels.saving : uiText.labels.save}
        </button>
        {error && (
          <p role="alert" className="detail-error">
            {error}{" "}
            {retry && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void retry()
                    .then((succeeded) => {
                      if (succeeded) {
                        setError("");
                        setRetry(null);
                      }
                    })
                    .catch((reason) =>
                      setError(reason instanceof Error ? reason.message : uiText.errors.load)
                    );
                }}
              >
                {error === uiText.errors.refreshAfterSave
                  ? uiText.labels.retryRefresh
                  : uiText.labels.retry}
              </button>
            )}
          </p>
        )}
        <section className="detail-section">
          <h3>{uiText.labels.evidence}</h3>
          {evidence.length ? (
            evidence.map((item) => (
              <article className="detail-evidence" key={item.id}>
                <small>{value(item, "received_at")}</small>
                <strong>{value(item, "subject")}</strong>
                <span>{value(item, "sender")}</span>
                <p>{value(item, "snippet")}</p>
              </article>
            ))
          ) : (
            <p>{uiText.pipeline.noEvidence}</p>
          )}
        </section>
        <section className="detail-section">
          <h3>{uiText.labels.interviewTimeline}</h3>
          {interviews.length ? (
            interviews.map((interview) => (
              <article className="interview" key={interview.id}>
                <small>
                  {new Intl.DateTimeFormat("en-GB", {
                    day: "2-digit",
                    month: "long",
                    year: "numeric"
                  }).format(new Date(value(interview, "event_at")))}
                </small>
                <strong>
                  {uiText.statuses[value(interview, "stage")] ?? value(interview, "stage")}
                </strong>
                <span>
                  {uiText.labels.participants}: {value(interview, "participants")}
                </span>
                <span>
                  {uiText.labels.result}:{" "}
                  {uiText.statuses[value(interview, "result")] ?? value(interview, "result")}
                </span>
                <p>{value(interview, "explicit_feedback") || uiText.labels.noReasonProvided}</p>
                {insights
                  .filter((insight) => Number(insight.interview_event_id) === interview.id)
                  .map((insight) => (
                    <p key={insight.id}>
                      <small>
                        {uiText.insightSources[value(insight, "source_type")] ??
                          value(insight, "source_type")}
                      </small>{" "}
                      · <span>{value(insight, "text")}</span>
                    </p>
                  ))}
                <label>
                  {uiText.labels.noteCategory}
                  <select
                    value={categoryByInterview[interview.id] ?? "system_design"}
                    onChange={(event) =>
                      setCategoryByInterview((current) => ({
                        ...current,
                        [interview.id]: event.target.value
                      }))
                    }
                  >
                    {Object.entries(uiText.insightCategories).map(([key, label]) => (
                      <option value={key} key={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {uiText.labels.note}
                  <textarea
                    aria-label={`Note for ${value(application, "company")}`}
                    value={noteByInterview[interview.id] ?? ""}
                    onChange={(event) =>
                      setNoteByInterview((current) => ({
                        ...current,
                        [interview.id]: event.target.value
                      }))
                    }
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || noteLocked || !noteByInterview[interview.id]?.trim()}
                  onClick={() => addNote(interview)}
                >
                  {uiText.labels.addNote}
                </button>
              </article>
            ))
          ) : (
            <p>{uiText.empty.interviews}</p>
          )}
        </section>
        <section className="detail-section">
          <h3>{uiText.labels.documents}</h3>
          {onGenerateDocuments && (
            <DocumentPackageControls
              onGenerate={onGenerateDocuments}
              onRefreshDocuments={
                onRefreshDocuments ??
                (async () => {
                  await onRefresh();
                  return { documents, activity };
                })
              }
            />
          )}
          {documents.length ? (
            documents.map((document) => (
              <a
                key={document.id}
                className="document-row"
                href={value(document, "download_url") || `/api/documents/${document.id}/download`}
              >
                <span>{value(document, "format").toUpperCase()}</span>
                <div>
                  <strong>{value(document, "document_type")}</strong>
                  <small>{value(document, "version")}</small>
                </div>
                {uiText.labels.download} {value(document, "document_type")}
              </a>
            ))
          ) : (
            <p>{uiText.empty.documents}</p>
          )}
        </section>
        <section className="detail-section">
          <h3>{uiText.pipeline.activity}</h3>
          {activity.length ? (
            activity.map((item) => (
              <p key={item.id} className="activity-row">
                <strong>{value(item, "action")}</strong> · {value(item, "created_at")} ·{" "}
                {value(item, "source")}
              </p>
            ))
          ) : (
            <p>{uiText.pipeline.noActivity}</p>
          )}
        </section>
      </section>
    </div>
  );
}
