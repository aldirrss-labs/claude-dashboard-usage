# Claude Rooms

A local control room for Claude Code on this machine: what it costs, which projects it runs in,
which accounts it runs as, and how it is configured. It reads directly from `~/.claude/` — the
session logs, credentials and config Claude Code already writes — so there is nothing to set up on
the Claude Code side.

Everything stays on the machine. There is no server component and no telemetry.

## The five rooms

| Room | What it is for |
|---|---|
| **Dashboard** | What Claude Code is costing you, and where the money actually goes |
| **Projects** | Every project on this machine, and a full breakdown per project |
| **MCP Marketplace** | Discover, install and manage MCP servers — *not built yet* |
| **Accounts** | Several Claude logins on one machine: quota, switching, parallel sessions |
| **Settings** | Pricing, budget, and the daily email report |

### Dashboard

Total tokens and cost, active projects, sessions and API calls, cache savings, busiest day and most
expensive session. Then the breakdowns: usage over time, cost by model, **where the tokens go versus
where the money goes** (they disagree sharply — cache reads dominate volume but not spend), models
by project, a day-by-hour activity heatmap, and top projects.

### Projects

Every project detected on this machine, sortable by last active, tokens, cost, session count or
name, with a week-over-week cost trend. Each project opens onto spend over time, splits by model,
git branch and account, cost per session / message / active day, and a full session log with
durations.

### MCP Marketplace

Planned. Claude Code keeps MCP server definitions in `~/.claude.json` and their OAuth tokens in
`~/.claude/.credentials.json` — both files this app already reads and writes carefully (see
`lib/account-swap-fields.ts`, which exists precisely to avoid clobbering MCP logins during an
account switch). Managing servers from here is a natural extension rather than a bolt-on.

### Accounts

Store credentials for several Claude accounts and switch the active one in a click. Live quota per
account (5h / 7d / per-model / spend) straight from Anthropic's OAuth usage endpoint, auto-switch
with hysteresis and cooldown, per-directory account mapping, isolated parallel sessions, and
encrypted backup/restore.

### Settings

Editable per-model pricing with a one-click sync from Anthropic's published table, a daily cost
budget that raises a warning on the Dashboard, and a daily email usage report over Gmail SMTP.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app starts ingesting usage data
immediately — no setup step required — by scanning `~/.claude/projects/`.

To run it as an always-on background service instead, build it and install the systemd user service —
no root required, and it works from wherever you cloned the repo:

```bash
npm run build
deploy/install.sh
```

See [`deploy/README.md`](deploy/README.md) for options, redeployment and uninstalling.

## How it works

- **Storage**: SQLite at `~/.claude-dashboard/usage.db` — the directory keeps its original name
  deliberately. Renaming it to match the product would orphan every existing database, and the only
  thing gained is tidiness in a path nobody types. Created automatically on first run and
  untouched by app rebuilds or redeploys.
- **Ingestion**: an in-process scheduler (`lib/ingest-scheduler.ts`) re-scans `~/.claude/projects/`
  every 5 minutes, tailing each `.jsonl` file from its last read byte offset so multi-MB logs
  aren't reparsed on every cycle. The same cycle also checks whether a daily email report is due.
- **Project identity**: projects are deduplicated by a normalized "canonical path" derived from
  each session's real working directory, not the raw folder name Claude Code assigns — this keeps
  git worktrees and other path variants of the same project from showing up as separate rows. See
  `lib/paths.ts` (`normalizeCanonicalPath`) and `scripts/merge-duplicate-projects.ts` for the
  one-time migration that merges any duplicates already in the database.
- **Pricing**: model prices are stored in SQLite and used to compute cost for every view. They can
  be edited manually in Settings or synced from `https://www.anthropic.com/pricing`.

## Daily email report

Settings → Daily email report lets you send a full usage summary (cost, tokens, per-project and
per-model breakdown, cache efficiency, day-over-day change) to an email address via Gmail SMTP,
sent automatically once the previous day ends. It checks on every 5-minute ingest cycle — not just
around midnight — and catches up on the last 3 days if the app wasn't running when a day rolled
over, so a report is never silently lost.

You'll need a [Gmail App Password](https://myaccount.google.com/apppasswords) (not your regular
Gmail password) for the sender account. Use the "Send Test Email" button in Settings to verify the
configuration before relying on it.

## Tech stack

- [Next.js](https://nextjs.org) (App Router) + React 19
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) for storage
- [Tremor](https://tremor.so) for charts, [Tailwind CSS v4](https://tailwindcss.com) for styling
- [Framer Motion](https://www.framer.com/motion/) for animation
- [Nodemailer](https://nodemailer.com) for the daily email report

## Project structure

```
app/                  Routes: Dashboard (/), Projects (/projects), Project detail
                       (/projects/[slug]), Settings (/settings), and API routes under app/api/
components/           UI components (charts, tables, cards, sidebar)
lib/                  Ingestion, scheduling, SQLite schema/queries, pricing, mailer
scripts/              One-off maintenance scripts (duplicate-project migration)
deploy/               systemd unit template + install script
docs/plans/           Design docs written while building this app
```
