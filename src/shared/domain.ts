import type { DashboardJob, JobInput } from "./types.js";
import type { SearchPolicy } from "../server/config/schema.js";

export function isWorkingJobUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function rankApplyToday<T extends DashboardJob>(jobs: T[], policy: SearchPolicy): T[] {
  const eligible = jobs.filter((job) =>
    (job.triage_status === "new" || job.triage_status === "shortlisted") &&
    (!policy.excludeSponsorshipRequired || job.requires_sponsorship !== 1) &&
    !job.application_id && job.duplicate_blocked !== 1 && policy.dailySelection[job.employment_type] > 0
  );
  const ranked = [...eligible].sort((left, right) => {
    const validLink = (url: string | null) => Number(isWorkingJobUrl(url));
    return right.score - left.score || validLink(right.url) - validLink(left.url) ||
      Date.parse(right.posted_at ?? right.created_at) - Date.parse(left.posted_at ?? left.created_at) || left.id - right.id;
  });
  const permanent = ranked.filter((job) => job.employment_type === "permanent").slice(0, policy.dailySelection.permanent);
  const freelance = ranked.filter((job) => job.employment_type === "freelance").slice(0, policy.dailySelection.freelance);
  const selected = new Set([...permanent, ...freelance].map((job) => job.id));
  const result = [...permanent, ...freelance];
  for (const job of ranked) {
    if (result.length >= policy.dailySelection.total) break;
    if (!selected.has(job.id)) result.push(job);
  }
  return result.sort((left, right) => ranked.indexOf(left) - ranked.indexOf(right));
}

export interface ScoreResult {
  total: number;
  excluded: boolean;
  reasons: string[];
}

function daysBetween(a: Date, b: Date) {
  return Math.floor(Math.abs(a.getTime() - b.getTime()) / 86_400_000);
}

export function scoreJob(job: Omit<JobInput, "company" | "source">, policy: SearchPolicy, now = new Date()): ScoreResult {
  if (job.requiresSponsorship && policy.excludeSponsorshipRequired) {
    return { total: 0, excluded: true, reasons: ["Requires sponsorship"] };
  }

  const text = `${job.title} ${job.description ?? ""}`.toLowerCase();
  const reasons: string[] = [];
  let total = 0;

  const match = policy.preferredKeywordGroups.filter((group) =>
    group.allOf.every((keyword) => text.includes(keyword.toLowerCase())) &&
    (!group.anyOf.length || group.anyOf.some((keyword) => text.includes(keyword.toLowerCase())))
  ).sort((a, b) => b.score - a.score)[0];
  if (match) {
    total += match.score;
    reasons.push(match.label);
  }

  const location = `${job.location ?? ""} ${job.workMode ?? ""}`.toLowerCase();
  if (policy.locations.some((keyword) => location.includes(keyword.toLowerCase()))) {
    total += 20;
    reasons.push("Preferred location");
  }
  if (policy.seniorityKeywords.some((keyword) => text.includes(keyword.toLowerCase()))) total += 15;

  if (job.employmentType === "permanent") {
    if (job.salaryMin == null || job.salaryMin >= policy.permanentMinSalary) total += 15;
  } else if (job.dayRate == null || job.dayRate >= policy.freelanceMinDayRate) {
    total += 15;
  }

  if (!job.postedAt) total += 5;
  else {
    const age = daysBetween(now, new Date(`${job.postedAt}T00:00:00Z`));
    total += age <= 7 ? 10 : age <= 30 ? 6 : 2;
  }

  if (!job.language || policy.acceptedLanguages.some((language) => job.language!.toLowerCase().includes(language.toLowerCase()))) total += 5;
  return { total: Math.min(100, total), excluded: false, reasons };
}

export function buildFollowUps(appliedAt: string) {
  const start = new Date(appliedAt);
  return [7, 14].map((days, index) => ({
    sequence: index + 1,
    dueAt: new Date(start.getTime() + days * 86_400_000).toISOString()
  }));
}

export function buildFollowUpDraft(company: string, title: string, sequence: number, signature: string) {
  const opening = sequence === 1 ? "I'm following up" : "I wanted to follow up once more";
  return `Hello,\n\n${opening} on my application for the ${title} at ${company}. I remain very interested in the role and would be happy to provide any additional information.\n\nBest regards,\n${signature}`;
}
