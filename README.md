# Claude Usage Dashboard

A local web dashboard that tracks Claude Code token usage and cost across every project on this
machine. It reads directly from `~/.claude/projects/*/*.jsonl` — the session logs Claude Code
already writes — so there's nothing to configure on the Claude Code side.

## Features

- **Dashboard** — total tokens, estimated cost, active projects, cache efficiency, cache savings,
  a projected monthly cost, a stacked usage-over-time chart, a model breakdown chart, and a
  top-projects table with per-day sparklines.
- **Projects** — every project detected on this machine, sortable by last active, tokens, cost,
  session count, or name, with a week-over-week cost trend per project.
- **Project detail** — per-session token history and a full session table, including which model
  dominated each session.
- **Settings** — editable per-model pricing (with a one-click sync from Anthropic's public pricing
  page), a daily cost budget with an on-dashboard warning badge, and a daily email usage report.
- **Manual sync** — a "Sync Now" button on the Dashboard and Projects pages triggers an immediate
  re-scan on top of the automatic 5-minute background sync.

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

- **Storage**: SQLite at `~/.claude-dashboard/usage.db`, created automatically on first run and
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
