import { JiraClient } from "./client";

/** Where the host's local Jira helper (public/jira-helper.mjs) listens by default. */
export const DEFAULT_HELPER_URL = "http://127.0.0.1:8787";

export type HelperStatus =
  | { state: "checking" }
  | { state: "offline"; error?: string }
  | { state: "jira-error"; error: string }
  | { state: "connected"; user: string; jiraUrl: string; storyPointsField: string | null };

/** Asks the local helper whether it runs and is logged in to Jira. Never throws. */
export async function probeHelper(url: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<HelperStatus> {
  let res: Response;
  try {
    res = await fetchImpl(`${url.replace(/\/+$/, "")}/status`, { cache: "no-store" });
  } catch {
    return { state: "offline" };
  }
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) return { state: "offline", error: typeof body.error === "string" ? body.error : `Helper answered ${res.status}` };
  if (body.ok === true && typeof body.jiraUrl === "string") {
    return {
      state: "connected", user: String(body.user ?? "unknown"), jiraUrl: body.jiraUrl,
      storyPointsField: typeof body.storyPointsField === "string" ? body.storyPointsField : null,
    };
  }
  return { state: "jira-error", error: typeof body.error === "string" ? body.error : "The helper could not log in to Jira" };
}

/** Jira gateway for the host's browser: all calls go through the helper, which adds the credentials. */
export function gatewayForHelper(
  url: string, status: Extract<HelperStatus, { state: "connected" }>, fetchImpl?: typeof fetch,
): JiraClient {
  return new JiraClient({
    baseUrl: status.jiraUrl, proxyUrl: url, authType: "none", storyPointsField: status.storyPointsField ?? undefined,
  }, fetchImpl);
}

/** The command a host runs (next to their .env) to allow exactly this site. */
export function helperCommand(origin: string): string {
  return `node jira-helper.mjs --origin ${origin}`;
}
