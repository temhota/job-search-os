import { useEffect, useMemo, useState } from "react";
import type { ApplicationStatus, EvidenceReviewAction } from "../../shared/types.js";
import type { DashboardData, Row } from "../types.js";
import { uiText } from "../ui-text.js";

const statuses: ApplicationStatus[] = [
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
const groups = [
  "application_update",
  "rejection",
  "recruiter_conversation",
  "newsletter_alert",
  "unknown"
] as const;

function label(row: Row, key: string, fallback = "—") {
  const value = row[key];
  return value == null || value === "" ? fallback : String(value);
}

function address(row: Row) {
  if (Object.prototype.hasOwnProperty.call(row, "sender_address"))
    return typeof row.sender_address === "string" ? row.sender_address : null;
  return (label(row, "sender", "").match(/<([^<>]+)>/)?.[1] ?? label(row, "sender", ""))
    .trim()
    .toLowerCase();
}

type BulkConfirmation = { sender: string; rows: Array<{ id: number; subject: string }> };

function ReviewItem({
  item,
  applications,
  queue,
  pending,
  reviewEvidence,
  bulkIgnoreEvidence,
  onRefresh
}: {
  item: Row;
  applications: Row[];
  queue: Row[];
  pending: boolean;
  reviewEvidence: (row: Row, action: EvidenceReviewAction) => Promise<void>;
  bulkIgnoreEvidence: (sender: string, ids: number[]) => Promise<void>;
  onRefresh: () => Promise<unknown>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [applicationQuery, setApplicationQuery] = useState("");
  const [applicationId, setApplicationId] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const classification = label(item, "classification", "unknown");
  const [status, setStatus] = useState<ApplicationStatus>(
    statuses.includes(classification as ApplicationStatus)
      ? (classification as ApplicationStatus)
      : "unknown"
  );
  const [statusTouched, setStatusTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<(() => Promise<void>) | null>(null);
  const [confirmBulk, setConfirmBulk] = useState<BulkConfirmation | null>(null);
  const sender = address(item);
  const matchingRows = sender ? queue.filter((row) => address(row) === sender) : [];
  const suggested = applications.find(
    (application) => application.id === Number(item.suggested_application_id)
  );
  const chosen = applications.find((application) => application.id === Number(applicationId));
  const linkStatus = (application: Row): ApplicationStatus =>
    !statusTouched &&
    status === "unknown" &&
    statuses.includes(application.status as ApplicationStatus)
      ? (application.status as ApplicationStatus)
      : status;
  const filteredApplications = applications.filter((application) =>
    `${label(application, "company")} ${label(application, "title")}`
      .toLowerCase()
      .includes(applicationQuery.toLowerCase())
  );
  async function run(action: () => Promise<void>) {
    if (busy || pending) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      setRetry(null);
      setConfirmBulk(null);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : uiText.errors.saveEvidence;
      setError(message);
      setRetry(message === uiText.errors.reviewChanged ? null : () => action);
      if (message === uiText.errors.reviewChanged) setConfirmBulk(null);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      await onRefresh();
      setRetry(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : uiText.errors.refreshAfterSave);
    } finally {
      setBusy(false);
    }
  }
  const locked = busy || pending;
  return (
    <article className="review-item" id={`review-item-${item.id}`} tabIndex={-1}>
      <div className="review-message">
        <div>
          <button
            type="button"
            className="review-disclosure"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "▾" : "▸"} {label(item, "subject")}
          </button>
          <span>{label(item, "sender")}</span>
          <small>
            {item.received_at
              ? new Intl.DateTimeFormat("en-GB", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric"
                }).format(new Date(String(item.received_at)))
              : "—"}
          </small>
        </div>
        <div className="review-summary">
          <span>
            {uiText.labels.detectedAs}: {uiText.statuses[classification] ?? classification} ·{" "}
            {Math.round(Number(item.confidence ?? 0) * 100)}% {uiText.labels.confidence}
          </span>
          {suggested && (
            <button
              type="button"
              disabled={locked}
              onClick={() =>
                void run(() =>
                  reviewEvidence(item, {
                    action: "link",
                    applicationId: suggested.id,
                    status: linkStatus(suggested)
                  })
                )
              }
            >
              Confirm suggested link · {label(suggested, "company")}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setChoosing(true);
              setExpanded(true);
            }}
          >
            {uiText.review.chooseAnother}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="review-expanded">
          <p className="review-excerpt">{label(item, "snippet")}</p>
          <p className="review-reason">{uiText.labels.reviewReason}</p>
          <div className="review-fields">
            <label>
              {uiText.labels.reviewStatus}
              <select
                aria-label={uiText.labels.reviewStatus}
                value={status}
                disabled={locked}
                onChange={(event) => {
                  setStatus(event.target.value as ApplicationStatus);
                  setStatusTouched(true);
                }}
              >
                {statuses.map((value) => (
                  <option key={value} value={value}>
                    {uiText.statuses[value]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {classification === "unknown" && <small>{uiText.review.preserveStage}</small>}
          {choosing && (
            <div className="review-fields">
              <label>
                {uiText.review.searchApplications}
                <input
                  aria-label={uiText.review.searchApplications}
                  value={applicationQuery}
                  onChange={(event) => {
                    setApplicationQuery(event.target.value);
                    setApplicationId("");
                  }}
                />
              </label>
              <label>
                {uiText.labels.existingApplication}
                <select
                  aria-label={uiText.labels.existingApplication}
                  value={applicationId}
                  onChange={(event) => setApplicationId(event.target.value)}
                >
                  <option value="">{uiText.labels.chooseApplication}</option>
                  {filteredApplications.map((application) => (
                    <option value={application.id} key={application.id}>
                      {label(application, "company")} · {label(application, "title")}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={locked || !chosen}
                onClick={() => {
                  if (chosen)
                    void run(() =>
                      reviewEvidence(item, {
                        action: "link",
                        applicationId: chosen.id,
                        status: linkStatus(chosen)
                      })
                    );
                }}
              >
                {uiText.labels.linkApplication}
              </button>
            </div>
          )}
          <div className="review-fields create-review">
            <label>
              {uiText.labels.company}
              <input
                aria-label={uiText.labels.company}
                value={company}
                disabled={locked}
                onChange={(event) => setCompany(event.target.value)}
              />
            </label>
            <label>
              {uiText.labels.role}
              <input
                aria-label={uiText.labels.role}
                value={role}
                disabled={locked}
                onChange={(event) => setRole(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={locked || !company.trim() || !role.trim()}
              onClick={() =>
                void run(() =>
                  reviewEvidence(item, {
                    action: "create",
                    company: company.trim(),
                    title: role.trim(),
                    status
                  })
                )
              }
            >
              {uiText.labels.createApplication}
            </button>
            <button
              type="button"
              className="ignore-review"
              disabled={locked}
              onClick={() => void run(() => reviewEvidence(item, { action: "ignore" }))}
            >
              {uiText.labels.notJobRelated}
            </button>
          </div>
          {String(item.review_group) === "newsletter_alert" && sender && (
            <div className="review-bulk">
              <button
                type="button"
                disabled={locked}
                onClick={() =>
                  setConfirmBulk({
                    sender,
                    rows: matchingRows.map((row) => ({
                      id: row.id,
                      subject: label(row, "subject")
                    }))
                  })
                }
              >
                {uiText.review.bulkIgnore}
              </button>
              {confirmBulk && (
                <div className="review-confirm">
                  <p>
                    {confirmBulk.sender} · {confirmBulk.rows.length} {uiText.labels.items}.{" "}
                    {uiText.review.bulkWarning}
                  </p>
                  <ul>
                    {confirmBulk.rows.map((row) => (
                      <li key={row.id}>
                        #{row.id} {row.subject}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() =>
                      void run(() =>
                        bulkIgnoreEvidence(
                          confirmBulk.sender,
                          confirmBulk.rows.map((row) => row.id)
                        )
                      )
                    }
                  >
                    Ignore {confirmBulk.rows.length} {uiText.labels.items}
                  </button>
                  <button type="button" onClick={() => setConfirmBulk(null)}>
                    {uiText.review.cancel}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="review-error">
          {error}{" "}
          <button
            type="button"
            disabled={busy}
            onClick={() => void (pending ? refresh() : retry ? run(retry) : refresh())}
          >
            {pending
              ? uiText.labels.retryRefresh
              : retry
                ? uiText.labels.retry
                : uiText.review.refreshQueue}
          </button>
        </p>
      )}
      {pending && !error && (
        <p className="review-error">
          {uiText.errors.refreshAfterSave}{" "}
          <button type="button" disabled={busy} onClick={() => void refresh()}>
            {uiText.labels.retryRefresh}
          </button>
        </p>
      )}
    </article>
  );
}

export function ReviewPage({
  data,
  reviewEvidence,
  bulkIgnoreEvidence,
  pendingIds,
  onRefresh,
  targetId,
  onTargetHandled
}: {
  data: DashboardData;
  reviewEvidence: (row: Row, action: EvidenceReviewAction) => Promise<void>;
  bulkIgnoreEvidence: (sender: string, ids: number[]) => Promise<void>;
  pendingIds: number[];
  onRefresh: () => Promise<unknown>;
  targetId: number | null;
  onTargetHandled?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const [visibleCount, setVisibleCount] = useState(10);
  const filtered = useMemo(
    () =>
      data.reviewQueue.filter(
        (item) =>
          (group === "all" || item.review_group === group) &&
          `${label(item, "sender")} ${label(item, "subject")}`
            .toLowerCase()
            .includes(query.toLowerCase())
      ),
    [data.reviewQueue, group, query]
  );
  useEffect(() => {
    if (targetId == null) return;
    const targetIndex = filtered.findIndex((item) => item.id === targetId);
    if (targetIndex < 0) {
      onTargetHandled?.();
      return;
    }
    if (targetIndex >= visibleCount) setVisibleCount(targetIndex + 1);
    else {
      document.getElementById(`review-item-${targetId}`)?.focus();
      onTargetHandled?.();
    }
  }, [targetId, filtered, visibleCount, onTargetHandled]);
  const visible = filtered.slice(0, visibleCount);
  return (
    <section className="panel">
      <div className="section-title">
        <h2>{uiText.labels.manualReview}</h2>
        <span>{data.reviewQueue.length}</span>
      </div>
      <p className="review-intro">{uiText.labels.reviewExplanation}</p>
      {data.reviewQueue.length > 0 && (
        <div className="review-toolbar">
          <label>
            {uiText.review.searchQueue}
            <input
              aria-label={uiText.review.searchQueue}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setVisibleCount(10);
              }}
            />
          </label>
          <label>
            {uiText.review.filterGroup}
            <select
              aria-label={uiText.review.filterGroup}
              value={group}
              onChange={(event) => {
                setGroup(event.target.value);
                setVisibleCount(10);
              }}
            >
              <option value="all">All groups</option>
              {groups.map((value) => (
                <option key={value} value={value}>
                  {uiText.review.groups[value]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {visible.length ? (
        <>
          {groups.map((value) => {
            const rows = visible.filter((item) => (item.review_group ?? "unknown") === value);
            return rows.length ? (
              <section key={value} className="review-group">
                <h3>{uiText.review.groups[value]}</h3>
                {rows.map((item) => (
                  <ReviewItem
                    key={item.id}
                    item={item}
                    applications={data.applications}
                    queue={data.reviewQueue}
                    pending={pendingIds.includes(item.id)}
                    reviewEvidence={reviewEvidence}
                    bulkIgnoreEvidence={bulkIgnoreEvidence}
                    onRefresh={onRefresh}
                  />
                ))}
              </section>
            ) : null;
          })}
          <div className="review-pagination">
            <span>
              {uiText.labels.showing} {visible.length} {uiText.labels.of} {filtered.length}{" "}
              {uiText.labels.items}
            </span>
            {visible.length < filtered.length && (
              <button onClick={() => setVisibleCount((count) => count + 10)}>
                {uiText.labels.showMore}
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="empty">
          {data.reviewQueue.length ? uiText.review.noMatches : uiText.empty.review}
        </div>
      )}
    </section>
  );
}
