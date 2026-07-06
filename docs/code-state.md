# Zombie TV - Current Codebase State

Last updated: 2026-06-24.

This file is a concise implementation snapshot for active development.

## Runtime Overview

- Next.js 16 App Router project with API routes and client admin pages.
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
- Viewer auth finalization can continue through `/auth/plex/finish` and `/api/auth/plex/complete` when cross-site redirect cookie persistence is unreliable.
- Viewer callback requires a remote Plex endpoint for playback-capable sessions.
- Admin: `/api/admin/login` and `/api/admin/password`.
- Admin dashboard protection is server-enforced in `src/app/admin/dashboard/layout.tsx`.
- Admin-only logout endpoint `/api/admin/logout` de-escalates admin without destroying viewer/Plex session.
- Full logout still available at `/api/auth/logout`.
- Session cookies are secure by default in production, with optional `SESSION_COOKIE_SECURE` override for explicit non-HTTPS environments.

### Plex Redirect Override

- Optional hosted redirect origin is configurable from admin overview.
- Stored and validated via `src/lib/plex-auth-redirect.ts`.
- Used by both viewer and admin Plex init/callback routes for final redirect host handling.

### Scheduler

- Default 7-day rolling generation with periodic extension.
- Scheduler horizon days and auto-run interval hours are configurable from admin overview.
- Scheduler reads station slot configuration (weekday/weekend) from DB rules.
- Per-slot controls currently implemented:
	- `openVideo` / `closeVideo` bumper IDs
	- `libraryWeights`
	- `disabledLibraries` (library-type toggles in the slot library mix)
	- `allowGenres`
	- `breakStrategy` (`standard` chapter-aware | `center` | `end`)
	- `scheduleIncrement` (opt-in padding: `0` continuous, 5/15/30/60 min boundaries)
	- `marathon` (`{ chance, count, hint }` — probabilistic multi-hour takeover by one series)
	- `preset` (named reusable bundle resolved from `rules.slot_presets`)
- Per-station language controls are global across all slots/windows:
	- `allow_languages` / `deny_languages`
- Station-wide `schedule_offset` (0–29 min) shifts padded showtime boundaries (e.g. :05/:35).
- `rules.date_overrides` swaps/adjusts the day template on matching calendar dates (exact date, range with year-wrap, month, quarter, weekday); entries may re-point genre filters and replace overlapping windows.
- Filler windows pinned to a Plex show support `sequenceStart`/`sequenceEnd` fractions (loop within a slice of the series).
- Content ad breaks snap to Plex chapter markers (±6 min) when chapter data is synced.
- Hour/half-hour alignment still enforced by default; per-slot increments relax it opt-in.
- Holiday and event precedence flow is active.
- Non-standard channel types (`rules.channel_type` ≠ `standard`) are skipped by generation.

### Channel Types

- `rules.channel_type`: `standard` (default) | `weather` | `guide` | `loop` | `stream` | `web`.
- Non-standard types short-circuit `getPlaybackState` and derive state from rules JSON (no schedule rows).
- `weather`: custom 90s Weather-Channel-style surface (`WeatherChannel.tsx`) fed by Open-Meteo (no API key); config `rules.weather.{latitude,longitude,locationName,musicVideoId}`.
- `guide`: Prevue-style scrolling listings channel (`GuideChannel.tsx`) using `/api/stations` + `/api/epg`; config `rules.guide.{promoVideoId,musicVideoId}`.
- `loop`: loops a YouTube video/playlist (`rules.loop.contentId`).
- `stream`: plays an external HLS/direct URL via hls.js (`rules.stream.url`).
- `web`: embeds a page in a sandboxed iframe (`rules.web.url`).
- `/api/epg/[stationId]` synthesizes continuous listings for non-standard types.
- Seeded demo channels: `wthr` (Sydney weather) and `guide`.

### Playback

- `/api/now/[stationId]` computes current program, offsets, and transitions from schedule/slot rows.
- Ad windows now account for actual ad queue runtime and resume content after ad completion.
- Filler/ad YouTube queues use deterministic seeded ordering.
- YouTube duration metadata is used to improve queue fit.
- Ad/filler pools honour availability hints on `YoutubeContent` (`dayParts`, `dateRange`, `exclusive`) via `src/lib/date-hints.ts`; matching exclusive items take over their window.
- `PlaybackState.upNext` exposes the next scheduled programme; the viewer renders a dynamic "Up Next" card (`UpNextCard.tsx`) during filler and ad breaks.
- `/api/plex-stream` validates proxy targets against cached remote Plex origins (short TTL) and retries discovery on rotation.

### Filler Content Management

- Admin page label is now Filler Content.
- Allowed categories in UI are: `ads`, `filler`, `music`.
- Playlist import expands to per-video rows.
- Missing durations can be backfilled via `/api/admin/youtube/backfill-durations`.
- Availability hints per item: day parts (morning/daytime/prime/late/overnight), calendar date range (year-wrap supported), and an exclusive-takeover flag.

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

