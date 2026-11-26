# Jira integration

Code: `src/jira/` (`config.ts`, `client.ts`, `adf.ts`, `gateway.ts`), orchestration in `src/server/roomManager.ts`.
Credentials are read from environment variables by the server only and are never sent to browsers.

## Setup

**Jira Cloud** – create an API token at <https://id.atlassian.com/manage-profile/security/api-tokens>:

```bash
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=...
```

**Jira Server / Data Center** – create a personal access token:

```bash
JIRA_BASE_URL=https://jira.example.com
JIRA_PAT=...
```

Defaults: Cloud (email+token) → REST v3 with ADF comments; PAT → REST v2 with plain-text comments (override with `JIRA_API_VERSION`).
Partial configuration (e.g. only `JIRA_BASE_URL`) makes the server fail at startup with a clear message.

The Jira user needs **Browse projects** (read boards/issues), **Edit issues** (set story points) and **Add comments**.

**Story points field** – set `JIRA_STORY_POINTS_FIELD=customfield_XXXXX` or let the app find the number field named
*Story point estimate* (preferred) or *Story Points* via `GET /rest/api/{v}/field`. If neither exists the import fails with
instructions. The field must be on the issue's edit screen, otherwise Jira rejects the update (the error is shown in the room).

**Demo** – `JIRA_MODE=mock` serves in-memory boards/issues; write-backs are recorded in memory only.

## Flow

1. Host: *Import from Jira…* → board (`GET /rest/agile/1.0/board`) → optional sprint (`…/board/{id}/sprint?state=active,future`; Kanban boards return none) → optional JQL.
2. Issues are fetched with `GET /rest/agile/1.0/board/{id}/issue` (or `/sprint/{id}/issue`), paged by 50, filtered with the JQL (default `JIRA_DEFAULT_JQL` = `statusCategory != Done`), keeping the board's rank order.
3. Tickets are added to the room (de-duplicated by issue key; re-importing refreshes title/description/existing estimate but keeps rounds and decisions). Descriptions (ADF or text) are shown as plain text; the existing estimate is shown for reference.
4. On agreement the app performs:
   - `PUT /rest/api/{v}/issue/{key}` with `{"fields": {"<storyPointsField>": <estimate>}}`
   - `POST /rest/api/{v}/issue/{key}/comment` with the round summary (see [ESTIMATION.md](ESTIMATION.md#write-back-summary)).

## Write-back behaviour

- Mode **automatic** (default) writes as soon as the host accepts; mode **manual** waits for the host's *Write to Jira* button. Switch it in the room settings.
- Only tickets that came from the Jira import are written; manually added tickets never touch Jira (a client cannot create a `jira` ticket or choose the issue key).
- State per ticket: `none → pending → written | failed`. A failure (permissions, workflow, network) is stored with its message and shown to everyone; the host can **Retry**. The estimate is written first; if only the comment fails the message says *Estimate was saved, but adding the comment failed…*.
- If the ticket is reopened or re-decided while a write is in flight, the late result is ignored.
- Re-estimating (`reopen`) and accepting again overwrites the Jira value.
- Error messages never include credentials; 401 and 403 add a hint.
