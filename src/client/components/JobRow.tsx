import type { DashboardJob } from "../../shared/types.js";
import { AsyncButton } from "./AsyncButton.js";
import { uiText } from "../ui-text.js";
import { safeJobUrl } from "../job-url.js";
import { jobLocationLabel } from "../job-presentation.js";

interface Props {
  job: DashboardJob;
  onShortlist: () => Promise<unknown>;
  onSkip: () => Promise<unknown>;
  onMarkApplied: () => Promise<unknown>;
  onExpire?: () => Promise<unknown>;
  onRefresh: () => Promise<unknown>;
  locked: boolean;
  documents?: Array<{ id: number; document_type?: unknown }>;
  onOpenMaterials?: () => void;
  materialsExpanded?: boolean;
}

function field(job: DashboardJob, key: string, fallback = "") {
  const value = job[key];
  return value == null || value === "" ? fallback : String(value);
}

export function JobRow({ job, onShortlist, onSkip, onMarkApplied, onExpire, onRefresh, locked, documents = [], onOpenMaterials, materialsExpanded = false }: Props) {
  const company = field(job, "company");
  const title = field(job, "title");
  const url = safeJobUrl(job.url);
  const reason = field(job, "match_reason");
  const context = jobLocationLabel(job);
  const risk = Number(job.same_company_history) === 1 ? uiText.labels.companyHistory : field(job, "risk", uiText.labels.roleRequirements);
  return <article className="today-row job-action-row">
    <div className="score" aria-label={`Match score ${job.score}`}>{job.score}</div>
    <div className="today-row-main"><strong>{company}</strong><span>{title}</span><small>{jobLocationLabel(job)} · {field(job, "employment_type")}</small>{Number(job.duplicate_blocked) === 1 && <small className="duplicate-warning">{uiText.labels.alreadyApplied}</small>}<p><b>{reason ? uiText.labels.matchReason : uiText.labels.context}:</b> {reason || context || uiText.labels.detailsUnavailable}</p><p><b>{uiText.labels.risk}:</b> {risk}</p>{documents.length > 0 && <div className="job-documents">{documents.map((document) => <a key={document.id} href={`/api/documents/${document.id}/download`}>{uiText.labels.download} {String(document.document_type ?? "document")}</a>)}</div>}</div>
    <div className="today-actions">
      {url ? <a className="job-link" href={url} target="_blank" rel="noreferrer" aria-label={`Open ${company} vacancy`}>{uiText.labels.open} {uiText.labels.vacancy}</a> : <span className="job-link unavailable">{uiText.labels.linkUnavailable}</span>}
      {onOpenMaterials && <button type="button" aria-expanded={materialsExpanded} aria-label={`${uiText.labels.materialsFor} ${company} ${title}`} onClick={onOpenMaterials}>{uiText.labels.materials}</button>}
      {job.triage_status !== "shortlisted" && <AsyncButton label={uiText.labels.shortlist} ariaLabel={`${uiText.labels.shortlist} ${company} ${title}`} onAction={onShortlist} onRefresh={onRefresh} refreshErrorHandled disabled={locked} />}
      <AsyncButton label={uiText.labels.skip} ariaLabel={`${uiText.labels.skip} ${company} ${title}`} onAction={onSkip} onRefresh={onRefresh} refreshErrorHandled disabled={locked} />
      {onExpire && <AsyncButton label={uiText.labels.expire} ariaLabel={`${uiText.labels.expire} ${company} ${title}`} onAction={onExpire} onRefresh={onRefresh} refreshErrorHandled disabled={locked} />}
      <AsyncButton label={uiText.labels.markApplied} ariaLabel={`${uiText.labels.markApplied} ${company} ${title}`} onAction={onMarkApplied} onRefresh={onRefresh} refreshErrorHandled disabled={locked || Number(job.duplicate_blocked) === 1} />
    </div>
  </article>;
}
