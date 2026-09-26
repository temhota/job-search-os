import { useCallback, useEffect, useRef, useState } from "react";
import type { EvidenceReviewAction, FollowUpAction, JobTriageStatus } from "../shared/types.js";
import { berlinCalendarDay } from "../shared/berlin-date.js";
import { defaultApi, type DashboardApi } from "./api.js";
import { AppShell } from "./components/AppShell.js";
import { ApplicationDetailDrawer } from "./components/ApplicationDetailDrawer.js";
import { TodayPage } from "./pages/TodayPage.js";
import { JobsPage } from "./pages/JobsPage.js";
import { PipelinePage } from "./pages/PipelinePage.js";
import { ReviewPage } from "./pages/ReviewPage.js";
import type { DashboardData, JobDetails, PageKey, Row } from "./types.js";
import { uiText } from "./ui-text.js";
import "./styles.css";

export type { DashboardApi } from "./api.js";
export type { DashboardData } from "./types.js";

type PendingTodayMutation =
  | { kind: "job-triage"; id: number; status: JobTriageStatus }
  | { kind: "job-applied"; id: number }
  | { kind: "duplicate-override"; id: number; manualUnblock: boolean; expectedDuplicateBlocked: number }
  | { kind: "follow-up"; id: number; action: FollowUpAction["action"]; expectedStatus: "pending" | "done" | "dismissed"; expectedDueAt?: string };
type ReservedTodayMutation = PendingTodayMutation & { phase: "saving" | "awaiting-refresh" };
type ApplicationReservation = { id: number; kind: "status" | "detail"; expected: Record<string, unknown>; phase: "saving" | "awaiting-refresh"; dashboardConfirmed: boolean };
type InsightReservation = { id: number | null; interviewId: number; category: string; text: string; dashboardConfirmed: boolean };

const applicationFieldMap: Record<string, string> = {
  status: "status", priority: "priority", nextStep: "next_step", notes: "notes",
  appliedAt: "applied_at", rejectionReason: "rejection_reason", decision: "decision"
};

function confirmedByDashboard(mutation: PendingTodayMutation, dashboard: DashboardData) {
  if (mutation.kind === "follow-up") {
    const rows = [...dashboard.followUps, ...dashboard.today.followUpToday].filter((item) => item.id === mutation.id);
    if (mutation.action !== "snooze") return rows.length === 0;
    if (rows.length) return rows.every((item) => item.status === mutation.expectedStatus && item.due_at === mutation.expectedDueAt);
    return Boolean(mutation.expectedDueAt && berlinCalendarDay(mutation.expectedDueAt) > berlinCalendarDay());
  }
  const todayJob = dashboard.today.applyToday.find((item) => item.id === mutation.id);
  if (mutation.kind === "duplicate-override") {
    const job = dashboard.jobs.find((item) => item.id === mutation.id);
    const effectiveBlock = mutation.expectedDuplicateBlocked;
    return job != null && Number(job.manual_unblock) === Number(mutation.manualUnblock) && Number(job.duplicate_blocked) === effectiveBlock
      && (effectiveBlock === 0 ? !todayJob || Number(todayJob.duplicate_blocked ?? 0) === 0 : !todayJob);
  }
  if (mutation.kind === "job-applied") return !todayJob && (dashboard.applications.some((item) => Number(item.job_id) === mutation.id) || dashboard.jobs.some((item) => item.id === mutation.id && item.application_id != null));
  const statusConfirmed = dashboard.jobs.some((item) => item.id === mutation.id && item.triage_status === mutation.status);
  return statusConfirmed && (todayJob == null || todayJob.triage_status === mutation.status) && (!["skipped", "expired"].includes(mutation.status) || !todayJob);
}

