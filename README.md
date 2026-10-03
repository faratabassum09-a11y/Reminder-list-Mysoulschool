# Reminder List — MERN App

A working frontend + backend for the **Reminder List** system, replacing the
4 linked sheets (Master, Task List, Doer List, Consolidated) with a real app
anyone on the team can use without a spreadsheet admin in the loop.

## How the 4 sheets map to this app

| Old Sheet    | New Home                                                                 |
|--------------|---------------------------------------------------------------------------|
| Doer List    | `Doer` collection + **Doer List** page (each doer can have multiple buddy emails) |
| Task List    | `Task` collection + **Task List** page, merged into the same catalog as Master |
| Master       | `TaskInstance` collection + **Master** page (real Planned/Actual/Status, auto-computed) |
| Consolidated | `SubmissionLog` collection + **Submission Log** page — the raw, unprocessed form-submission history, paginated (52,498 rows) — plus a **Consolidated** page showing the live-computed per-doer rollup from Master |

Status (On Time / Delayed / Pending) is calculated automatically in the backend
whenever an entry is created or marked complete — nobody has to type "Delayed"
by hand.

## Project structure

```
mern-reminder-app/
  backend/     Express + MongoDB (Mongoose) API
  frontend/    React (Vite) dashboard UI
```

## Latest changes

