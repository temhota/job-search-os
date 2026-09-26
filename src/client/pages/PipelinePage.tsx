import { useEffect, useState } from "react";
import { berlinCalendarDay } from "../../shared/berlin-date.js";
import type { DashboardData, Row } from "../types.js";
import { uiText } from "../ui-text.js";

const stages = ["applied", "recruiter_screen", "technical_interview", "take_home", "onsite_final", "offer"];
const statuses = [...stages, "rejected", "withdrawn", "unknown"];
function field(row: Row, key: string) { return String(row[key] ?? ""); }
function date(value: unknown) { const parsed = value ? new Date(String(value)) : null; return parsed && !Number.isNaN(parsed.getTime()) ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(parsed) : "—"; }

interface Props {
  data: DashboardData;
  initialView?: "active" | "archive";
  onChangeStatus: (application: Row, status: string) => Promise<void>;
  onRefresh: (applicationId: number) => Promise<DashboardData>;
  onRetryRefresh?: () => Promise<void>;
  refreshIssue?: boolean;
  lockedApplicationIds?: number[];
  onOpenDetails: (application: Row, trigger: HTMLButtonElement) => void;
}

export function PipelinePage({ data, initialView = "active", onChangeStatus, onRefresh, onRetryRefresh, refreshIssue = false, lockedApplicationIds = [], onOpenDetails }: Props) {
  const [view, setView] = useState<"active" | "archive">(initialView);
  const [companyFilter, setCompanyFilter] = useState("");
  const [reasonFilter, setReasonFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<(() => Promise<boolean>) | null>(null);
  const [savedPendingId, setSavedPendingId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => setView(initialView), [initialView]);
  const pipeline = data.pipeline ?? { active: data.applications.filter((item) => stages.includes(field(item, "status"))), needsAttention: data.applications.filter((item) => item.status === "unknown"), archive: data.applications.filter((item) => ["rejected", "withdrawn"].includes(field(item, "status"))) };
  async function changeStatus(application: Row, status: string) {
    if (pending != null) return;
    setPending(application.id); setError(null); setRetry(null);
    try { await onChangeStatus(application, status); setSavedPendingId(null); return true; }
    catch (reason) {
      const message = reason instanceof Error ? reason.message : uiText.errors.saveApplication;
      setError(message);
      if (message === uiText.errors.refreshAfterSave) {
        setSavedPendingId(application.id);
        setRetry(() => async () => { const refreshed = await onRefresh(application.id); if (refreshed.applications.find((item) => item.id === application.id)?.status !== status) throw new Error(uiText.errors.refreshAfterSave); setSavedPendingId(null); return true; });
      } else setRetry(() => () => changeStatus(application, status));
      return false;
    }
    finally { setPending(null); }
  }
  function card(application: Row, showOverdue = true) {
    const company = field(application, "company");
    const title = field(application, "title");
    const overdue = application.next_step_due_at && Date.parse(String(application.next_step_due_at)) < Date.now();
    return <div className="kanban-card" key={application.id}>
      <button type="button" id={`pipeline-application-${application.id}`} className="pipeline-card-open" aria-label={`${uiText.labels.detailsFor} ${company} — ${title}`} onClick={(event) => onOpenDetails(application, event.currentTarget)}><strong>{company}</strong><span>{title}</span></button>
      <small>{uiText.pipeline.daysInStage}: {String(application.days_in_stage ?? 0)} · {uiText.pipeline.lastActivity}: {date(application.last_activity_at)}</small>
      {application.next_step && <p>{uiText.labels.nextStep}: {String(application.next_step)}</p>}
      {application.next_step_due_at && <p>{uiText.labels.followUp} #{String(application.next_follow_up_sequence ?? 1)}: {date(application.next_step_due_at)}</p>}
      {showOverdue && overdue && <b className="pipeline-overdue">{uiText.pipeline.overdue}</b>}
      {Number(application.priority ?? 0) > 0 && <small>{uiText.labels.priority}: {String(application.priority)}</small>}
      <select aria-label={`Status for ${company}`} value={field(application, "status")} disabled={pending === application.id || savedPendingId === application.id || lockedApplicationIds.includes(application.id)} onChange={(event) => void changeStatus(application, event.target.value)}>{statuses.map((status) => <option key={status} value={status}>{uiText.statuses[status]}</option>)}</select>
    </div>;
  }
  const archive = pipeline.archive.filter((item) => (!companyFilter || field(item, "company").toLowerCase().includes(companyFilter.toLowerCase())) && (!reasonFilter || field(item, "rejection_reason").toLowerCase().includes(reasonFilter.toLowerCase())) && (!dateFilter || berlinCalendarDay(field(item, "archived_at")) >= dateFilter));
  return <div className="pipeline-page">
    <div className="pipeline-tabs"><button type="button" aria-pressed={view === "active"} onClick={() => setView("active")}>{uiText.pipeline.active}</button><button type="button" aria-pressed={view === "archive"} onClick={() => setView("archive")}>{uiText.pipeline.archive}</button></div>
    {refreshIssue && !error && onRetryRefresh && <p role="alert" className="detail-error">{uiText.errors.refreshAfterSave} <button type="button" disabled={refreshing} onClick={() => { setRefreshing(true); void onRetryRefresh().catch(() => {}).finally(() => setRefreshing(false)); }}>{uiText.labels.retryRefresh}</button></p>}
    {error && <p role="alert" className="detail-error">{error} {retry && <button type="button" disabled={pending != null} onClick={() => { void retry().then((succeeded) => { if (succeeded) { setError(null); setRetry(null); } }).catch((reason) => setError(reason instanceof Error ? reason.message : uiText.errors.load)); }}>{savedPendingId != null ? uiText.labels.retryRefresh : uiText.labels.retry}</button>}</p>}
    {view === "active" ? <>
      <section aria-label="Active applications" className="kanban">{stages.map((stage) => { const items = pipeline.active.filter((item) => item.status === stage); return items.length ? <article key={stage}><header><span>{uiText.statuses[stage]}</span><b>{items.length}</b></header>{items.map((item) => card(item))}</article> : null; })}{pipeline.active.length === 0 && <p className="empty">{uiText.pipeline.emptyActive}</p>}</section>
      {pipeline.needsAttention.length > 0 && <section className="panel pipeline-attention" aria-label="Needs attention"><h2>{uiText.labels.needsAttention}</h2><div className="pipeline-attention-list">{pipeline.needsAttention.map((item) => card(item))}</div></section>}
    </> : <section className="panel pipeline-archive" aria-label="Archived applications"><h2>{uiText.pipeline.archive}</h2><div className="pipeline-filters"><label>{uiText.labels.company}<input value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)} /></label><label>{uiText.pipeline.fromDate}<input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} /></label><label>{uiText.labels.rejectionReason}<input value={reasonFilter} onChange={(event) => setReasonFilter(event.target.value)} /></label></div><div className="pipeline-archive-list">{archive.length ? archive.map((item) => card(item, false)) : <p className="empty">{uiText.pipeline.emptyArchive}</p>}</div></section>}
  </div>;
}
