// Break caught: the dashboard stops exposing the real application pipeline or cannot persist a status change.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { App, type DashboardApi } from "../src/client/App.js";
import { defaultApi } from "../src/client/api.js";
import { ReviewPage } from "../src/client/pages/ReviewPage.js";

const dashboard = {
  summary: { jobs: 6, applications: 3, interviews: 2, responses: 2, offers: 0, review: 1 },
  jobs: [
    { id: 1, company: "Northstar Health", title: "Senior React Native Engineer", url: "https://jobs.example.com/northstar-mobile", score: 94, location: "Germany Remote", employment_type: "permanent", duplicate_blocked: 0 },
    { id: 2, company: "No URL GmbH", title: "React Engineer", url: null, score: 80, location: "Berlin", employment_type: "permanent", duplicate_blocked: 0 }
  ],
  applications: [{ id: 7, job_id: 1, company: "Acme", title: "Senior React Engineer", status: "applied", priority: 3, notes: "", score: 88, applied_at: "2026-09-01T09:00:00.000Z" }],
  followUps: [{ id: 9, company: "Acme", title: "Senior React Engineer", due_at: "2026-09-08T09:00:00.000Z", sequence: 1 }],
  interviews: [{ id: 12, company: "Acme", stage: "technical_interview", event_at: "2026-09-03T09:00:00.000Z", participants: "talent@acme.example.com", result: "rejected", explicit_feedback: "Strong communication; improve mobile architecture." }],
  insights: [{ category: "react_native_mobile_architecture", count: 1 }],
  insightDetails: [{ id: 14, company: "Acme", category: "react_native_mobile_architecture", text: "Strong communication; improve mobile architecture.", source_type: "employer_feedback", confidence: 0.94, event_at: "2026-09-03T09:00:00.000Z" }],
  sourceStats: [{ source: "email", count: 3 }],
  searchSources: [
    { id: 71, seed_key: null, name: "Remote React", search_url: "https://jobs.example.com/react?remote=1", category: "permanent" as const, enabled: 1 as const, last_checked_at: "2026-09-25T07:00:00.000Z", last_success_at: "2026-09-24T07:00:00.000Z", last_discovered_count: 12, last_imported_count: 3, last_error: "Timeout from source" },
    { id: 72, seed_key: null, name: "Freelance roles", search_url: "javascript:alert(1)", category: "freelance" as const, enabled: 0 as const, last_checked_at: null, last_success_at: null, last_discovered_count: null, last_imported_count: null, last_error: null }
  ],
  documents: [], reviewQueue: [{ id: 10, subject: "Quick chat", sender: "alex@example.com", received_at: "2026-09-02T09:00:00.000Z", snippet: "Хотите обсудить вакансию?", classification: "unknown", confidence: 0.35, job_id: null }],
  today: {
    applyToday: [
      { id: 1, company: "Northstar Health", title: "Senior React Native Engineer", url: "https://jobs.example.com/northstar-mobile", score: 94, work_mode: "Remote", location: "Germany Remote", employment_type: "permanent", triage_status: "new", description: "React Native mobile architecture" },
      { id: 2, company: "No URL GmbH", title: "React Engineer", url: null, score: 80, work_mode: "Hybrid", location: "Berlin", employment_type: "permanent", triage_status: "new" }
    ],
    followUpToday: [{ id: 9, company: "Acme", title: "Senior React Engineer", due_at: "2026-09-08T09:00:00.000Z", sequence: 1, draft: "Hello Acme" }],
    followUpRemainingCount: 0,
    needsAttention: [{ kind: "application", application: { id: 7, company: "Acme", title: "Senior React Engineer", status: "applied", priority: 3, next_step: "Prepare interview", days_in_stage: 8 } }],
    weeklyProgress: { last7Days: { applications: 2, responses: 1, interviews: 1, offers: 0, responseRate: 0.5 }, last30Days: { applications: 6, responses: 3, interviews: 2, offers: 0, responseRate: 0.5 }, allTime: { applications: 12, responses: 6, interviews: 3, offers: 1, responseRate: 0.5 } }
  }
};

