# 📺 1990s Australian Broadcast Simulator — Master Project Plan

> **Single source of truth.** All previous draft plan files have been consolidated here.

---

## 🎯 Project Summary

A web-based application that simulates a strict-timeline 24/7 broadcast television network set in early-mid 1990s Australia. Content is sourced from **Plex** (primary media) and **YouTube** (ads, music videos, filler — manually curated via JSON). The system generates era-accurate schedules, enforces station-specific rules, and presents everything through a **VHS-style viewport overlay** with a 1990s Electronic Program Guide.

### Confirmed Technical Decisions

| Decision | Choice | Notes |
|---|---|---|
| Timeline sync | Server-authoritative global clock | All users see the same frame at the same time |
| YouTube management | Manual JSON input | No YouTube Data API required |
| VHS effect scope | Entire viewport | Applied in `layout.tsx`, not per-component |
| Plex data fetching | On-demand API calls | No local caching of library data |
| Database | SQLite via Prisma | File-based, easy to deploy |
| Auth | Plex OAuth (full flow) | Users log in with their Plex account |
| Schedule horizon | 2-week rolling lock | Auto-progresses; admin can override any slot |
| Admin portal | `/admin` route | Protected, visual schedule editor |
| Tech stack | Next.js 14, TypeScript, Prisma | Node.js backend, SQLite DB |

---

## 🧱 1. Core Principles

### Strict Broadcast Simulation
- One global server-synced timeline for all users.
- If a user tunes in late, they join the program already in progress.
- No per-user timelines.

### Weighted Random Content Selection
- Scheduler chooses content based on genre, era, and station rules.
- Weighted by: station identity · time of day · content type (movie/episode/filler) · rating (G/PG daytime, M/MA15+ late night)

### Era-Accurate Break Points + Soft Cuts
- Use Plex chapter markers when available.
- Fall back to nearest natural silence/scene change.
- Allow ±5 seconds drift to avoid mid-sentence cuts.

### Minimalist 1990s EPG
- Blue background, white text, block grid.
- Program name only — no extra metadata.
- 48-hour look-ahead across all stations.

### Six Stations at Launch (unlimited future expansion)

| ID | Full Name | Ad Policy |
|---|---|---|
| STN | Subtitle Television Network | Ads enabled |
| ZBC | Zombie Cheese Broadcasting Network | No ads |
| NNWK | Nippon Network | Ads enabled |
| Seven | Seven | Ads enabled |
| Nine | Nine | Ads enabled |
| Ten | Ten | Ads enabled |

### Schedule Locking & Progression
- Schedules are generated and **locked 2 weeks ahead**.
- The scheduler auto-extends the lock as time passes.
- TV show episodes are pinned to a fixed weekday/time slot and advance weekly.
- Admin can override any individual slot via the admin portal.

### Holiday Overrides

| Holiday | Behaviour |
|---|---|
| Christmas Eve | Movie marathons, Carols specials, extended kids blocks |
| Christmas Day | All-day family movies, religious programming |
| Good Friday | No ads on some stations; religious films priority |
| Easter Sunday | Family movies |
| Halloween | Horror movies/TV priority; special YouTube bumpers injected |

Holiday definitions are editable in the admin portal as named settings with a date range, then reused by holiday-tagged catalog items and year-specific overrides.

### Era-Accurate Branding
- Per-station logos, idents, bumpers, VHS overlays, colour palettes.
- Australian rating boards (G, PG, M, MA15+) displayed on screen.

---

## 🧩 2. System Architecture

### 🧠 A. Scheduling Engine

**Purpose:** Generate 2-week rolling schedules per station, auto-progressing over time.

| Input | Source |
|---|---|
| Plex library metadata | Plex API (on-demand, no cache) |
| YouTube filler pools | `config/youtube-fillers.json` (manual) |
| Station rules | `config/stations.json` |
| Holiday calendar | Editable holiday settings + year-specific holiday overrides |
| Special event queue | `SpecialEvent` DB table |

