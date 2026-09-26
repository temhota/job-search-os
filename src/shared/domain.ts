import type { DashboardJob, JobInput } from "./types.js";

// Fictitious demo floors: no real candidate's compensation preferences.
const demoMinimumSalary = 0;
const demoMinimumDayRate = 0;

export function isWorkingJobUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function rankApplyToday<T extends DashboardJob>(jobs: T[]): T[] {
  const eligible = jobs.filter((job) =>
    (job.triage_status === "new" || job.triage_status === "shortlisted") &&
    !job.application_id && job.duplicate_blocked !== 1
  );
  const ranked = [...eligible].sort((left, right) => {
    const validLink = (url: string | null) => Number(isWorkingJobUrl(url));
    return right.score - left.score || validLink(right.url) - validLink(left.url) ||
      Date.parse(right.posted_at ?? right.created_at) - Date.parse(left.posted_at ?? left.created_at) || left.id - right.id;
  });
  const permanent = ranked.filter((job) => job.employment_type === "permanent").slice(0, 4);
  const freelance = ranked.filter((job) => job.employment_type === "freelance").slice(0, 1);
  const selected = new Set([...permanent, ...freelance].map((job) => job.id));
  const result = [...permanent, ...freelance];
  for (const job of ranked) {
    if (result.length >= 5) break;
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

export function scoreJob(job: Omit<JobInput, "company" | "source">, now = new Date()): ScoreResult {
  if (job.requiresSponsorship) {
    return { total: 0, excluded: true, reasons: ["Requires sponsorship"] };
  }

  const text = `${job.title} ${job.description ?? ""}`.toLowerCase();
  const reasons: string[] = [];
  let total = 0;

  if (text.includes("react native") && text.includes("typescript")) {
    total += 35;
    reasons.push("Strong React Native/TypeScript match");
  } else if (text.includes("react") && text.includes("typescript")) {
    total += 28;
    reasons.push("Strong React/TypeScript match");
  } else if (text.includes("typescript") && (text.includes("node") || text.includes("full-stack") || text.includes("full stack"))) {
    total += 22;
    reasons.push("Relevant TypeScript full-stack match");
  }

  // The baseline gives every location the same score until local configuration is introduced.
  total += 20;
  reasons.push("Neutral demo location score");
  if (/senior|staff|lead/.test(text)) total += 15;

  if (job.employmentType === "permanent") {
    if (job.salaryMin == null || job.salaryMin >= demoMinimumSalary) total += 15;
  } else if (job.dayRate == null || job.dayRate >= demoMinimumDayRate) {
    total += 15;
  }

  if (!job.postedAt) total += 5;
  else {
    const age = daysBetween(now, new Date(`${job.postedAt}T00:00:00Z`));
    total += age <= 7 ? 10 : age <= 30 ? 6 : 2;
  }

  if (!job.language || /english|german|deutsch|englisch/i.test(job.language)) total += 5;
  return { total: Math.min(100, total), excluded: false, reasons };
}

export function buildFollowUps(appliedAt: string) {
  const start = new Date(appliedAt);
  return [7, 14].map((days, index) => ({
    sequence: index + 1,
    dueAt: new Date(start.getTime() + days * 86_400_000).toISOString()
  }));
}

export function buildFollowUpDraft(company: string, title: string, sequence: number) {
  const opening = sequence === 1 ? "I'm following up" : "I wanted to follow up once more";
  return `Hello,\n\n${opening} on my application for the ${title} at ${company}. I remain very interested in the role and would be happy to provide any additional information.\n\nBest regards,\nAlex Morgan`;
}