- **Dashboard colours** — per-person on-time %: **70% and below = red**, **71–90% = yellow**, **above 90% = green** (with a small legend above the table).
- **Master date filters** — quick toggles for **Today / Tomorrow / Last Week / Next Week** (click again to clear) plus a **From / To calendar** range. Export CSV follows whatever filter is on screen.
- **MySoul Assistant** — the chatbot is renamed, and now understands questions like "what are my next week tasks", "what's due tomorrow", "upcoming tasks", "delayed tasks last week".
- **Notifications** — **Clear all** and per-item **×** dismiss (page and bell). **View task** now opens Master showing exactly that task (even if you're already on Master).
- **Speed** — see "Performance notes" below.

## Workshop PMS (sub-site)

### Loading the Workshop history (one command)

The whole Google-Sheets history is bundled in `backend/data/`:
`workshops.csv` (206 workshops), `workshop-templates.json` (the 4 fixed task lists),
`workshop-tasks.json` (10,715 tasks with planned / actual / on-time-or-delayed).

```
cd backend
npm run seed:workshops -- --dry-run   # check the files only
npm run seed:workshops                # load into MongoDB
```

It also creates one Response per completed task and sets the ID counters
(next new UTW is UTW-97, ICP-85, R12-27, THW-22; task numbering continues after WTS-11340).
Re-running replaces the workshop data; it refuses if workshops were created inside the app
unless you add `--force`.


After signing in you land on an **app chooser** (`/hub`): **Reminder List** (everything above, unchanged)
or **Workshop PMS** (`/workshops`). "All apps" at the foot of either sidebar brings you back.

**Flow** — replaces the Google Form + Apps Script:

1. Anyone signed in opens **New Workshop** and submits type, start date/time and days. Start Day and the
   Workshop ID (`UTW-17`, `ICP-4` …) are filled in automatically.
2. It appears under **Approvals** as *Awaiting approval*. An **admin** approves or rejects (with a reason).
3. On approval the type's **fixed task list** is copied into real tasks (`UTW-17-WTS-1204` …), each with an
   owner, due time (start date + `T-7` / `T` / `T+2` offset, at the task's time, India time) and score.
4. The workshop is POSTed to the **Launch Verification** Apps Script (`LAUNCH_WEBHOOK_URL`); the
   **Launches** page shows what was sent, reads the remote feed back, and can resend anything missing.
5. Owners tick tasks off under **Tasks** ("Done" → when they finished). Done before due = full score, after = 0.

| Page | Who | What |
|---|---|---|
| Overview | all | upcoming workshops, your open tasks, on-time rate |
| New Workshop | all | submit a request (admins can approve on the spot) |
| Approvals | all see, admin acts | approve / reject / edit / delete |
| Workshops → detail | all | progress, task table; admin: reschedule (re-times open tasks + re-sends launch), resend, delete |
| Tasks | all | every task; filters, "only mine", CSV export; members can complete only their own |
| Launches | admin | hand-off status + remote feed check |
| Task Lists | admin | edit the 4 fixed lists, **paste straight from the Google Sheet** (columns B:F), ID numbering |

**First-time setup**

1. Set `LAUNCH_WEBHOOK_URL` in `backend/.env` (see `.env.example`).
2. Sign in as admin → **Task Lists** → for each of UTW / ICP / R12 / THW use **Paste from Sheets** (copy columns
   B:F of the old task-list tab: Task · Timeline · Time · Owner · Score) and **Save**. Owners are matched by name
   against the Doer List. Check R12/THW "usual days / time" — those two are placeholders.
3. Same page → **ID numbering**: enter the last number already used per series so new IDs continue from the sheet.

New workshop types: pick **New workshop** on the New Workshop form (or POST `/api/workshops/templates` as admin) — no code change or restart needed. Add its tasks under Task Lists; they're created automatically for approved workshops of that type.

Tasks page is server-paged (`GET /api/workshops/tasks?page=1&limit=100`).
Collections added: `workshops`, `workshoptasks`, `workshoptemplates`, `workshopcounters`.

## Performance notes

- Two-layer cache (`backend/utils/cache.js`): in-memory first (no network hop), Redis second (optional, shared).
  Master lists and Dashboard rollups are cached for a few seconds and instantly retired whenever Master changes.
- Doers/Tasks are joined from memory instead of `populate()` on every request; the signed-in user lookup is cached for 20s.
- The "generate upcoming" job now has an in-memory cooldown, so it no longer re-runs on every Master visit when Redis isn't set.
- Frontend: pages are code-split and prefetched when idle, the last signed-in user is cached so the app paints before the server answers, and Doers/Tasks lists are cached client-side for 30s.
- On Render, the server pings its own `/api/health` every 10 minutes so the free tier doesn't fall asleep (set `KEEP_ALIVE=0` to disable).

## 1. Backend setup

```bash
cd backend
npm install
cp .env.example .env     # edit MONGO_URI if not running Mongo locally
npm run seed:real         # loads ALL the real data from all 4 sheets (see below)
# npm run seed             # or: a tiny made-up sample dataset instead
npm run dev                # starts API on http://localhost:5000
```

### Real data import (`npm run seed:real`)

`backend/data/*.json` holds the actual data pulled from every tab of the
"Reminder List" workbook:

- **doers.json** (22 rows) — every person from the Doer List tab, with department, email,
  and a **list** of buddy emails (some people have 2–5 buddies in the sheet, not just one).
- **tasks.json** (489 rows) — the de-duplicated catalog of every distinct recurring task
  (task name + department + frequency), combined from both the Task List and Master tabs,
  with the person who most recently owned it as the default assignee.
  Frequency codes: `D` Daily, `W` Weekly, `M` Monthly, `Q` Quarterly, `Y` Yearly,
  and `E1st`/`E2nd`/`E3rd`/`E4th` for "every Nth of the month" tasks from the sheet.
- **instances.json** (58,828 rows) — every occurrence from the Master tab, plus any Task
  List rows not already present in Master. Each row carries its real `Planned` date and,
  where the sheet recorded one, its real `Actual` completion timestamp. Status is computed
  the same way the Master sheet itself does it: `actual <= planned` → **On Time**,
  `actual > planned` → **Delayed**, no actual yet → **Pending** (or **Delayed** if the
  planned time has already passed).
- **submissions.json** (52,498 rows) — the raw Consolidated tab: one row per "task done"
  form submission (Task Id, Timestamp, Name, Task), including rows where the sheet's own
  name/task lookup came back blank. Kept exactly as-is rather than merged into Master, since
  it's a different kind of record (a raw event log vs. a processed planned/actual row).
  Browse it on the **Submission Log** page (paginated, with search).

Re-run `npm run seed:real` any time — it wipes and reloads all four collections from those
JSON files, so regenerate the JSON from a fresh sheet export whenever the sheet changes.

⚠️ This is a big seed (~112k documents total across `instances.json` + `submissions.json`),
so it'll take noticeably longer than the old sample seed. `insertMany` batches automatically,
so it should still complete in well under a minute against a local MongoDB.

## 2. Frontend setup

```bash
cd frontend
npm install
npm run dev                # starts Vite dev server, proxies /api to the backend
```

## Pages

- **Dashboard** — overall totals and per-department on-time rate.
- **Master** — every task instance, filterable by status, with a "mark complete" action.
- **Task List** — the recurring task catalog.
- **Doer List** — the team directory, including multiple buddy emails per person.
- **Consolidated** — live per-doer rollup (total / on-time / delayed / pending / %) computed
  from Master, no duplicate data entry required.
- **Submission Log** — the raw Consolidated-tab history, paginated with a task-text search.
- **Messages** — private, one-to-one chat with anyone signed in (search-to-start, live-ish via
  polling), plus a pinned **Doer List Announcements** thread: any admin can post one message
  that reaches every active person on the Doer List who also has a login (matched by email),
  and everyone signed in can read it. A red badge in the sidebar tracks unread DMs +
  announcements, the same way the notification bell tracks admin notifications.

## Chatbot (MySoul Assistant)

The 🦉 widget in the corner answers most questions instantly with zero API cost — a
rule-based matcher reads the same endpoints the pages already use (percentage, pending/
delayed/completed tasks, leaderboard, "what is X page", navigation, etc). Anything that
doesn't match one of those patterns falls through to Gemini, which gets a live, role-scoped
JSON snapshot of the asker's real data (and, for admins, the whole team's) plus a written
description of how the site works — so it answers from actual numbers instead of guessing,
and can field genuinely open-ended questions about the site or the data.

To turn the AI fallback on, set `GEMINI_API_KEY` in `backend/.env` (free key at
https://aistudio.google.com/apikey). Without it, MySoul Assistant still works — it just tells people AI
answers aren't turned on yet instead of calling out to Gemini. `GEMINI_MODEL` is optional
and defaults to `gemini-3.8-flash`. If Google renames/retires that model again later, set
`GEMINI_MODEL` in `backend/.env` to whatever they recommend — no code change needed.

Ask MySoul Assistant "who are you" / "who made you" and it answers "I'm MySoul Assistant, developed by Fara" — that's
matched instantly on the frontend (no API call needed) and is also baked into the Gemini
system prompt, so the answer is consistent whether or not the AI fallback is configured.

## Help Tickets

Replaces the "Help Ticket" Google Form. Any doer can raise a ticket to any other doer.

- **Help Tickets** (sidebar, everyone): *Inbox* = tickets raised **to me** (only I can see these), *Raised by me* = tickets I raised. The assignee can mark a ticket In Progress / Resolved with a note; the raiser can withdraw it while it's still Open. A red badge shows how many unresolved tickets are waiting on you.
- **Tickets Raised** (sidebar, admin only): every ticket between every pair of doers, with search, status filter, status change and delete.
- Visibility is enforced on the server (`backend/routes/tickets.js`): a ticket is only returned to its assignee, its raiser, and admins.
- A login is matched to a Doer by **email** (same as Master). A user with no matching Doer can't raise or receive tickets.
- Form fields: Raised By, PC Accountable (Dolly / Paridhi — change with `TICKET_PC_NAMES=Dolly,Paridhi` in the backend env), Issue, Assigned To, Planned Date + Time of Resolution.
- The assignee also gets an email when SMTP is configured (best effort; the ticket is created either way).
