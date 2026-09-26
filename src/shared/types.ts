export const applicationStatuses = [
  "applied",
  "recruiter_screen",
  "technical_interview",
  "take_home",
  "onsite_final",
  "offer",
  "rejected",
  "withdrawn",
  "unknown"
] as const;

export type ApplicationStatus = (typeof applicationStatuses)[number];
export const jobTriageStatuses = ["new", "shortlisted", "skipped", "expired"] as const;
export type JobTriageStatus = (typeof jobTriageStatuses)[number];
export type ISODateString = string;
export type EmploymentType = "permanent" | "freelance";
export type SearchSourceCategory = "permanent" | "freelance" | "both";

export interface SearchSourceInput {
  name: string;
  searchUrl: string;
  category: SearchSourceCategory;
  enabled?: boolean;
}

export type SearchSourcePatch = Partial<SearchSourceInput>;

export interface SearchSource {
  id: number;
  seed_key: string | null;
  name: string;
  search_url: string;
  category: SearchSourceCategory;
  enabled: 0 | 1;
  last_checked_at: ISODateString | null;
  last_success_at: ISODateString | null;
  last_discovered_count: number | null;
  last_imported_count: number | null;
  last_error: string | null;
}

export interface SearchSourceCheckInput {
  status: "success" | "error";
  discoveredCount: number;
  importedCount: number;
  checkedAt: ISODateString;
  errorText?: string | null;
}

export interface DashboardJob {
  id: number;
  score: number;
  url: string | null;
  posted_at: string | null;
  created_at: string;
  employment_type: EmploymentType;
  triage_status: JobTriageStatus;
  duplicate_blocked: number;
  application_id: number | null;
  [key: string]: unknown;
}

export interface DashboardApplication {
  id: number;
  job_id: number;
  status: ApplicationStatus;
  updated_at: string;
  stage_entered_at: string;
  applied_at: string | null;
  priority: number;
  next_step: string | null;
  last_activity_at: string;
  archived_at?: string | null;
  next_step_due_at?: string | null;
  next_follow_up_sequence?: number | null;
  days_in_stage: number;
  [key: string]: unknown;
}

export interface WeeklyProgressPeriod {
  applications: number;
  responses: number;
  interviews: number;
  offers: number;
  responseRate: number;
}

export interface TodayView {
  applyToday: DashboardJob[];
  followUpToday: Record<string, unknown>[];
  followUpRemainingCount: number;
  needsAttention: TodayAttentionItem[];
  weeklyProgress: { last7Days: WeeklyProgressPeriod; last30Days: WeeklyProgressPeriod; allTime: WeeklyProgressPeriod };
}

export interface ReviewAttentionEvidence {
  id: number;
  classification: string;
  confidence: number;
  received_at: string;
  sender: string;
  subject: string;
  [key: string]: unknown;
}

export type TodayAttentionItem =
  | { kind: "application"; application: DashboardApplication }
  | { kind: "review"; evidence: ReviewAttentionEvidence };

export interface PipelineView {
  active: DashboardApplication[];
  needsAttention: DashboardApplication[];
  archive: DashboardApplication[];
}

export type FollowUpAction =
  | { action: "done" }
  | { action: "dismiss" }
  | { action: "snooze"; dueAt: ISODateString };

export type EvidenceReviewAction =
  | { action: "ignore" }
  | { action: "link"; applicationId: number; status: ApplicationStatus }
  | { action: "create"; company: string; title: string; status: ApplicationStatus };

export interface JobInput {
  company: string;
  title: string;
  url?: string | null;
  description?: string | null;
  location?: string | null;
  workMode?: string | null;
  employmentType: EmploymentType;
  salaryMin?: number | null;
  salaryMax?: number | null;
  dayRate?: number | null;
  source: string;
  searchSourceId?: number | null;
  postedAt?: string | null;
  requiresSponsorship?: boolean;
  language?: string | null;
}

export interface EmailEvidenceInput {
  messageId: string;
  account: string;
  mailbox: string;
  receivedAt: string;
  sender: string;
  recipients: string;
  subject: string;
  snippet: string;
  classification: ApplicationStatus;
  confidence: number;
}