## Recently Implemented (Previous Session)

- **1990s viewer experience overhaul:** auto-hiding NowBar; TvOsd component (channel digits, programme banner, volume bar, news clock bug in VCR-OSD styling via `lib/osd-style.ts`); numeric channel entry + volume keys in page.tsx; ChannelChange gained a sync-tear 'roll' mode (static kept for dead channels); WebAudio tuning blips + optional mono TV-speaker chain (`lib/tv-audio.ts`); CRT power-on/off animation (`CrtPower.tsx`, 'zombietv-power-off' event on logout); off-air screens (`OffAirScreens.tsx`: PM5544 test card / VCR blue screen / analog static, selected by `offAirStyle`); station DOG watermark + `PlaybackState.newsLive`; optional 4:3 bezel mode; composite dot-crawl/chroma + phosphor sheen layers in VHSOverlay; Up Next restyled as a broadcast lower-third; teletext-flavoured EPG header; six new VHS settings (`fourByThreeEnabled`, `compositeArtifactsEnabled`, `phosphorBloomEnabled`, `tvSpeakerAudioEnabled`, `channelChangeSoundEnabled`, `offAirStyle`) with admin toggles.
- **Plex metadata intelligence:** catalog sync now stores original air dates, intro/credits markers (movies get a per-item detail fetch so they carry chapters+markers too), collections/labels/studio/countries, audience+critic ratings, addedAt, watch state and artwork paths on `MediaItem` (needs `npx prisma db push`). Episodes sort in broadcast (air-date) order; `contentQualityMultiplier` adds seasonal air-date affinity, day-part-aware rating weighting, premiere boosts and recently-watched penalties on top of library weights; slot allow-lists match all Plex tokens (genres/collections/labels/studio/countries) via `itemMatchTokens`; ad breaks snap to markers as well as chapters and `effectiveRuntimeMins` trims long credit rolls; slots stamp `premiere`/`anniversaryYears` metadata surfaced on the Up Next card with poster art through `/api/plex-art`.
- **Hardening + infrastructure batch:** vitest suite (70 tests) over the extracted pure scheduler core (`src/lib/scheduler/ad-breaks|alignment|ratings`, `date-hints`, `seeded-random`); deterministic seeded marathon rolls (stable across regeneration, seed = station:broadcast-date:slot); batched scheduler writes (nested slotMediaItem creates + per-day grouped usage-counter flush); station rules validated on save (`station-rules-validation.ts`) with optimistic-lock (409) via `expectedUpdatedAt`; Plex tokens AES-256-GCM encrypted at rest (`secret-box.ts`, legacy plaintext passthrough); SSE playback stream (`/api/now/[id]/stream`) with polling fallback in `usePlayback`; server-side weather proxy (`/api/weather`, 10-min cache) and guide aggregate (`/api/guide`) with shared `lib/epg.ts`; YouTube embeds reworked (`YouTubeLayer.tsx` — chrome-cropping overscan, in-place unmute via IFrame API, no reload-restarts); filler pool availability checker (`/api/admin/youtube/validate` + UI); schedule day dry-run preview (`previewStationDay` + Station Rules → Advanced → Day Preview); EPG hover prefetch; structured slot-presets form editor.
- **FieldStation42-inspired feature port:** probabilistic marathons, date-specific schedule overrides, chapter-aware/strategy-based ad breaks, per-slot schedule increments + station showtime offset, reusable slot presets, sequence ranges for pinned shows, day-part/date-range filler availability hints with exclusive takeover, dynamic Up Next cards, and non-standard channel types (custom Open-Meteo weather channel, Prevue-style guide channel, loop/stream/web channels). Requires `npx prisma db push` for the new `YoutubeContent` hint columns.
- **Environment validation:** App now exits with clear error message if critical env vars (`DATABASE_URL`, `SESSION_SECRET`, `PLEX_CLIENT_ID`) are missing. Validation runs at startup in `db.ts` before attempting Prisma connection.
- **Bumper semantics:** Open/close bumper IDs (`openBumperId`, `closeBumperId`) are now exposed in `PlaybackState` API response from `/api/now/[stationId]`. Data is available for client rendering.
- **Show pacing visibility:** Episode pacing tracked by scheduler is now visible in the admin schedule editor. "Pacing" column displays next episode (S##E##) and last aired date for tracked shows.

## Known Gaps

- Unit tests cover the pure scheduler core (`npm test`); the run-loop and API routes still lack integration tests.
- Mobile admin page ergonomics still need dedicated responsive design (admin pages have no CSS media queries).
- Deployment docs and release process are now documented, but the release checklist still depends on manual verification.
- Live playback now pushes via SSE with polling fallback; multi-instance deployments would need sticky sessions or a shared pub/sub.
- Bumper rendering UI: PlaybackState includes bumper IDs, but viewer component rendering logic not yet implemented.