**Key behaviours:**
- Time blocks follow 1990s Australian weekday/weekend templates (see §5)
- Programs align to hour or half-hour; only the leftover rounding gaps between programmed Plex slots are filled with YouTube filler
- Ad/filler may only appear inside documented ad-break windows or as the rounding gap after a Plex program, never as a full replacement for a scheduled Plex block
- TV show episodes lock to same weekday/timeslot; advance one ep/week
- Ad breaks: every 15 min (TV shows) / every 30 min (movies)
- Holiday overrides replace partial or full day schedules

### 🕒 B. Real-Time Playback Engine

**Purpose:** Tell every client what frame to play right now.

- Server maintains a single authoritative clock
- Client receives: `{ contentId, source, startOffsetMs, nextTransitionAt, adBreaks[] }`
- Handles: current program · elapsed time · ad break detection · station ident triggers · soft-cut transitions

### 📦 C. Content Ingestion Layer

**Plex OAuth flow:**
1. User visits `/auth/plex` → redirected to plex.tv OAuth
2. Token returned → stored server-side
3. App queries Plex API for library metadata on demand
4. Lightweight index stored in `MediaItem` table for scheduling

**YouTube filler (manual):**
- Edit `config/youtube-fillers.json` to add video IDs / playlist IDs
- Admin portal provides a UI to add/remove entries without editing JSON directly
- Categories: `ads`, `music`, `bumpers`, `filler`, `special`

### 🏷️ D. Station Rule Engine

Each station is defined in `config/stations.json` (source of truth) and seeded into the DB.

**Per-station rules:**
- `allow_genres` / `deny_genres` (comma-separated strings, SQLite-compatible)
- `allow_languages` / `deny_languages`
- `ad_policy` → `{ enabled, break_interval_tv, break_interval_movie }`
- `time_blocks[]` → named blocks with day, start, end, content_source
- `holiday_overrides` → per-holiday behaviour
- `filler_pools` → YouTube IDs for ads / music / bumpers
- `special_schedule` → one-off fixed slots (e.g. ZBC Sunday Monkey + Rage)

**Station profiles:**
- **STN** — Multicultural; foreign/subtitled/art-house; no Japanese; ads on
- **ZBC** — No ads; children's, UK drama, documentary; late-night Rage (YouTube, ≤2005); Sunday: Rage opener → random playlist → Monkey ep
- **NNWK** — Japanese & Korean content only; Japanese ads
- **Seven** — Documentary, drama; blockbuster Saturday night movie
- **Nine** — US sitcoms; blockbuster Sunday night movie
- **Ten** — Youth/teen; horror priority on Halloween

### 📅 E. Holiday & Event Override System
- `HolidaySetting` rows define the named holiday calendar and date range
- `HolidayOverride` rows in DB override scheduling for a given holiday + year + station
- `SpecialEvent` rows inject one-off blocks (breaking news, marathons, sports overruns)
- Holiday-tagged catalog items are preferred on matching holidays
- Priority: `SpecialEvent (high) > HolidayOverride > normal schedule`

### 📺 F. User Interface Layer

**VHS Viewport Overlay** (`src/components/VHSOverlay.tsx`, rendered in `layout.tsx`):
- Scanlines · chromatic aberration · noise · vignette · CRT curvature · flicker
- All intensities are **tunable by admin** via the Admin Preferences panel
- Applied to entire `<body>` — not scoped to the video player

**EPG** — classic 1990s look:
- Dark blue background (`#0a1628`), white text
- 48-hour time grid, hour/half-hour blocks, "NOW" indicator
- Station tabs across the top

