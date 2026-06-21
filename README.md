# IdiotBox

1990s broadcast simulator with a shared live timeline, Plex-backed programming, and YouTube filler content.
For people that dont want to make decisions on what to watch...
But only after like a million setup decisions.
Complacency is earned

## What It Does

- Simulates multi-station linear TV where all viewers share one server-authoritative timeline.
- Schedules content in rolling 14-day windows with station-specific rules.
- Streams Plex content through a local proxy and injects ad/filler segments from YouTube.
- Provides an admin portal for schedule, station rules, events, catalog, security, and visual effects.

## Tech Stack

| Layer | Choice |
|---|---|
| App | Next.js 14 (App Router, TypeScript, React 18) |
| Database | SQLite via Prisma |
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
DATABASE_URL="file:./prisma/dev.db"
SESSION_SECRET="replace-with-a-random-32+-char-secret"
PLEX_CLIENT_ID="your-plex-client-id"
```

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

Container startup runs schema push and seed against `/data/dev.db` when needed.

## Authentication Model

- Viewer auth uses Plex OAuth routes under `/api/auth/plex/*`.
- Admin auth uses `/api/admin/login` with bcrypt password check.
- Admin logout (`/api/admin/logout`) drops admin privileges only and keeps the base user session intact.
- Full session logout (`/api/auth/logout`) signs out the session entirely.

## Admin Portal Features

- Overview and Plex connection status
- Plex catalog sync and library classification controls
- Optional Plex auth redirect base URL for hosted callback redirects
- Schedule editor (regen all or single station, slot edits, swaps, audit trail)
- Station Rules editor with weekday/weekend slot configuration
- Filler Content manager (renamed from YouTube Pool)
- Holiday settings and holiday override management
- Special Events with duration mode (`preset` or `until finished`)
- VHS/CRT tuning with live preview
- Admin Security password change page
- Audit log

## Scheduling and Playback Behavior

- 14-day rolling schedule generation with periodic extension.
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
- SQLite pragmas (`busy_timeout`, `WAL`, `synchronous=NORMAL`) are initialized in the Prisma layer for lock resilience.

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

See `CODE_STATE.md` for a deeper implementation snapshot and `test-checklist.md` for verification coverage.