export function App({ api = defaultApi }: { api?: DashboardApi }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [active, setActive] = useState<PageKey>("today");
  const [reviewTargetId, setReviewTargetId] = useState<number | null>(null);
  const [selectedApplicationId, setSelectedApplicationId] = useState<number | null>(null);
  const [pipelineView, setPipelineView] = useState<"active" | "archive">("active");
  const [jobDetails, setJobDetails] = useState<JobDetails | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailRequestSequence = useRef(0);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const loadingCloseRef = useRef<HTMLButtonElement | null>(null);
  const detailReturnApplicationId = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingTodayRef = useRef<Record<string, ReservedTodayMutation>>({});
  const pendingApplicationRef = useRef<Record<number, ApplicationReservation>>({});
  const [pendingApplicationIds, setPendingApplicationIds] = useState<number[]>([]);
  const [statusRefreshIssue, setStatusRefreshIssue] = useState(false);
  const pendingInsightRef = useRef<Record<number, InsightReservation>>({});
  const [lockedNoteJobIds, setLockedNoteJobIds] = useState<number[]>([]);
  const [pendingToday, setPendingToday] = useState<Record<string, ReservedTodayMutation>>({});
  const refreshSequence = useRef(0);
  const [refreshIssue, setRefreshIssue] = useState(false);
  const pendingReviewRef = useRef<Record<number, "saving" | "awaiting-refresh">>({});
  const [pendingReviewIds, setPendingReviewIds] = useState<number[]>([]);

  useEffect(() => {
    const sequence = ++refreshSequence.current;
    api.load()
      .then((dashboard) => { if (sequence === refreshSequence.current) setData(dashboard); })
      .catch((reason) => { if (sequence === refreshSequence.current) setError(reason instanceof Error ? reason.message : uiText.errors.fallback); });
  }, [api]);

  const selectedApplication = data?.applications.find((application) => application.id === selectedApplicationId);
  const selectedJobId = selectedApplication ? Number(selectedApplication.job_id) : null;
  const selectedApplicationIdRef = useRef<number | null>(null);
  selectedApplicationIdRef.current = selectedApplicationId;
  const selectedJobRef = useRef<number | null>(null);
  selectedJobRef.current = selectedJobId;
  const applicationConfirmed = useCallback((dashboard: DashboardData, reservation: ApplicationReservation) => {
    const row = dashboard.applications.find((item) => item.id === reservation.id);
    return row != null && Object.entries(reservation.expected).every(([key, expected]) => row[key] === expected);
  }, []);
  const dashboardConfirmsPending = useCallback((dashboard: DashboardData) => {
    return Object.values(pendingApplicationRef.current).every((reservation) => reservation.phase === "saving" || applicationConfirmed(dashboard, reservation))
      && Object.values(pendingInsightRef.current).every((reservation) => reservation.id == null || dashboard.insightDetails?.some((insight) => insight.id === reservation.id))
      && Object.entries(pendingReviewRef.current).every(([id, phase]) => phase === "saving" || !dashboard.reviewQueue.some((item) => item.id === Number(id)));
  }, [applicationConfirmed]);
  function reserveApplication(id: number, kind: ApplicationReservation["kind"], expected: Record<string, unknown>) {
    if (pendingApplicationRef.current[id]) throw new Error(uiText.errors.refreshAfterSave);
    const reservation: ApplicationReservation = { id, kind, expected, phase: "saving", dashboardConfirmed: false };
    pendingApplicationRef.current = { ...pendingApplicationRef.current, [id]: reservation };
    setPendingApplicationIds(Object.keys(pendingApplicationRef.current).map(Number));
    return reservation;
  }
  const releaseApplication = useCallback((id: number) => {
    const next = { ...pendingApplicationRef.current };
    delete next[id];
    pendingApplicationRef.current = next;
    setPendingApplicationIds(Object.keys(next).map(Number));
  }, []);
  const reloadDashboard = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const refreshed = await api.load();
    if (sequence !== refreshSequence.current || !dashboardConfirmsPending(refreshed)) throw new Error(uiText.errors.refreshAfterSave);
    setData(refreshed);
    for (const reservation of Object.values(pendingApplicationRef.current)) {
      if (reservation.phase === "awaiting-refresh") {
        if (reservation.kind === "status") releaseApplication(reservation.id);
        else reservation.dashboardConfirmed = true;
      }
    }
    if (!Object.values(pendingApplicationRef.current).some((reservation) => reservation.kind === "status" && reservation.phase === "awaiting-refresh")) setStatusRefreshIssue(false);
    for (const reservation of Object.values(pendingInsightRef.current)) if (reservation.id != null) reservation.dashboardConfirmed = true;
    pendingReviewRef.current = Object.fromEntries(Object.entries(pendingReviewRef.current).filter(([id, phase]) => phase === "saving" || refreshed.reviewQueue.some((item) => item.id === Number(id))));
    setPendingReviewIds(Object.keys(pendingReviewRef.current).map(Number));
    return refreshed;
  }, [api, dashboardConfirmsPending, releaseApplication]);
  const loadDetails = useCallback(async (jobId: number) => {
    if (!api.getJobDetails) return true;
    const requestId = ++detailRequestSequence.current;
    setDetailError(null);
    try {
      const result = await api.getJobDetails(jobId);
      if (requestId !== detailRequestSequence.current || selectedJobRef.current !== jobId) return false;
      const reservation = result.application ? pendingApplicationRef.current[result.application.id] : undefined;
      if ((reservation && (reservation.phase === "saving" || !reservation.dashboardConfirmed || !Object.entries(reservation.expected).every(([key, expected]) => result.application?.[key] === expected))) ||
          (pendingInsightRef.current[jobId] != null && (pendingInsightRef.current[jobId].id == null || !pendingInsightRef.current[jobId].dashboardConfirmed || !result.insights.some((insight) => insight.id === pendingInsightRef.current[jobId].id)))) {
        setDetailError(uiText.errors.refreshAfterSave); return false;
      }
      setJobDetails(result);
      if (reservation) releaseApplication(reservation.id);
      delete pendingInsightRef.current[jobId];
      setLockedNoteJobIds(Object.keys(pendingInsightRef.current).map(Number));
      return true;
    }
    catch (reason) { if (requestId === detailRequestSequence.current && selectedJobRef.current === jobId) setDetailError(reason instanceof Error ? reason.message : uiText.errors.loadDetails); return false; }
  }, [api, releaseApplication]);
  const loadAuthoritativeDetails = useCallback(async (jobId: number) => {
    const selectedId = selectedApplicationIdRef.current;
    const applicationPending = selectedId != null ? pendingApplicationRef.current[selectedId] : undefined;
    const insightPending = pendingInsightRef.current[jobId];
    if ((applicationPending && !applicationPending.dashboardConfirmed) || (insightPending && !insightPending.dashboardConfirmed)) {
      try { await reloadDashboard(); }
      catch {
        if (selectedJobRef.current === jobId) setDetailError(uiText.errors.refreshAfterSave);
        return false;
      }
    }
    if (selectedJobRef.current !== jobId) return false;
    return loadDetails(jobId);
  }, [loadDetails, reloadDashboard]);
  useEffect(() => {
    if (selectedJobId == null) return;
    setJobDetails(null);
    void loadAuthoritativeDetails(selectedJobId);
    return () => { detailRequestSequence.current += 1; };
  }, [selectedJobId, loadAuthoritativeDetails]);

  async function changeStatus(application: Row, status: string) {
    const reservation = reserveApplication(application.id, "status", { status });
    let updated: Row;
    try { updated = await api.updateApplication(application.id, { status }) as Row; }
    catch (reason) { releaseApplication(application.id); throw reason; }
    reservation.expected = { status: updated?.status ?? status };
    reservation.phase = "awaiting-refresh";
    try {
      await reloadDashboard();
      releaseApplication(application.id);
    } catch {
      if (pendingApplicationRef.current[application.id]) setStatusRefreshIssue(true);
      throw new Error(uiText.errors.refreshAfterSave);
    }
  }

  async function saveApplication(application: Row, input: Record<string, unknown>) {
    const expected = Object.fromEntries(Object.entries(input).filter(([key]) => key in applicationFieldMap).map(([key, value]) => [applicationFieldMap[key], value]));
    const reservation = reserveApplication(application.id, "detail", expected);
    let updated: Row;
    try { updated = await api.updateApplication(application.id, input) as Row; }
    catch (reason) { releaseApplication(application.id); throw reason; }
    reservation.expected = Object.fromEntries(Object.entries(expected).map(([key, value]) => [key, updated && Object.prototype.hasOwnProperty.call(updated, key) ? updated[key] : value]));
    reservation.phase = "awaiting-refresh";
    setData((current) => current ? { ...current, applications: current.applications.map((item) => item.id === application.id ? { ...item, ...updated } : item) } : current);
    if (api.getJobDetails) {
      if (typeof input.status === "string") setPipelineView(["rejected", "withdrawn"].includes(input.status) ? "archive" : "active");
      try { await reloadDashboard(); if (!(await loadDetails(Number(application.job_id)))) throw new Error(uiText.errors.refreshAfterSave); }
      catch { throw new Error(uiText.errors.refreshAfterSave); }
    } else {
      try { await reloadDashboard(); releaseApplication(application.id); }
      catch { throw new Error(uiText.errors.refreshAfterSave); }
    }
  }

  async function refreshApplicationDetails(jobId: number) {
    await reloadDashboard();
    if (!(await loadDetails(jobId))) throw new Error(uiText.errors.refreshAfterSave);
  }

  async function toggleDuplicate(job: Row) {
    if (!api.updateJob) return;
    const manualUnblock = Number(job.manual_unblock) !== 1;
    const expectedDuplicateBlocked = manualUnblock ? 0 : Number(job.raw_duplicate_blocked ?? job.duplicate_blocked ?? 0);
    const { key, reservation } = reserveMutation({ kind: "duplicate-override", id: job.id, manualUnblock, expectedDuplicateBlocked });
    let updated: Row;
    try { updated = await api.updateJob(job.id, { manualUnblock }) as Row; }
    catch (reason) { finishMutation(key, reservation, false); throw reason; }
    const serverBlock = Number(updated?.duplicate_blocked);
    finishMutation(key, reservation, true, { kind: "duplicate-override", id: job.id, manualUnblock, expectedDuplicateBlocked: Number.isFinite(serverBlock) ? serverBlock : expectedDuplicateBlocked });
  }

  async function reviewEvidence(item: Row, input: EvidenceReviewAction) {
    if (!api.reviewEvidence) throw new Error(uiText.errors.saveEvidence);
    await resolveReview([item.id], () => api.reviewEvidence!(item.id, input));
  }

  async function bulkIgnoreEvidence(sender: string, ids: number[]) {
    if (!api.bulkIgnoreEvidence) throw new Error(uiText.errors.saveEvidence);
    await resolveReview(ids, () => api.bulkIgnoreEvidence!(sender, ids));
  }

  async function resolveReview(ids: number[], mutation: () => Promise<unknown>) {
    if (ids.some((id) => pendingReviewRef.current[id])) throw new Error(uiText.errors.refreshAfterSave);
    for (const id of ids) pendingReviewRef.current[id] = "saving";
    setPendingReviewIds(Object.keys(pendingReviewRef.current).map(Number));
    try { await mutation(); }
    catch (reason) {
      for (const id of ids) delete pendingReviewRef.current[id];
      setPendingReviewIds(Object.keys(pendingReviewRef.current).map(Number));
      throw reason;
    }
    for (const id of ids) pendingReviewRef.current[id] = "awaiting-refresh";
    try { await reloadDashboard(); }
    catch { throw new Error(uiText.errors.refreshAfterSave); }
  }

  async function addInterviewNote(interview: Row, input: { category: string; text: string }) {
    if (!api.addInterviewNote) throw new Error(uiText.errors.saveInsight);
    const jobId = Number((data?.applications.find((item) => item.id === Number(interview.application_id)))?.job_id);
    if (pendingInsightRef.current[jobId]) throw new Error(uiText.errors.saveInsight);
    const reservation: InsightReservation = { id: null, interviewId: interview.id, category: input.category, text: input.text.trim(), dashboardConfirmed: false };
    pendingInsightRef.current[jobId] = reservation;
    setLockedNoteJobIds(Object.keys(pendingInsightRef.current).map(Number));
    let created: Row;
    try { created = await api.addInterviewNote(interview.id, input) as Row; }
    catch (reason) {
      if (pendingInsightRef.current[jobId] === reservation) delete pendingInsightRef.current[jobId];
      setLockedNoteJobIds(Object.keys(pendingInsightRef.current).map(Number));
      throw reason;
    }
    reservation.id = created.id;
    setData((current) => current ? {
      ...current,
      insightDetails: [{ ...created, interview_event_id: interview.id }, ...(current.insightDetails ?? [])]
    } : current);
    if (api.getJobDetails) {
      try { await reloadDashboard(); if (!(await loadDetails(jobId))) throw new Error(uiText.errors.refreshAfterSave); }
      catch { throw new Error(uiText.errors.refreshAfterSave); }
    } else {
      delete pendingInsightRef.current[jobId];
      setLockedNoteJobIds(Object.keys(pendingInsightRef.current).map(Number));
    }
  }

  async function refreshToday() {
    const sequence = ++refreshSequence.current;
    try {
      const refreshed = await api.load();
      if (sequence !== refreshSequence.current) return;
      if (!dashboardConfirmsPending(refreshed)) throw new Error(uiText.errors.refreshAfterSave);
      setData(refreshed);
      for (const reservation of Object.values(pendingApplicationRef.current)) {
        if (reservation.phase === "awaiting-refresh") {
          if (reservation.kind === "status") releaseApplication(reservation.id);
          else reservation.dashboardConfirmed = true;
        }
      }
      if (!Object.values(pendingApplicationRef.current).some((reservation) => reservation.kind === "status" && reservation.phase === "awaiting-refresh")) setStatusRefreshIssue(false);
      for (const reservation of Object.values(pendingInsightRef.current)) if (reservation.id != null) reservation.dashboardConfirmed = true;
      const remaining = Object.fromEntries(Object.entries(pendingTodayRef.current).filter(([, mutation]) => mutation.phase === "saving" || !confirmedByDashboard(mutation, refreshed)));
      pendingTodayRef.current = remaining;
      setPendingToday(remaining);
      const unresolvedSaved = Object.values(remaining).some((mutation) => mutation.phase === "awaiting-refresh");
      setRefreshIssue(unresolvedSaved);
      if (unresolvedSaved) throw new Error(uiText.errors.refreshAfterSave);
    } catch (reason) {
      if (sequence !== refreshSequence.current) return;
      setRefreshIssue(true);
      throw reason;
    }
  }

  function reserveMutation(mutation: PendingTodayMutation) {
    const key = `${mutation.kind === "follow-up" ? "follow-up" : "job"}-${mutation.id}`;
    if (pendingTodayRef.current[key]) throw new Error(uiText.errors.refreshAfterSave);
    const reservation: ReservedTodayMutation = { ...mutation, phase: "saving" };
    const next = { ...pendingTodayRef.current, [key]: reservation };
    pendingTodayRef.current = next;
    setPendingToday(next);
    return { key, reservation };
  }

  function finishMutation(key: string, reservation: ReservedTodayMutation, succeeded: boolean, saved?: PendingTodayMutation) {
    if (pendingTodayRef.current[key] !== reservation) return;
    const next = { ...pendingTodayRef.current };
    if (succeeded) next[key] = { ...(saved ?? reservation), phase: "awaiting-refresh" };
    else delete next[key];
    pendingTodayRef.current = next;
    setPendingToday(next);
  }

  async function updateJobTriage(id: number, status: JobTriageStatus) {
    if (!api.updateJobTriage) return Promise.reject(new Error(uiText.errors.saveChanges));
    const { key, reservation } = reserveMutation({ kind: "job-triage", id, status });
    try {
      const result = await api.updateJobTriage(id, status);
      finishMutation(key, reservation, true);
      return result;
    } catch (reason) {
      finishMutation(key, reservation, false);
      throw reason;
    }
  }

  async function markJobApplied(id: number) {
    if (!api.markJobApplied) return Promise.reject(new Error(uiText.errors.saveChanges));
    const { key, reservation } = reserveMutation({ kind: "job-applied", id });
    try {
      const result = await api.markJobApplied(id);
      finishMutation(key, reservation, true);
      return result;
    } catch (reason) {
      finishMutation(key, reservation, false);
      throw reason;
    }
  }

  async function updateFollowUp(id: number, input: FollowUpAction) {
    if (!api.updateFollowUp) return Promise.reject(new Error(uiText.errors.saveChanges));
    const expectedStatus = input.action === "snooze" ? "pending" : input.action === "done" ? "done" : "dismissed";
    const { key, reservation } = reserveMutation({ kind: "follow-up", id, action: input.action, expectedStatus, expectedDueAt: input.action === "snooze" ? input.dueAt : undefined });
    try {
      const result = await api.updateFollowUp(id, input);
      const saved = result && typeof result === "object" ? result as Record<string, unknown> : {};
      const expectedDueAt = input.action === "snooze" ? (typeof saved.due_at === "string" ? saved.due_at : input.dueAt) : undefined;
      finishMutation(key, reservation, true, { ...reservation, expectedDueAt });
      return result;
    } catch (reason) {
      finishMutation(key, reservation, false);
      throw reason;
    }
  }

  const closeDetails = useCallback(() => {
    setSelectedApplicationId(null);
    setJobDetails(null);
    setDetailError(null);
    requestAnimationFrame(() => {
      if (detailTrigger.current?.isConnected) detailTrigger.current.focus();
      else if (detailReturnApplicationId.current != null) (document.getElementById(`pipeline-application-${detailReturnApplicationId.current}`) ?? document.querySelector<HTMLElement>('nav button[aria-current="page"]'))?.focus();
    });
  }, []);
  useEffect(() => {
    if (!selectedApplication || !api.getJobDetails || jobDetails) return;
    loadingCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { closeDetails(); return; }
      if (event.key !== "Tab") return;
      const dialog = loadingCloseRef.current?.closest('[role="dialog"]');
      const controls = [...(dialog?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      if (!controls.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedApplication, api, jobDetails, detailError, closeDetails]);

  function navigateToReview(id: number) {
    setReviewTargetId(id);
    setActive("review");
  }

  if (error) return <main className="state-card"><h1>{uiText.errors.fallback}</h1><p>{error}</p></main>;
  if (!data) return <main className="state-card"><span className="pulse" />{uiText.labels.loading}</main>;
  const lockedJobIds = Object.values(pendingToday).filter((item) => item.kind !== "follow-up").map((item) => item.id);
  const lockedFollowUpIds = Object.values(pendingToday).filter((item) => item.kind === "follow-up").map((item) => item.id);

  return (
    <AppShell activePage={active} reviewCount={data.summary.review} onNavigate={(page) => { setReviewTargetId(null); if (page === "pipeline") setPipelineView("active"); setActive(page); }}>
      {active === "today" && <TodayPage data={data} onTriage={updateJobTriage} onMarkApplied={markJobApplied} onFollowUp={updateFollowUp} onOpenFollowUpDraft={(id) => api.openFollowUpDraft ? api.openFollowUpDraft(id) : Promise.reject(new Error(uiText.errors.openEmailDraft))} onRefresh={refreshToday} lockedJobIds={lockedJobIds} lockedFollowUpIds={lockedFollowUpIds} refreshIssue={refreshIssue} onNavigateToReview={navigateToReview} onOpenDetails={(application, trigger) => { detailTrigger.current = trigger; detailReturnApplicationId.current = application.id; setSelectedApplicationId(application.id); }} />}
      {active === "jobs" && <JobsPage data={data} onTriage={updateJobTriage} onMarkApplied={markJobApplied} onRefresh={refreshToday} lockedJobIds={lockedJobIds} refreshIssue={refreshIssue} onCreateSearchSource={(input) => api.createSearchSource ? api.createSearchSource(input) : Promise.reject(new Error(uiText.errors.saveSearchSource))} onUpdateSearchSource={(id, input) => api.updateSearchSource ? api.updateSearchSource(id, input) : Promise.reject(new Error(uiText.errors.saveSearchSource))} onOpenApplication={(application, trigger) => { detailTrigger.current = trigger; detailReturnApplicationId.current = application.id; setPipelineView(["rejected", "withdrawn"].includes(String(application.status)) ? "archive" : "active"); setActive("pipeline"); setSelectedApplicationId(application.id); }} onToggleDuplicate={toggleDuplicate} onGenerateDocuments={api.generateDocuments ? (jobId, language) => api.generateDocuments!(jobId, language) : undefined} onRefreshDocuments={async (jobId) => api.getJobDetails ? api.getJobDetails(jobId) : { documents: data.documents.filter((document) => Number(document.job_id) === jobId), activity: [] }} />}
      {active === "pipeline" && <PipelinePage data={data} initialView={pipelineView} onChangeStatus={changeStatus} onRefresh={async (applicationId) => { const refreshed = await reloadDashboard(); releaseApplication(applicationId); return refreshed; }} onRetryRefresh={async () => { await reloadDashboard(); }} refreshIssue={statusRefreshIssue} lockedApplicationIds={pendingApplicationIds} onOpenDetails={(application, trigger) => { detailTrigger.current = trigger; detailReturnApplicationId.current = application.id; setSelectedApplicationId(application.id); }} />}
      {active === "review" && <ReviewPage data={data} reviewEvidence={reviewEvidence} bulkIgnoreEvidence={bulkIgnoreEvidence} pendingIds={pendingReviewIds} onRefresh={reloadDashboard} targetId={reviewTargetId} onTargetHandled={() => setReviewTargetId(null)} />}
      {selectedApplication && (!api.getJobDetails || jobDetails) && <ApplicationDetailDrawer
        key={selectedApplicationId}
        application={jobDetails?.application ?? selectedApplication}
        data={data}
        details={jobDetails ?? undefined}
        onClose={closeDetails}
        onSave={saveApplication}
        onAddInterviewNote={addInterviewNote}
        onRefresh={() => refreshApplicationDetails(Number(selectedApplication.job_id))}
        onGenerateDocuments={api.generateDocuments ? (language) => api.generateDocuments!(Number(selectedApplication.job_id), language) : undefined}
        onRefreshDocuments={async () => {
          if (!api.getJobDetails) { await refreshApplicationDetails(Number(selectedApplication.job_id)); return { documents: data.documents.filter((document) => Number(document.job_id) === Number(selectedApplication.job_id)), activity: [] }; }
          return api.getJobDetails(Number(selectedApplication.job_id));
        }}
        applicationLocked={pendingApplicationIds.includes(selectedApplication.id)}
        noteLocked={lockedNoteJobIds.includes(Number(selectedApplication.job_id))}
      />}
      {selectedApplication && api.getJobDetails && !jobDetails && <div className="detail-backdrop"><section className="detail-drawer" role="dialog" aria-modal="true" aria-label={`${String(selectedApplication.company)} application details`}><button ref={loadingCloseRef} type="button" onClick={closeDetails} aria-label={uiText.labels.closeDetails}>×</button>{detailError ? <p role="alert">{detailError} <button type="button" onClick={() => void loadAuthoritativeDetails(Number(selectedApplication.job_id))}>{uiText.pipeline.retryDetails}</button></p> : <p>{uiText.labels.loading}</p>}</section></div>}
    </AppShell>
  );
}
