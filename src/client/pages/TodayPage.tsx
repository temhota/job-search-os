import { useState } from "react";
import type { FollowUpAction, JobTriageStatus, WeeklyProgressPeriod } from "../../shared/types.js";
import { nextBerlinCalendarDay, snoozeDueAt } from "../../shared/berlin-date.js";
import type { DashboardData, Row } from "../types.js";
import { uiText } from "../ui-text.js";
import { AsyncButton } from "../components/AsyncButton.js";
import { JobRow } from "../components/JobRow.js";

interface Props {
  data: DashboardData;
  onTriage: (id: number, status: JobTriageStatus) => Promise<unknown>;
  onMarkApplied: (id: number) => Promise<unknown>;
  onFollowUp: (id: number, input: FollowUpAction) => Promise<unknown>;
  onOpenFollowUpDraft: (id: number) => Promise<unknown>;
  onRefresh: () => Promise<unknown>;
  lockedJobIds: number[];
  lockedFollowUpIds: number[];
  refreshIssue: boolean;
  onOpenDetails: (application: Row, trigger: HTMLButtonElement) => void;
  onNavigateToReview: (id: number) => void;
}

function formatDate(value: unknown) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Berlin"
  }).format(new Date(String(value)));
}

function FollowUpRow({
  item,
  onAction,
  onOpenDraft,
  onRefresh,
  locked
}: {
  item: Row;
  onAction: (id: number, input: FollowUpAction) => Promise<unknown>;
  onOpenDraft: (id: number) => Promise<unknown>;
  onRefresh: () => Promise<unknown>;
  locked: boolean;
}) {
  const [date, setDate] = useState("");
  const [openingDraft, setOpeningDraft] = useState(false);
  const [draftFailure, setDraftFailure] = useState<string | null>(null);
  const [replyReady, setReplyReady] = useState(false);
  const minimumDate = nextBerlinCalendarDay();
  const dueAt = snoozeDueAt(date);
  const company = String(item.company ?? "Unknown company");
  const actionTarget = `${company} ${String(item.title ?? "")} #${String(item.sequence ?? "")}`;
  async function copyDraft() {
    await navigator.clipboard.writeText(String(item.draft ?? ""));
  }
  async function openDraft() {
    if (openingDraft) return;
    setOpeningDraft(true);
    setDraftFailure(null);
    setReplyReady(false);
    try {
      await copyDraft();
    } catch {
      setDraftFailure(uiText.errors.copyDraft);
      setOpeningDraft(false);
      return;
    }
    try {
      await onOpenDraft(item.id);
      setReplyReady(true);
    } catch (reason) {
      setDraftFailure(reason instanceof Error ? reason.message : uiText.errors.openEmailDraft);
    } finally {
      setOpeningDraft(false);
    }
  }
  return (
    <article className="today-row follow-up-row">
      <div className="today-row-main">
        <strong>{company}</strong>
        <span>{String(item.title ?? "")}</span>
        <small>
          {uiText.labels.followUp} #{String(item.sequence ?? "")} · {formatDate(item.due_at)}
        </small>
      </div>
      <div className="today-actions">
        <span className="async-action">
          <button
            type="button"
            aria-label={`${uiText.labels.openEmailDraft} ${actionTarget}`}
            disabled={openingDraft || locked}
            onClick={openDraft}
          >
            {openingDraft ? uiText.labels.openingEmailDraft : uiText.labels.openEmailDraft}
          </button>
          {replyReady && (
            <span className="action-success" role="status">
              {uiText.labels.replyReady}
            </span>
          )}
          {draftFailure && (
            <span className="action-error" role="alert">
              {draftFailure}
              <textarea
                className="draft-fallback"
                readOnly
                aria-label={`${uiText.labels.draftText} ${actionTarget}`}
                value={String(item.draft ?? "")}
              />
              <AsyncButton
                label={uiText.labels.copyDraft}
                ariaLabel={`${uiText.labels.copyDraft} ${actionTarget}`}
                onAction={copyDraft}
              />
            </span>
          )}
        </span>
        <AsyncButton
          label={uiText.labels.done}
          ariaLabel={`${uiText.labels.done} ${actionTarget}`}
          disabled={locked}
          onAction={() => onAction(item.id, { action: "done" })}
          onRefresh={onRefresh}
          refreshErrorHandled
        />
        <label>
          {uiText.labels.snoozeUntil}
          <input
            type="date"
            min={minimumDate}
            aria-label={`${uiText.labels.snoozeUntil} for ${actionTarget}`}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <AsyncButton
          label={uiText.labels.snooze}
          ariaLabel={`${uiText.labels.snooze} ${actionTarget}`}
          disabled={!dueAt || locked}
          onAction={() => onAction(item.id, { action: "snooze", dueAt: dueAt! })}
          onRefresh={onRefresh}
          refreshErrorHandled
        />
        <AsyncButton
          label={uiText.labels.dismiss}
          ariaLabel={`${uiText.labels.dismiss} ${actionTarget}`}
          disabled={locked}
          onAction={() => onAction(item.id, { action: "dismiss" })}
          onRefresh={onRefresh}
          refreshErrorHandled
        />
      </div>
    </article>
  );
}

