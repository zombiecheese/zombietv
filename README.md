# Zombie TV

1990s broadcast simulator with a shared live timeline, Plex-backed programming, and YouTube filler content.

For people that don't want to make decisions on what to watch...
But only after like a million setup decisions.

Complacency is earned.

## What It Does

- Simulates multi-station linear TV where all viewers share one server-authoritative timeline.
- Schedules content in rolling windows with station-specific rules.
- Streams Plex content through a local proxy and injects ad/filler segments from YouTube.
- Provides an admin portal for schedule, station rules, events, catalog, security, and visual effects.

## Tech Stack

| Layer | Choice |
|---|---|
| App | Next.js 14 (App Router, TypeScript, React 18) |
| Database | PostgreSQL via Prisma |
| Viewer auth | Plex OAuth |
| Admin auth | Email/password login (bcrypt hash in admin user preferences) |
| Media | Plex for primary programming, YouTube for filler/ad content |
| Session | iron-session |

## Quick Start

### Prerequisites

- Node.js 18+
- A reachable Plex server
- Plex client ID for viewer OAuth flow

### 1. Install

```bash
npm install
```

### 2. Configure environment

Create `.env` in the repo root:

```env
DATABASE_URL="postgresql://zombietv:zombietv_dev_password@localhost:5432/zombietv?schema=public"
SESSION_SECRET="replace-with-a-random-32+-char-secret"
PLEX_CLIENT_ID="your-plex-client-id"
POSTGRES_DB="zombietv"
POSTGRES_USER="zombietv"
POSTGRES_PASSWORD="zombietv_dev_password"
```

⚠️ **Important:** All three variables above (`DATABASE_URL`, `SESSION_SECRET`, `PLEX_CLIENT_ID`) are required. The app will exit at startup with a clear error message if any are missing or empty.

### 3. Initialize database

```bash
npx prisma db push
node scripts/init-db.js
```

Seed defaults include:

- Base stations
- Holiday overrides
- Default admin user (`admin@zombietv.com` / `admin123`)

Change the seeded admin password immediately via Admin Security after first login.

### 4. Run

```bash
npm run dev
```

- Viewer: http://localhost:3000
- Admin: http://localhost:3000/admin

### Docker

```bash
docker compose up --build
```

Docker compose starts both PostgreSQL and the app. Container startup runs `prisma db push`, then the idempotent seed script, then starts the app.

## Authentication Model

- Viewer auth uses Plex OAuth routes under `/api/auth/plex/*`.
- Admin auth uses `/api/admin/login` with bcrypt password check.
- Admin logout (`/api/admin/logout`) drops admin privileges only and keeps the base user session intact.
- Full session logout (`/api/auth/logout`) signs out the session entirely.

## Admin Portal Features

- Overview and Plex connection status
- Plex catalog sync and library classification controls
- Optional Plex auth redirect base URL for hosted callback redirects
- Schedule editor with:
  - Regen all or single station scheduling
  - Show pacing visibility (next episode and last aired date for tracked shows)
  - Slot edits, swaps, and audit trail
- Station Rules editor with weekday/weekend slot configuration and bumper ID assignment
- Filler Content manager (renamed from YouTube Pool)
- Holiday settings and holiday override management
- Special Events with duration mode (`preset` or `until finished`)
- VHS/CRT tuning with live preview
- Admin Security password change page
- Audit log

## Scheduling and Playback Behavior

- Default 7-day rolling schedule generation with periodic extension.
- Scheduler horizon and auto-run interval are configurable from the Overview page.
- Hour/half-hour alignment remains enforced.
- Per-slot station rules include:
    - filler-only windows
    - open/close bumper IDs
    - per-library weighting (`tv_shows`, `movies`, `animation`, `fitness`)
    - allow-lists for genres and languages
- Holiday and event precedence supported (`SpecialEvent` over holiday override over normal schedule).
- Ad windows are runtime-aware: ad playback completes before returning to program content.
- YouTube duration metadata is used to fit ad/filler queues more accurately.

## VHS/CRT Controls

Settings persisted in `AdminPreference` and polled by clients include:

- `vhsIntensity`
- `noiseIntensity`
- `chromaticAberration`
- `vignette`
- `crtCurvature`
- `flicker`
- `ghosting`
- `trackingNoise`
- `horizontalJitter`
- `showDebug`

## Important Notes

- Station and filler behavior is DB-driven at runtime.
- `config/stations.json` and `config/youtube-fillers.json` are legacy seed/reference artifacts, not runtime source of truth.
- PostgreSQL is now the primary runtime database to support better concurrency for admin operations and catalog sync.

## Project Layout

```text
src/
    app/
        admin/
        api/
    components/
    hooks/
    lib/
prisma/
scripts/
```

See [docs/code-state.md](docs/code-state.md) for a deeper implementation snapshot, [docs/schedule-generation.md](docs/schedule-generation.md) for the scheduling rules and flow, [docs/project-plan.md](docs/project-plan.md) for the project roadmap and priorities, [docs/deployment-release.md](docs/deployment-release.md) for deployment and release guidance, [docs/test-checklist.md](docs/test-checklist.md) for verification coverage, and [docs/checklist-verification.md](docs/checklist-verification.md) for current feature status and release readiness.
