import { useState } from "react";
import type {
  DashboardJob,
  JobTriageStatus,
  SearchSourceInput,
  SearchSourcePatch
} from "../../shared/types.js";
import type { DashboardData, Row } from "../types.js";
import { uiText } from "../ui-text.js";
import { JobRow } from "../components/JobRow.js";
import { safeJobUrl } from "../job-url.js";
import { AsyncButton } from "../components/AsyncButton.js";
import {
  DocumentPackageControls,
  type DocumentSnapshot,
  type GeneratedDocumentPair
} from "../components/DocumentPackageControls.js";
import { jobLocationLabel, normalizedWorkMode, roleMatches } from "../job-presentation.js";
import { SearchSourcesPanel } from "../components/SearchSourcesPanel.js";

type Tab = "new" | "shortlisted" | "applied" | "archived";
interface Props {
  data: DashboardData;
  onTriage: (id: number, status: JobTriageStatus) => Promise<unknown>;
  onMarkApplied: (id: number) => Promise<unknown>;
  onRefresh: () => Promise<unknown>;
  onOpenApplication: (application: Row, trigger: HTMLButtonElement) => void;
  lockedJobIds: number[];
  refreshIssue: boolean;
  onToggleDuplicate: (job: Row) => Promise<void>;
  onGenerateDocuments?: (
    jobId: number,
    language: "English" | "German"
  ) => Promise<GeneratedDocumentPair>;
  onRefreshDocuments?: (jobId: number) => Promise<DocumentSnapshot>;
  onCreateSearchSource: (input: SearchSourceInput) => Promise<unknown>;
  onUpdateSearchSource: (id: number, input: SearchSourcePatch) => Promise<unknown>;
}