**Player:**
- Plex SDK for primary content (streams from user's Plex server)
- YouTube `<iframe>` embed for ads, music, bumpers, filler
- Channel-change static burst animation on station switch

---

## 🗄️ 3. Database Schema

> Full schema in `prisma/schema.prisma`. SQLite — no native arrays; comma-separated strings used for genres/ratings.

| Table | Purpose |
|---|---|
| `Station` | Station definitions (branding, rules, filler pools) |
| `Schedule` | One row = one day per station (2-week lock) |
| `Slot` | One program block within a schedule day |
| `SlotMediaItem` | Join: which Plex items are in a slot (ordered) |
| `MediaItem` | Lightweight Plex library index for scheduling |
| `YoutubeContent` | Manually curated YouTube videos/playlists |
| `HolidaySetting` | Editable holiday definition and date range |
| `HolidayOverride` | Per-holiday schedule replacement rules |
| `SpecialEvent` | One-off event injections (breaking news, marathons) |
| `User` | Plex OAuth users + admin flag |
| `ScheduleChange` | Audit log of all admin manual edits |
| `AdminPreference` | Global/per-station settings (VHS intensity, etc.) |

---

## 🧮 4. Scheduling Algorithm

```
FOR each station:
  FOR each day in the 2-week window (if not already scheduled):
    1. Load station template + time-block template for weekday/weekend
    2. Resolve HolidaySetting for the current date → if match, apply holiday-aware catalog preferences and override rules
    3. Exclude all holiday-tagged items that don't match today's holiday (items tagged for ANY holiday are withheld on non-matching days)
    3. Check SpecialEvent queue → inject any high-priority events
    4. FOR each time block:
       a. Query Plex API with station genre/language filters
       b. Weighted random selection (weighted by station identity, time of day, rating)
       c. If TV show: lock to same weekday/time; advance episode pointer
       d. Calculate ad break offsets (15 min TV / 30 min movie)
       e. Calculate filler needed to reach next hour/half-hour boundary
       f. Write Slot + SlotMediaItem rows to DB
    5. Commit day schedule
END
```

---

## 🧰 5. Time-Block Templates (1990s Australian TV)

### Weekday

| Time | Block | Typical Content |
|---|---|---|
| 00:00–02:00 | Late Movies | Older films, thrillers, B-movies |
| 02:00–04:00 | Infomercials | Paid programming (YouTube filler) |
| 04:00–06:00 | Early News / Religion | News updates, religious programs |
| 06:00–07:00 | Breakfast Warm-Up | Aerobics, early kids, news briefs |
| 07:00–09:00 | Kids Cartoons | Agro's Cartoon Connection, Cheez TV |
| 09:00–11:00 | Morning Lifestyle | Talk shows, lifestyle |
| 11:00–12:00 | US/UK Reruns | Sitcoms, soaps, light dramas |
| 12:00–14:00 | Midday Movie | Classic films, telemovies |
| 14:00–16:00 | Daytime Soaps | Days of Our Lives, Y&R |
| 16:00–18:00 | After-School TV | Totally Wild, cartoons, kids game shows |
| 18:00–18:30 | Evening News | Flagship news bulletin |
| 18:30–19:30 | Current Affairs | A Current Affair, Today Tonight |
| 19:30–21:30 | Prime Time | Sitcoms, dramas, reality, weekly movie |
| 21:30–22:30 | Second-Tier Prime | Imported dramas, local specials |
| 22:30–23:00 | Late News | Network late bulletin |
| 23:00–00:00 | Late Night | US sitcoms, UK comedy, documentaries |

### Weekend Differences

| Time | Content |
|---|---|
| 06:00–10:00 | Kids Cartoons (extended Saturday block) |
| 10:00–12:00 | Sports Preview / Lifestyle |
| 12:00–18:00 | Live Sport (AFL, cricket, tennis, motorsport) |
| 18:00–19:00 | News (shorter/lighter) |
| 19:00–22:00 | Movies (big Saturday/Sunday slots) |
| 22:00–late | Music video shows (Rage, Ground Zero, Video Hits) |

---

## 🧪 6. Special Event Schema

```json
{
  "id": "string",
  "type": "breaking_news | sports_overrun | marathon | custom",
  "stationId": "string | null",
  "startTime": "ISO timestamp",
  "durationMins": 60,
  "priority": "high | medium | low",
  "replaceSchedule": true,
  "content": { "source": "plex | youtube", "id": "...", "description": "..." }
}
```

---

## 🎨 7. Branding Asset Pipeline

| Asset | Location | Status |
|---|---|---|
| Station logos | `public/assets/{id}-logo.png` | ⬜ Placeholder SVGs only |
| 1990s idents | `public/assets/idents/{id}/` | ⬜ Pending |
| Bumpers | `public/assets/bumpers/{id}/` | ⬜ Pending |
| AU rating boards | `public/assets/ratings/` | ⬜ Pending |
| VHS overlay | `src/components/VHSOverlay.tsx` | ✅ Built (tuneable) |
| Channel-change static | `src/components/ChannelChange.tsx` | ⬜ Pending |
| EPG theme | Inline styles in EPG component | ✅ Defined |

---

## 🗂️ 8. Project File Structure

```
zombietv/
├── config/
│   ├── stations.json          # Station rules, branding, filler pool IDs
│   └── youtube-fillers.json   # Manually curated YouTube video/playlist IDs
├── prisma/
│   └── schema.prisma          # SQLite schema (Prisma ORM)
├── public/
│   └── assets/                # Logos, rating boards, static files
├── scripts/
│   └── init-db.js             # DB seed script (CommonJS require)
├── src/
│   ├── app/
│   │   ├── layout.tsx         # Root layout — VHS overlay + CRT SVG filter
│   │   ├── page.tsx           # Main viewer page (EPG overlay on full-screen video)
│   │   └── admin/
│   │       ├── page.tsx       # Admin login gate
│   │       └── dashboard/
│   │           ├── page.tsx   # Dashboard home
│   │           ├── audit/     # Audit log
│   │           ├── catalog/   # Plex catalog + holiday tags + blocked media
│   │           ├── events/    # Special event injection
│   │           ├── holidays/  # Holiday settings + overrides
│   │           ├── schedule/  # Schedule editor
│   │           ├── shows/     # Show progress + reset
│   │           ├── stations/  # Station rule editor
│   │           ├── vhs/       # VHS/CRT intensity controls
│   │           └── youtube/   # YouTube pool manager
│   ├── components/
│   │   ├── EPG.tsx            # 48-hr program guide overlay (resolution-scalable)
│   │   ├── VideoPlayer.tsx    # Plex HLS + YouTube iframe switcher
│   │   ├── VHSOverlay.tsx     # Viewport-wide CRT/VHS effect layer
│   │   ├── VHSSettingsSync.tsx
│   │   ├── RouteVisualEffects.tsx
│   │   ├── ChannelChange.tsx  # Static burst animation on station switch
│   │   ├── NowBar.tsx
│   │   ├── RatingBug.tsx      # AU rating overlay at program start
│   │   └── admin/AdminShell.tsx
│   ├── hooks/
│   │   ├── usePlayback.ts     # Server-authoritative playback state + drift correction
│   │   └── useVHSSettings.ts
│   └── lib/
│       ├── scheduler.ts       # 2-week rolling schedule generator
│       ├── plex-catalog.ts    # Catalog sync, holiday tag map, blocked keys
│       ├── holidays.ts        # Holiday detection + settings CRUD
│       ├── plex-client.ts     # Plex API client
│       ├── plex-auth.ts       # Plex OAuth pin flow
│       ├── playback.ts        # PlaybackState type + clock logic
│       ├── session.ts         # iron-session config
│       ├── vhs-defaults.ts    # VHSSettings type + defaults
│       └── youtube-playlist.ts
├── instrumentation.ts         # Starts scheduler on server boot
└── package.json
```

---

## ✅ 9. Action Items & Progress

### Phase 1 — Foundation
- [x] Project structure scaffolded
- [x] SQLite schema defined (`prisma/schema.prisma`)
- [x] Station config defined (`config/stations.json`)
- [x] YouTube filler config created (`config/youtube-fillers.json`)
- [x] DB seed script (`scripts/init-db.js`)
- [x] VHS overlay component (`src/components/VHSOverlay.tsx`)
- [x] Root layout with viewport-wide VHS effect
- [x] Main viewer page scaffold
- [x] Admin login gate (`/admin`)
- [x] Admin dashboard scaffold (`/admin/dashboard`)
- [x] Scheduling utilities (`src/utils/scheduling.ts`)

### Phase 2 — Core Engine
- [x] Plex OAuth full flow (`/auth/plex` → token → user session)
- [x] Plex API client (library scan, metadata fetch, stream URL)
- [x] Scheduling engine (2-week generator, episode pointer, filler padding)
- [x] Real-time playback engine (server clock → client offset calculation)
- [x] Ad break injection logic
- [x] Holiday override enforcement

### Phase 3 — UI
- [x] EPG component (48-hr grid, NOW indicator, all stations)
- [x] Video player component (Plex + YouTube iframe switching)
- [x] Channel-change static burst animation
- [x] Station branding assets (colour themes wired to EPG + NowBar)
- [x] VHS intensity controls wired to AdminPreference DB

### Phase 4 — Admin Portal
- [x] Real auth (JWT / httpOnly cookie, bcrypt password)
- [x] Schedule editor (drag/drop slot reassignment per station per day)
- [x] YouTube content manager (add/remove IDs, preview)
- [x] Special event creator
- [x] Holiday override UI
- [x] Audit log viewer

### Phase 4 — Admin Portal
- [x] Real auth (Plex OAuth admin flag; no separate password system)
- [x] Schedule editor (drag/drop slot reassignment per station per day)
- [x] Regenerate all stations or single station from schedule editor
- [x] YouTube content manager (add/remove IDs, preview opens in new tab)
- [x] Special event creator
- [x] Holiday override UI (per-year, per-station, content priority)
- [x] Holiday settings manager (create/edit/delete named holidays with date ranges)
- [x] Audit log viewer
- [x] Station rule editor (create/edit stations, rules, filler pools, branding)
- [x] Plex catalog browser with holiday tag assignment and blocked media management
- [x] Show progress tracker with reset button
- [x] VHS/CRT intensity controls (6 sliders + debug overlay toggle)

### Phase 5 — Polish & Deploy
- [x] Australian rating bug overlay (RatingBug component — text-based, fades after 5s)
- [x] Channel-specific colour themes applied to EPG and UI chrome
- [x] EPG overlay on video (floats above; resolution-scalable font/row sizes)
- [x] VHS/broadcast video degradation (saturate, contrast, pixelated rendering)
- [x] Plex dashboard visibility (HLS transcode + 10s timeline heartbeat)
- [x] Show exclusivity enforcement (one show per station)
- [x] Episode pacing (7-day throttle per show)
- [x] Holiday-tagged content exclusion (only scheduled on matching holiday)
- [x] YouTube background audio fix (iframe unmounted on station switch)
- [x] Environment config (`.env` for DATABASE_URL, Plex client ID, session secret)
- [x] Docker compose setup (multi-container, named volume for SQLite)
- [ ] Australian rating board image assets (placeholder text only currently)
- [ ] Station idents/bumpers between programs
- [ ] Mobile-responsive EPG
- [ ] Production deployment guide (non-Docker)

---

## 📝 Notes

- **SQLite arrays:** SQLite has no native array type. Genres and ratings are stored as comma-separated strings and split at the application layer.
- **Plex stream auth:** All Plex video URLs require the user's Plex token. The player must attach `?X-Plex-Token=` to every stream request.
- **YouTube filler ordering (ZBC Sunday):** Rage opener (`Lzk0sygecu4`) → random from `PLVWLfb1wlwNRF3Y33ygrsdXDcq7osC1Uv` → Rage closer (`wx7-Hr-iVJ4`) → one episode of Monkey.
- **ZBC music cutoff:** Music video blocks on ZBC must not include content released after 2005.
- **Halloween YouTube IDs:** `zbeYwGANtWM` (list: `RDzbeYwGANtWM`) and `qkVlC2WgEwc` are seeded as Halloween bumpers.
- **No YouTube Data API:** All YouTube content is manually curated. No API key required.
- **Admin password:** Default seed is `admin123` — must be changed before any deployment.


