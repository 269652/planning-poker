import { describe, it, expect } from "vitest";
import { probeHelper, gatewayForHelper, helperCommand, DEFAULT_HELPER_URL } from "@/jira/helper";
import { JiraClient } from "@/jira/client";

const respond = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

describe("probeHelper (the host's browser checks the local Jira helper)", () => {
  it("reports a connected helper", async () => {
    const s = await probeHelper(DEFAULT_HELPER_URL, respond(200, { ok: true, user: "Moritz", jiraUrl: "https://j/jira", storyPointsField: "customfield_1" }));
    expect(s).toEqual({ state: "connected", user: "Moritz", jiraUrl: "https://j/jira", storyPointsField: "customfield_1" });
  });

  it("reports a running helper whose Jira login fails", async () => {
    expect(await probeHelper(DEFAULT_HELPER_URL, respond(200, { ok: false, error: "Jira answered 401" })))
      .toEqual({ state: "jira-error", error: "Jira answered 401" });
  });

  it("reports a helper that is not running or refuses this site", async () => {
    const down = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
    expect(await probeHelper(DEFAULT_HELPER_URL, down)).toMatchObject({ state: "offline" });
    expect(await probeHelper(DEFAULT_HELPER_URL, respond(403, { error: "Origin not allowed" }))).toEqual({ state: "offline", error: "Origin not allowed" });
  });

  it("calls /status on the given helper URL", async () => {
    const urls: string[] = [];
    await probeHelper("http://127.0.0.1:9999/", (async (u: RequestInfo | URL) => { urls.push(String(u)); return new Response("{}"); }) as typeof fetch);
    expect(urls).toEqual(["http://127.0.0.1:9999/status"]);
  });
});

describe("gatewayForHelper / helperCommand", () => {
  it("builds a Jira client that talks to the helper without credentials and links issues to Jira", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fn = (async (u: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(u), auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify({ key: "BMG-1", fields: { summary: "s" } }));
    }) as typeof fetch;
    const g = gatewayForHelper(DEFAULT_HELPER_URL, { state: "connected", user: "u", jiraUrl: "https://j/jira", storyPointsField: "customfield_1" }, fn);
    expect(g).toBeInstanceOf(JiraClient);
    const [issue] = await g.getIssues(["BMG-1"]);
    expect(seen[0]).toEqual({ url: "http://127.0.0.1:8787/rest/api/2/issue/BMG-1?fields=summary,description,status,issuetype,customfield_1", auth: null });
    expect(issue.url).toBe("https://j/jira/browse/BMG-1");
  });

  it("tells the host exactly how to start the helper for this site", () => {
    expect(helperCommand("https://me.github.io")).toBe("node jira-helper.mjs --origin https://me.github.io");
  });
});