function field(row: Row, key: string) {
  return String(row[key] ?? "");
}
export function JobsPage({
  data,
  onTriage,
  onMarkApplied,
  onRefresh,
  onOpenApplication,
  onToggleDuplicate,
  onGenerateDocuments,
  onRefreshDocuments,
  onCreateSearchSource,
  onUpdateSearchSource,
  lockedJobIds,
  refreshIssue
}: Props) {
  const [tab, setTab] = useState<Tab>("new");
  const [employment, setEmployment] = useState("");
  const [role, setRole] = useState<"" | "react_native" | "react" | "typescript_node">("");
  const [workMode, setWorkMode] = useState("");
  const [minimum, setMinimum] = useState("0");
  const [linksOnly, setLinksOnly] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [materialsJobId, setMaterialsJobId] = useState<number | null>(null);
  function selectTab(next: Tab) {
    setTab(next);
    setEmployment("");
    setRole("");
    setWorkMode("");
    setMinimum("0");
    setLinksOnly(false);
  }
  async function retry() {
    setRetrying(true);
    try {
      await onRefresh();
    } catch {
      /* App retains the refresh issue. */
    } finally {
      setRetrying(false);
    }
  }
  const rows = data.jobs.filter((job) => {
    const applied = job.application_id != null;
    const triage = field(job, "triage_status") || "new";
    const inTab =
      tab === "applied"
        ? applied
        : !applied &&
          (tab === "archived" ? ["skipped", "expired"].includes(triage) : triage === tab);
    return (
      inTab &&
      (!employment || field(job, "employment_type").toLowerCase() === employment) &&
      roleMatches(job, role) &&
      (!workMode || normalizedWorkMode(job) === workMode) &&
      Number(job.score ?? 0) >= Number(minimum) &&
      (!linksOnly || safeJobUrl(job.url) != null)
    );
  });
  return (
    <div className="jobs-page">
      {refreshIssue && (
        <div className="today-refresh-error" role="alert">
          {uiText.errors.refreshAfterSave}{" "}
          <button type="button" disabled={retrying} onClick={retry}>
            {uiText.labels.retryRefresh}
          </button>
        </div>
      )}
      <SearchSourcesPanel
        sources={data.searchSources ?? []}
        onCreate={onCreateSearchSource}
        onUpdate={onUpdateSearchSource}
        onRefresh={onRefresh}
      />
      <div className="jobs-tabs" aria-label="Job stages">
        {(
          [
            ["new", uiText.jobs.new],
            ["shortlisted", uiText.jobs.shortlisted],
            ["applied", uiText.jobs.applied],
            ["archived", uiText.jobs.archived]
          ] as const
        ).map(([key, label]) => (
          <button type="button" key={key} aria-pressed={tab === key} onClick={() => selectTab(key)}>
            {label}
          </button>
        ))}
      </div>
      <section className="panel jobs-workspace">
        <div className="jobs-filters">
          <label>
            {uiText.jobs.employment}
            <select value={employment} onChange={(event) => setEmployment(event.target.value)}>
              <option value="">All types</option>
              <option value="permanent">Permanent</option>
              <option value="freelance">Freelance</option>
            </select>
          </label>
          <label>
            {uiText.jobs.role}
            <select value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
              <option value="">All roles</option>
              <option value="react_native">React Native</option>
              <option value="react">React</option>
              <option value="typescript_node">TypeScript / Node.js</option>
            </select>
          </label>
          <label>
            {uiText.jobs.workMode}
            <select value={workMode} onChange={(event) => setWorkMode(event.target.value)}>
              <option value="">All modes</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">Onsite</option>
            </select>
          </label>
          <label>
            {uiText.jobs.minimum}
            <select value={minimum} onChange={(event) => setMinimum(event.target.value)}>
              <option value="0">Any score</option>
              <option value="70">70+</option>
              <option value="80">80+</option>
              <option value="90">90+</option>
            </select>
          </label>
          <label className="jobs-link-filter">
            <input
              type="checkbox"
              checked={linksOnly}
              onChange={(event) => setLinksOnly(event.target.checked)}
            />
            {uiText.jobs.workingLinks}
          </label>
        </div>
        <div className="jobs-list">
          {rows.length ? (
            rows.map((job) => {
              if (tab === "new" || tab === "shortlisted") {
                const jobDocuments = data.documents.filter(
                  (document) => Number(document.job_id) === job.id
                );
                const materialsTitle = `${uiText.labels.materialsFor} ${field(job, "company")} ${field(job, "title")}`;
                const materialsExpanded = materialsJobId === job.id;
                return (
                  <div className="jobs-entry" key={job.id}>
                    <JobRow
                      job={job as DashboardJob}
                      onShortlist={() => onTriage(job.id, "shortlisted")}
                      onSkip={() => onTriage(job.id, "skipped")}
                      onExpire={() => onTriage(job.id, "expired")}
                      onMarkApplied={() => onMarkApplied(job.id)}
                      onRefresh={onRefresh}
                      locked={lockedJobIds.includes(job.id)}
                      documents={jobDocuments}
                      onOpenMaterials={
                        onGenerateDocuments
                          ? () =>
                              setMaterialsJobId((current) => (current === job.id ? null : job.id))
                          : undefined
                      }
                      materialsExpanded={materialsExpanded}
                    />
                    {onGenerateDocuments && (
                      <section
                        className="job-materials"
                        role="region"
                        aria-label={materialsTitle}
                        hidden={!materialsExpanded}
                      >
                        <h3>{materialsTitle}</h3>
                        <p>{uiText.labels.materialsDescription}</p>
                        <DocumentPackageControls
                          onGenerate={(language) => onGenerateDocuments(job.id, language)}
                          onRefreshDocuments={() =>
                            onRefreshDocuments
                              ? onRefreshDocuments(job.id)
                              : Promise.resolve({ documents: jobDocuments, activity: [] })
                          }
                        />
                      </section>
                    )}
                    {(Number(job.duplicate_blocked) === 1 || Number(job.manual_unblock) === 1) && (
                      <AsyncButton
                        key={`duplicate-${job.id}-${job.manual_unblock}`}
                        label={
                          Number(job.manual_unblock) === 1
                            ? uiText.labels.restoreBlock
                            : uiText.labels.allowRepeat
                        }
                        onAction={() => onToggleDuplicate(job)}
                        onRefresh={onRefresh}
                        disabled={lockedJobIds.includes(job.id)}
                      />
                    )}
                  </div>
                );
              }
              const application = data.applications.find(
                (item) => Number(item.id) === Number(job.application_id)
              );
              const url = safeJobUrl(job.url);
              const documents = data.documents.filter(
                (document) => Number(document.job_id) === job.id
              );
              return (
                <article className="today-row job-action-row" key={job.id}>
                  <div className="score" aria-label={`Match score ${job.score}`}>
                    {String(job.score ?? "—")}
                  </div>
                  <div className="today-row-main">
                    <strong>{field(job, "company")}</strong>
                    <span>{field(job, "title")}</span>
                    <small>
                      {jobLocationLabel(job)} · {field(job, "employment_type")}
                    </small>
                    {Number(job.duplicate_blocked) === 1 && (
                      <small className="duplicate-warning">{uiText.labels.alreadyApplied}</small>
                    )}
                    {documents.length > 0 && (
                      <div className="job-documents">
                        {documents.map((document) => (
                          <a key={document.id} href={`/api/documents/${document.id}/download`}>
                            {uiText.labels.download} {field(document, "document_type")}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="today-actions">
                    {url ? (
                      <a
                        className="job-link"
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${field(job, "company")} vacancy`}
                      >
                        {uiText.labels.open} {uiText.labels.vacancy}
                      </a>
                    ) : (
                      <span className="job-link unavailable">{uiText.labels.linkUnavailable}</span>
                    )}
                    {application && (
                      <button
                        type="button"
                        onClick={(event) => onOpenApplication(application, event.currentTarget)}
                      >
                        {uiText.jobs.viewPipeline}
                      </button>
                    )}
                    {(Number(job.duplicate_blocked) === 1 || Number(job.manual_unblock) === 1) && (
                      <AsyncButton
                        key={`duplicate-${job.id}-${job.manual_unblock}`}
                        label={
                          Number(job.manual_unblock) === 1
                            ? uiText.labels.restoreBlock
                            : uiText.labels.allowRepeat
                        }
                        onAction={() => onToggleDuplicate(job)}
                        onRefresh={onRefresh}
                        disabled={lockedJobIds.includes(job.id)}
                      />
                    )}
                  </div>
                </article>
              );
            })
          ) : (
            <p className="empty">{uiText.jobs.empty}</p>
          )}
        </div>
      </section>
    </div>
  );
}
