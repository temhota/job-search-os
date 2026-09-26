import type { EvidenceReviewAction, FollowUpAction, JobTriageStatus, SearchSource, SearchSourceInput, SearchSourcePatch } from "../shared/types.js";
import type { DashboardData, JobDetails } from "./types.js";
import { uiText } from "./ui-text.js";

async function searchSourceMutationError(response: Response): Promise<Error> {
  const fallback = new Error(uiText.errors.saveSearchSource);
  if (![400, 409].includes(response.status) || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return fallback;
  try {
    const body: unknown = await response.json();
    const error = body && typeof body === "object" && "error" in body ? body.error : null;
    const known = response.status === 409
      ? ["Search source URL already exists"]
      : ["Invalid search source", "Invalid search source update", "Invalid search source ID"];
    return typeof error === "string" && known.includes(error) ? new Error(error) : fallback;
  } catch {
    return fallback;
  }
}

export interface DashboardApi {
  load(): Promise<DashboardData>;
  updateApplication(id: number, input: Record<string, unknown>): Promise<unknown>;
  updateJob?(id: number, input: Record<string, unknown>): Promise<unknown>;
  reviewEvidence?(id: number, input: EvidenceReviewAction): Promise<unknown>;
  bulkIgnoreEvidence?(sender: string, evidenceIds: number[]): Promise<{ sender: string; count: number; evidenceIds: number[] }>;
  addInterviewNote?(id: number, input: { category: string; text: string }): Promise<unknown>;
  updateJobTriage?(id: number, status: JobTriageStatus): Promise<unknown>;
  markJobApplied?(id: number): Promise<unknown>;
  updateFollowUp?(id: number, input: FollowUpAction): Promise<unknown>;
  openFollowUpDraft?(id: number): Promise<{ opened: true }>;
  getJobDetails?(jobId: number): Promise<JobDetails>;
  generateDocuments?(jobId: number, language: "English" | "German"): Promise<{ docx: { id: number; format: string; download_url: string }; pdf: { id: number; format: string; download_url: string } }>;
  createSearchSource?(input: SearchSourceInput): Promise<SearchSource>;
  updateSearchSource?(id: number, input: SearchSourcePatch): Promise<SearchSource>;
}

export const defaultApi: DashboardApi = {
  async createSearchSource(input) {
    const response = await fetch("/api/search-sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    if (!response.ok) throw await searchSourceMutationError(response);
    return response.json();
  },
  async updateSearchSource(id, input) {
    const response = await fetch(`/api/search-sources/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    if (!response.ok) throw await searchSourceMutationError(response);
    return response.json();
  },
  async generateDocuments(jobId, language) {
    const response = await fetch(`/api/jobs/${jobId}/documents`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ language }) });
    if (response.status === 503) throw new Error(uiText.errors.documentUnavailable);
    if (!response.ok) throw new Error(uiText.errors.documentGeneration);
    return response.json();
  },
  async load() {
    const response = await fetch("/api/dashboard");
    if (!response.ok) throw new Error(uiText.errors.load);
    return response.json();
  },
  async getJobDetails(jobId) {
    const response = await fetch(`/api/jobs/${jobId}/details`);
    if (!response.ok) throw new Error(uiText.errors.loadDetails);
    return response.json();
  },
  async updateApplication(id, input) {
    const response = await fetch(`/api/applications/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    if (!response.ok) throw new Error(uiText.errors.saveApplication);
    return response.json();
  },
  async updateJob(id, input) {
    const response = await fetch(`/api/jobs/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    if (!response.ok) throw new Error(uiText.errors.saveJob);
    return response.json();
  },
  async reviewEvidence(id, input) {
    const response = await fetch(`/api/evidence/${id}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    if (!response.ok) throw new Error(uiText.errors.saveEvidence);
    return response.json();
  },
  async bulkIgnoreEvidence(sender, evidenceIds) {
    const response = await fetch("/api/evidence/bulk-ignore", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sender, evidenceIds })
    });
    if (response.status === 409) throw new Error(uiText.errors.reviewChanged);
    if (!response.ok) throw new Error(uiText.errors.saveEvidence);
    return response.json();
  },
  async addInterviewNote(id, input) {
    const response = await fetch(`/api/interviews/${id}/insights`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    if (!response.ok) throw new Error(uiText.errors.saveInsight);
    return response.json();
  },
  async updateJobTriage(id, status) {
    const response = await fetch(`/api/jobs/${id}/triage`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status })
    });
    if (!response.ok) throw new Error(uiText.errors.saveChanges);
    return response.json();
  },
  async markJobApplied(id) {
    const response = await fetch(`/api/jobs/${id}/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    if (!response.ok) throw new Error(uiText.errors.saveChanges);
    return response.json();
  },
  async updateFollowUp(id, input) {
    const response = await fetch(`/api/follow-ups/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(input)
    });
    if (!response.ok) throw new Error(uiText.errors.saveChanges);
    return response.json();
  },
  async openFollowUpDraft(id) {
    const response = await fetch(`/api/follow-ups/${id}/email-draft`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}"
    });
    if (response.status === 409) throw new Error(uiText.errors.noReplyableEmailThread);
    if (!response.ok) throw new Error(uiText.errors.openEmailDraft);
    return response.json();
  }
};
