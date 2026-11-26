export type JiraEnv = Record<string, string | undefined>;

export interface RealJiraConfig {
  mode: 'real';
  baseUrl: string;
  auth: { kind: 'basic'; email: string; token: string } | { kind: 'bearer'; token: string };
  /** 3 = Jira Cloud (ADF bodies); 2 = Server / Data Center (plain-text bodies). */
  apiVersion: 2 | 3;
  /** e.g. customfield_10016. Auto-detected by name when omitted. */
  storyPointsField?: string;
  defaultJql: string;
}
export interface MockJiraConfig {
  mode: 'mock';
}
export type JiraConfig = RealJiraConfig | MockJiraConfig;

/**
 * Read Jira settings from environment variables.
 * Returns null when Jira is not configured at all (the app then runs with
 * manually entered tickets only). Throws on *partial* configuration so typos
 * are caught at startup instead of at the first write-back.
 */
export function loadJiraConfig(env: JiraEnv): JiraConfig | null {
  if (env.JIRA_MODE === 'mock') return { mode: 'mock' };

  const { JIRA_BASE_URL: base, JIRA_EMAIL: email, JIRA_API_TOKEN: apiToken, JIRA_PAT: pat } = env;
  if (!base && !email && !apiToken && !pat) return null;

  if (!base) throw new Error('Jira is partially configured: JIRA_BASE_URL is missing');

  let auth: RealJiraConfig['auth'];
  if (pat) auth = { kind: 'bearer', token: pat };
  else if (email && apiToken) auth = { kind: 'basic', email, token: apiToken };
  else {
    throw new Error(
      'Jira auth is incomplete: set JIRA_EMAIL and JIRA_API_TOKEN (Jira Cloud) or JIRA_PAT (Server/Data Center)',
    );
  }

  let apiVersion: 2 | 3 = auth.kind === 'basic' ? 3 : 2;
  if (env.JIRA_API_VERSION) {
    if (env.JIRA_API_VERSION !== '2' && env.JIRA_API_VERSION !== '3') {
      throw new Error('JIRA_API_VERSION must be 2 or 3');
    }
    apiVersion = Number(env.JIRA_API_VERSION) as 2 | 3;
  }

  return {
    mode: 'real',
    baseUrl: base.replace(/\/+$/, ''),
    auth,
    apiVersion,
    storyPointsField: env.JIRA_STORY_POINTS_FIELD || undefined,
    defaultJql: env.JIRA_DEFAULT_JQL || 'statusCategory != Done',
  };
}
