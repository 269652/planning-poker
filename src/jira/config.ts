import { JiraClient } from "./client";
import { MockJira } from "./mock";
import type { JiraGateway } from "./types";

type Env = Record<string, string | undefined>;

/** Builds the Jira gateway from environment variables; null when Jira is not configured. */
export function jiraFromEnv(env: Env): JiraGateway | null {
  if (env.JIRA_MOCK === "1" || env.JIRA_MOCK === "true") return new MockJira();
  const baseUrl = env.JIRA_BASE_URL;
  const apiToken = env.JIRA_API_TOKEN;
  if (!baseUrl && !apiToken) return null;
  if (!baseUrl) throw new Error("JIRA_BASE_URL is required when Jira is configured");
  if (!apiToken) throw new Error("JIRA_API_TOKEN is required when JIRA_BASE_URL is set");
  const authType = env.JIRA_AUTH === "bearer" ? "bearer" : "basic";
  if (authType === "basic" && !env.JIRA_EMAIL) throw new Error("JIRA_EMAIL is required for basic auth (use JIRA_AUTH=bearer for personal access tokens)");
  return new JiraClient({
    baseUrl, apiToken, authType, email: env.JIRA_EMAIL, storyPointsField: env.JIRA_STORY_POINTS_FIELD || undefined,
  });
}
