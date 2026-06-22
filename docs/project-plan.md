# Zombie TV - Project Plan

Single source plan for current architecture, completed scope, and next milestones.
Last reviewed: 2026-06-23.

## 1. Product Goal

Simulate a shared, always-on 1990s-style TV broadcast where:

- everyone tunes into the same live timeline
- station identity and daypart rules shape scheduling
- Plex provides primary programming
- YouTube provides ads/filler/music segments

## 2. Current Architecture

### Core Runtime

- Next.js App Router app with API routes for auth, schedule, playback, and admin operations.
- PostgreSQL with Prisma for all runtime state.
- Rolling schedule generation and server-authoritative playback model.

### Auth Model

- Viewer auth: Plex OAuth (`/api/auth/plex/*`).
- Admin auth: email/password (`/api/admin/login`) with bcrypt hash.
- Admin dashboard routes protected server-side via admin guard layout.
- Admin logout removes admin privileges only; full logout is separate.

### Data Model Highlights

- `Station.rules` stores active station behavior and slot config.
- `YoutubeContent` stores active filler inventory.
- `AdminPreference` stores global settings including VHS values and Plex redirect override.
- `HolidayOverride` and `SpecialEvent` inject schedule precedence logic.

## 3. Implemented Scope

### Scheduling

- Default 7-day rolling schedule generation and extension (admin-configurable).
- DB-backed weekday/weekend slot config with per-slot controls:
  - enable/disable
  - filler-only mode
  - open/close bumper IDs
  - per-library weights
  - genre/language allow lists
- Holiday override support (station-specific precedence over global).
- Special events with station-scoped or global targeting.
- Event duration modes: preset minutes or until content finished.

### Playback

- `GET /api/now/[stationId]` computes current playback state from schedule slots.
- Ad breaks now behave as runtime windows that complete before content resumes.
- Filler and ad queues are seeded deterministically and use duration metadata where available.

### Admin Portal

- Overview with Plex connect/status and catalog settings.
- Optional hosted Plex auth redirect origin setting.
- Schedule editor with slot operations and audit trail.
- Station Rules editor (weekday/weekend slots, ad policy, branding).
- Filler Content manager with playlist import and runtime backfill.
- Holidays, special events, show progress, VHS controls, audit log.
- Admin Security page for password changes.

### Visual Layer

- EPG overlay with now indicator and drag navigation.
- VHS/CRT overlay with expanded controls:
  - ghosting
  - tracking noise
  - horizontal jitter

## 4. Completed Milestones

- Redirect override feature wired through init and callback auth routes.
- Admin password-change endpoint and UI shipped.
- Admin dashboard route protection hardened.
- Admin-only logout behavior separated from global session logout.
- Runtime config migration to DB-backed station/filler rules completed.
- Scheduler and playback updated for newer slot model and runtime-aware ad handling.
- Filler Content rename and category narrowing completed.
- VHS control expansion and live preview completed.
- Mobile-responsive EPG with 900px viewport breakpoint.
- Deployment docs and release process hardening.
- Observability for long-running sync/regeneration jobs with durable status storage.
- Environment validation at startup with clear error messages.
- Bumper semantics exposure in PlaybackState API.
- Show pacing visibility in schedule editor UI.

## 5. Next Milestones

### Later / Backlog

- Build test coverage for scheduler, playback transitions, and admin APIs.
- Add deterministic fixture-based integration tests for holiday/event precedence.
- Implement real-time WebSocket push for scheduler/catalog observability (replace polling).
- Refine mobile admin page layouts with dedicated responsive design.

## 6. Constraints and Risks

- PostgreSQL runtime still requires query/index monitoring during large catalog sync operations.
- Complex schedule precedence (event/holiday/slot rules) needs strong automated regression tests.
- Real Plex and YouTube variability can impact deterministic manual testing.
- [x] Episode pacing (7-day throttle per show)
- [x] Holiday-tagged content exclusion (only scheduled on matching holiday)
- [x] YouTube background audio fix (iframe unmounted on station switch)
- [x] Environment config (`.env` for DATABASE_URL, Plex client ID, session secret)
- [x] Docker compose setup (multi-container with PostgreSQL service)
- [x] Mobile-responsive EPG
- [x] Deployment docs and release process hardening
- [x] Observability for long-running sync/regeneration jobs

---

## 📝 Notes

- **Storage format:** Genres and ratings remain stored as comma-separated strings in current JSON/application-layer handling.
- **Plex stream auth:** All Plex video URLs require the user's Plex token. The player must attach `?X-Plex-Token=` to every stream request.
- **YouTube filler ordering (ZBC Sunday):** Rage opener (`Lzk0sygecu4`) → random from `PLVWLfb1wlwNRF3Y33ygrsdXDcq7osC1Uv` → Rage closer (`wx7-Hr-iVJ4`) → one episode of Monkey.
- **ZBC music cutoff:** Music video blocks on ZBC must not include content released after 2005.
- **Halloween YouTube IDs:** `zbeYwGANtWM` (list: `RDzbeYwGANtWM`) and `qkVlC2WgEwc` are seeded as Halloween bumpers.
- **No YouTube Data API:** All YouTube content is manually curated. No API key required.
- **Admin password:** Default seed is `admin123` — must be changed before any deployment.
