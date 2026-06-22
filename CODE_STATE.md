# Project Documentation Moved

This file has been moved to `docs/code-state.md` to centralize all project documentation.

Please refer to [docs/code-state.md](docs/code-state.md) for the current implementation snapshot.


## Runtime Overview

- Next.js 14 App Router project with API routes and client admin pages.
- PostgreSQL + Prisma storage.
- Viewer authentication through Plex OAuth.
- Admin authentication through email/password (bcrypt hash stored in admin user preferences).
- Shared server-authoritative playback clock and timeline.

## Source of Truth Model

- Runtime configuration is DB-backed.
- Station rule behavior is persisted in `Station.rules` JSON.
- Filler/ad inventory is persisted in `YoutubeContent`.
- Global settings (including VHS settings and Plex auth redirect base URL) are persisted in `AdminPreference`.
- `config/stations.json` and `config/youtube-fillers.json` remain seed/reference artifacts, not runtime config.

## Key Implemented Features

### Auth and Session

- Viewer: Plex auth routes under `/api/auth/plex/init` and `/api/auth/plex/callback`.
- Admin: `/api/admin/login` and `/api/admin/password`.
- Admin dashboard protection is server-enforced in `src/app/admin/dashboard/layout.tsx`.
- Admin-only logout endpoint `/api/admin/logout` de-escalates admin without destroying viewer/Plex session.
- Full logout still available at `/api/auth/logout`.

### Plex Redirect Override

- Optional hosted redirect origin is configurable from admin overview.
- Stored and validated via `src/lib/plex-auth-redirect.ts`.
- Used by both viewer and admin Plex init/callback routes for final redirect host handling.

### Scheduler

- Default 7-day rolling generation with periodic extension.
- Scheduler horizon days and auto-run interval hours are configurable from admin overview.
- Scheduler reads station slot configuration (weekday/weekend) from DB rules.
- Per-slot controls currently implemented:
	- `fillerOnly`
	- `openVideo` / `closeVideo` bumper IDs
	- `libraryWeights`
	- `allowGenres`
- Per-station language controls are global across all slots/windows:
	- `allow_languages` / `deny_languages`
- Hour/half-hour alignment still enforced.
- Holiday and event precedence flow is active.

### Playback

- `/api/now/[stationId]` computes current program, offsets, and transitions from schedule/slot rows.
- Ad windows now account for actual ad queue runtime and resume content after ad completion.
- Filler/ad YouTube queues use deterministic seeded ordering.
- YouTube duration metadata is used to improve queue fit.

### Filler Content Management

- Admin page label is now Filler Content.
- Allowed categories in UI are: `ads`, `filler`, `music`.
- Playlist import expands to per-video rows.
- Missing durations can be backfilled via `/api/admin/youtube/backfill-durations`.

### VHS/CRT

- Settings persisted via `/api/vhs-settings` and polled by clients.
- Tunables include existing controls plus `ghosting`, `trackingNoise`, and `horizontalJitter`.
- Admin VHS page includes live preview.

## Database Tables In Active Use

- `Station`
- `Schedule`
- `Slot`
- `SlotMediaItem`
- `MediaItem`
- `ShowProgress`
- `YoutubeContent`
- `HolidaySetting`
- `HolidayOverride`
- `SpecialEvent`
- `User`
- `ScheduleChange`
- `AdminPreference`

## Operational Notes

- Database initialization in `src/lib/db.ts` establishes the Prisma connection early for stable startup behavior.
- PostgreSQL is the intended runtime database for concurrent admin operations and catalog sync.
- If behavior appears stale after major API changes, clear build artifacts and restart the server process.

## Known Gaps

- No formal automated test suite yet.
- Mobile EPG/admin ergonomics still need dedicated responsive polish beyond the current guide layout.
- Deployment docs and release process are now documented, but the release checklist still depends on manual verification.
- Observability for long-running sync/regeneration jobs now exists, but the app still relies on dashboard polling rather than push updates.
