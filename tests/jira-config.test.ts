import { describe, expect, it } from 'vitest';
import { loadJiraConfig } from '@/jira/config';

describe('loadJiraConfig', () => {
  it('returns null when Jira is not configured', () => {
    expect(loadJiraConfig({})).toBeNull();
  });

  it('supports an explicit mock mode', () => {
    expect(loadJiraConfig({ JIRA_MODE: 'mock' })).toEqual({ mode: 'mock' });
  });

  it('configures Jira Cloud with email + API token (basic auth, REST v3)', () => {
    const c = loadJiraConfig({ JIRA_BASE_URL: 'https://acme.atlassian.net/', JIRA_EMAIL: 'a@b.c', JIRA_API_TOKEN: 'tok' });
    expect(c).toMatchObject({
      mode: 'real',
      baseUrl: 'https://acme.atlassian.net',
      auth: { kind: 'basic', email: 'a@b.c', token: 'tok' },
      apiVersion: 3,
      defaultJql: 'statusCategory != Done',
    });
  });

  it('configures Jira Server/Data Center with a personal access token (bearer, REST v2)', () => {
    const c = loadJiraConfig({ JIRA_BASE_URL: 'https://jira.corp', JIRA_PAT: 'pat' });
    expect(c).toMatchObject({ mode: 'real', auth: { kind: 'bearer', token: 'pat' }, apiVersion: 2 });
  });

  it('honours overrides', () => {
    const c = loadJiraConfig({
      JIRA_BASE_URL: 'https://jira.corp',
      JIRA_PAT: 'pat',
      JIRA_API_VERSION: '3',
      JIRA_STORY_POINTS_FIELD: 'customfield_10002',
      JIRA_DEFAULT_JQL: 'status = "To Do"',
    });
    expect(c).toMatchObject({ apiVersion: 3, storyPointsField: 'customfield_10002', defaultJql: 'status = "To Do"' });
  });

  it('fails loudly on partial configuration', () => {
    expect(() => loadJiraConfig({ JIRA_BASE_URL: 'https://x' })).toThrow(/JIRA_EMAIL.*JIRA_API_TOKEN.*JIRA_PAT/s);
    expect(() => loadJiraConfig({ JIRA_EMAIL: 'a@b.c', JIRA_API_TOKEN: 't' })).toThrow(/JIRA_BASE_URL/);
    expect(() => loadJiraConfig({ JIRA_BASE_URL: 'https://x', JIRA_PAT: 'p', JIRA_API_VERSION: '4' })).toThrow(/JIRA_API_VERSION/);
  });
});
