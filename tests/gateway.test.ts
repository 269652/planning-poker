import { describe, expect, it } from 'vitest';
import { MockJiraGateway, RealJiraGateway, createGateway } from '@/jira/gateway';

describe('createGateway', () => {
  it('returns null when unconfigured', () => {
    expect(createGateway({})).toBeNull();
  });
  it('returns the mock for JIRA_MODE=mock', () => {
    expect(createGateway({ JIRA_MODE: 'mock' })).toBeInstanceOf(MockJiraGateway);
  });
  it('returns the real gateway for full config', () => {
    const g = createGateway({ JIRA_BASE_URL: 'https://x.atlassian.net', JIRA_EMAIL: 'a@b.c', JIRA_API_TOKEN: 't' });
    expect(g).toBeInstanceOf(RealJiraGateway);
    expect(g!.mode).toBe('real');
  });
});

describe('MockJiraGateway', () => {
  it('serves demo boards, sprints and issues', async () => {
    const g = new MockJiraGateway();
    const boards = await g.listBoards();
    expect(boards.length).toBeGreaterThan(0);
    expect(await g.listBoards('zzzz-no-match')).toEqual([]);
    const sprints = await g.listSprints(boards[0].id);
    expect(sprints.length).toBeGreaterThan(0);
    const issues = await g.fetchIssues({ boardId: boards[0].id });
    expect(issues.length).toBeGreaterThan(2);
    expect(issues[0]).toMatchObject({ source: 'jira' });
    expect(issues[0].key).toMatch(/^[A-Z]+-\d+$/);
  });

  it('records write-backs and reflects them in later reads', async () => {
    const g = new MockJiraGateway();
    const [board] = await g.listBoards();
    const [first] = await g.fetchIssues({ boardId: board.id });
    await g.writeEstimate(first.key!, 8, ['Agreed 8']);
    expect(g.written).toEqual([{ key: first.key, points: 8, lines: ['Agreed 8'] }]);
    const again = await g.fetchIssues({ boardId: board.id });
    expect(again.find((i) => i.key === first.key)!.currentEstimate).toBe(8);
  });

  it('rejects unknown issues', async () => {
    await expect(new MockJiraGateway().writeEstimate('NOPE-1', 3, [])).rejects.toThrow(/not found/i);
  });
});