function clientSource(directory: string): string {
  return readdirSync(directory, { withFileTypes: true }).map((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return clientSource(path);
    return /\.tsx?$/.test(entry.name) ? readFileSync(path, "utf8") : "";
  }).join("\n");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("App", () => {
  test("identifies the public application with neutral product branding", async () => {
    const { container } = render(<App api={{ load: vi.fn().mockResolvedValue(dashboard), updateApplication: vi.fn() }} />);
    await screen.findByRole("heading", { name: "Today" });
    expect(container.querySelector(".brand")).toHaveTextContent(/^JSJob SearchOperating system$/);
  });

  test("describes the local search without a preset personal deadline or employment mix", async () => {
    render(<App api={{ load: vi.fn().mockResolvedValue(dashboard), updateApplication: vi.fn() }} />);
    await screen.findByRole("heading", { name: "Today" });
    expect(screen.getByLabelText("Search overview")).toHaveTextContent("Local job search");
  });

  test("shows source status in a collapsed Jobs disclosure and keeps disabled rows visible", async () => {
    render(<App api={{ load: vi.fn().mockResolvedValue(dashboard), updateApplication: vi.fn() }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    const disclosure = screen.getByText("Search sources");
    expect(disclosure.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(disclosure);
    expect(screen.getByText("Remote React")).toBeVisible();
    expect(screen.getByText("Freelance roles")).toBeVisible();
    expect(screen.getByText("Timeout from source")).toBeVisible();
    expect(screen.getByText(/12 discovered/)).toBeVisible();
    expect(screen.getByText(/3 imported/)).toBeVisible();
    expect(screen.getByText(/Last checked: Never checked/)).toBeVisible();
    expect(screen.getByText(/Last successful check: No successful check/)).toBeVisible();
    expect(screen.getByText("Disabled")).toBeVisible();
    const safeLink = screen.getByRole("link", { name: "Open search for Remote React" });
    expect(safeLink).toHaveAttribute("href", "https://jobs.example.com/react?remote=1");
    expect(safeLink).toHaveAttribute("target", "_blank");
    expect(safeLink).toHaveAttribute("rel", "noreferrer");
    expect(screen.queryByRole("link", { name: "Open search for Freelance roles" })).not.toBeInTheDocument();
  });

  test("creates a source and refreshes the dashboard after saving", async () => {
    const createSearchSource = vi.fn().mockResolvedValue({});
    const load = vi.fn().mockResolvedValue(dashboard);
    render(<App api={{ load, updateApplication: vi.fn(), createSearchSource }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    fireEvent.click(screen.getByText("Search sources"));
    fireEvent.click(screen.getByRole("button", { name: "Add source" }));
    fireEvent.change(screen.getByLabelText("Source name"), { target: { value: "React Native EU" } });
    fireEvent.change(screen.getByLabelText("Filtered search URL"), { target: { value: "https://jobs.example.com/react-native" } });
    fireEvent.change(screen.getByLabelText("Source category"), { target: { value: "both" } });
    fireEvent.click(screen.getByRole("button", { name: "Save source" }));
    await waitFor(() => expect(createSearchSource).toHaveBeenCalledWith({ name: "React Native EU", searchUrl: "https://jobs.example.com/react-native", category: "both", enabled: true }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  test("edits a source with prefilled fields and disables it without removing the row", async () => {
    const updateSearchSource = vi.fn().mockResolvedValue({});
    const disabled = { ...dashboard.searchSources[0], enabled: 0 as const };
    const load = vi.fn().mockResolvedValueOnce(dashboard).mockResolvedValueOnce(dashboard).mockResolvedValueOnce({ ...dashboard, searchSources: [disabled, dashboard.searchSources[1]] }).mockResolvedValue(dashboard);
    render(<App api={{ load, updateApplication: vi.fn(), updateSearchSource }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    fireEvent.click(screen.getByText("Search sources"));
    fireEvent.click(screen.getByRole("button", { name: "Edit Remote React" }));
    expect(screen.getByLabelText("Source name")).toHaveValue("Remote React");
    expect(screen.getByLabelText("Filtered search URL")).toHaveValue("https://jobs.example.com/react?remote=1");
    expect(screen.getByLabelText("Source category")).toHaveValue("permanent");
    expect(screen.getByLabelText("Enabled")).toBeChecked();
    fireEvent.change(screen.getByLabelText("Source category"), { target: { value: "both" } });
    fireEvent.click(screen.getByRole("button", { name: "Save source" }));
    await waitFor(() => expect(updateSearchSource).toHaveBeenCalledWith(71, { name: "Remote React", searchUrl: "https://jobs.example.com/react?remote=1", category: "both", enabled: true }));
    fireEvent.click(screen.getByRole("button", { name: "Disable Remote React" }));
    await waitFor(() => expect(updateSearchSource).toHaveBeenCalledWith(71, { enabled: false }));
    await screen.findByRole("button", { name: "Enable Remote React" });
    const sourceRow = screen.getByText("Remote React").closest("article");
    expect(sourceRow).toBeInTheDocument();
    expect(within(sourceRow!).getByText("Disabled")).toBeInTheDocument();
    const enable = within(sourceRow!).getByRole("button", { name: "Enable Remote React" });
    expect(enable).toBeEnabled();
    fireEvent.click(enable);
    await waitFor(() => expect(updateSearchSource).toHaveBeenCalledWith(71, { enabled: true }));
    expect(updateSearchSource).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(within(sourceRow!).getByText("Enabled")).toBeInTheDocument());
  });

  test("keeps entered source fields and shows an English error after a failed save", async () => {
    const createSearchSource = vi.fn().mockRejectedValue(new Error("server rejected source"));
    render(<App api={{ load: vi.fn().mockResolvedValue(dashboard), updateApplication: vi.fn(), createSearchSource }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    fireEvent.click(screen.getByText("Search sources"));
    fireEvent.click(screen.getByRole("button", { name: "Add source" }));
    fireEvent.change(screen.getByLabelText("Source name"), { target: { value: "React Native EU" } });
    fireEvent.change(screen.getByLabelText("Filtered search URL"), { target: { value: "https://jobs.example.com/react-native" } });
    fireEvent.click(screen.getByRole("button", { name: "Save source" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("server rejected source");
    expect(screen.getByLabelText("Source name")).toHaveValue("React Native EU");
    expect(screen.getByLabelText("Filtered search URL")).toHaveValue("https://jobs.example.com/react-native");
  });

  test("rejects an unsafe search URL with one specific inline error", async () => {
    const createSearchSource = vi.fn();
    render(<App api={{ load: vi.fn().mockResolvedValue(dashboard), updateApplication: vi.fn(), createSearchSource }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    fireEvent.click(screen.getByText("Search sources"));
    fireEvent.click(screen.getByRole("button", { name: "Add source" }));
    fireEvent.change(screen.getByLabelText("Source name"), { target: { value: "Unsafe" } });
    fireEvent.change(screen.getByLabelText("Filtered search URL"), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByRole("button", { name: "Save source" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter an HTTP or HTTPS search URL.");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(createSearchSource).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Filtered search URL")).toHaveValue("javascript:alert(1)");
  });

  test("keeps the source draft available to retry a failed dashboard refresh", async () => {
    const load = vi.fn().mockResolvedValueOnce(dashboard).mockRejectedValueOnce(new Error("offline")).mockResolvedValue(dashboard);
    const createSearchSource = vi.fn().mockResolvedValue({});
    render(<App api={{ load, updateApplication: vi.fn(), createSearchSource }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    fireEvent.click(screen.getByText("Search sources"));
    fireEvent.click(screen.getByRole("button", { name: "Add source" }));
    fireEvent.change(screen.getByLabelText("Source name"), { target: { value: "React Native EU" } });
    fireEvent.change(screen.getByLabelText("Filtered search URL"), { target: { value: "https://jobs.example.com/react-native" } });
    fireEvent.click(screen.getByRole("button", { name: "Save source" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Source name")).toHaveValue("React Native EU");
    fireEvent.click(within(screen.getByRole("group", { name: "Add source" })).getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    expect(createSearchSource).toHaveBeenCalledTimes(1);
  });
  test("keeps vacancy names out of visible job action labels", async () => {
    render(<App api={{ load: vi.fn().mockResolvedValue(dashboard), updateApplication: vi.fn(), updateJobTriage: vi.fn(), markJobApplied: vi.fn() }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));

    expect(screen.getByRole("button", { name: "Shortlist Northstar Health Senior React Native Engineer" })).toHaveTextContent(/^Shortlist$/);
    expect(screen.getByRole("button", { name: "Skip Northstar Health Senior React Native Engineer" })).toHaveTextContent(/^Skip$/);
    expect(screen.getByRole("button", { name: "Expire Northstar Health Senior React Native Engineer" })).toHaveTextContent(/^Expire$/);
    expect(screen.getByRole("button", { name: "Mark as applied Northstar Health Senior React Native Engineer" })).toHaveTextContent(/^Mark as applied$/);
  });

  test("generates materials for a new job without applying or changing triage", async () => {
    const packageResult = { docx: { id: 51, format: "docx", download_url: "/api/documents/51/download" }, pdf: { id: 52, format: "pdf", download_url: "/api/documents/52/download" } };
    const generateDocuments = vi.fn().mockResolvedValue(packageResult);
    const markJobApplied = vi.fn();
    const updateJobTriage = vi.fn();
    const api: DashboardApi = { load: vi.fn().mockResolvedValue({ ...dashboard, applications: [], followUps: [], documents: [] }), updateApplication: vi.fn(), markJobApplied, updateJobTriage, generateDocuments };
    render(<App api={api} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    fireEvent.click(screen.getByRole("button", { name: "Materials for Northstar Health Senior React Native Engineer" }));
    const materials = screen.getByRole("region", { name: "Materials for Northstar Health Senior React Native Engineer" });
    fireEvent.change(within(materials).getByRole("combobox", { name: "Document language" }), { target: { value: "German" } });
    fireEvent.click(within(materials).getByRole("button", { name: "Generate application package" }));
    expect(await within(materials).findByRole("link", { name: "Download DOCX resume" })).toHaveAttribute("href", "/api/documents/51/download");
    expect(within(materials).getByRole("link", { name: "Download PDF resume" })).toHaveAttribute("href", "/api/documents/52/download");
    expect(generateDocuments).toHaveBeenCalledExactlyOnceWith(1, "German");
    expect(markJobApplied).not.toHaveBeenCalled();
    expect(updateJobTriage).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Mark as applied Northstar Health Senior React Native Engineer" })).toBeInTheDocument();
  });

  test("generates materials for a shortlisted job without changing its state", async () => {
    const generateDocuments = vi.fn().mockResolvedValue({ docx: { id: 71, format: "docx", download_url: "/api/documents/71/download" }, pdf: { id: 72, format: "pdf", download_url: "/api/documents/72/download" } });
    const markJobApplied = vi.fn();
    const updateJobTriage = vi.fn();
    const shortlistedJob = { ...dashboard.jobs[0], triage_status: "shortlisted" };
    const api: DashboardApi = { load: vi.fn().mockResolvedValue({ ...dashboard, jobs: [shortlistedJob], applications: [], followUps: [], documents: [] }), updateApplication: vi.fn(), markJobApplied, updateJobTriage, generateDocuments };
    render(<App api={api} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    fireEvent.click(screen.getByRole("button", { name: "Shortlisted" }));
    fireEvent.click(screen.getByRole("button", { name: "Materials for Northstar Health Senior React Native Engineer" }));
    const materials = screen.getByRole("region", { name: "Materials for Northstar Health Senior React Native Engineer" });
    fireEvent.click(within(materials).getByRole("button", { name: "Generate application package" }));
    expect(await within(materials).findByRole("link", { name: "Download PDF resume" })).toHaveAttribute("href", "/api/documents/72/download");
    expect(generateDocuments).toHaveBeenCalledExactlyOnceWith(1, "English");
    expect(markJobApplied).not.toHaveBeenCalled();
    expect(updateJobTriage).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Mark as applied Northstar Health Senior React Native Engineer" })).toBeInTheDocument();
  });

  test("materials Retry only reloads documents after an uncertain generation error", async () => {
    const generateDocuments = vi.fn().mockRejectedValue(new Error("Document generation is unavailable on this Mac"));
    const pair = [{ id: 61, job_id: 1, document_type: "resume", language: "en", format: "docx", download_url: "/api/documents/61/download" }, { id: 62, job_id: 1, document_type: "resume", language: "en", format: "pdf", download_url: "/api/documents/62/download" }];
    const details = (documents: typeof pair, activity: Array<Record<string, unknown>>) => ({ job: dashboard.jobs[0], application: null, evidence: [], interviews: [], insights: [], activity, documents });
    const getJobDetails = vi.fn().mockResolvedValueOnce(details([], [])).mockResolvedValueOnce(details(pair, [{ id: 91, action: "documents_generated", details: JSON.stringify({ documentIds: [61, 62], language: "en" }) }]));
    const api: DashboardApi = { load: vi.fn().mockResolvedValue({ ...dashboard, applications: [], followUps: [], documents: [] }), updateApplication: vi.fn(), generateDocuments, getJobDetails };
    render(<App api={api} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    fireEvent.click(screen.getByRole("button", { name: "Materials for Northstar Health Senior React Native Engineer" }));
    const materials = screen.getByRole("region", { name: "Materials for Northstar Health Senior React Native Engineer" });
    fireEvent.click(within(materials).getByRole("button", { name: "Generate application package" }));
    expect(await within(materials).findByRole("alert")).toHaveTextContent("Document generation is unavailable on this Mac");
    fireEvent.click(within(materials).getByRole("button", { name: "Retry" }));
    expect(await within(materials).findByRole("link", { name: "Download DOCX resume" })).toHaveAttribute("href", "/api/documents/61/download");
    expect(within(materials).getByRole("link", { name: "Download PDF resume" })).toHaveAttribute("href", "/api/documents/62/download");
    expect(generateDocuments).toHaveBeenCalledTimes(1);
    expect(getJobDetails).toHaveBeenCalledTimes(2);
    expect(getJobDetails).toHaveBeenNthCalledWith(1, 1);
    expect(getJobDetails).toHaveBeenNthCalledWith(2, 1);
  });

  test("Retry ignores the prior English pair after a failed German attempt and recovers only a new German pair", async () => {
    const english = [{ id: 101, job_id: 1, document_type: "resume", language: "en", format: "docx", download_url: "/api/documents/101/download" }, { id: 102, job_id: 1, document_type: "resume", language: "en", format: "pdf", download_url: "/api/documents/102/download" }];
    const german = [{ id: 103, job_id: 1, document_type: "resume", language: "de", format: "docx", download_url: "/api/documents/103/download" }, { id: 104, job_id: 1, document_type: "resume", language: "de", format: "pdf", download_url: "/api/documents/104/download" }];
    const englishActivity = { id: 201, action: "documents_generated", details: JSON.stringify({ documentIds: [101, 102], language: "en" }) };
    const germanActivity = { id: 202, action: "documents_generated", details: JSON.stringify({ documentIds: [103, 104], language: "de" }) };
    const details = (documents: typeof english, activity: Array<typeof englishActivity>) => ({ job: dashboard.jobs[0], application: null, evidence: [], interviews: [], insights: [], activity, documents });
    const getJobDetails = vi.fn()
      .mockResolvedValueOnce(details([], []))
      .mockResolvedValueOnce(details(english, [englishActivity]))
      .mockResolvedValueOnce(details([...english, german[0]], [englishActivity]))
      .mockResolvedValueOnce(details([...english, ...german], [englishActivity, germanActivity]));
    const generateDocuments = vi.fn()
      .mockResolvedValueOnce({ docx: english[0], pdf: english[1] })
      .mockRejectedValueOnce(new Error("Generation response was lost"));
    const api: DashboardApi = { load: vi.fn().mockResolvedValue({ ...dashboard, applications: [], followUps: [], documents: [] }), updateApplication: vi.fn(), generateDocuments, getJobDetails };
    render(<App api={api} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    fireEvent.click(screen.getByRole("button", { name: "Materials for Northstar Health Senior React Native Engineer" }));
    const materials = screen.getByRole("region", { name: "Materials for Northstar Health Senior React Native Engineer" });
    fireEvent.click(within(materials).getByRole("button", { name: "Generate application package" }));
    expect(await within(materials).findByRole("link", { name: "Download PDF resume" })).toHaveAttribute("href", "/api/documents/102/download");
    fireEvent.change(within(materials).getByRole("combobox", { name: "Document language" }), { target: { value: "German" } });
    fireEvent.click(within(materials).getByRole("button", { name: "Generate application package" }));
    expect(await within(materials).findByRole("alert")).toHaveTextContent("Generation response was lost");
    expect(within(materials).queryByRole("link", { name: /Download.*resume/i })).not.toBeInTheDocument();
    fireEvent.click(within(materials).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(within(materials).getByRole("button", { name: "Retry" })).toBeEnabled());
    expect(getJobDetails).toHaveBeenCalledTimes(3);
    expect(within(materials).getByRole("alert")).toHaveTextContent("Generation response was lost");
    expect(within(materials).queryByRole("link", { name: /Download.*resume/i })).not.toBeInTheDocument();
    fireEvent.click(within(materials).getByRole("button", { name: "Retry" }));
    expect(await within(materials).findByRole("link", { name: "Download DOCX resume" })).toHaveAttribute("href", "/api/documents/103/download");
    expect(within(materials).getByRole("link", { name: "Download PDF resume" })).toHaveAttribute("href", "/api/documents/104/download");
    expect(getJobDetails).toHaveBeenCalledTimes(4);
    expect(generateDocuments).toHaveBeenCalledTimes(2);
    expect(generateDocuments).toHaveBeenNthCalledWith(2, 1, "German");
  });

  test("Retry cannot recover a same-language pair that existed immediately before Generate", async () => {
    const priorPair = [{ id: 111, job_id: 1, document_type: "resume", language: "de", format: "docx", download_url: "/api/documents/111/download" }, { id: 112, job_id: 1, document_type: "resume", language: "de", format: "pdf", download_url: "/api/documents/112/download" }];
    const activity = [{ id: 211, action: "documents_generated", details: JSON.stringify({ documentIds: [111, 112], language: "de" }) }];
    const details = { job: dashboard.jobs[0], application: null, evidence: [], interviews: [], insights: [], activity, documents: priorPair };
    const getJobDetails = vi.fn().mockResolvedValue(details);
    const generateDocuments = vi.fn().mockRejectedValue(new Error("Generation response was lost"));
    const api: DashboardApi = { load: vi.fn().mockResolvedValue({ ...dashboard, applications: [], followUps: [], documents: [] }), updateApplication: vi.fn(), generateDocuments, getJobDetails };
    render(<App api={api} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    fireEvent.click(screen.getByRole("button", { name: "Materials for Northstar Health Senior React Native Engineer" }));
    const materials = screen.getByRole("region", { name: "Materials for Northstar Health Senior React Native Engineer" });
    fireEvent.change(within(materials).getByRole("combobox", { name: "Document language" }), { target: { value: "German" } });
    fireEvent.click(within(materials).getByRole("button", { name: "Generate application package" }));
    expect(await within(materials).findByRole("alert")).toHaveTextContent("Generation response was lost");
    fireEvent.click(within(materials).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(within(materials).getByRole("button", { name: "Retry" })).toBeEnabled());
    expect(within(materials).getByRole("alert")).toHaveTextContent("Generation response was lost");
    expect(within(materials).queryByRole("link", { name: /Download.*resume/i })).not.toBeInTheDocument();
    expect(getJobDetails).toHaveBeenCalledTimes(2);
    expect(generateDocuments).toHaveBeenCalledExactlyOnceWith(1, "German");
  });

  test("an unavailable baseline read blocks POST and does not offer an ineffective recovery Retry", async () => {
    const getJobDetails = vi.fn().mockRejectedValue(new Error("Cannot load documents"));
    const generateDocuments = vi.fn();
    const api: DashboardApi = { load: vi.fn().mockResolvedValue({ ...dashboard, applications: [], followUps: [], documents: [] }), updateApplication: vi.fn(), generateDocuments, getJobDetails };
    render(<App api={api} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    fireEvent.click(screen.getByRole("button", { name: "Materials for Northstar Health Senior React Native Engineer" }));
    const materials = screen.getByRole("region", { name: "Materials for Northstar Health Senior React Native Engineer" });
    fireEvent.click(within(materials).getByRole("button", { name: "Generate application package" }));
    expect(await within(materials).findByRole("alert")).toHaveTextContent("Cannot load documents");
    expect(within(materials).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(within(materials).getByRole("button", { name: "Generate application package" })).toBeEnabled();
    expect(generateDocuments).not.toHaveBeenCalled();
  });

  test("collapsing Materials during generation preserves the result for reopening", async () => {
    const pending = deferred<{ docx: { id: number; format: string; download_url: string }; pdf: { id: number; format: string; download_url: string } }>();
    const generateDocuments = vi.fn().mockReturnValue(pending.promise);
    const api: DashboardApi = { load: vi.fn().mockResolvedValue({ ...dashboard, applications: [], followUps: [], documents: [] }), updateApplication: vi.fn(), generateDocuments, getJobDetails: vi.fn().mockResolvedValue({ job: dashboard.jobs[0], application: null, evidence: [], interviews: [], insights: [], activity: [], documents: [] }) };
    render(<App api={api} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    const toggle = screen.getByRole("button", { name: "Materials for Northstar Health Senior React Native Engineer" });
    fireEvent.click(toggle);
    const materials = screen.getByRole("region", { name: "Materials for Northstar Health Senior React Native Engineer" });
    fireEvent.click(within(materials).getByRole("button", { name: "Generate application package" }));
    expect(await within(materials).findByRole("button", { name: "Generating package…" })).toBeDisabled();
    fireEvent.click(toggle);
    expect(screen.queryByRole("region", { name: "Materials for Northstar Health Senior React Native Engineer" })).not.toBeInTheDocument();
    await act(async () => pending.resolve({ docx: { id: 81, format: "docx", download_url: "/api/documents/81/download" }, pdf: { id: 82, format: "pdf", download_url: "/api/documents/82/download" } }));
    fireEvent.click(toggle);
    const reopened = screen.getByRole("region", { name: "Materials for Northstar Health Senior React Native Engineer" });
    expect(within(reopened).getByRole("link", { name: "Download DOCX resume" })).toHaveAttribute("href", "/api/documents/81/download");
    expect(within(reopened).getByRole("link", { name: "Download PDF resume" })).toHaveAttribute("href", "/api/documents/82/download");
    expect(generateDocuments).toHaveBeenCalledTimes(1);
  });

  test("document API client posts only to the package endpoint", async () => {
    const response = { ok: true, status: 201, json: async () => ({ docx: { id: 1 }, pdf: { id: 2 } }) };
    const fetcher = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetcher);
    try {
      await defaultApi.generateDocuments!(8, "German");
      expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/jobs/8/documents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ language: "German" }) });
    } finally { vi.unstubAllGlobals(); }
  });
  test("generates English or German package on explicit action and exposes only successful links", async () => {
    const pending = deferred<{ docx: { id: number; format: string; download_url: string }; pdf: { id: number; format: string; download_url: string } }>();
    const generateDocuments = vi.fn().mockReturnValueOnce(pending.promise).mockRejectedValueOnce(new Error("Document generation is unavailable on this Mac"));
    const api: DashboardApi = { load: vi.fn().mockResolvedValue(dashboard), updateApplication: vi.fn(), generateDocuments };
    render(<App api={api} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(screen.getByRole("button", { name: "Details for Acme — Senior React Engineer" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Generate application package" }));
    expect(within(dialog).getByRole("button", { name: "Generating package…" })).toBeDisabled();
    await waitFor(() => expect(generateDocuments).toHaveBeenCalledWith(1, "English"));
    await act(async () => pending.resolve({ docx: { id: 41, format: "docx", download_url: "/api/documents/41/download" }, pdf: { id: 42, format: "pdf", download_url: "/api/documents/42/download" } }));
    expect(within(dialog).getByRole("link", { name: /Download DOCX resume/i })).toHaveAttribute("href", "/api/documents/41/download");
    expect(within(dialog).getByRole("link", { name: /Download PDF resume/i })).toHaveAttribute("href", "/api/documents/42/download");
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Document language" }), { target: { value: "German" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Generate application package" }));
    await waitFor(() => expect(generateDocuments).toHaveBeenCalledWith(1, "German"));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Document generation is unavailable on this Mac");
    expect(within(dialog).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("link", { name: /Download.*resume/i })).not.toBeInTheDocument();
  });
  test("pipeline separates active, unknown and archive, and restores card focus after detail closes", async () => {
    const applications = [dashboard.applications[0],
      { ...dashboard.applications[0], id: 8, job_id: 8, company: "Rejected Co", status: "rejected" },
      { ...dashboard.applications[0], id: 9, job_id: 9, company: "Withdrawn Co", status: "withdrawn" },
      { ...dashboard.applications[0], id: 10, job_id: 10, company: "Unknown Co", status: "unknown" }];
    const pipeline = { active: [applications[0]], needsAttention: [applications[3]], archive: [applications[1], applications[2]] };
    const detail = { job: { id: 1, company: "Acme", title: "Senior React Engineer" }, application: applications[0], evidence: [{ id: 11, sender: "recruiter@example.com", subject: "Antwort", snippet: "Wir sprechen morgen", received_at: "2026-09-20T09:00:00.000Z" }], interviews: [{ ...dashboard.interviews[0], application_id: 7 }], insights: [{ ...dashboard.insightDetails[0], interview_event_id: 12 }], documents: [{ id: 30, job_id: 1, document_type: "resume", format: "pdf", version: "v1", download_url: "/api/documents/30/download" }], activity: [{ id: 40, action: "updated", created_at: "2026-09-23T09:00:00.000Z", source: "manual" }] };
    const api: DashboardApi = { load: vi.fn().mockResolvedValue({ ...dashboard, applications, pipeline }), getJobDetails: vi.fn().mockResolvedValue(detail), updateApplication: vi.fn() };
    render(<App api={api} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Pipeline" }));
    const active = screen.getByRole("region", { name: "Active applications" });
    expect(within(active).getByText("Acme")).toBeInTheDocument();
    expect(within(active).queryByText("Rejected Co")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Needs attention" })).toHaveTextContent("Unknown Co");
    expect(screen.queryByText("Withdrawn Co")).not.toBeInTheDocument();
    const trigger = within(active).getByRole("button", { name: "Details for Acme — Senior React Engineer" });
    fireEvent.click(trigger);
    expect(await screen.findByText("Wir sprechen morgen")).toBeInTheDocument();
    const drawer = screen.getByRole("dialog", { name: "Acme application details" });
    expect(within(drawer).getAllByText("Strong communication; improve mobile architecture.")).toHaveLength(2);
    expect(within(drawer).getByRole("link", { name: /Download.*resume/i })).toHaveAttribute("href", "/api/documents/30/download");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(screen.getByRole("region", { name: "Archived applications" })).toHaveTextContent("Rejected Co");
    expect(screen.getByRole("region", { name: "Archived applications" })).toHaveTextContent("Withdrawn Co");
  });
  test("ordinary Pipeline navigation opens the active view", async () => {
    const rejected = { ...dashboard.applications[0], status: "rejected", company: "Rejected Co" };
    const appliedJob = { ...dashboard.jobs[0], application_id: 7, application_status: "rejected" };
    render(<App api={{ load: vi.fn().mockResolvedValue({ ...dashboard, jobs: [appliedJob], applications: [rejected] }), updateApplication: vi.fn() }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    fireEvent.click(screen.getByRole("button", { name: "Applied" }));
    fireEvent.click(screen.getByRole("button", { name: "View in Pipeline" }));
    expect(screen.getByRole("button", { name: "Archive" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close details" }));
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Today" }));
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Pipeline" }));
    expect(screen.getByRole("button", { name: "Active" })).toHaveAttribute("aria-pressed", "true");
  });
  test("failed pipeline status retains the saved stage and can retry", async () => {
    const updateApplication = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({});
    const load = vi.fn().mockResolvedValue(dashboard);
    render(<App api={{ load, updateApplication }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Pipeline" }));
    const status = screen.getByRole("combobox", { name: "Status for Acme" });
    fireEvent.change(status, { target: { value: "technical_interview" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(status).toHaveValue("applied");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(updateApplication).toHaveBeenCalledTimes(2));
    expect(updateApplication).toHaveBeenLastCalledWith(7, { status: "technical_interview" });
  });
  test("repeated pipeline failure keeps the retry available", async () => {
    const updateApplication = vi.fn().mockRejectedValue(new Error("offline"));
    render(<App api={{ load: vi.fn().mockResolvedValue(dashboard), updateApplication }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Pipeline" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Status for Acme" }), { target: { value: "technical_interview" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(updateApplication).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("alert")).toHaveTextContent("offline");
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  });
  test("pending follow-up is overdue even without a free-text next step", async () => {
    const due = { ...dashboard.applications[0], next_step: null, next_step_due_at: "2020-01-01T09:00:00.000Z", next_follow_up_sequence: 1 };
    render(<App api={{ load: vi.fn().mockResolvedValue({ ...dashboard, pipeline: { active: [due], needsAttention: [], archive: [] } }), updateApplication: vi.fn() }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Pipeline" }));
    expect(screen.getByRole("region", { name: "Active applications" })).toHaveTextContent("Overdue");
  });

  test("archive does not label terminal applications as overdue", async () => {
    const archived = { ...dashboard.applications[0], status: "rejected", next_step_due_at: "2020-01-01T09:00:00.000Z", next_follow_up_sequence: 1 };
    render(<App api={{ load: vi.fn().mockResolvedValue({ ...dashboard, pipeline: { active: [], needsAttention: [], archive: [archived] } }), updateApplication: vi.fn() }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Pipeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(screen.getByRole("region", { name: "Archived applications" })).not.toHaveTextContent("Overdue");
  });

  test("Today attention uses a concise visible Details label", async () => {
    render(<App api={{ load: vi.fn().mockResolvedValue(dashboard), updateApplication: vi.fn() }} />);
    await screen.findByRole("heading", { name: "Needs attention" });
    const button = screen.getByRole("button", { name: "Details for Acme — Senior React Engineer" });
    expect(button).toHaveTextContent(/^Details$/);
  });

  test("archive date filter uses the terminal event date", async () => {
    const archived = { ...dashboard.applications[0], status: "rejected", updated_at: "2026-09-24T09:00:00.000Z", archived_at: "2026-09-20T09:00:00.000Z" };
    render(<App api={{ load: vi.fn().mockResolvedValue({ ...dashboard, pipeline: { active: [], needsAttention: [], archive: [archived] } }), updateApplication: vi.fn() }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Pipeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-09-22" } });
    expect(screen.getByRole("region", { name: "Archived applications" })).not.toHaveTextContent("Acme");
  });

  test("loading and error detail modals keep keyboard focus inside", async () => {
    const pending = deferred<never>();
    const getJobDetails = vi.fn().mockReturnValueOnce(pending.promise).mockRejectedValueOnce(new Error("offline"));
    render(<App api={{ load: vi.fn().mockResolvedValue(dashboard), updateApplication: vi.fn(), getJobDetails }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Pipeline" }));
    const trigger = screen.getByRole("button", { name: "Details for Acme — Senior React Engineer" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Acme application details" });
    const close = within(dialog).getByRole("button", { name: "Close details" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
    pending.reject(new Error("offline"));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("offline");
    const retry = within(dialog).getByRole("button", { name: "Retry loading details" });
    retry.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(retry).toHaveFocus();
  });
  test("stale successful detail refresh keeps saved fields and retries only the read", async () => {
    const saved = { ...dashboard.applications[0], next_step: "Call recruiter", rejection_reason: null, decision: null };
    const confirmed = { ...dashboard, applications: [saved] };
    const detail = { job: dashboard.jobs[0], application: dashboard.applications[0], evidence: [], interviews: [], insights: [], documents: [], activity: [] };
    const load = vi.fn().mockResolvedValueOnce(dashboard).mockResolvedValueOnce(dashboard).mockResolvedValueOnce(confirmed);
    const updateApplication = vi.fn().mockResolvedValue(saved);
    const getJobDetails = vi.fn().mockResolvedValueOnce(detail).mockResolvedValue({ ...detail, application: saved });
    render(<App api={{ load, updateApplication, getJobDetails }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Pipeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Details for Acme — Senior React Engineer" }));
    await screen.findByLabelText("Next step");
    const dialog = screen.getByRole("dialog", { name: "Acme application details" });
    fireEvent.change(within(dialog).getByLabelText("Next step"), { target: { value: "Call recruiter" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Saved, but unable to refresh dashboard");
    expect(within(dialog).getByLabelText("Next step")).toHaveValue("Call recruiter");
    expect(screen.getByRole("region", { name: "Active applications" })).toHaveTextContent("Next step: Call recruiter");
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    expect(updateApplication).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument());
  });
  test("reopened details can clear a pending save through read-only Retry", async () => {
    const saved = { ...dashboard.applications[0], next_step: "Call recruiter", rejection_reason: null, decision: null };
    const initialDetail = { job: dashboard.jobs[0], application: dashboard.applications[0], evidence: [], interviews: [], insights: [], documents: [], activity: [] };
    const getJobDetails = vi.fn().mockResolvedValueOnce(initialDetail).mockResolvedValue({ ...initialDetail, application: saved });
    const load = vi.fn().mockResolvedValueOnce(dashboard).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(dashboard).mockResolvedValueOnce({ ...dashboard, applications: [saved] });
    const updateApplication = vi.fn().mockResolvedValue(saved);
    render(<App api={{ load, getJobDetails, updateApplication }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Pipeline" }));
    const trigger = screen.getByRole("button", { name: "Details for Acme — Senior React Engineer" });
    fireEvent.click(trigger);
    await screen.findByLabelText("Next step");
    fireEvent.change(screen.getByLabelText("Next step"), { target: { value: "Call recruiter" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved, but unable to refresh dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    await waitFor(() => expect(trigger).toHaveFocus());
    fireEvent.click(trigger);
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved, but unable to refresh dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Retry loading details" }));
    expect(await screen.findByLabelText("Next step")).toHaveValue("Call recruiter");
    expect(updateApplication).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(4);
    expect(getJobDetails).toHaveBeenCalledTimes(2);
    expect(load.mock.invocationCallOrder[3]).toBeLessThan(getJobDetails.mock.invocationCallOrder[1]);
  });
  test("a saved interview note stays locked through failed refresh, reopen and GET-only retry", async () => {
    const interview = { ...dashboard.interviews[0], application_id: 7 };
    const base = { ...dashboard, interviews: [interview], insightDetails: [] };
    const created = { id: 99, interview_event_id: 12, category: "system_design", text: "A new note", source_type: "user_note", confidence: 1 };
    const confirmed = { ...base, insightDetails: [created] };
    const initialDetail = { job: dashboard.jobs[0], application: dashboard.applications[0], evidence: [], interviews: [interview], insights: [], documents: [], activity: [] };
    const getJobDetails = vi.fn().mockResolvedValueOnce(initialDetail).mockResolvedValue({ ...initialDetail, insights: [created] });
    const load = vi.fn().mockResolvedValueOnce(base).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(base).mockResolvedValueOnce(confirmed);
    const post = deferred<typeof created>();
    const addInterviewNote = vi.fn().mockReturnValue(post.promise);
    render(<App api={{ load, getJobDetails, updateApplication: vi.fn(), addInterviewNote }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Pipeline" }));
    const trigger = screen.getByRole("button", { name: "Details for Acme — Senior React Engineer" });
    fireEvent.click(trigger);
    const input = await screen.findByLabelText("Note for Acme");
    fireEvent.change(input, { target: { value: "A new note" } });
    const add = screen.getByRole("button", { name: "Add note" });
    fireEvent.click(add);
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(addInterviewNote).toHaveBeenCalledTimes(1);
    await act(async () => post.resolve(created));
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved, but unable to refresh dashboard");
    expect(screen.getByRole("button", { name: "Add note" })).toBeDisabled();
    expect(screen.getByLabelText("Note for Acme")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    await waitFor(() => expect(trigger).toHaveFocus());
    fireEvent.click(trigger);
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved, but unable to refresh dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Retry loading details" }));
    expect(await screen.findByText("A new note")).toBeInTheDocument();
    expect(addInterviewNote).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Note for Acme"), { target: { value: "Another note" } });
    expect(screen.getByRole("button", { name: "Add note" })).toBeEnabled();
  });

  test("failed interview-note POST releases its lock and retains the draft", async () => {
    const interview = { ...dashboard.interviews[0], application_id: 7 };
    const detail = { job: dashboard.jobs[0], application: dashboard.applications[0], evidence: [], interviews: [interview], insights: [], documents: [], activity: [] };
    const addInterviewNote = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ id: 99, interview_event_id: 12, text: "Draft note" });
    render(<App api={{ load: vi.fn().mockResolvedValue({ ...dashboard, interviews: [interview] }), getJobDetails: vi.fn().mockResolvedValue(detail), updateApplication: vi.fn(), addInterviewNote }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Pipeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Details for Acme — Senior React Engineer" }));
    fireEvent.change(await screen.findByLabelText("Note for Acme"), { target: { value: "Draft note" } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(screen.getByLabelText("Note for Acme")).toHaveValue("Draft note");
    expect(screen.getByRole("button", { name: "Add note" })).toBeEnabled();
  });

  test("late document baseline cannot replace a confirmed interview note", async () => {
    const interview = { ...dashboard.interviews[0], application_id: 7 };
    const note = { id: 99, interview_event_id: 12, category: "system_design", text: "Confirmed note", source_type: "user_note", confidence: 1 };
    const base = { ...dashboard, interviews: [interview], insightDetails: [] };
    const confirmed = { ...base, insightDetails: [note] };
    const initialDetail = { job: dashboard.jobs[0], application: dashboard.applications[0], evidence: [], interviews: [interview], insights: [], documents: [], activity: [] };
    const delayedBaseline = deferred<typeof initialDetail>();
    const getJobDetails = vi.fn().mockResolvedValueOnce(initialDetail).mockReturnValueOnce(delayedBaseline.promise).mockResolvedValue({ ...initialDetail, insights: [note] });
    render(<App api={{ load: vi.fn().mockResolvedValueOnce(base).mockResolvedValue(confirmed), updateApplication: vi.fn(), getJobDetails, addInterviewNote: vi.fn().mockResolvedValue(note), generateDocuments: vi.fn().mockResolvedValue({ docx: { id: 51, format: "docx", download_url: "/api/documents/51/download" }, pdf: { id: 52, format: "pdf", download_url: "/api/documents/52/download" } }) }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Pipeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Details for Acme — Senior React Engineer" }));
    fireEvent.change(await screen.findByLabelText("Note for Acme"), { target: { value: "Confirmed note" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate application package" }));
    await waitFor(() => expect(getJobDetails).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    expect(await screen.findByText("Confirmed note")).toBeInTheDocument();
    await act(async () => delayedBaseline.resolve(initialDetail));
    expect(screen.getByText("Confirmed note")).toBeInTheDocument();
  });

  test.each([
    ["spring DST", "2026-03-28T23:30:00.000Z", "2026-03-29"],
    ["autumn DST", "2026-10-24T22:30:00.000Z", "2026-10-25"]
  ])("archive filtering uses the Berlin day at %s", async (_label, archivedAt, fromDate) => {
    const archived = { ...dashboard.applications[0], status: "rejected", archived_at: archivedAt };
    render(<App api={{ load: vi.fn().mockResolvedValue({ ...dashboard, pipeline: { active: [], needsAttention: [], archive: [archived] } }), updateApplication: vi.fn() }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Pipeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: fromDate } });
    expect(screen.getByRole("region", { name: "Archived applications" })).toHaveTextContent("Acme");
  });
  test("an older status refresh cannot overwrite a newer authoritative dashboard", async () => {
    const staleStatusLoad = deferred<typeof dashboard>();
    const confirmed = {
      ...dashboard,
      applications: [{ ...dashboard.applications[0], status: "technical_interview" }],
      pipeline: { active: [{ ...dashboard.applications[0], status: "technical_interview" }], needsAttention: [], archive: [] },
      jobs: dashboard.jobs.map((job) => job.id === 1 ? { ...job, triage_status: "shortlisted" } : job),
      today: { ...dashboard.today, applyToday: dashboard.today.applyToday.map((job) => job.id === 1 ? { ...job, triage_status: "shortlisted" } : job) }
    };
    const load = vi.fn().mockResolvedValueOnce(dashboard).mockReturnValueOnce(staleStatusLoad.promise).mockResolvedValueOnce(confirmed);
    const updateApplication = vi.fn().mockResolvedValue({ status: "technical_interview" });
    render(<App api={{ load, updateApplication, updateJobTriage: vi.fn().mockResolvedValue({}) }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Pipeline" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Status for Acme" }), { target: { value: "technical_interview" } });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Today" }));
    fireEvent.click(screen.getByRole("button", { name: "Shortlist Northstar Health Senior React Native Engineer" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    staleStatusLoad.resolve(dashboard);
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Pipeline" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Status for Acme" })).toHaveValue("technical_interview"));
    expect(screen.getByRole("combobox", { name: "Status for Acme" })).toBeEnabled();
  });
  test("failed detail save keeps the edit open and retries without changing the pipeline", async () => {
    const updateApplication = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({});
    render(<App api={{ load: vi.fn().mockResolvedValue(dashboard), updateApplication }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Pipeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Details for Acme — Senior React Engineer" }));
    const drawer = screen.getByRole("dialog", { name: "Acme application details" });
    fireEvent.change(within(drawer).getByLabelText("Next step"), { target: { value: "Call recruiter" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "Save" }));
    expect(await within(drawer).findByRole("alert")).toHaveTextContent("offline");
    expect(within(drawer).getByLabelText("Next step")).toHaveValue("Call recruiter");
    fireEvent.click(within(drawer).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(updateApplication).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("combobox", { name: "Status for Acme" })).toHaveValue("applied");
  });
  test("shows the four server-derived Today sections and caps application candidates", async () => {
    const manyJobs = Array.from({ length: 7 }, (_, index) => ({ ...dashboard.today.applyToday[0], id: index + 20, company: `Candidate ${index}` }));
    const api: DashboardApi = { load: vi.fn().mockResolvedValue({ ...dashboard, today: { ...dashboard.today, applyToday: manyJobs } }), updateApplication: vi.fn() };
    render(<App api={api} />);
    await screen.findByRole("heading", { name: "Apply today" });
    for (const heading of ["Follow up today", "Needs attention", "Application progress"]) expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Shortlist Candidate/ })).toHaveLength(5);
    expect(screen.queryByText("Candidate 5")).not.toBeInTheDocument();
  });

  test("shows the search health and today's actions", async () => {
    const api: DashboardApi = { load: vi.fn().mockResolvedValue(dashboard), updateApplication: vi.fn() };
    render(<App api={api} />);
    const progressHeading = await screen.findByRole("heading", { name: "Application progress" });
    expect(progressHeading).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Last 30 days" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "All time" })).toBeInTheDocument();
    expect(within(progressHeading.closest("section")!).queryAllByText("offers")).toHaveLength(0);
    expect(screen.getAllByText("Acme").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Follow up today" })).toBeInTheDocument();
  });

  test("opens vacancy URLs and does not show a fake link when a URL is missing", async () => {
    const api: DashboardApi = { load: vi.fn().mockResolvedValue(dashboard), updateApplication: vi.fn() };
    render(<App api={api} />);
    await screen.findByRole("heading", { name: "Today" });
    const todayLink = screen.getByRole("link", { name: "Open Northstar Health vacancy" });
    expect(todayLink).toHaveAttribute("href", "https://jobs.example.com/northstar-mobile");
    expect(todayLink).toHaveAttribute("target", "_blank");
    expect(screen.getByText("Link unavailable")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Jobs/i }));
    const jobsLink = screen.getByRole("link", { name: "Open Northstar Health vacancy" });
    expect(jobsLink).toHaveAttribute("href", "https://jobs.example.com/northstar-mobile");
    expect(screen.getByText("Link unavailable")).toBeInTheDocument();
  });

  test("shortlisting replaces the dashboard with freshly loaded state", async () => {
    const refreshed = { ...dashboard, today: { ...dashboard.today, applyToday: dashboard.today.applyToday.slice(1) } };
    const load = vi.fn().mockResolvedValueOnce(dashboard).mockResolvedValueOnce(refreshed);
    const updateJobTriage = vi.fn().mockResolvedValue({});
    render(<App api={{ load, updateApplication: vi.fn(), updateJobTriage }} />);
    await screen.findByRole("heading", { name: "Apply today" });
    fireEvent.click(screen.getByRole("button", { name: /Shortlist Northstar Health Senior React Native Engineer/ }));
    await waitFor(() => expect(screen.queryByText("Northstar Health")).not.toBeInTheDocument());
    expect(updateJobTriage).toHaveBeenCalledWith(1, "shortlisted");
    expect(load).toHaveBeenCalledTimes(2);
  });

  test("finishing a follow-up removes it after a fresh dashboard load", async () => {
    const refreshed = { ...dashboard, today: { ...dashboard.today, followUpToday: [] } };
    const updateFollowUp = vi.fn().mockResolvedValue({});
    render(<App api={{ load: vi.fn().mockResolvedValueOnce(dashboard).mockResolvedValueOnce(refreshed), updateApplication: vi.fn(), updateFollowUp }} />);
    await screen.findByRole("heading", { name: "Follow up today" });
    fireEvent.click(screen.getByRole("button", { name: "Done Acme Senior React Engineer #1" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Done Acme Senior React Engineer #1" })).not.toBeInTheDocument());
    expect(updateFollowUp).toHaveBeenCalledWith(9, { action: "done" });
  });

  test("snoozes a follow-up to an ISO date", async () => {
    const updateFollowUp = vi.fn().mockResolvedValue({});
    render(<App api={{ load: vi.fn().mockResolvedValue(dashboard), updateApplication: vi.fn(), updateFollowUp }} />);
    await screen.findByRole("heading", { name: "Follow up today" });
    fireEvent.change(screen.getByLabelText("Snooze until for Acme Senior React Engineer #1"), { target: { value: "2026-09-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Snooze Acme Senior React Engineer #1" }));
    await waitFor(() => expect(updateFollowUp).toHaveBeenCalledWith(9, { action: "snooze", dueAt: "2026-09-30T12:00:00.000Z" }));
  });

  test("keeps a failed action visible and offers retry without disabling other actions", async () => {
    const updateJobTriage = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({});
    const load = vi.fn().mockResolvedValue(dashboard);
    render(<App api={{ load, updateApplication: vi.fn(), updateJobTriage }} />);
    await screen.findByRole("heading", { name: "Apply today" });
    fireEvent.click(screen.getByRole("button", { name: /Shortlist Northstar Health Senior React Native Engineer/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save changes");
    expect(screen.getByText("Northstar Health")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Skip Northstar Health Senior React Native Engineer/ })).toBeEnabled();
    expect(load).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(updateJobTriage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  test("retries only dashboard refresh after a follow-up decision was saved", async () => {
    const refreshed = { ...dashboard, today: { ...dashboard.today, followUpToday: [] } };
    const load = vi.fn().mockResolvedValueOnce(dashboard).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(refreshed);
    const updateFollowUp = vi.fn().mockResolvedValue({});
    render(<App api={{ load, updateApplication: vi.fn(), updateFollowUp }} />);
    await screen.findByRole("heading", { name: "Follow up today" });
    fireEvent.click(screen.getByRole("button", { name: "Done Acme Senior React Engineer #1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved, but unable to refresh dashboard");
    expect(screen.getByRole("button", { name: "Done Acme Senior React Engineer #1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Dismiss Acme Senior React Engineer #1" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Done Acme Senior React Engineer #1" })).not.toBeInTheDocument());
    expect(updateFollowUp).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(3);
  });

  test("a saved follow-up stays locked across Today navigation until authoritative refresh", async () => {
    const refreshed = { ...dashboard, today: { ...dashboard.today, followUpToday: [] }, followUps: [] };
    const load = vi.fn().mockResolvedValueOnce(dashboard).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(refreshed);
    const updateFollowUp = vi.fn().mockResolvedValue({});
    render(<App api={{ load, updateApplication: vi.fn(), updateFollowUp }} />);
    await screen.findByRole("heading", { name: "Follow up today" });
    fireEvent.click(screen.getByRole("button", { name: "Done Acme Senior React Engineer #1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved, but unable to refresh dashboard");
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Today" }));
    expect(screen.getByRole("button", { name: "Done Acme Senior React Engineer #1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Dismiss Acme Senior React Engineer #1" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Done Acme Senior React Engineer #1" })).not.toBeInTheDocument());
    expect(updateFollowUp).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(3);
  });

  test("a saved job action locks triage and apply across navigation, then unlocks after confirmed refresh", async () => {
    const refreshed = {
      ...dashboard,
      jobs: dashboard.jobs.map((job) => job.id === 1 ? { ...job, triage_status: "shortlisted" } : job),
      today: { ...dashboard.today, applyToday: dashboard.today.applyToday.map((job) => job.id === 1 ? { ...job, triage_status: "shortlisted" } : job) }
    };
    const load = vi.fn().mockResolvedValueOnce(dashboard).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(refreshed);
    const updateJobTriage = vi.fn().mockResolvedValue({});
    const markJobApplied = vi.fn();
    render(<App api={{ load, updateApplication: vi.fn(), updateJobTriage, markJobApplied }} />);
    await screen.findByRole("heading", { name: "Apply today" });
    fireEvent.click(screen.getByRole("button", { name: "Shortlist Northstar Health Senior React Native Engineer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved, but unable to refresh dashboard");
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    expect(screen.getByRole("button", { name: "Skip Northstar Health Senior React Native Engineer" })).toBeDisabled();
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Today" }));
    const skip = screen.getByRole("button", { name: "Skip Northstar Health Senior React Native Engineer" });
    const applied = screen.getByRole("button", { name: "Mark as applied Northstar Health Senior React Native Engineer" });
    expect(skip).toBeDisabled();
    expect(applied).toBeDisabled();
    fireEvent.click(skip);
    fireEvent.click(applied);
    expect(updateJobTriage).toHaveBeenCalledTimes(1);
    expect(markJobApplied).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(skip).toBeEnabled());
    expect(applied).toBeEnabled();
    expect(updateJobTriage).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(3);
  });

  test("a successful but stale reload does not clear the saved job lock", async () => {
    const refreshed = { ...dashboard, jobs: dashboard.jobs.map((job) => job.id === 1 ? { ...job, triage_status: "skipped" } : job), today: { ...dashboard.today, applyToday: dashboard.today.applyToday.slice(1) } };
    const load = vi.fn().mockResolvedValueOnce(dashboard).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(dashboard).mockResolvedValueOnce(refreshed);
    const updateJobTriage = vi.fn().mockResolvedValue({});
    render(<App api={{ load, updateApplication: vi.fn(), updateJobTriage }} />);
    await screen.findByRole("heading", { name: "Apply today" });
    fireEvent.click(screen.getByRole("button", { name: "Skip Northstar Health Senior React Native Engineer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved, but unable to refresh dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("button", { name: "Mark as applied Northstar Health Senior React Native Engineer" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Skip Northstar Health Senior React Native Engineer" })).not.toBeInTheDocument());
    expect(updateJobTriage).toHaveBeenCalledTimes(1);
  });

  test("mark as applied also locks job triage across navigation until refresh confirms the application", async () => {
    const refreshed = {
      ...dashboard,
      jobs: dashboard.jobs.map((job) => job.id === 1 ? { ...job, application_id: 42, application_status: "applied" } : job),
      applications: [...dashboard.applications, { id: 42, job_id: 1, company: "Northstar Health", title: "Senior React Native Engineer", status: "applied" }],
      today: { ...dashboard.today, applyToday: dashboard.today.applyToday.slice(1) }
    };
    const load = vi.fn().mockResolvedValueOnce(dashboard).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(refreshed);
    const markJobApplied = vi.fn().mockResolvedValue({});
    const updateJobTriage = vi.fn();
    render(<App api={{ load, updateApplication: vi.fn(), markJobApplied, updateJobTriage }} />);
    await screen.findByRole("heading", { name: "Apply today" });
    fireEvent.click(screen.getByRole("button", { name: "Mark as applied Northstar Health Senior React Native Engineer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved, but unable to refresh dashboard");
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Today" }));
    expect(screen.getByRole("button", { name: "Shortlist Northstar Health Senior React Native Engineer" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Skip Northstar Health Senior React Native Engineer" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Mark as applied Northstar Health Senior React Native Engineer" })).not.toBeInTheDocument());
    expect(markJobApplied).toHaveBeenCalledTimes(1);
    expect(updateJobTriage).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(3);
  });

  test("reserves a job before the write resolves and releases it if the write fails", async () => {
    const pendingWrite = deferred<unknown>();
    const updateJobTriage = vi.fn().mockReturnValue(pendingWrite.promise);
    const markJobApplied = vi.fn();
    render(<App api={{ load: vi.fn().mockResolvedValue(dashboard), updateApplication: vi.fn(), updateJobTriage, markJobApplied }} />);
    await screen.findByRole("heading", { name: "Apply today" });
    const shortlist = screen.getByRole("button", { name: "Shortlist Northstar Health Senior React Native Engineer" });
    const skip = screen.getByRole("button", { name: "Skip Northstar Health Senior React Native Engineer" });
    const applied = screen.getByRole("button", { name: "Mark as applied Northstar Health Senior React Native Engineer" });
    act(() => { fireEvent.click(shortlist); fireEvent.click(skip); fireEvent.click(applied); });
    expect(skip).toBeDisabled();
    expect(applied).toBeDisabled();
    expect(updateJobTriage).toHaveBeenCalledTimes(1);
    expect(markJobApplied).not.toHaveBeenCalled();
    pendingWrite.reject(new Error("offline"));
    expect((await screen.findAllByRole("alert")).some((alert) => alert.textContent?.includes("Unable to save changes"))).toBe(true);
    await waitFor(() => expect(skip).toBeEnabled());
    expect(applied).toBeEnabled();
  });

  test("reserves a follow-up before the write resolves and releases it on failure", async () => {
    const pendingWrite = deferred<unknown>();
    const updateFollowUp = vi.fn().mockReturnValue(pendingWrite.promise);
    render(<App api={{ load: vi.fn().mockResolvedValue(dashboard), updateApplication: vi.fn(), updateFollowUp }} />);
    await screen.findByRole("heading", { name: "Follow up today" });
    const done = screen.getByRole("button", { name: "Done Acme Senior React Engineer #1" });
    const dismiss = screen.getByRole("button", { name: "Dismiss Acme Senior React Engineer #1" });
    const openDraft = screen.getByRole("button", { name: "Open reply & copy draft Acme Senior React Engineer #1" });
    act(() => { fireEvent.click(done); fireEvent.click(dismiss); });
    expect(dismiss).toBeDisabled();
    expect(openDraft).toBeDisabled();
    expect(updateFollowUp).toHaveBeenCalledTimes(1);
    pendingWrite.reject(new Error("offline"));
    expect((await screen.findAllByRole("alert")).some((alert) => alert.textContent?.includes("Unable to save changes"))).toBe(true);
    await waitFor(() => expect(dismiss).toBeEnabled());
    expect(openDraft).toBeEnabled();
  });

  test("an older GET cannot overwrite a newer authoritative GET", async () => {
    const older = deferred<typeof dashboard>();
    const newer = deferred<typeof dashboard>();
    const authoritative = {
      ...dashboard,
      jobs: dashboard.jobs.map((job) => job.id === 1 ? { ...job, triage_status: "skipped" } : job),
      followUps: [],
      today: { ...dashboard.today, applyToday: dashboard.today.applyToday.slice(1), followUpToday: [] }
    };
    const load = vi.fn().mockResolvedValueOnce(dashboard).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const updateJobTriage = vi.fn().mockResolvedValue({});
    const updateFollowUp = vi.fn().mockResolvedValue({});
    render(<App api={{ load, updateApplication: vi.fn(), updateJobTriage, updateFollowUp }} />);
    await screen.findByRole("heading", { name: "Apply today" });
    fireEvent.click(screen.getByRole("button", { name: "Skip Northstar Health Senior React Native Engineer" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Done Acme Senior React Engineer #1" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    newer.resolve(authoritative);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Skip Northstar Health Senior React Native Engineer" })).not.toBeInTheDocument());
    older.resolve(dashboard);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Done Acme Senior React Engineer #1" })).not.toBeInTheDocument());
    expect(screen.queryByText("Northstar Health")).not.toBeInTheDocument();
    expect(updateJobTriage).toHaveBeenCalledTimes(1);
    expect(updateFollowUp).toHaveBeenCalledTimes(1);
  });

  test("an older successful GET cannot clear locks after the newest GET fails", async () => {
    const older = deferred<typeof dashboard>();
    const newer = deferred<typeof dashboard>();
    const authoritative = {
      ...dashboard,
      jobs: dashboard.jobs.map((job) => job.id === 1 ? { ...job, triage_status: "skipped" } : job),
      followUps: [],
      today: { ...dashboard.today, applyToday: dashboard.today.applyToday.slice(1), followUpToday: [] }
    };
    const load = vi.fn().mockResolvedValueOnce(dashboard).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise).mockResolvedValueOnce(authoritative);
    const updateJobTriage = vi.fn().mockResolvedValue({});
    const updateFollowUp = vi.fn().mockResolvedValue({});
    render(<App api={{ load, updateApplication: vi.fn(), updateJobTriage, updateFollowUp }} />);
    await screen.findByRole("heading", { name: "Apply today" });
    fireEvent.click(screen.getByRole("button", { name: "Skip Northstar Health Senior React Native Engineer" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Done Acme Senior React Engineer #1" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    newer.reject(new Error("offline"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved, but unable to refresh dashboard");
    older.resolve(authoritative);
    await waitFor(() => expect(screen.getByRole("button", { name: "Skip Northstar Health Senior React Native Engineer" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Dismiss Acme Senior React Engineer #1" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Skip Northstar Health Senior React Native Engineer" })).not.toBeInTheDocument());
    expect(updateJobTriage).toHaveBeenCalledTimes(1);
    expect(updateFollowUp).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(4);
  });

  test("an older initial load cannot overwrite a later accepted refresh", async () => {
    const initialOlder = deferred<typeof dashboard>();
    const refreshed = { ...dashboard, jobs: dashboard.jobs.map((job) => job.id === 1 ? { ...job, triage_status: "skipped" } : job), today: { ...dashboard.today, applyToday: dashboard.today.applyToday.slice(1) } };
    const load = vi.fn().mockReturnValueOnce(initialOlder.promise).mockResolvedValueOnce(dashboard).mockResolvedValueOnce(refreshed);
    const updateJobTriage = vi.fn().mockResolvedValue({});
    render(<StrictMode><App api={{ load, updateApplication: vi.fn(), updateJobTriage }} /></StrictMode>);
    await screen.findByRole("heading", { name: "Apply today" });
    fireEvent.click(screen.getByRole("button", { name: "Skip Northstar Health Senior React Native Engineer" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Skip Northstar Health Senior React Native Engineer" })).not.toBeInTheDocument());
    await act(async () => { initialOlder.resolve(dashboard); await initialOlder.promise; });
    expect(screen.queryByRole("button", { name: "Skip Northstar Health Senior React Native Engineer" })).not.toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(3);
  });

  test("snooze cannot submit today and uses a Berlin-safe instant for tomorrow", async () => {
    const berlinToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const tomorrow = new Date(`${berlinToday}T12:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowDay = tomorrow.toISOString().slice(0, 10);
    const updateFollowUp = vi.fn().mockResolvedValue({});
    render(<App api={{ load: vi.fn().mockResolvedValue(dashboard), updateApplication: vi.fn(), updateFollowUp }} />);
    await screen.findByRole("heading", { name: "Follow up today" });
    const dateInput = screen.getByLabelText("Snooze until for Acme Senior React Engineer #1");
    fireEvent.change(dateInput, { target: { value: berlinToday } });
    expect(screen.getByRole("button", { name: "Snooze Acme Senior React Engineer #1" })).toBeDisabled();
    fireEvent.change(dateInput, { target: { value: tomorrowDay } });
    fireEvent.click(screen.getByRole("button", { name: "Snooze Acme Senior React Engineer #1" }));
    await waitFor(() => expect(updateFollowUp).toHaveBeenCalledWith(9, { action: "snooze", dueAt: `${tomorrowDay}T12:00:00.000Z` }));
  });

  test("a snooze confirmed after Berlin midnight unlocks when the follow-up is due again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-09-29T21:55:00.000Z"));
      const dueAt = "2026-09-30T12:00:00.000Z";
      const refresh = deferred<typeof dashboard>();
      const load = vi.fn().mockResolvedValueOnce(dashboard).mockReturnValueOnce(refresh.promise);
      const updateFollowUp = vi.fn().mockResolvedValue({ status: "pending", due_at: dueAt });
      render(<App api={{ load, updateApplication: vi.fn(), updateFollowUp }} />);
      await screen.findByRole("heading", { name: "Follow up today" });
      fireEvent.change(screen.getByLabelText("Snooze until for Acme Senior React Engineer #1"), { target: { value: "2026-09-30" } });
      fireEvent.click(screen.getByRole("button", { name: "Snooze Acme Senior React Engineer #1" }));
      await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
      vi.setSystemTime(new Date("2026-09-29T22:05:00.000Z"));
      const dueFollowUp = { ...dashboard.today.followUpToday[0], due_at: dueAt, status: "pending" };
      const afterRollover = { ...dashboard, followUps: [dueFollowUp], today: { ...dashboard.today, followUpToday: [dueFollowUp] } };
      await act(async () => { refresh.resolve(afterRollover); await refresh.promise; });
      expect(screen.queryByText("Saved, but unable to refresh dashboard")).not.toBeInTheDocument();
      fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
      fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Today" }));
      expect(screen.getByRole("button", { name: "Done Acme Senior React Engineer #1" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Dismiss Acme Senior React Engineer #1" })).toBeEnabled();
      expect(updateFollowUp).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a due follow-up with the old due time does not falsely confirm Snooze", async () => {
    const berlinToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const tomorrow = new Date(`${berlinToday}T12:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const day = tomorrow.toISOString().slice(0, 10);
    const dueAt = `${day}T12:00:00.000Z`;
    const oldRow = { ...dashboard.today.followUpToday[0], status: "pending" };
    const stale = { ...dashboard, followUps: [oldRow], today: { ...dashboard.today, followUpToday: [oldRow] } };
    const load = vi.fn().mockResolvedValueOnce(dashboard).mockResolvedValueOnce(stale);
    const updateFollowUp = vi.fn().mockResolvedValue({ status: "pending", due_at: dueAt });
    render(<App api={{ load, updateApplication: vi.fn(), updateFollowUp }} />);
    await screen.findByRole("heading", { name: "Follow up today" });
    fireEvent.change(screen.getByLabelText("Snooze until for Acme Senior React Engineer #1"), { target: { value: day } });
    fireEvent.click(screen.getByRole("button", { name: "Snooze Acme Senior React Engineer #1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved, but unable to refresh dashboard");
    expect(screen.getByRole("button", { name: "Done Acme Senior React Engineer #1" })).toBeDisabled();
  });

  test("Today opens the exact review item past the first ten", async () => {
    const reviewQueue = Array.from({ length: 12 }, (_, index) => ({ ...dashboard.reviewQueue[0], id: index + 1, subject: `Review item ${index + 1}` }));
    const item = reviewQueue[11];
    const data = { ...dashboard, reviewQueue, today: { ...dashboard.today, needsAttention: [{ kind: "review", evidence: item }] } };
    render(<App api={{ load: vi.fn().mockResolvedValue(data), updateApplication: vi.fn() }} />);
    await screen.findByRole("heading", { name: "Needs attention" });
    fireEvent.click(screen.getByRole("button", { name: /Review item 12/ }));
    expect(screen.getByRole("button", { name: /Review item 12/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Review item 12/ }).closest(".review-item")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Filter group"), { target: { value: "application_update" } });
    expect(screen.getByLabelText("Filter group")).toHaveValue("application_update");
    fireEvent.change(screen.getByLabelText("Search review items"), { target: { value: "something else" } });
    expect(screen.getByLabelText("Search review items")).toHaveValue("something else");
  });

  test("distinguishes follow-up actions for two roles at one company", async () => {
    const followUpToday = [dashboard.today.followUpToday[0], { ...dashboard.today.followUpToday[0], id: 11, title: "Product Designer", sequence: 2 }];
    const data = { ...dashboard, today: { ...dashboard.today, followUpToday } };
    render(<App api={{ load: vi.fn().mockResolvedValue(data), updateApplication: vi.fn() }} />);
    await screen.findByRole("heading", { name: "Follow up today" });
    expect(screen.getByRole("button", { name: "Done Acme Senior React Engineer #1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done Acme Product Designer #2" })).toBeInTheDocument();
  });

  test("keeps company names out of visible follow-up action labels", async () => {
    render(<App api={{ load: vi.fn().mockResolvedValue(dashboard), updateApplication: vi.fn() }} />);
    await screen.findByRole("heading", { name: "Follow up today" });

    expect(screen.getByRole("button", { name: "Open reply & copy draft Acme Senior React Engineer #1" })).toHaveTextContent(/^Open reply & copy draft$/);
    expect(screen.getByRole("button", { name: "Done Acme Senior React Engineer #1" })).toHaveTextContent(/^Done$/);
    expect(screen.getByRole("button", { name: "Snooze Acme Senior React Engineer #1" })).toHaveTextContent(/^Snooze$/);
    expect(screen.getByRole("button", { name: "Dismiss Acme Senior React Engineer #1" })).toHaveTextContent(/^Dismiss$/);
  });

  test("copies the draft and opens a native Apple Mail reply without completing the follow-up", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const openFollowUpDraft = vi.fn().mockResolvedValue({ opened: true });
    const updateFollowUp = vi.fn();
    render(<App api={{ load: vi.fn().mockResolvedValue(dashboard), updateApplication: vi.fn(), openFollowUpDraft, updateFollowUp }} />);
    await screen.findByRole("heading", { name: "Follow up today" });

    fireEvent.click(screen.getByRole("button", { name: "Open reply & copy draft Acme Senior React Engineer #1" }));

    await waitFor(() => expect(openFollowUpDraft).toHaveBeenCalledWith(9));
    expect(writeText).toHaveBeenCalledWith("Hello Acme");
    expect(writeText.mock.invocationCallOrder[0]).toBeLessThan(openFollowUpDraft.mock.invocationCallOrder[0]);
    expect(await screen.findByRole("status")).toHaveTextContent("Reply opened. Press ⌘V in Mail to paste the draft.");
    expect(updateFollowUp).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Copy draft Acme Senior React Engineer #1" })).not.toBeInTheDocument();
  });

  test("keeps Mail closed and offers a retry when copying the draft fails", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("Clipboard unavailable")) } });
    const openFollowUpDraft = vi.fn().mockResolvedValue({ opened: true });
    render(<App api={{ load: vi.fn().mockResolvedValue(dashboard), updateApplication: vi.fn(), openFollowUpDraft }} />);
    await screen.findByRole("heading", { name: "Follow up today" });

    fireEvent.click(screen.getByRole("button", { name: "Open reply & copy draft Acme Senior React Engineer #1" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to copy the draft. Copy it manually instead.");
    expect(openFollowUpDraft).not.toHaveBeenCalled();
    expect(screen.queryByText(/draft text has been copied/i)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Draft text Acme Senior React Engineer #1" })).toHaveValue("Hello Acme");
    expect(screen.getByRole("button", { name: "Copy draft Acme Senior React Engineer #1" })).toBeInTheDocument();
  });

  test("offers Copy draft when Apple Mail cannot open a safe reply", async () => {
    const openFollowUpDraft = vi.fn().mockRejectedValue(new Error("No replyable email thread was found. Copy the draft instead."));
    render(<App api={{ load: vi.fn().mockResolvedValue(dashboard), updateApplication: vi.fn(), openFollowUpDraft }} />);
    await screen.findByRole("heading", { name: "Follow up today" });

    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
    fireEvent.click(screen.getByRole("button", { name: "Open reply & copy draft Acme Senior React Engineer #1" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No replyable email thread was found. Copy the draft instead.");
    expect(screen.getByRole("button", { name: "Copy draft Acme Senior React Engineer #1" })).toHaveTextContent(/^Copy draft$/);
  });

  test("persists a pipeline status change", async () => {
    const updateApplication = vi.fn().mockResolvedValue({});
    const api: DashboardApi = { load: vi.fn().mockResolvedValue(dashboard), updateApplication };
    render(<App api={api} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Pipeline" }));
    fireEvent.change(screen.getByLabelText("Status for Acme"), { target: { value: "technical_interview" } });
    await waitFor(() => expect(updateApplication).toHaveBeenCalledWith(7, { status: "technical_interview" }));
  });

  test("Jobs tabs separate triage from applications and combine filters", async () => {
    const jobs = [
      { id: 1, company: "Native Remote", title: "React Native Engineer", description: "React Native", employment_type: "permanent", work_mode: "Remote", score: 91, url: "https://example.com/1", triage_status: "new" },
      { id: 2, company: "React Hybrid", title: "React Engineer", employment_type: "permanent", work_mode: "Hybrid", score: 80, url: null, triage_status: "new" },
      { id: 3, company: "Node Freelance", title: "TypeScript Node.js", employment_type: "freelance", work_mode: "Remote", score: 88, url: "https://example.com/3", triage_status: "shortlisted" },
      { id: 4, company: "Skipped Co", title: "Engineer", employment_type: "permanent", work_mode: "Onsite", score: 70, triage_status: "skipped" },
      { id: 5, company: "Expired Co", title: "Engineer", employment_type: "permanent", work_mode: "Onsite", score: 60, triage_status: "expired" },
      { id: 6, company: "Applied Co", title: "Engineer", employment_type: "permanent", work_mode: "Remote", score: 95, triage_status: "new", application_id: 77 }
    ];
    render(<App api={{ load: vi.fn().mockResolvedValue({ ...dashboard, jobs }), updateApplication: vi.fn() }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    expect(screen.getByText("Native Remote")).toBeInTheDocument();
    expect(screen.getByText("React Hybrid")).toBeInTheDocument();
    expect(screen.queryByText("Applied Co")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Employment type"), { target: { value: "permanent" } });
    fireEvent.change(screen.getByLabelText("Role keywords (inferred)"), { target: { value: "react_native" } });
    fireEvent.change(screen.getByLabelText("Work mode"), { target: { value: "remote" } });
    fireEvent.change(screen.getByLabelText("Minimum score"), { target: { value: "90" } });
    fireEvent.click(screen.getByLabelText("Working links only"));
    expect(screen.getByText("Native Remote")).toBeInTheDocument();
    expect(screen.queryByText("React Hybrid")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Applied", pressed: false }));
    expect(screen.getByText("Applied Co")).toBeInTheDocument();
    expect(screen.queryByText("Native Remote")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skipped / expired" }));
    expect(screen.getByText("Skipped Co")).toBeInTheDocument();
    expect(screen.getByText("Expired Co")).toBeInTheDocument();
  });

  test("marking a job applied moves it from New to Applied after refresh", async () => {
    const original = { ...dashboard, jobs: [{ ...dashboard.jobs[1], triage_status: "new" }] };
    const refreshed = { ...original, jobs: [{ ...original.jobs[0], application_id: 21, application_status: "applied" }], applications: [...dashboard.applications, { id: 21, job_id: 2, company: "No URL GmbH", title: "React Engineer", status: "applied" }] };
    const markJobApplied = vi.fn().mockResolvedValue({});
    render(<App api={{ load: vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(refreshed), updateApplication: vi.fn(), markJobApplied }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark as applied No URL GmbH React Engineer" }));
    await waitFor(() => expect(screen.queryByText("No URL GmbH")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Applied" }));
    expect(screen.getByText("No URL GmbH")).toBeInTheDocument();
    expect(markJobApplied).toHaveBeenCalledWith(2);
  });

  test("failed triage keeps the job in New and unsafe links stay unavailable", async () => {
    const jobs = [{ ...dashboard.jobs[1], triage_status: "new", url: "javascript:alert(1)" }];
    const updateJobTriage = vi.fn().mockRejectedValueOnce(new Error("offline"));
    render(<App api={{ load: vi.fn().mockResolvedValue({ ...dashboard, jobs }), updateApplication: vi.fn(), updateJobTriage }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    expect(screen.getByText("Link unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Open No URL GmbH vacancy/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skip No URL GmbH React Engineer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save changes");
    expect(screen.getByText("No URL GmbH")).toBeInTheDocument();
  });

  test("shows four workflow pages, a review count, and original source text", async () => {
    const api: DashboardApi = { load: vi.fn().mockResolvedValue(dashboard), updateApplication: vi.fn() };
    render(<App api={api} />);
    await screen.findByRole("heading", { name: "Today" });
    const navigation = screen.getByRole("navigation", { name: "Primary navigation" });
    expect([...navigation.querySelectorAll("button")].map((button) => button.textContent?.replace(/^\d\d/, "").trim())).toEqual(["Today", "Jobs", "Pipeline", "Review1"]);
    for (const name of ["Interviews", "History", "Materials", "Analytics"]) {
      expect(screen.queryByRole("button", { name: new RegExp(name, "i") })).not.toBeInTheDocument();
    }
    expect(within(navigation).getByRole("button", { name: /Review/i })).toHaveTextContent("1");
    fireEvent.click(within(navigation).getByRole("button", { name: /Review/i }));
    expect(screen.getByRole("heading", { name: "Review" })).toBeInTheDocument();
    expect(screen.queryByText("Хотите обсудить вакансию?")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Quick chat/ }));
    expect(screen.getByText("Хотите обсудить вакансию?")).toBeInTheDocument();
  });

  test("contains no Cyrillic in static dashboard source", () => {
    const entryHtml = readFileSync(resolve("index.html"), "utf8");
    const source = clientSource(resolve("src/client")) + entryHtml;
    expect(source).not.toMatch(/[А-Яа-яЁё]/);
    expect(new DOMParser().parseFromString(entryHtml, "text/html").documentElement.lang).toBe("en");
  });

  test("explains and creates an application from the manual-review queue", async () => {
    const reviewed = { ...dashboard, summary: { ...dashboard.summary, review: 0 }, reviewQueue: [] };
    const reviewEvidence = vi.fn().mockResolvedValue({});
    const api = { load: vi.fn().mockResolvedValueOnce(dashboard).mockResolvedValue(reviewed), updateApplication: vi.fn(), reviewEvidence } as DashboardApi;
    render(<App api={api} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: /Review/i }));
    expect(screen.getByText(/could not confidently match/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Quick chat/ }));
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Orbit Learning" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Fullstack Engineer" } });
    fireEvent.change(screen.getByLabelText("Review status"), { target: { value: "recruiter_screen" } });
    fireEvent.click(screen.getByRole("button", { name: "Create application" }));
    await waitFor(() => expect(reviewEvidence).toHaveBeenCalledWith(10, { action: "create", company: "Orbit Learning", title: "Fullstack Engineer", status: "recruiter_screen" }));
    await waitFor(() => expect(screen.queryByText("Хотите обсудить вакансию?")).not.toBeInTheDocument());
  });

  test("can link or ignore a review item", async () => {
    const reviewed = { ...dashboard, summary: { ...dashboard.summary, review: 0 }, reviewQueue: [] };
    const reviewEvidence = vi.fn().mockResolvedValue(reviewed);
    const api = { load: vi.fn().mockResolvedValue(dashboard), updateApplication: vi.fn(), reviewEvidence } as DashboardApi;
    render(<App api={api} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: /Review/i }));
    fireEvent.click(screen.getByRole("button", { name: /Quick chat/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "Choose another application" })[0]);
    fireEvent.change(screen.getByLabelText("Existing application"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Link to application" }));
    await waitFor(() => expect(reviewEvidence).toHaveBeenCalledWith(10, { action: "link", applicationId: 7, status: "applied" }));

    reviewEvidence.mockClear();
    const secondApi = { load: vi.fn().mockResolvedValue(dashboard), updateApplication: vi.fn(), reviewEvidence } as DashboardApi;
    render(<App api={secondApi} />);
    await screen.findAllByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getAllByRole("navigation").at(-1)!).getByRole("button", { name: /Review/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /Quick chat/ }).at(-1)!);
    fireEvent.click(screen.getAllByRole("button", { name: "Not job-related" }).at(-1)!);
    await waitFor(() => expect(reviewEvidence).toHaveBeenCalledWith(10, { action: "ignore" }));
  });

  test("groups review items, suggests one match, and searches applications only on request", async () => {
    const reviewQueue = [
      { ...dashboard.reviewQueue[0], id: 11, subject: "Interview update", review_group: "application_update", suggested_application_id: 7 },
      { ...dashboard.reviewQueue[0], id: 12, subject: "Unfortunately", review_group: "rejection", suggested_application_id: null },
      { ...dashboard.reviewQueue[0], id: 13, subject: "Recruiter chat", review_group: "recruiter_conversation", suggested_application_id: null },
      { ...dashboard.reviewQueue[0], id: 14, subject: "Weekly job alert", review_group: "newsletter_alert", suggested_application_id: null, sender: "Jobs <jobs@mail.example.com>" },
      { ...dashboard.reviewQueue[0], id: 15, subject: "Question", review_group: "unknown", suggested_application_id: null }
    ];
    const data = { ...dashboard, summary: { ...dashboard.summary, review: 5 }, reviewQueue };
    const reviewEvidence = vi.fn().mockResolvedValue({});
    render(<App api={{ load: vi.fn().mockResolvedValue(data), updateApplication: vi.fn(), reviewEvidence }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: /Review/i }));
    expect(screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent)).toEqual([
      "Likely application update", "Likely rejection", "Recruiter conversation", "Likely newsletter / job alert", "Unknown"
    ]);
    expect(screen.queryByText("Хотите обсудить вакансию?")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirm suggested link.*Acme/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("Search applications")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Choose another application" })[0]);
    fireEvent.change(screen.getByLabelText("Search applications"), { target: { value: "missing" } });
    expect(screen.queryByRole("option", { name: /Acme/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search applications"), { target: { value: "Acme" } });
    expect(screen.getByRole("option", { name: /Acme/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Existing application"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Search applications"), { target: { value: "missing" } });
    expect(screen.getByRole("button", { name: "Link to application" })).toBeDisabled();
  });

  test("requires exact-sender confirmation before bulk-ignore and retains a failed item for retry", async () => {
    const reviewQueue = [
      { ...dashboard.reviewQueue[0], id: 11, sender: "Jobs <jobs@mail.example.com>", subject: "Job alert", review_group: "newsletter_alert" },
      { ...dashboard.reviewQueue[0], id: 12, sender: "jobs@mail.example.com", subject: "Weekly jobs", review_group: "newsletter_alert" },
      { ...dashboard.reviewQueue[0], id: 13, sender: "jobs+other@mail.example.com", subject: "Other jobs", review_group: "newsletter_alert" }
    ];
    const data = { ...dashboard, summary: { ...dashboard.summary, review: 3 }, reviewQueue };
    const reviewEvidence = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({});
    const bulkIgnoreEvidence = vi.fn().mockResolvedValue({ count: 2 });
    render(<App api={{ load: vi.fn().mockResolvedValue(data), updateApplication: vi.fn(), reviewEvidence, bulkIgnoreEvidence }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: /Review/i }));
    fireEvent.click(screen.getByRole("button", { name: /Job alert/ }));
    fireEvent.click(screen.getByRole("button", { name: "Bulk-ignore sender" }));
    expect(screen.getByText(/jobs@mail\.example\.com.*2 items/)).toBeInTheDocument();
    expect(bulkIgnoreEvidence).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(bulkIgnoreEvidence).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Not job-related" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(screen.getByRole("button", { name: /Job alert/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(reviewEvidence).toHaveBeenCalledTimes(2));
    cleanup();
    render(<App api={{ load: vi.fn().mockResolvedValue(data), updateApplication: vi.fn(), reviewEvidence: vi.fn(), bulkIgnoreEvidence }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: /Review/i }));
    fireEvent.click(screen.getByRole("button", { name: /Job alert/ }));
    fireEvent.click(screen.getByRole("button", { name: "Bulk-ignore sender" }));
    fireEvent.click(screen.getByRole("button", { name: "Ignore 2 items" }));
    await waitFor(() => expect(bulkIgnoreEvidence).toHaveBeenCalledWith("jobs@mail.example.com", [11, 12]));
  });

  test("a failed suggested link remains reviewable and retries the same decision", async () => {
    const item = { ...dashboard.reviewQueue[0], review_group: "application_update", suggested_application_id: 7 };
    const data = { ...dashboard, reviewQueue: [item] };
    const reviewEvidence = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({});
    render(<App api={{ load: vi.fn().mockResolvedValue(data), updateApplication: vi.fn(), reviewEvidence }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: /Review/i }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm suggested link.*Acme/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(screen.getByRole("button", { name: /Quick chat/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(reviewEvidence).toHaveBeenCalledTimes(2));
    expect(reviewEvidence).toHaveBeenLastCalledWith(10, { action: "link", applicationId: 7, status: "applied" });
  });

  test("a saved review decision retries only dashboard refresh", async () => {
    const reviewed = { ...dashboard, summary: { ...dashboard.summary, review: 0 }, reviewQueue: [] };
    const load = vi.fn().mockResolvedValueOnce(dashboard).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(reviewed);
    const reviewEvidence = vi.fn().mockResolvedValue({});
    render(<App api={{ load, updateApplication: vi.fn(), reviewEvidence }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: /Review/i }));
    fireEvent.click(screen.getByRole("button", { name: /Quick chat/ }));
    fireEvent.click(screen.getByRole("button", { name: "Not job-related" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved, but unable to refresh dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Quick chat/ })).not.toBeInTheDocument());
    expect(reviewEvidence).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(3);
  });

  test("bulk confirmation submits its frozen sender and evidence IDs after a queue update", async () => {
    const first = { ...dashboard.reviewQueue[0], id: 21, sender: "Jobs <jobs@mail.example.com>", subject: "Job alert", review_group: "newsletter_alert" };
    const second = { ...first, id: 22, subject: "Weekly job alert" };
    const third = { ...first, id: 23, subject: "Newly arrived alert" };
    const bulkIgnoreEvidence = vi.fn().mockResolvedValue(undefined);
    const props = { data: { ...dashboard, reviewQueue: [first, second] }, reviewEvidence: vi.fn(), bulkIgnoreEvidence, pendingIds: [], onRefresh: vi.fn(), targetId: null };
    const view = render(<ReviewPage {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Job alert/ }));
    fireEvent.click(screen.getByRole("button", { name: "Bulk-ignore sender" }));
    expect(screen.getByText(/jobs@mail\.example\.com.*2 items/)).toBeInTheDocument();
    view.rerender(<ReviewPage {...props} data={{ ...props.data, reviewQueue: [first, second, third] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Ignore 2 items" }));
    await waitFor(() => expect(bulkIgnoreEvidence).toHaveBeenCalledWith("jobs@mail.example.com", [21, 22]));
  });

  test("shows a large review queue in manageable batches", async () => {
    const reviewQueue = Array.from({ length: 12 }, (_, index) => ({ ...dashboard.reviewQueue[0], id: index + 1, subject: `Review item ${index + 1}` }));
    const largeDashboard = { ...dashboard, summary: { ...dashboard.summary, review: reviewQueue.length }, reviewQueue };
    const api: DashboardApi = { load: vi.fn().mockResolvedValue(largeDashboard), updateApplication: vi.fn() };
    render(<App api={api} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: /Review/i }));
    expect(screen.getByText("Showing 10 of 12 items")).toBeInTheDocument();
    expect(screen.queryByText("Review item 11")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show 10 more" }));
    expect(screen.getByRole("button", { name: /Review item 11/ })).toBeInTheDocument();
  });

  test("opens every application including terminal and unknown statuses and saves detail fields", async () => {
    const applications = [
      dashboard.applications[0],
      { ...dashboard.applications[0], id: 8, company: "Rejected Co", status: "rejected" },
      { ...dashboard.applications[0], id: 9, company: "Withdrawn Co", status: "withdrawn" },
      { ...dashboard.applications[0], id: 10, company: "Unknown Co", status: "unknown" }
    ];
    const updateApplication = vi.fn().mockResolvedValue({});
    const api: DashboardApi = { load: vi.fn().mockResolvedValue({ ...dashboard, applications }), updateApplication };
    render(<App api={api} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Pipeline" }));
    for (const company of ["Acme", "Unknown Co"]) {
      expect(screen.getByRole("button", { name: `Details for ${company} — Senior React Engineer` })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    for (const company of ["Rejected Co", "Withdrawn Co"]) expect(screen.getByRole("button", { name: `Details for ${company} — Senior React Engineer` })).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "Details for Rejected Co — Senior React Engineer" });
    fireEvent.click(trigger);
    const detail = screen.getByRole("dialog", { name: "Rejected Co application details" });
    expect(within(detail).getByRole("button", { name: "Close details" })).toHaveFocus();
    fireEvent.change(within(detail).getByLabelText("Status"), { target: { value: "recruiter_screen" } });
    fireEvent.change(within(detail).getByLabelText("Priority"), { target: { value: "4" } });
    fireEvent.change(within(detail).getByLabelText("Next step"), { target: { value: "Call recruiter" } });
    fireEvent.change(within(detail).getByLabelText("Notes"), { target: { value: "Call notes" } });
    fireEvent.change(within(detail).getByLabelText("Applied date"), { target: { value: "2026-09-02" } });
    fireEvent.change(within(detail).getByLabelText("Rejection reason"), { target: { value: "role_closed" } });
    fireEvent.change(within(detail).getByLabelText("Decision"), { target: { value: "review" } });
    fireEvent.click(within(detail).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateApplication).toHaveBeenCalledWith(8, {
      status: "recruiter_screen", priority: 4, nextStep: "Call recruiter", notes: "Call notes",
      appliedAt: "2026-09-02T00:00:00.000Z", rejectionReason: "role_closed", decision: "review"
    }));
    fireEvent.click(within(detail).getByRole("button", { name: "Close details" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  test("keeps interview feedback, personal notes, and document downloads in application details", async () => {
    const addInterviewNote = vi.fn().mockResolvedValue({ id: 99, interview_event_id: 12, category: "system_design", text: "I rushed the trade-off discussion.", source_type: "user_note", confidence: 1 });
    const api: DashboardApi = {
      load: vi.fn().mockResolvedValue({
        ...dashboard,
        interviews: [{ ...dashboard.interviews[0], application_id: 7 }],
        insightDetails: [{ ...dashboard.insightDetails[0], interview_event_id: 12 }],
        documents: [{ id: 30, job_id: 1, company: "Acme", document_type: "resume", format: "pdf", version: "v1" }]
      }),
      updateApplication: vi.fn(), addInterviewNote
    };
    render(<App api={api} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Pipeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Details for Acme — Senior React Engineer" }));
    const detail = screen.getByRole("dialog", { name: "Acme application details" });
    expect(within(detail).getAllByText("Strong communication; improve mobile architecture.")).toHaveLength(2);
    expect(within(detail).getByText(/Employer feedback/)).toBeInTheDocument();
    expect(within(detail).getByText(/talent@acme.example.com/)).toBeInTheDocument();
    expect(within(detail).getByText("03 September 2026")).toBeInTheDocument();
    expect(within(detail).getByRole("link", { name: /Download.*resume/i })).toHaveAttribute("href", "/api/documents/30/download");
    fireEvent.change(within(detail).getByLabelText("Note for Acme"), { target: { value: "I rushed the trade-off discussion." } });
    fireEvent.click(within(detail).getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(addInterviewNote).toHaveBeenCalledWith(12, { category: "system_design", text: "I rushed the trade-off discussion." }));
    expect(within(detail).getByText("I rushed the trade-off discussion.")).toBeInTheDocument();
  });

  test("keeps a document for a job without an application downloadable", async () => {
    const api: DashboardApi = {
      load: vi.fn().mockResolvedValue({ ...dashboard, documents: [{ id: 31, job_id: 2, company: "No URL GmbH", document_type: "cover_letter", format: "docx", version: "v1" }] }),
      updateApplication: vi.fn()
    };
    render(<App api={api} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    expect(screen.getByRole("link", { name: /Download.*cover_letter/i })).toHaveAttribute("href", "/api/documents/31/download");
  });

  test("applied jobs retain their document and duplicate controls", async () => {
    const applied = { ...dashboard.jobs[0], application_id: 7, triage_status: "new", duplicate_blocked: 1 };
    render(<App api={{ load: vi.fn().mockResolvedValue({ ...dashboard, jobs: [applied], documents: [{ id: 31, job_id: 1, document_type: "resume" }] }), updateApplication: vi.fn(), updateJob: vi.fn().mockResolvedValue({ manual_unblock: 1, duplicate_blocked: 0 }) }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    fireEvent.click(screen.getByRole("button", { name: "Applied" }));
    expect(screen.getByRole("link", { name: "Download resume" })).toHaveAttribute("href", "/api/documents/31/download");
    expect(screen.getByRole("button", { name: "Allow repeat application" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View in Pipeline" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Status for Northstar Health/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View in Pipeline" }));
    expect(screen.getByRole("heading", { name: "Pipeline" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Acme application details" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close details" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Details for Acme — Senior React Engineer" })).toHaveFocus());
  });

  test("duplicate override enables applying immediately", async () => {
    const blocked = { ...dashboard.jobs[0], triage_status: "new", duplicate_blocked: 1, manual_unblock: 0 };
    const updateJob = vi.fn().mockResolvedValue({ id: 1, manual_unblock: 1, duplicate_blocked: 0 });
    const refreshed = { ...dashboard, jobs: [{ ...blocked, manual_unblock: 1, duplicate_blocked: 0 }] };
    render(<App api={{ load: vi.fn().mockResolvedValueOnce({ ...dashboard, jobs: [blocked] }).mockResolvedValue(refreshed), updateApplication: vi.fn(), updateJob }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    const mark = screen.getByRole("button", { name: "Mark as applied Northstar Health Senior React Native Engineer" });
    expect(mark).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Allow repeat application" }));
    await waitFor(() => expect(mark).toBeEnabled());
    expect(updateJob).toHaveBeenCalledWith(1, { manualUnblock: true });
  });

  test("status PATCH stays reserved across Pipeline to Jobs to Pipeline navigation", async () => {
    const patch = deferred<{ status: string }>();
    const updateApplication = vi.fn().mockReturnValue(patch.promise);
    render(<App api={{ load: vi.fn().mockResolvedValue(dashboard), updateApplication }} />);
    await screen.findByRole("heading", { name: "Today" });
    const nav = screen.getByRole("navigation");
    fireEvent.click(within(nav).getByRole("button", { name: "Pipeline" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Status for Acme" }), { target: { value: "technical_interview" } });
    fireEvent.click(within(nav).getByRole("button", { name: "Jobs" }));
    fireEvent.click(within(nav).getByRole("button", { name: "Pipeline" }));
    expect(screen.getByRole("combobox", { name: "Status for Acme" })).toBeDisabled();
    expect(updateApplication).toHaveBeenCalledTimes(1);
    await act(async () => patch.reject(new Error("offline")));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Status for Acme" })).toBeEnabled());
  });

  test("saved status can retry its dashboard read after Pipeline unmount", async () => {
    const patch = deferred<{ status: string }>();
    const confirmed = { ...dashboard, applications: [{ ...dashboard.applications[0], status: "technical_interview" }] };
    const load = vi.fn().mockResolvedValueOnce(dashboard).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(confirmed);
    const updateApplication = vi.fn().mockReturnValue(patch.promise);
    render(<App api={{ load, updateApplication }} />);
    await screen.findByRole("heading", { name: "Today" });
    const nav = screen.getByRole("navigation");
    fireEvent.click(within(nav).getByRole("button", { name: "Pipeline" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Status for Acme" }), { target: { value: "technical_interview" } });
    fireEvent.click(within(nav).getByRole("button", { name: "Jobs" }));
    await act(async () => patch.resolve({ status: "technical_interview" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    fireEvent.click(within(nav).getByRole("button", { name: "Pipeline" }));
    expect(screen.getByRole("combobox", { name: "Status for Acme" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Status for Acme" })).toBeEnabled());
    expect(screen.getByRole("combobox", { name: "Status for Acme" })).toHaveValue("technical_interview");
    expect(updateApplication).toHaveBeenCalledTimes(1);
  });

  test("detail save PATCH stays reserved across Pipeline to Jobs to Pipeline navigation", async () => {
    const patch = deferred<Record<string, unknown>>();
    const updateApplication = vi.fn().mockReturnValue(patch.promise);
    render(<App api={{ load: vi.fn().mockResolvedValue(dashboard), updateApplication }} />);
    await screen.findByRole("heading", { name: "Today" });
    const nav = screen.getByRole("navigation");
    fireEvent.click(within(nav).getByRole("button", { name: "Pipeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Details for Acme — Senior React Engineer" }));
    fireEvent.change(screen.getByLabelText("Next step"), { target: { value: "Call recruiter" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    fireEvent.click(within(nav).getByRole("button", { name: "Jobs" }));
    fireEvent.click(within(nav).getByRole("button", { name: "Pipeline" }));
    expect(screen.getByRole("combobox", { name: "Status for Acme" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Details for Acme — Senior React Engineer" }));
    const dialog = await screen.findByRole("dialog", { name: "Acme application details" });
    expect(within(dialog).getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(updateApplication).toHaveBeenCalledTimes(1);
    await act(async () => patch.reject(new Error("offline")));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Status for Acme" })).toBeEnabled());
  });

  test("duplicate allow refreshes server-derived Today before releasing the job", async () => {
    const blocked = { ...dashboard.jobs[0], triage_status: "new", duplicate_blocked: 1, manual_unblock: 0 };
    const duplicateToday = { ...dashboard.today.applyToday[0], duplicate_blocked: 1 };
    const initial = { ...dashboard, jobs: [blocked], today: { ...dashboard.today, applyToday: [duplicateToday] } };
    const refreshed = { ...initial, jobs: [{ ...blocked, manual_unblock: 1, duplicate_blocked: 0 }], today: { ...dashboard.today, applyToday: [{ ...duplicateToday, duplicate_blocked: 0 }] } };
    const patch = deferred<Record<string, unknown>>();
    const refresh = deferred<typeof refreshed>();
    const load = vi.fn().mockResolvedValueOnce(initial).mockReturnValueOnce(refresh.promise);
    render(<App api={{ load, updateApplication: vi.fn(), updateJob: vi.fn().mockReturnValue(patch.promise) }} />);
    await screen.findByRole("heading", { name: "Today" });
    const nav = screen.getByRole("navigation");
    fireEvent.click(within(nav).getByRole("button", { name: "Jobs" }));
    fireEvent.click(screen.getByRole("button", { name: "Allow repeat application" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await act(async () => patch.resolve({ manual_unblock: 1, duplicate_blocked: 0 }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Mark as applied Northstar Health Senior React Native Engineer" })).toBeDisabled();
    await act(async () => refresh.resolve(refreshed));
    fireEvent.click(within(nav).getByRole("button", { name: "Today" }));
    expect(screen.getByRole("button", { name: "Mark as applied Northstar Health Senior React Native Engineer" })).toBeEnabled();
  });

  test("saved duplicate override retries only the dashboard read", async () => {
    const blocked = { ...dashboard.jobs[0], triage_status: "new", duplicate_blocked: 1, manual_unblock: 0 };
    const initial = { ...dashboard, jobs: [blocked] };
    const confirmed = { ...initial, jobs: [{ ...blocked, manual_unblock: 1, duplicate_blocked: 0 }] };
    const load = vi.fn().mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(confirmed);
    const updateJob = vi.fn().mockResolvedValue({ manual_unblock: 1, duplicate_blocked: 0 });
    render(<App api={{ load, updateApplication: vi.fn(), updateJob }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    const allow = screen.getByRole("button", { name: "Allow repeat application" });
    const duplicateAction = allow.closest(".async-action") as HTMLElement;
    fireEvent.click(allow);
    expect(await within(duplicateAction).findByRole("alert")).toHaveTextContent("Saved, but unable to refresh dashboard");
    fireEvent.click(within(duplicateAction).getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    expect(updateJob).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Restore duplicate block" })).toBeEnabled();
  });

  test("restoring an override confirms the server's effective duplicate state", async () => {
    const allowed = { ...dashboard.jobs[0], triage_status: "new", duplicate_blocked: 0, raw_duplicate_blocked: 0, manual_unblock: 1 };
    const restored = { ...allowed, manual_unblock: 0 };
    const initial = { ...dashboard, jobs: [allowed] };
    const confirmed = { ...dashboard, jobs: [restored] };
    const load = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(confirmed);
    const updateJob = vi.fn().mockResolvedValue(restored);
    render(<App api={{ load, updateApplication: vi.fn(), updateJob }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore duplicate block" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Restore duplicate block" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark as applied Northstar Health Senior React Native Engineer" })).toBeEnabled();
  });

  test("work mode inferred from location agrees with filter without matching substrings", async () => {
    const jobs = [
      { ...dashboard.jobs[0], id: 10, company: "Remote Co", location: "Germany Remote", work_mode: null, triage_status: "new" },
      { ...dashboard.jobs[0], id: 11, company: "Hybrid Co", location: "Berlin - Hybrid", work_mode: null, triage_status: "new" },
      { ...dashboard.jobs[0], id: 12, company: "Onsite Co", location: "Berlin On-site", work_mode: null, triage_status: "new" },
      { ...dashboard.jobs[0], id: 13, company: "Unknown Co", location: "Remoteville", work_mode: null, triage_status: "new" }
    ];
    render(<App api={{ load: vi.fn().mockResolvedValue({ ...dashboard, jobs }), updateApplication: vi.fn() }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    fireEvent.change(screen.getByLabelText("Work mode"), { target: { value: "remote" } });
    expect(screen.getByText("Remote Co")).toBeInTheDocument();
    expect(screen.getAllByText(/Remote · Germany Remote/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Remoteville")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Work mode"), { target: { value: "hybrid" } });
    expect(screen.getByText("Hybrid Co")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Work mode"), { target: { value: "onsite" } });
    expect(screen.getByText("Onsite Co")).toBeInTheDocument();
  });

  test("role keywords honor an unambiguous title over incidental description", async () => {
    const jobs = [
      { ...dashboard.jobs[0], id: 10, company: "React Role", title: "React Engineer", description: "Our mobile team also uses React Native", triage_status: "new" },
      { ...dashboard.jobs[0], id: 11, company: "Native Role", title: "React Native Engineer", description: "TypeScript Node.js backend collaboration", triage_status: "new" },
      { ...dashboard.jobs[0], id: 12, company: "Generic Role", title: "Frontend Engineer", description: "React Native experience required", triage_status: "new" }
    ];
    render(<App api={{ load: vi.fn().mockResolvedValue({ ...dashboard, jobs }), updateApplication: vi.fn() }} />);
    await screen.findByRole("heading", { name: "Today" });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Jobs" }));
    fireEvent.change(screen.getByLabelText("Role keywords (inferred)"), { target: { value: "react" } });
    expect(screen.getByText("React Role")).toBeInTheDocument();
    expect(screen.queryByText("Native Role")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Role keywords (inferred)"), { target: { value: "react_native" } });
    expect(screen.getByText("Native Role")).toBeInTheDocument();
    expect(screen.getByText("Generic Role")).toBeInTheDocument();
    expect(screen.queryByText("React Role")).not.toBeInTheDocument();
  });

});
