import type { TodayView, PipelineView, SearchSource } from "../shared/types.js";

export type Row = Record<string, unknown> & { id: number };

export interface DashboardData {
  searchSelection: { permanent: number; freelance: number; total: number };
  summary: { jobs: number; applications: number; interviews: number; responses: number; offers: number; review: number };
  jobs: Row[];
  applications: Row[];
  followUps: Row[];
  interviews: Row[];
  insights: Row[];
  insightDetails?: Row[];
  sourceStats: Row[];
  searchSources: SearchSource[];
  documents: Row[];
  reviewQueue: Row[];
  today: TodayView;
  pipeline?: PipelineView;
}

export interface JobDetails {
  job: Row;
  application: Row | null;
  evidence: Row[];
  interviews: Row[];
  insights: Row[];
  documents: Row[];
  activity: Row[];
}

export type PageKey = "today" | "jobs" | "pipeline" | "review";
