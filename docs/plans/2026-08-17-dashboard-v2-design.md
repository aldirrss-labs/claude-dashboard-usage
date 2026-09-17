# Dashboard v2 — Design

Date: 2026-08-17

## Context

Five requests from the user against the usage dashboard already in service:

1. A manual "Sync Now" button on the Projects and Dashboard pages.
2. Change the project list's default sort to "last active", plus new sort options.
3. Fix an anomaly: one physical project splitting into several rows in the Projects list.
4. A back button on the project detail page.
5. Additional features to make the dashboard more "advanced".

## 1. Fixing duplicate projects

**Root cause (confirmed by querying `~/.claude-dashboard/usage.db` directly):** `projects.slug`
(the raw folder name Claude Code derives from the cwd, dash-separated) was used as the dedup key.
It splits into several rows for the same project when:

- A git worktree creates a `<slug>--claude-worktrees-<name>` folder — physically a different
  directory, but conceptually the same project.
- `decodeProjectSlug()` (`lib/paths.ts`) reconstructs a path from the slug with
  `slug.replace(/-/g, "/")`, which is lossy whenever a real path segment contains a literal dash
  (e.g. `development-agent`).

Real examples from the database: `development-agent` had 5 separate `projects` rows (1 real + 4
worktrees), and `premium` mixed together 2 different projects that happened to share a folder
basename.

**Approach:** schema migration + data merge, with a new dedup key based on `canonical_path`
(not `slug`).

### Schema change

```sql
ALTER TABLE projects ADD COLUMN canonical_path TEXT;
CREATE UNIQUE INDEX idx_projects_canonical_path ON projects(canonical_path);
```

`slug` stays (for reference/debugging) but is no longer the unique constraint used for deduping.

### Path normalisation

A new `normalizeCanonicalPath(displayPath): string` in `lib/paths.ts`:

- Strip the `--claude-worktrees-.*$` suffix from `display_path` (not from `slug` — `display_path`
  already uses the real, non-lossy `cwd` for most rows, courtesy of `ensureProject`, which already
  stores `cwd` when it is available).
- Rows whose `display_path` came from the lossy `decodeProjectSlug()` fallback (flagged via a
  `path_source` column where missing, or re-detected during migration from history) are **not**
  force-merged — they stand as separate rows, so two genuinely different projects that merely look
  alike are never merged by mistake.

### Data migration (one-time, run before `ensureProject` starts using the new schema)

1. **Backup first**: copy `usage.db` → `usage.db.bak-<timestamp>` before the migration runs at all.
2. Compute `canonical_path` for every existing `projects` row.
3. Group by `canonical_path`. For any group with more than one row:
   - Pick the "primary" row = earliest `first_seen_at`.
   - Re-point `sessions.project_id` and `usage_events.project_id` from the non-primary rows to the
     primary one.
   - Delete the non-primary `projects` rows.
4. Set `canonical_path` on the surviving primary rows (and on the single rows that were not grouped).
5. Log a summary: project count before/after, and the list of merges performed, for audit.

### `ensureProject()` change (`lib/ingest.ts`)

From here on, lookup/insert keys off `canonical_path` (computed from the incoming `cwd`) rather than
the raw `slug`. A new worktree for an existing project attaches to the same row automatically
instead of creating another one.

## 2. Sync Now button

- `POST /api/ingest/sync` — calls `runIngestCycle()` (the same function the scheduler uses) and
  returns `{ filesScanned, eventsInserted, syncedAt }`.
- `GET /api/ingest/status` — returns `{ lastSyncedAt }` from `MAX(updated_at)` in `ingest_state`,
  used to show status without triggering a sync.
- A `SyncButton.tsx` component shared by the Dashboard and Projects pages: a button with a loading
  state that resolves to success ("Synced X seconds ago"). On success the page refetches the
  relevant data.

## 3. Default sort and new options (Projects page)

- Default `SortKey` changes from `"totalTokens"` to `"lastActiveAt"`.
- New sort options: project name (alphabetical), session count.
- An ascending/descending toggle (clicking the same option again reverses direction), with an arrow
  indicator in the dropdown/header.

## 4. Back button on the project detail page

`<Link href="/projects">← Back to Projects</Link>` above the title in
`app/projects/[slug]/page.tsx`. Not `router.back()`, so a user who landed directly via URL is not
thrown out of the app.

## 5. Advanced features

### A. Cost and efficiency analysis

- A "Cache savings" card on the Dashboard: the estimated dollars saved by cache reads compared with
  those tokens being billed as ordinary input, computed from `model_pricing`.
- Monthly cost projection: average daily cost over the selected range × 30, shown as small text
  under the "Estimated cost" card.

### B. Project comparison and trend

- A "Top Projects" table on the Dashboard (top 5 by cost) with a mini tokens/day sparkline per row —
  a feature already planned in the original design but not yet built.
- A week-over-week % column in the Projects table, against the previous week.

### C. Deeper session detail

- A mini bar chart of tokens per session above the sessions table (project detail page).
- A "Model" column per session in the sessions table (joined from `usage_events.model`, taking the
  dominant model per session).

### D. Alerting and monitoring

- A daily cost threshold input in Settings, stored in the `budget_limits` table (already in the
  schema, unused so far).
- A visual warning badge on the Dashboard when today's cost exceeds the threshold. No push or email
  notification — out of scope, that needs separate infrastructure.

