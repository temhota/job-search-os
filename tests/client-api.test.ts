import { afterEach, describe, expect, test, vi } from "vitest";
import { defaultApi } from "../src/client/api.js";

afterEach(() => vi.unstubAllGlobals());

const sourceInput = { name: "React roles", searchUrl: "https://jobs.example.com/search?q=react&region=eu", category: "both" as const };

describe("defaultApi search source mutations", () => {
  test("shows the server duplicate URL error for a normalized duplicate create", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Search source URL already exists" }), {
      status: 409,
      headers: { "content-type": "application/json" }
    })));

    await expect(defaultApi.createSearchSource!({ ...sourceInput, searchUrl: "HTTPS://JOBS.EXAMPLE.COM:443/search/?region=eu&q=react#results" }))
      .rejects.toThrow("Search source URL already exists");
  });

  test("shows a recognized validation error for an invalid update", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Invalid search source update" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    })));

    await expect(defaultApi.updateSearchSource!(7, { searchUrl: "javascript:alert(1)" }))
      .rejects.toThrow("Invalid search source update");
  });

  test.each([
    [400, "text/html", "<script>alert('bad')</script>"],
    [409, "application/json", JSON.stringify({ error: "<img src=x onerror=alert(1)>" })],
    [409, "application/json", JSON.stringify({ error: 42 })],
    [500, "application/json", JSON.stringify({ error: "Search source URL already exists" })]
  ])("falls back to the generic error for an unsafe or unexpected response (%i, %s)", async (status, contentType, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, {
      status,
      headers: { "content-type": contentType }
    })));

    await expect(defaultApi.createSearchSource!(sourceInput)).rejects.toThrow("Unable to save search source");
  });
});

describe("defaultApi follow-up drafts", () => {
  test("posts to the local draft endpoint and returns its result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ opened: true }), {
      status: 201,
      headers: { "content-type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(defaultApi.openFollowUpDraft!(9)).resolves.toEqual({ opened: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/follow-ups/9/email-draft", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}"
    });
  });

  test("distinguishes a missing safe thread from an Apple Mail failure", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "No replyable email thread found" }), { status: 409, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Unable to open Apple Mail draft" }), { status: 503, headers: { "content-type": "application/json" } })));

    await expect(defaultApi.openFollowUpDraft!(9)).rejects.toThrow("No replyable email thread was found. Copy the draft instead.");
    await expect(defaultApi.openFollowUpDraft!(9)).rejects.toThrow("Unable to open a native Apple Mail reply. The draft text has been copied.");
  });
});
