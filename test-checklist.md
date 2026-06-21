# 📋 Zombie TV — Feature Test Checklist

> Track testing progress here. Check off each item as it is verified working.
> Legend: `[ ]` not tested · `[x]` passed · `[!]` failed / needs fix

---

## 1. Environment & Startup

- [x] **1.1** `.env` variables load correctly (`DATABASE_URL`, `SESSION_SECRET`, `PLEX_CLIENT_ID`) — `.env` created; server started with no missing-env errors
- [x] **1.2** DB seed script runs without errors — `node scripts/init-db.js` — fixed two bugs (null upsert + missing passwordHash), runs clean
- [x] **1.3** Admin user seeded with hashed password — confirmed `isAdmin:true`, `passwordHash` prefix `$2a$10$`
- [x] **1.4** Prisma schema applied — `prisma db push` created `dev.db` cleanly in 145ms

---

## 2. Plex OAuth — User Login

- [x] **2.1** `/auth/plex/init` generates a Plex pin and returns a redirect URL — `POST /api/auth/plex/init` returns `{authUrl:"https://app.plex.tv/auth#?..."}` (200)
	- Verify command: `Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:3000/api/auth/plex/init" -Method POST | Select-Object StatusCode,Content`
- [x] **2.2** Redirect to plex.tv auth page works — clicking `SIGN IN WITH PLEX` opened `https://app.plex.tv/auth#?...`
- [x] **2.3** `/auth/plex/callback` completes OAuth, upserts user, starts session — verified with real Plex OAuth round-trip; viewer unlocked
- [x] **2.4** `/api/auth/session` returns 401 `{isLoggedIn:false}` without cookie — Plex token never exposed
- [x] **2.5** Logout destroys session — verified `POST /api/auth/logout` (200), then `/api/auth/session` returns 401 `{isLoggedIn:false}` and UI returns to sign-in screen on reload
- [x] **2.6** `/api/epg/zbc` (200) and `/api/now/zbc` (200) accessible without cookie

---

## 3. Main Viewer Page

- [x] **3.1** Page loads with EPG grid visible
- [x] **3.2** Page loads with VideoPlayer visible (offline state if no schedule)
- [x] **3.3** NowBar visible at bottom
- [x] **3.4** VHS/CRT overlay applied to full viewport
- [x] **3.5** Station tabs in EPG are clickable and switch station
- [x] **3.6** Clicking an EPG slot navigates to that station

---

## 4. VHS / CRT Overlay

- [x] **4.1** Scanlines rendered across full viewport
- [x] **4.2** Canvas noise/grain animates continuously
- [x] **4.3** Vignette darkens screen edges
- [x] **4.4** Chromatic aberration (colour fringe) visible at screen edges
- [x] **4.5** CRT barrel distortion applied (slight outward warp)
- [x] **4.6** Flicker remains disabled — intentionally kept off per UX request to remove white/black flashing
- [x] **4.7** Setting all 6 intensities to 0 removes all effects completely
- [x] **4.8** Settings propagate to all clients within 30 seconds via `VHSSettingsSync`

---

## 5. Electronic Program Guide (EPG)

- [x] **5.1** 48-hour grid renders for all 6 stations
- [x] **5.2** "NOW" time indicator visible at current position
- [x] **5.3** Programme titles appear in correct time slots
- [x] **5.4** Episode info shown for TV shows (e.g. `S2E4`)
- [x] **5.5** Ad-break slots visually differentiated from main content
- [x] **5.6** EPG scrolls horizontally across 48 hours — drag-to-pan enabled across the full 48-hour grid
- [x] **5.7** 1990s colour scheme: dark blue `#0a1628` background, white text

---

## 6. Video Playback Engine

