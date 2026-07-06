# Zombie TV

1990s broadcast simulator with a shared live timeline, Plex-backed programming, and YouTube filler content.

For people that don't want to make decisions on what to watch...
But only after like a million setup decisions.

Complacency is earned.

## What It Does

- Simulates multi-station linear TV where all viewers share one server-authoritative timeline.
- Schedules content in rolling windows with station-specific rules.
- Streams Plex content through a local proxy and injects ad/filler segments from YouTube.
- Supports non-broadcast channel types: a custom 90s-style weather channel, a Prevue-style programme guide channel, and loop/stream/web channels.
- Provides an admin portal for schedule, station rules, events, catalog, security, and visual effects.

## Tech Stack

| Layer | Choice |
|---|---|
| App | Next.js 16 (App Router, TypeScript, React 18) |
| Database | PostgreSQL via Prisma |
| Viewer auth | Plex OAuth |
| Admin auth | Email/password login (bcrypt hash in admin user preferences) |
| Media | Plex for primary programming, YouTube for filler/ad content |
| Session | iron-session |

## Quick Start

### Prerequisites

- Node.js 24.x
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
# Optional: force cookie secure mode on/off (auto in production by default)
# SESSION_COOKIE_SECURE="true"
```

⚠️ **Important:** All three variables above (`DATABASE_URL`, `SESSION_SECRET`, `PLEX_CLIENT_ID`) are required. The app will exit at startup with a clear error message if any are missing or empty.

In production, auth cookies are secure by default and require HTTPS at the edge/proxy. If you are testing a non-HTTPS environment, set `SESSION_COOKIE_SECURE=false` explicitly.

### 3. Initialize database

```bash
npx prisma db push
node scripts/init-db.js
```

Seed defaults include:

- Base stations (plus demo `wthr` weather and `guide` listing channels)
- Holiday overrides
- Default admin user (`admin@zombietv.com` / `admin123`)

Change the seeded admin password immediately via Admin Security after first login.

### 4. Run

```bash
npm run dev
```

- Viewer: http://localhost:3000
- Admin: http://localhost:3000/admin

Run the unit test suite (pure scheduler core: date hints, ad breaks, alignment, ratings, seeded randomness) with:

```bash
npm test
```

### Docker

```bash
docker compose up --build
```

Docker compose starts both PostgreSQL and the app. Container startup runs `prisma db push`, then the idempotent seed script, then starts the app.

## Authentication Model

- Viewer auth uses Plex OAuth routes under `/api/auth/plex/*`.
- Viewer auth finalization uses `/auth/plex/finish` and `/api/auth/plex/complete` to recover from cross-site redirect/cookie races.
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
- Station Rules editor with weekday/weekend slot configuration and bumper ID assignment, plus:
  - Channel type selection (standard / weather / guide / loop / stream / web)
  - Per-slot break strategy, schedule increment, random marathon config, and slot presets
  - Station-wide showtime offset and date-specific schedule overrides
- Filler Content manager (renamed from YouTube Pool) with per-item availability hints (day parts, date ranges, exclusive takeover)
- Holiday settings and holiday override management
- Special Events with duration mode (`preset` or `until finished`)
- VHS/CRT tuning with live preview
- Admin Security password change page
- Audit log

## Scheduling and Playback Behavior

- Default 7-day rolling schedule generation with periodic extension.
- Scheduler horizon and auto-run interval are configurable from the Overview page.
- Hour/half-hour alignment remains enforced by default; per-slot schedule increments (continuous/5/15/30/60 min) and a station-wide showtime offset (e.g. :05/:35 starts) relax it opt-in.
- Per-slot station rules include:
    - filler-only windows
    - open/close bumper IDs
    - per-library weighting (`tv_shows`, `movies`, `animation`, `fitness`)
    - allow-lists for genres and languages
    - break strategy (`standard` chapter-aware, `center` intermission, `end` no mid-rolls)
    - probabilistic marathons (`chance` × `count` hours, optional seasonal hint)
    - reusable named slot presets
- Date-specific overrides can retarget a day's lineup and genres on exact dates, ranges (year-wrap supported), months, quarters, or weekdays.
- Filler windows pinned to a show support sequence ranges (loop within a fraction of the series).
- Holiday and event precedence supported (`SpecialEvent` over holiday override over normal schedule).
- Ad windows are runtime-aware: ad playback completes before returning to program content.
- Mid-roll ad breaks snap to Plex chapter markers when available, landing cuts on natural scene breaks.
- Ad/filler pools honour per-item availability hints: day parts (morning/daytime/prime/late/overnight), calendar date ranges, and an exclusive-takeover flag for themed windows.
- A dynamic "Up Next" card renders during station breaks and ad pods from live schedule data.
- YouTube duration metadata is used to fit ad/filler queues more accurately.
- Marathon rolls are deterministic per station/date/slot, so schedule regeneration never silently adds or removes a marathon.
- Catalog sync pulls extended Plex metadata: original air dates, intro/credits markers, collections/labels, audience ratings, studio, countries, added-at, watch state, and artwork paths.
- Episodes air in original broadcast order (air-date sorting) when air dates are available; content near its original air date gets a seasonal boost (Christmas episodes surface in December) and exact anniversaries are flagged.
- Mid-roll breaks snap to Plex chapters **and** intro/credits markers; long credit rolls are trimmed from effective runtime so joins are tighter.
- Slot allow-lists match Plex collections, labels, studios and countries in addition to genres — curate pools in Plex, schedule with them here.
- Audience ratings weight prime time toward well-rated content (late night tolerates the schlock); fresh never-aired library additions get a PREMIERE boost and badge; recently-watched-on-Plex content is penalised.
- The "Up Next" card shows real Plex poster art via an authenticated proxy (`/api/plex-art`).
- Live playback state is pushed to viewers over Server-Sent Events (with automatic polling fallback); transitions land within ~300 ms.
- Weather data and guide listings are served through cached server-side proxies (`/api/weather`, `/api/guide`).
- YouTube filler renders through a chrome-hiding embed layer: native YouTube UI is cropped out of frame and audio is unmuted in place after first interaction (no stream restarts).
- Plex tokens are encrypted at rest (AES-256-GCM derived from `SESSION_SECRET`).
- Station Rules → Advanced includes a **Day Preview** dry run (resolved lineup, holiday/date-override detection, marathon outcomes) and Filler Content includes a **Check Availability** scan that flags deleted or embed-disabled videos.

## Channel Types

Set per station in Station Rules → Channel Type (`rules.channel_type`):

| Type | Behaviour |
|---|---|
| `standard` | Normal scheduled broadcast station (default) |
| `weather` | Continuous 90s-style weather channel rendered from Open-Meteo data (no API key); configure latitude/longitude/location name and optional background music |
| `guide` | Prevue-style scrolling programme listings with optional promo video panel |
| `loop` | Continuously loops a YouTube video or playlist |
| `stream` | Plays an external HLS (`.m3u8`) or direct media URL |
| `web` | Embeds a web page as the channel |

Non-standard channels skip schedule generation entirely and appear in the EPG with synthesized continuous listings.

## The 1990s Viewer Experience

- **TV OSD** — chrome auto-hides while watching; channel changes flash big blocky channel digits (top-right) and a one-line programme banner (station · time · title) that fades after a few seconds, all in a hard-outlined VCR-OSD style.
- **Remote-control input** — channel up/down (arrow keys), direct numeric channel entry with on-screen digit echo, and volume keys (`+`/`-`) with the classic green segment volume bar.
- **Analog tuning** — switching between live channels cuts to black with a brief vertical sync tear/picture roll (plus an optional click + static blip); dead channels show the configured off-air look.
- **Off-air looks** — PM5544-style test card with station ident and clock (default), saturated VCR blue screen, or full analog static.
- **Station watermark (DOG)** — translucent station ident during programmes, dropped for ad breaks; a corner clock bug appears during live news windows.
- **CRT behaviours** — power-on line-bloom when the set turns on, collapse-to-dot on sign-out, optional 4:3 tube mode with bezel, composite dot-crawl/chroma artifacts, and phosphor/glass sheen — all tunable from the admin VHS page.
- **TV speaker audio** (optional) — programme audio routed through a mono band-passed "3-inch speaker" chain.
- **Guide** — the overlay EPG carries a teletext flavour (black surface, monospace, `P501 GUIDE` page header, cyan/yellow accents); the Up Next break card renders as a broadcast lower-third with poster art.

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
- `fourByThreeEnabled`, `compositeArtifactsEnabled`, `phosphorBloomEnabled`, `tvSpeakerAudioEnabled`, `channelChangeSoundEnabled`, `offAirStyle` (`testcard` / `bluescreen` / `static`)

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