function Progress({ label, period }: { label: string; period: WeeklyProgressPeriod }) {
  return (
    <article className="progress-period">
      <h3>{label}</h3>
      <dl>
        <div>
          <dt>{uiText.labels.applications}</dt>
          <dd>{period.applications}</dd>
        </div>
        <div>
          <dt>{uiText.labels.responses}</dt>
          <dd>{period.responses}</dd>
        </div>
        <div>
          <dt>{uiText.labels.interviews}</dt>
          <dd>{period.interviews}</dd>
        </div>
        <div>
          <dt>{uiText.labels.todayResponseRate}</dt>
          <dd>{Math.round(period.responseRate * 100)}%</dd>
        </div>
      </dl>
    </article>
  );
}

export function TodayPage({
  data,
  onTriage,
  onMarkApplied,
  onFollowUp,
  onOpenFollowUpDraft,
  onRefresh,
  lockedJobIds,
  lockedFollowUpIds,
  refreshIssue,
  onOpenDetails,
  onNavigateToReview
}: Props) {
  const today = data.today;
  const [retrying, setRetrying] = useState(false);
  async function retryRefresh() {
    setRetrying(true);
    try {
      await onRefresh();
    } catch {
      /* The App keeps the contextual refresh alert visible. */
    } finally {
      setRetrying(false);
    }
  }
  return (
    <div className="today-page">
      {refreshIssue && (
        <div className="today-refresh-error" role="alert">
          {uiText.errors.refreshAfterSave}{" "}
          <button type="button" disabled={retrying} onClick={retryRefresh}>
            {uiText.labels.retryRefresh}
          </button>
        </div>
      )}
      <section className="panel today-section">
        <div className="section-title">
          <h2>{uiText.labels.applyToday}</h2>
          <span>{Math.min(5, today.applyToday.length)}</span>
        </div>
        {today.applyToday.length ? (
          today.applyToday
            .slice(0, 5)
            .map((job) => (
              <JobRow
                key={job.id}
                job={job}
                onShortlist={() => onTriage(job.id, "shortlisted")}
                onSkip={() => onTriage(job.id, "skipped")}
                onMarkApplied={() => onMarkApplied(job.id)}
                onRefresh={onRefresh}
                locked={lockedJobIds.includes(job.id)}
              />
            ))
        ) : (
          <p className="empty">{uiText.empty.applyToday}</p>
        )}
      </section>
      <section className="panel today-section">
        <div className="section-title">
          <h2>{uiText.labels.followUpToday}</h2>
          <span>{today.followUpToday.length}</span>
        </div>
        {today.followUpToday.length ? (
          today.followUpToday.map((item) => (
            <FollowUpRow
              key={Number(item.id)}
              item={item as Row}
              onAction={onFollowUp}
              onOpenDraft={onOpenFollowUpDraft}
              onRefresh={onRefresh}
              locked={lockedFollowUpIds.includes(Number(item.id))}
            />
          ))
        ) : (
          <p className="empty">{uiText.empty.followUps}</p>
        )}
        {today.followUpRemainingCount > 0 && (
          <p className="today-remaining">
            {today.followUpRemainingCount} {uiText.labels.moreFollowUps}
          </p>
        )}
      </section>
      <section className="panel today-section">
        <div className="section-title">
          <h2>{uiText.labels.needsAttention}</h2>
          <span>{today.needsAttention.length}</span>
        </div>
        {today.needsAttention.length ? (
          today.needsAttention.map((item) =>
            item.kind === "application" ? (
              <article
                className="today-row attention-row"
                key={`application-${item.application.id}`}
              >
                <div className="today-row-main">
                  <strong>{String(item.application.company ?? "Unknown company")}</strong>
                  <span>{String(item.application.title ?? "")}</span>
                  <small>
                    {uiText.statuses[item.application.status]} ·{" "}
                    {String(item.application.next_step ?? uiText.labels.nextStep)}
                  </small>
                </div>
                <button
                  type="button"
                  aria-label={`${uiText.labels.detailsFor} ${String(item.application.company ?? "application")} — ${String(item.application.title ?? "")}`}
                  onClick={(event) => onOpenDetails(item.application as Row, event.currentTarget)}
                >
                  {uiText.labels.details}
                </button>
              </article>
            ) : (
              <article className="today-row attention-row" key={`review-${item.evidence.id}`}>
                <div className="today-row-main">
                  <strong>{uiText.labels.reviewItem}</strong>
                  <span>{item.evidence.subject}</span>
                  <small>{item.evidence.sender}</small>
                </div>
                <button type="button" onClick={() => onNavigateToReview(item.evidence.id)}>
                  {uiText.labels.reviewItem} {item.evidence.subject}
                </button>
              </article>
            )
          )
        ) : (
          <p className="empty">{uiText.empty.needsAttention}</p>
        )}
      </section>
      <section className="panel today-section">
        <div className="section-title">
          <h2>{uiText.labels.weeklyProgress}</h2>
        </div>
        <div className="progress-periods">
          <Progress label={uiText.labels.last7Days} period={today.weeklyProgress.last7Days} />
          <Progress label={uiText.labels.last30Days} period={today.weeklyProgress.last30Days} />
          <Progress label={uiText.labels.allTime} period={today.weeklyProgress.allTime} />
        </div>
      </section>
    </div>
  );
}