## Implementation order

1. Duplicate-project migration (the riskiest, and it touches production data — done and verified
   first, before anything else is built on top of it).
2. Sync Now button + status.
3. Default sort + new options + back button (small, quick changes).
4. Advanced features A–D.

---

# Dashboard v3 — follow-up (same date)

Follow-up requests after v2 was deployed:

1. Clarification: "WoW" = week-over-week (the % change in cost against last week). Confusing, so it
   was folded into point 2.
2. Change all UI text (the Indonesian added in v2) to English.
3. A daily email report over Gmail SMTP.
4. Change the visual theme to follow the Framer "Insightix" reference (light sidebar + blue accent,
   large metric cards, soft gradient charts).
5. Add a "View Claude Pricing" link on the Settings page.
6. (Added mid-session) Move the charts from plain Recharts to Tremor (`@tremor/react`) for a more
   modern look, in keeping with the Insightix style.

## 6. English copy + pricing link

Every UI string added in v2 (SyncButton status, budget badge, the "Daily budget" label, the WoW
column, and so on) was translated into English. The WoW column got the full "Week-over-week" header
with a `title` tooltip explaining what it means. The Settings page got a
`<a href="https://www.anthropic.com/pricing" target="_blank">View Claude Pricing ↗</a>` link — the
same URL `/api/pricing/sync` already scrapes.

## 7. Daily email report (Gmail SMTP)

**New schema:**

```sql
CREATE TABLE email_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  smtp_user TEXT,
  smtp_app_password TEXT,
  recipient_email TEXT,
  enabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE email_log (
  report_date TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL,
  status TEXT NOT NULL
);
```

The SMTP credentials (a Gmail App Password) are stored in plain text in the local `usage.db` — a
trade-off the user accepted for the convenience of editing them from the Settings UI (single-user
app, database not publicly exposed).

**Trigger:** inside the ingest cycle that already runs every 5 minutes
(`lib/ingest-scheduler.ts`). On each cycle: if the clock is past midnight AND `email_log` has no row
for yesterday AND `email_settings.enabled = 1`, generate and send yesterday's report, then record it
in `email_log`. Up to 5 minutes of delay past midnight is acceptable — no separate OS cron needed.

**Report contents (HTML email, covering only the day that just ended, whatever the threshold
status):**
- Total tokens and cost for that day.
- A breakdown by project active that day.
- A breakdown by model.
- Cache efficiency % and cache savings $ for that day.
- % comparison against the previous day (tokens and cost).

**Library:** `nodemailer`, Gmail SMTP transport with an App Password.

**Settings UI:** a new "Email Reports" form — SMTP user, App Password (password input), recipient
email, an enable/disable toggle, and a "Send Test Email" button (sends today's report immediately,
without waiting for midnight, to verify the configuration).

The Dashboard budget warning badge (v2, section 5.D) **stays**, separate from email — the email is a
routine summary, the badge is a real-time indicator while browsing the dashboard.

## 8. Visual theme — Insightix style

Reference: the Framer marketplace template "Insightix" (white sidebar, bright blue accent around
`#3b82f6`, large metric cards with bold numbers plus a small trend indicator, soft blue gradient
area charts).

- Sidebar: from dark (the v1 command-center theme) to white/light with a thin right border, grey
  icons, and an active item shown as a pale blue background with blue text and icon.
- Metric cards: larger, bolder numbers, plus a small trend line (↑/↓ against the previous period)
  under each figure — the same pattern as the existing `WeekOverWeekBadge`, generalised into a
  `TrendIndicator` component reused by `SummaryCard`.
- No dark mode — a single light theme, per the user's decision.
- The blue accent is aligned with `COLOR_INPUT` (`#2a78d6`), already used in the charts, so it stays
  consistent with the validated categorical data palette (dataviz skill).

## 9. Chart migration to Tremor

Move `UsageTimeSeriesChart`, `ModelBreakdownChart`, `TopProjectsTable` (sparkline) and
`SessionTokensChart` from raw Recharts to `@tremor/react` components (`AreaChart`, `BarChart`,
`SparkAreaChart`) — a library built specifically for analytics dashboards, whose styling matches the
Insightix reference (soft gradients, transition animations, more polished tooltips). Tremor is
itself built on Recharts, so this is a styling/API layer swap rather than a rewrite from scratch.

**Compatibility notes (found during implementation):**

- The stable `@tremor/react` (3.18.x) only supports React ^18, while this project is on React
  19.2.8. We use the pre-release `4.0.0-beta-tremor-v4.4`, the only published version declaring a
  `react: ^19.0.0` peer dependency. Risk: the API may change when the stable release lands.
- Tremor generates chart colour classes (`fill-blue-500`, etc.) dynamically at runtime rather than
  as literal strings, so Tailwind v4's static content scanner never finds them and the charts render
  with no colour at all (everything black/grey). Tremor's official Tailwind v3 documentation solves
  this with `content` + `safelist` in `tailwind.config.ts`, but this project is on Tailwind v4 (no
  config file, CSS-first). Fixed with `@source inline("...")` in `app/globals.css`, which explicitly
  sources every colour/shade combination in use (`blue`, `orange`, `emerald`, `amber`, `gray` ×
  several shades). It must be extended by hand if Tremor is given new colours in future.
