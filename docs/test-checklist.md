# Zombie TV - Feature Test Checklist

Purpose: keep a current, trustworthy test matrix for the present codebase.

Legend:

- `[ ]` not yet run on current build
- `[x]` passed on current build
- `[!]` known issue or regression

Last reset: 2026-06-23 after environment validation, bumper semantics, and show pacing implementations.

## 1. Environment and Startup

- [ ] 1.1 `.env` values required for startup are present and loaded (`DATABASE_URL`, `SESSION_SECRET`, `PLEX_CLIENT_ID`)
- [ ] 1.1a Local PostgreSQL connection is reachable with configured `DATABASE_URL`
- [ ] 1.2 `npx prisma db push` runs cleanly
- [ ] 1.3 `node scripts/init-db.js` seeds stations, holidays, and admin user
- [ ] 1.4 App starts in dev mode without runtime init errors
- [ ] 1.5 App exits with clear error message if critical env vars are missing

## 2. Viewer Authentication (Plex)

- [ ] 2.1 `POST /api/auth/plex/init` returns a valid `authUrl`
- [ ] 2.2 Viewer Plex callback sets session and unlocks viewer
- [ ] 2.3 Hosted redirect override (if configured) is used for final callback redirect
- [ ] 2.4 `POST /api/auth/logout` fully clears session

## 3. Admin Authentication and Security

- [ ] 3.1 `POST /api/admin/login` accepts valid seeded credentials
- [ ] 3.2 Invalid admin password returns 401
- [ ] 3.3 `/admin/dashboard/*` is blocked without admin session
- [ ] 3.4 Admin Security password change endpoint validates current password
- [ ] 3.5 `POST /api/admin/logout` removes only admin role and preserves base session

## 4. Plex Admin Connection and Catalog

- [ ] 4.1 Admin Plex connect flow (`/api/admin/plex`) succeeds
- [ ] 4.2 Catalog sync starts and reports progress
- [ ] 4.3 Catalog settings save (`autoSyncMaxAgeHours`, selected libraries, classifications)
- [ ] 4.4 Optional Plex auth redirect base URL saves and validates absolute http(s)

## 5. Scheduling Engine

- [ ] 5.1 `POST /api/scheduler/run` creates/extends the configured horizon window (default 7 days)
- [ ] 5.2 Weekday/weekend slot config from Station Rules is honored
- [ ] 5.3 Per-slot `fillerOnly` behavior works as expected
- [ ] 5.4 Per-slot `libraryWeights` influence selection pool
- [ ] 5.5 Per-slot genre/language allow-lists are applied
- [ ] 5.6 Open/close bumper IDs persist into slot metadata
- [ ] 5.7 Holiday override precedence (station-specific over global) works
- [ ] 5.8 Special event precedence over normal schedule works
- [ ] 5.9 `until finished` event mode persists and executes correctly

## 6. Playback Engine

- [ ] 6.1 `/api/now/[stationId]` returns complete `PlaybackState` including `openBumperId` and `closeBumperId`
- [ ] 6.2 Mid-program join seeks to correct offset
- [ ] 6.3 Ad windows run to queue completion before content resumes
- [ ] 6.4 Filler queue uses duration-aware sequencing
- [ ] 6.5 Offline station behavior is graceful
- [ ] 6.6 Bumper metadata appears in playback state for client rendering

## 7. EPG and Viewer UI

- [ ] 7.1 EPG renders 48-hour grid and now marker
- [ ] 7.2 Current slot titles remain visible for partially clipped rows
- [ ] 7.3 Channel switching works with static burst transition
- [ ] 7.4 NowBar reflects title/episode/ad state correctly
- [ ] 7.5 Mobile EPG (<900px) displays card layout instead of timeline grid

## 8. Filler Content Admin

- [ ] 8.1 Add video entry with auto duration fetch
- [ ] 8.2 Import playlist and expand to item rows
- [ ] 8.3 Edit and delete operations work from table controls
- [ ] 8.4 Category/station filters work
- [ ] 8.5 Backfill runtimes endpoint updates missing durations

## 9. Station Rules Admin

- [ ] 9.1 Create station and verify appearance across admin selectors
- [ ] 9.2 Edit weekday/weekend slots and persist changes
- [ ] 9.3 Save station-wide ad policy and verify scheduler effect
- [ ] 9.4 Delete non-base station and clean related data

## 10. VHS/CRT Admin and Overlay

- [ ] 10.1 All controls save and round-trip via `/api/vhs-settings`
- [ ] 10.2 New controls (`ghosting`, `trackingNoise`, `horizontalJitter`) affect viewer overlay
- [ ] 10.3 Admin live preview responds to slider changes
- [ ] 10.4 Viewer updates settings on poll interval

## 11. Audit and Change Tracking

- [ ] 11.1 Manual schedule edits produce audit rows
- [ ] 11.2 Audit detail expands with before/after payload
- [ ] 11.3 Pagination and refresh work as expected

## 12. Schedule Editor and Show Pacing

- [ ] 12.1 Schedule editor loads and displays slot table with pacing column
- [ ] 12.2 Pacing column shows next episode (S##E##) for tracked shows
- [ ] 12.3 Last aired date appears next to pacing info
- [ ] 12.4 Non-tracked shows display "—" in pacing column

## 13. Admin Observability

- [ ] 13.1 Scheduler status card displays on admin overview
- [ ] 13.2 Status card shows phase, scope, counts, and timestamps
- [ ] 13.3 Schedule editor progress panel updates live during regeneration (3000ms polling)
- [ ] 13.4 Catalog sync status appears on overview and updates live

## 14. Integration: Environment, Bumpers, and Pacing

- [ ] 14.1 With all three env vars set, app starts without error and loads admin dashboard
- [ ] 14.2 With missing `SESSION_SECRET`, app exits at startup with clear error message
- [ ] 14.3 PlaybackState API returns bumper IDs alongside other playback metadata
- [ ] 14.4 Schedule editor displays bumper info in slot metadata AND pacing column together
- [ ] 14.5 Admin can regenerate schedule and immediately see pacing column populate for tracked shows

## 15. Known Open Risks

- [ ] 15.1 PostgreSQL operational tuning under heavy concurrent admin/catalog operations
- [ ] 15.2 Scheduler regressions around complex precedence combinations
- [ ] 15.3 Bumper rendering not yet implemented on viewer UI (data available via PlaybackState, UI rendering pending)
- [ ] 15.4 Admin mobile pages need responsive design polish (no CSS media queries)
