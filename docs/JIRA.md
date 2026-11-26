# Jira integration

Only the **host** talks to Jira — from their own browser, through the **Jira helper** running on their own computer.
Guests never need Jira access or any setup; tickets and results are streamed to them by the host.

## Why a local helper

The app is a static site without a server. A browser page may only call another site (Jira) if that site allows it
with **CORS** headers, which Jira servers usually do not do for arbitrary sites. And API tokens should not live in a web page.
The helper solves both:

* it reads the credentials from a `.env` file on the host's machine — they **never** enter the browser;
* it answers the browser's CORS requests itself and forwards the app's Jira calls, adding the credentials.

**Hosting a room requires a running helper that is signed in to Jira**; the start page shows its state and how to start it.
In the room, the host sees whether the helper is connected; while it is not, import and write-back pause (estimating continues,
and failed write-backs can be retried later).

## Running the helper

Needs Node.js 18 or newer. Either download `jira-helper.mjs` from the start page (it is served by the site) and put a `.env`
next to it, or use a clone of this repository (`.env` in the repository root):

```bash
node jira-helper.mjs --origin https://you.github.io                 # downloaded file
npm run jira-helper -- --origin https://you.github.io               # in the repository
npm run jira-helper                                                  # local development (allows http://localhost:3000)
```

It listens on `http://127.0.0.1:8787` (only on this machine), checks the Jira login and prints e.g.
`✓ Connected to https://jira.example.com as Alex`. The page finds it automatically (another address can be set under
*Helper address* on the start page). Options: `--origin <site>` (repeatable, or comma-separated), `--port <n>`, `--env <file>`.
Without `--env` it reads `.env.local`, then `.env` from the current folder, then from the helper's own folder.
Environment variables that are already set take precedence over the file.

Chrome and Edge may ask whether the site may access devices on your local network the first time — allow it, that is the helper.

## `.env` for the helper

| Variable | Required | Description |
| --- | --- | --- |
| `JIRA_BASE_URL` | yes | e.g. `https://your-company.atlassian.net` or `https://jira.example.com/jira` (context paths work). Alias: `JIRA_URL`. |
| `JIRA_API_TOKEN` | yes | Cloud: an [API token](https://id.atlassian.com/manage-profile/security/api-tokens). Server/DC: a personal access token. Alias: `JIRA_PERSONAL_TOKEN` (implies bearer). |
| `JIRA_AUTH` | no | `basic` (`email:token`, Cloud) or `bearer` (Server/DC personal access token). Default: `bearer` for `JIRA_PERSONAL_TOKEN`, otherwise `basic` when an email is set, else `bearer`. |
| `JIRA_EMAIL` | for basic auth | Account email (Cloud) or username. Alias: `JIRA_USERNAME`. |
| `JIRA_STORY_POINTS_FIELD` | no | Field id such as `customfield_10016`. If unset, the app looks for a field named *Story point estimate* or *Story Points* via `GET /rest/api/2/field`. |
| `HELPER_ORIGINS` | no | Allowed sites, comma-separated (same as `--origin`). |
| `HELPER_PORT` | no | Port (default 8787; same as `--port`). |

See [`.env.example`](../.env.example). Never commit a real `.env`.

## What the helper allows

* Listens on `127.0.0.1` only.
* Answers only the allowed origins (`--origin`); every other site — and requests without an `Origin` — get `403`.
  It answers CORS preflights itself, including Chrome's Private Network Access (`Access-Control-Allow-Private-Network`).
* `GET /status` → `{ ok, user, jiraUrl, storyPointsField }` (or `{ ok: false, error }`); never includes credentials.
* Forwards **only** the calls the app makes; everything else is `404`:

| Purpose | Call |
| --- | --- |
| sign-in check | `GET /rest/api/2/myself` |
| list / search boards | `GET /rest/agile/1.0/board` (`?name=…` for the autocomplete) |
| board details | `GET /rest/agile/1.0/board/{id}` |
| list sprints | `GET /rest/agile/1.0/board/{id}/sprint?state=active,future` |
| backlog issues | `GET /rest/agile/1.0/board/{id}/backlog?jql=statusCategory != Done` |
| all open issues / search | `GET /rest/agile/1.0/board/{id}/issue?jql=statusCategory != Done [AND text ~ "…*"] ORDER BY Rank ASC` |
| sprint issues | `GET /rest/agile/1.0/sprint/{id}/issue?jql=statusCategory != Done` |
| discover points field | `GET /rest/api/2/field` |
| fetch issue by key | `GET /rest/api/2/issue/{key}` |
| write estimate | `PUT /rest/api/2/issue/{key}` — body must set exactly **one numeric field** |
| write comment | `POST /rest/api/2/issue/{key}/comment` — body must be a plain `{ "body": "…" }` |

* Adds the credentials itself (any `Authorization` sent by the browser is ignored), drops cookies, and sends
  `X-Atlassian-Token: no-check` (Jira Server/DC's XSRF check).

Anyone who can make the **allowed site** run code could act as the helper's Jira user while it runs — only allow the
site you use, and stop the helper (Ctrl+C) after the session.

## Importing

A room can be bound to a board when it is created (autocomplete on the start page, backed by Jira's board `name` filter).
The import dialog opens on that board; another board can be picked there.

The host chooses where to take tickets from — *Backlog* or an active/future sprint (scrum boards only; Jira rejects both
for kanban boards) or *All open issues on the board* — or types in the search box: free text (Jira's `text ~` search,
input reduced to plain terms so it cannot change the JQL) or an exact key such as `PROJ-123`, which is looked up directly.
Selections survive new searches, so tickets can be collected from several searches and added in one go, in the order picked.
Only issues whose status category is **not Done** are listed (an exact key lookup also finds done issues).
Already imported issues are shown as "in session" and cannot be added twice. Listing all issues is capped at 500, a search at 50 hits.
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

* Everyone in the room gets a toast when the write-back succeeds or fails.
* If Jira or the helper fails, the ticket **stays estimated** with `failed` and the error text; the host can **retry**.
  If only the comment failed, the points were saved already; a retry writes both again (so the comment may then appear twice).
* If the ticket is reopened or removed while a write is in flight, the late result is discarded.
* Comments appear as the helper's Jira user.

## Security notes

* Credentials stay in the helper's `.env` on the host's machine; the browser, the room's guests and the relay never see them.
* The room (tickets, history, participant tokens) is stored in the host's browser (`localStorage`). Guests store only their own token.
* Issue descriptions are rendered from a safe subset of Jira wiki markup as plain React text (never as HTML); only `http(s)` links are clickable.
* Anyone who knows a room code can join that room while the host has it open. Codes are 8 characters from a 31-letter alphabet (~40 bits); share invite links only with your team.
