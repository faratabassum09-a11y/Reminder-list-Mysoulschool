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

## Chatbot (Ozzy)

The 🦉 widget in the corner answers most questions instantly with zero API cost — a
rule-based matcher reads the same endpoints the pages already use (percentage, pending/
delayed/completed tasks, leaderboard, "what is X page", navigation, etc). Anything that
doesn't match one of those patterns falls through to Gemini, which gets a live, role-scoped
JSON snapshot of the asker's real data (and, for admins, the whole team's) plus a written
description of how the site works — so it answers from actual numbers instead of guessing,
and can field genuinely open-ended questions about the site or the data.

To turn the AI fallback on, set `GEMINI_API_KEY` in `backend/.env` (free key at
https://aistudio.google.com/apikey). Without it, Ozzy still works — it just tells people AI
answers aren't turned on yet instead of calling out to Gemini. `GEMINI_MODEL` is optional
and defaults to `gemini-3.8-flash`. If Google renames/retires that model again later, set
`GEMINI_MODEL` in `backend/.env` to whatever they recommend — no code change needed.

Ask Ozzy "who are you" / "who made you" and it answers "I'm Ozzy, developed by Fara" — that's
matched instantly on the frontend (no API call needed) and is also baked into the Gemini
system prompt, so the answer is consistent whether or not the AI fallback is configured.