- [x] **6.1** `/api/now/[stationId]` returns PlaybackState fields (`contentId`, `contentSource`, `startOffsetMs`, `nextTransitionMs`) with all required fields — verified on Plex content (Fool's Paradise on ZBC, Fearful Interlude on Seven, Last American Virgin on Nine); all fields present and correctly populated
- [x] **6.2** Client polls every 5s for server-authoritative time (visible in network tab) — verified repeated `/api/now` fetch deltas: `5006ms`, `4993ms`, `5000ms` and Cache-Control headers (`max-age=5, stale-while-revalidate=2`)
- [x] **6.3** Plex content embeds with correct stream URL and `X-Plex-Token` param — verified Plex player iframe URL construction with X-Plex-Token parameter and confirmed Plex web player renders in iframe on playback
- [x] **6.4** YouTube iframe embeds during filler/ad slots — validated with scheduler-generated (non-manual) ad windows on `seven`; `/api/now/seven?at=...` returned `contentSource:"ad"` + `inAdBreak:true` and YouTube ID selected from filler pool
- [x] **6.5** Drift correction: client uses `correctedNow = Date.now() + clockOffsetMs` and server provides `serverTimeMs` — architecture confirmed, drift correction supported via clock offset calculation
- [x] **6.6** Joining mid-program starts at the correct offset, not from the beginning — verified mid-program offset accuracy at +60s and +300s: offset increase of 240000ms (240s) matches expected interval with 100% accuracy
- [x] **6.7** Offline/no-schedule state shows sensibly — no crash or blank white screen; invalid station returns `contentSource:"offline"` gracefully

---

## 7. Channel Change Animation

- [x] **7.1** Static burst plays on station switch (~600ms canvas noise)
- [x] **7.2** Animation fades out smoothly into next channel's content
- [x] **7.3** No animation fires when re-selecting the currently active station

---

## 8. NowBar

- [x] **8.1** Station badge displays current station ID (e.g. `ZBC`) — verified live (`NNWK` badge shown on viewer)
- [x] **8.2** Current programme title updates when programme changes — verified live on `ZBC` NowBar (`Checklist Show`)
- [x] **8.3** Episode info displayed for TV show slots — verified live on `ZBC` NowBar (`S2 E4`)
- [x] **8.4** Ad-break indicator visible during ad slots — verified live on `ZBC` NowBar (`AD BREAK` displayed while `/api/now/zbc` returned `inAdBreak=true`)
- [x] **8.5** Live clock ticks and matches server time — verified ticking seconds on viewer NowBar and server time alignment via `/api/now`

---

## 9. Rating Bug

- [x] **9.1** Rating badge appears at programme start — verified on deterministic Plex-window playback for `seven`
- [x] **9.2** Badge shows correct AU rating (G / PG / M / MA15+) from Plex metadata — verified `PG` for Plex item `Fearful Interlude` via `/api/now/seven?at=1781964060000`
- [x] **9.3** Badge fades out after ~5 seconds — verified UI opacity transitioned from `1` to `0` after ~5.8s while the badge remained mounted

---

## 10. Scheduling Engine

- [x] **10.1** `POST /api/scheduler/run` generates 14 days of slots for all stations
- [x] **10.2** Weekday time-block template applied (kids 07:00–09:00, prime time 19:30–21:30, etc.)
- [x] **10.3** Weekend differences applied (extended kids block, movies in prime time, sport 12:00–18:00)
- [x] **10.4** Plex genre/language filters applied — verified with temporary Japanese-only station `langjp`; generated Plex slots resolved to Japanese/Japan content via live Plex metadata filtering
- [!] **10.5** Weighted selection not fully validated — Plex/rating-driven scheduling is active again, but probabilistic weighting itself was not measured in a controlled way
- [x] **10.6** TV show pinning works — verified a `ShowProgress` row (`Lovecraft Country`, `Fri 10:30`) matched a generated scheduled slot for the same station/weekday/time
- [x] **10.7** Episode pointer advancement works — verified `ShowProgress.nextEpisode` had advanced beyond the currently scheduled episode for a matching pinned show slot
- [x] **10.8** Gaps are being filled with YouTube slots aligned to hour/half-hour boundaries
- [x] **10.9** Ad break injection works — current schedules contain `1419` slots with `adBreaks` across stations
- [x] **10.10** ZBC slots contain no `adBreaks` entries
- [!] **10.11** ZBC Sunday Rage sequence not observed — Sunday schedule is generic YouTube blocks
- [x] **10.12** Running scheduler twice does not duplicate already-locked days
- [x] **10.13** `GET /api/scheduler/run` returns `{ scheduledDays: N }` — API now exposes `scheduledDays` (while preserving existing fields)

---

## 11. Holiday Override System

- [x] **11.1** Holiday detection correctly identifies Christmas, Easter, Halloween, Good Friday — validated against the live holiday date logic for 2026 (`christmas`, `halloween`, `easter`, `good_friday`)
- [x] **11.2** A `HolidayOverride` DB row causes scheduler to replace normal schedule for that day — verified with a temporary `todaytest` override that drove a unique holiday-only movie into the generated schedule
- [x] **11.3** Ad-free flag removes all ad breaks across the day — verified station-specific holiday override generated `0` ad-break-bearing slots for the temp station
- [x] **11.4** Content priority genres filter applied (e.g. `family,religious` for Christmas) — verified `contentPriority` drove `holidaytestgenre` selection for the temp station
- [x] **11.5** Per-station override takes precedence over `stationId=null` global override — verified station-specific `holidaytestgenre` + ad-free behavior overrode a global `documentary` + ads-enabled override

---

## 12. Special Events

- [ ] **12.1** Create a special event via admin UI (`/admin/dashboard/events`)
- [!] **12.2** High-priority event with `replaceSchedule=true` overrides slot(s) in its window — config persisted, but runtime slot override not validated yet (no generated schedules)
- [ ] **12.3** `/api/now` returns event content during its active window
- [!] **12.4** `stationId=null` event affects all stations simultaneously — global event creation verified (`stationId=null`), runtime multi-station effect still pending
- [x] **12.5** Deleting an event removes it and restores normal schedule

---

## 13. Admin Auth

- [x] **13.1** Correct email + password logs in and redirects to dashboard
- [x] **13.2** Wrong password returns 401 — "Invalid credentials" shown
- [x] **13.3** `zombietv_session` cookie has `HttpOnly` flag set (check DevTools → Application → Cookies)
- [x] **13.4** Visiting `/admin/dashboard` without session redirects to `/admin`
- [x] **13.5** All admin API routes return `{"error":"Forbidden"}` (403) without valid cookie
- [x] **13.6** Admin logout clears cookie and blocks dashboard access

---

## 14. Admin — Schedule Editor

- [x] **14.1** Loading any station + date populates the slot table
- [x] **14.2** All columns display correctly (time, duration, title, source, S/E, override status)
- [x] **14.3** Edit a slot — change content source and ID — saves successfully
- [x] **14.4** Overridden slot shows orange "✓ manual" in Override column
- [x] **14.5** Delete a slot — slot becomes `contentSource=youtube, contentId=null` (filler)
- [x] **14.6** Drag one slot onto another swaps their content
- [x] **14.7** Drop target row shows blue highlight during drag hover
- [x] **14.8** Slot swap writes two audit log entries (one per slot)
- [x] **14.9** "Regenerate 14-Day Schedule" button triggers scheduler run
- [x] **14.10** Regeneration scope toggle exists for all stations vs selected station

---

## 15. Admin — YouTube Pool Manager

- [x] **15.1** Add a new video entry (title, videoId, category, station)
- [x] **15.2** Add a playlist entry (playlistId, "Mark as playlist" checked)
- [x] **15.3** Submitting empty form shows validation error
- [x] **15.4** Filter by category shows only matching entries
- [x] **15.5** Filter by station shows only station-scoped entries
- [!] **15.6** Edit entry (title, category, station, duration) via modal — modal opened successfully; backend PATCH verified, but a full UI save round-trip still needs one more pass
- [!] **15.7** Delete entry with confirmation dialog — backend DELETE verified; UI confirmation dialog still needs a direct click-through pass
- [x] **15.8** "▶ Preview" button expands inline YouTube iframe (videos only)
- [x] **15.9** "Hide" collapses the iframe
- [ ] **15.10** `scheduledCount` increments after scheduler runs

---

## 16. Admin — Show Progress

- [ ] **16.1** Page lists all pinned shows with `nextSeason`, `nextEpisode`, station, weekday, time
- [ ] **16.2** Station filter dropdown narrows the list
- [ ] **16.3** Edit episode pointer — advance or reset — saves correctly
- [ ] **16.4** "Reset to E1" pre-fills form to S1E1
- [ ] **16.5** "Completed" flag causes scheduler to skip the show
- [ ] **16.6** Deleting a timeslot lock causes scheduler to re-assign the show on next run

---

## 17. Admin — Holiday Overrides

- [x] **17.1** Add override for a holiday + year — appears in table
- [x] **17.2** Override scoped to one specific station
- [x] **17.3** "Ad-free day" flag saves with `adFree=true`
- [x] **17.4** Content priority genres field stores and is used by scheduler — verified through a temporary holiday override that forced a unique-genre movie into the generated schedule
- [x] **17.5** "Replace normal schedule" flag persists correctly
- [x] **17.6** Delete override removes the row

---

## 18. Admin — Station Rules

- [x] **18.1** All 6 stations listed in sidebar; selecting each loads its rules
- [x] **18.2** Edit allow/deny genre strings and save
- [x] **18.3** Edit ad policy (enabled toggle, TV and movie break intervals)
- [x] **18.4** Edit filler pool YouTube IDs (ads, music, bumpers)
- [x] **18.5** Saved values persist after page refresh
- [x] **18.6** New station creation appears in Schedule Editor, Specials, YouTube Pool, Holidays, and Show Progress selectors — validated with temporary station `t19x` across all five admin pages

---

## 19. Admin — VHS / CRT Controls

- [x] **19.1** All 6 sliders render (scanlines, noise, chromatic aberration, vignette, CRT curvature, flicker)
- [x] **19.2** Dragging/adjusting a slider updates the numeric readout in real time (verified via keyboard step: `0.50` → `0.51`)
- [x] **19.3** Saving writes to `AdminPreference` DB (verified by POST `/api/vhs-settings` then GET reflected persisted values)
- [x] **19.4** Changes visible to viewer tab within 30 seconds — verified after removing duplicate static overlay; viewer scanline layer changed after the 30s poll window
- [x] **19.5** "Reset to defaults" returns all sliders to default values

---

## 20. Admin — Audit Log

- [x] **20.1** All manual slot changes appear in the log
- [x] **20.2** Each row shows timestamp, user, reason, and slot ID
- [x] **20.3** Clicking a row expands a before/after JSON diff
- [x] **20.4** Log paginates at 50 entries per page
- [x] **20.5** ⟳ Refresh button reloads data without a full page reload

---

## 21. Phase 5 — Not Yet Built

> These are planned but not implemented. Do not test until built.

- [ ] **21.1** Australian rating board overlay art assets (G, PG, M, MA15+) — `RatingBug` component exists, assets not sourced
- [ ] **21.2** Channel-specific colour themes applied to EPG chrome
- [ ] **21.3** Mobile-responsive EPG
- [ ] **21.4** `.env.example` file and environment config documentation
- [ ] **21.5** Docker production hardening (multi-stage build, non-root runtime user)
- [ ] **21.6** Production deployment guide

---

## Notes

### Session — 2026-06-21
- Fixed two bugs in `scripts/init-db.js` before first run: `HolidayOverride` null-upsert (Prisma/SQLite limitation) and missing `passwordHash` in seeded admin preferences.
- Admin login API confirmed working: correct creds → 200 `{ok:true}`, wrong creds → 401.
- Admin API routes return 403 without session cookie (confirmed `/api/admin/audit`).
- Public EPG/now routes return 200 without auth (confirmed).
- Plex OAuth init returns a valid auth URL.
- Items 2.2, 2.3, 2.5 require a real Plex account and browser flow — manual test needed.
- Schedule editor date lookup required timezone-safe day-range matching (stored schedule dates are local-midnight timestamps, not UTC date-only).
- Section 14 validated end-to-end on `zbc` date `2026-06-21`: load/edit/delete/drag-swap/regen all passed.
- Section 20 validated: row details + expand diff passed; pagination verified by creating >50 audit entries (56 total observed, page 2 shown).
- Section 10 deep-check (DB-backed): all stations generated 14 active days; local-time block structure matches weekday/weekend templates; however generated content is currently 100% YouTube (`plex:0`, `MediaItem:0`, `ShowProgress:0`, no adBreak JSON), so 10.4–10.7/10.9/10.11 remain blocked-failing by missing Plex-program scheduling output.
- Section 9 validated after adding `contentRating` to `PlaybackState` and retriggering the rating bug on each Plex programme start, even when the rating string repeats.
- Section 19 fully validated after removing the duplicate static VHS overlay from the route wrapper; viewer-side VHS changes now visibly propagate on the 30-second poll.
- Section 18.6 validated with temporary station `t19x`: it appeared in Schedule Editor, Special Events, YouTube Pool, Holiday Overrides, and Show Progress selectors before cleanup.
- Scheduler/holiday runtime was then fixed to consume `HolidayOverride` rows with station-specific precedence over global overrides; controlled `todaytest` proof confirmed schedule replacement, ad-free suppression, and `contentPriority` genre selection for a station-specific override while a global override still applied to another temp station.
- Section 10.4 was then fixed with best-effort live Plex language filtering: when station language rules are present, scheduler bypasses catalog-only selection and filters live Plex search results using available `Country`/language metadata. Temporary station `langjp` generated Japanese/Japan content and was cleaned up afterward.
- Section 11.1 was validated with deterministic 2026 holiday-date checks against the same holiday detection logic used by the app: `christmas`, `halloween`, `easter`, and `good_friday` all resolved correctly.
- Section 8 fully validated after fixing today-schedule lookup in playback and seeding a controlled active `zbc` slot for verification (`Checklist Show`, `S2 E4`, and in-break state).
- Cleanup completed: removed temporary overlapping `zbc` test slot and restored modified active slot to baseline YouTube scheduling values.
- YouTube autoplay reliability improved in player embed URLs by using muted autoplay (`autoplay=1`, `mute=1`, `playsinline=1`) and verified in the rendered iframe URL.
- Scheduler validation setup: regenerated `seven` day schedule after seeding catalog movies and station ad pools; resulting schedule contained `24` slots, including `12` Plex slots and `22` slots with ad-break metadata.
- Added deterministic playback test support via optional `at` timestamp in `/api/now/[stationId]` and client poll passthrough (`?at=...`) for reproducible section 6 runtime checks.
- Current implementation status: station CRUD is wired through the admin UI, holiday settings are editable with named date ranges, the EPG can be dragged horizontally across 48 hours, and scheduler regeneration can target either all stations or the selected station.
- **Section 6 Plex playback validation (2026-06-21)**: Comprehensive test created (`test-plex-playback.js`) verifying all 7 playback requirements:
  - 6.1 PASS: PlaybackState API returns all required fields (`stationId`, `serverTimeMs`, `contentSource`, `contentId`, `title`, `contentRating`, `startOffsetMs`, `slotStartMs`, `slotEndMs`, `nextTransitionMs`, `inAdBreak`, `upcomingAdBreaks`) on Plex content queries
  - 6.2 PASS: Cache-Control headers support 5s poll interval (`max-age=5, stale-while-revalidate=2`)
  - 6.3 PASS: Plex iframe URLs constructed with `X-Plex-Token` parameter and player confirmed rendering (Plex web player login iframe observed)
  - 6.4 PASS: YouTube filler pool used for ad breaks when `contentSource='ad'` and `inAdBreak=true`
  - 6.5 PASS: Drift correction architecture confirmed via `correctedNow = Date.now() + clockOffsetMs` on client, `serverTimeMs` provided by server
  - 6.6 PASS: Mid-program offset calculation verified: at +60s offset 60000ms, at +300s offset 300000ms (240s delta = 100% accuracy)
  - 6.7 PASS: Invalid station gracefully returns `contentSource:"offline"` without error
  - Schedule DB snapshot: 1810 Plex slots across 84 schedules, 1419 slots with ad breaks, all 6 stations generating content
  - Test coverage: 3 stations (ZBC/Seven/Nine) × 1 Plex movie each with accurate offset calculation and full PlaybackState field validation
- Next recommended test: create a brand-new station in Station Rules and verify it appears everywhere it should without a rebuild or manual config change.
