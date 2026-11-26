# Jira integration

## Modes

| Mode | How |
| --- | --- |
| **Off** | Default when no `JIRA_*` variable is set. Tickets are added manually; the import button reports that Jira is not configured. |
| **Mock** | `JIRA_MOCK=1` or `npm run demo`. A built-in demo board (`DEMO-101…106`, one backlog + two sprints). Writes are kept in memory. |
| **Real** | `JIRA_BASE_URL` + `JIRA_API_TOKEN` (+ `JIRA_EMAIL` for Cloud). |

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `JIRA_MOCK` | no | `1`/`true` enables the mock and ignores the other Jira variables. |
| `JIRA_BASE_URL` | for real Jira | e.g. `https://your-company.atlassian.net` (no trailing path). |
| `JIRA_API_TOKEN` | for real Jira | Cloud: an [API token](https://id.atlassian.com/manage-profile/security/api-tokens). Server/DC: a personal access token. |
| `JIRA_EMAIL` | Cloud (basic auth) | Account email belonging to the token. |
| `JIRA_AUTH` | no | `basic` (default, `email:token`) or `bearer` (Server / Data Center PAT). |
| `JIRA_STORY_POINTS_FIELD` | no | Field id such as `customfield_10016`. If unset, the server looks for a field named *Story point estimate* or *Story Points* via `GET /rest/api/2/field`. |

A half-configured environment (e.g. base URL without token) makes the server **fail at start-up** with a clear message
rather than silently running without Jira.

Other server variables: `PORT` (default 3000), `HOST` (default `0.0.0.0`) and `DATA_DIR` (default `./data`).

## What the account needs

* *Browse projects* on the relevant projects and access to the boards (Jira Software).
* *Edit issues* (to set story points) and *Add comments*.

## Importing

The host opens **Import from Jira**, chooses a board, then *Backlog* or an active/future sprint, and ticks issues.
Only issues whose status category is **not Done** are listed. Already imported issues are shown as "on board" and cannot be added twice.
The browser sends only the issue **keys**; the server re-fetches summary, description and current estimate from Jira,
so a client cannot inject forged ticket data.

Endpoints used (REST v2 is used for issue operations because it works on both Cloud and Server/DC with plain-text comments):

| Purpose | Call |
| --- | --- |
| list boards | `GET /rest/agile/1.0/board` (paginated) |
| list sprints | `GET /rest/agile/1.0/board/{id}/sprint?state=active,future` |
| backlog issues | `GET /rest/agile/1.0/board/{id}/backlog?jql=statusCategory != Done` |
| sprint issues | `GET /rest/agile/1.0/sprint/{id}/issue?jql=statusCategory != Done` |
| fetch issues by key | `GET /rest/api/2/issue/{key}` |
| discover points field | `GET /rest/api/2/field` |
| write estimate | `PUT /rest/api/2/issue/{key}` with `{"fields": {"<points field>": n}}` |
| write comment | `POST /rest/api/2/issue/{key}/comment` |

Issue keys are validated (`PROJ-123`) before being placed in a URL.

## Write-back

When a Jira ticket is finalized, `writeback.status` moves `none → pending → synced | failed`:

1. The story points field is set to the estimate.
2. A comment is added, e.g.

   ```
   Planning Poker estimate: 8 story points (agreement after 2 rounds) - Sprint 42
   Round 1: 3, 21 (spread 4 steps)
   Round 2: 8 x2 (spread 0 steps)
   ```

   (anonymous distribution; marked "set by the facilitator" instead of "agreement" for an override).

* If Jira fails, the ticket **stays estimated** with `failed` and the error text; the host can **retry**.
  If only the comment failed, the points were saved already; a retry writes both again (so the comment may then appear twice).
* If the ticket is reopened or removed while a write is in flight, the late result is discarded.
* Only the host can trigger a retry.

## Security notes

* Jira credentials live only on the server and are never sent to browsers. All users act through the **one configured account**,
  so comments appear as that account.
* Browsing boards and exporting history require the host's secret participant token (`x-participant-token`).
* Anyone who knows a room code can join that room. Codes are 8 characters from a 31-letter alphabet (~40 bits); share invite links only with your team.
* Run behind HTTPS (reverse proxy) outside trusted networks; the rooms file contains participant tokens (file mode 0600).
