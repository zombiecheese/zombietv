# Zombie TV — Current Codebase State

> Last updated: 2026-06-21. Reflects actual implemented functionality.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router, TypeScript, React 18) |
| Database | SQLite via Prisma ORM 5.x |
| Auth | Plex OAuth (iron-session, httpOnly cookies) |
| HLS streaming | hls.js 1.6 via custom `/api/plex-stream` proxy |
| Filler / ads | YouTube iframe embed (manually curated IDs) |
| Password hashing | bcryptjs |
| Date math | date-fns 3.x |
| Deployment | Docker (Dockerfile + docker-compose.yml) |

---

## Project Structure

```
zombietv/
├── config/
│   ├── stations.json           # Station rules, branding, filler pool IDs
│   └── youtube-fillers.json    # Manually curated YouTube video/playlist IDs
├── prisma/
│   └── schema.prisma           # SQLite schema (Prisma ORM)
├── public/assets/              # Logos, rating boards, static files
├── scripts/
│   └── init-db.js              # DB seed (stations, admin user, youtube fillers)
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout — VHS overlay, CRT SVG filter
│   │   ├── page.tsx                # Main viewer (EPG overlay on video, channel change)
│   │   ├── admin/
│   │   │   ├── page.tsx            # Admin login gate
│   │   │   └── dashboard/
│   │   │       ├── page.tsx        # Dashboard home
│   │   │       ├── audit/          # Audit log viewer
│   │   │       ├── catalog/        # Plex catalog browser + holiday tag management
│   │   │       ├── events/         # Special event injection
│   │   │       ├── holidays/       # Holiday settings + year-specific overrides
│   │   │       ├── schedule/       # Schedule editor (drag/swap slots, regenerate)
│   │   │       ├── shows/          # Show progress tracker + reset button
│   │   │       ├── stations/       # Station rule editor
│   │   │       ├── vhs/            # VHS/CRT effect intensity controls
│   │   │       └── youtube/        # YouTube content pool manager
│   │   └── api/
│   │       ├── admin/              # Admin CRUD endpoints
│   │       ├── auth/               # Plex OAuth + session endpoints
│   │       ├── epg/[stationId]/    # 48-hour EPG data per station
│   │       ├── now/[stationId]/    # Current playback state per station
│   │       ├── plex-stream/        # HLS proxy + /timeline relay to Plex dashboard
│   │       ├── scheduler/run/      # Manual scheduler trigger
│   │       ├── stations/           # Public station list
│   │       └── vhs-settings/       # VHS intensity read/write
│   ├── components/
│   │   ├── ChannelChange.tsx   # Static burst animation on station switch
│   │   ├── EPG.tsx             # 48-hr program guide (overlay on video, scalable)
│   │   ├── NowBar.tsx          # Now-playing bar
│   │   ├── RatingBug.tsx       # Australian rating overlay (fades after 5s)
│   │   ├── RouteVisualEffects.tsx  # CRT filter + VHSOverlay on non-admin routes
│   │   ├── VideoPlayer.tsx     # Plex HLS + YouTube iframe switcher
│   │   ├── VHSOverlay.tsx      # Viewport-wide CRT/VHS effect layer
│   │   ├── VHSSettingsSync.tsx # Polls /api/vhs-settings every 30s
│   │   └── admin/AdminShell.tsx
│   ├── hooks/
│   │   ├── usePlayback.ts      # Polls /api/now, returns PlaybackState + clockOffsetMs
│   │   └── useVHSSettings.ts   # Fetches VHS settings once on mount
│   ├── lib/
│   │   ├── admin-guard.ts      # Server-side admin session check
│   │   ├── db.ts               # Prisma singleton
│   │   ├── holidays.ts         # Holiday detection + settings CRUD
│   │   ├── json.ts             # Safe JSON parse/stringify helpers
│   │   ├── playback.ts         # PlaybackState type + server-clock logic
│   │   ├── plex-auth.ts        # Plex OAuth pin flow
│   │   ├── plex-catalog.ts     # Catalog sync, holiday tag map, blocked keys
│   │   ├── plex-client.ts      # Plex API client (library scan, metadata, stream URLs)
│   │   ├── scheduler.ts        # 2-week schedule generator
│   │   ├── session.ts          # iron-session config + helpers
│   │   ├── vhs-defaults.ts     # VHSSettings type + default values
│   │   └── youtube-playlist.ts # YouTube filler pool helpers
│   └── utils/
│       └── scheduling.ts       # Time helpers, weighted random, genre filter utils
├── instrumentation.ts          # Next.js instrumentation: starts scheduler on boot
├── next.config.js
└── package.json
```

---

## Database Schema

| Table | Purpose |
|---|---|
| `Station` | Station definitions — branding, rules JSON, filler pools JSON |
| `Schedule` | One row per station per day (2-week rolling lock) |
| `Slot` | One program block within a Schedule |
| `SlotMediaItem` | Ordered join: which Plex items are in a Slot |
| `MediaItem` | Lightweight Plex catalog index for scheduling + blocking |
| `ShowProgress` | Episode pointer per show per station; throttled weekly advancement |
| `YoutubeContent` | Manually curated YouTube video/playlist IDs with category |
| `HolidaySetting` | Editable named holiday calendar entries with date ranges |
| `HolidayOverride` | Per-holiday, per-year, per-station schedule replacement rules |
| `SpecialEvent` | One-off injected blocks (breaking news, marathons, sports overruns) |
| `User` | Plex OAuth users with admin flag and Plex credentials |
| `ScheduleChange` | Audit log of all admin manual slot edits |
| `AdminPreference` | Global/per-station key–value settings (VHS intensity, catalog, holiday tags) |

---

## Key Implemented Behaviours

### Playback
- Single global server-authoritative timeline; all viewers see the same frame
- `usePlayback` polls `/api/now/[stationId]` every 5s; returns `PlaybackState` + `clockOffsetMs` drift correction
- Plex content streamed via `/api/plex-stream` HLS proxy (forces transcode with `directPlay=1, directStream=1` for Plex dashboard visibility)
- Plex dashboard heartbeat: `/api/plex-stream/timeline` called every 10s from VideoPlayer with current offset/duration
- YouTube iframe only mounted when active; unmounted on station switch to stop background audio
- Joining mid-program seeks to correct `startOffsetMs` immediately
- Station switch: static burst via `ChannelChange`, then station state updates
- VHS/broadcast degradation: `saturate(0.92)`, `contrast(1.05)`, `imageRendering: pixelated` applied to video element

### Scheduling
- 2-week rolling schedule generated on startup (`instrumentation.ts`) and every 6 hours
- Show exclusivity: first station to air a show owns it; other stations' candidates are filtered out
- Episode pacing: `ShowProgress` advances at most once per 7 days (`EPISODE_PROGRESS_INTERVAL_DAYS = 7`)
- Holiday-tagged content only scheduled on matching holiday days (excluded from all non-matching days)
- Rescue pool fallback if slot placement fails 6+ times consecutively
- Hour/half-hour slot alignment with YouTube filler padding for rounding gaps
- Admin reset button wipes all `ShowProgress` records to restart episode pointers

### VHS / CRT Effects
- `VHSOverlay`: scanlines (CSS repeating-linear-gradient), noise (canvas 1/3 resolution, 12fps, `screen` blend), vignette, chromatic aberration, flicker (CSS keyframe animation)
- CRT barrel distortion: SVG `feTurbulence` + `feDisplacementMap` filter on root layout
- Admin-tunable (6 sliders) via `/admin/dashboard/vhs`; propagates to all clients within 30s via polling
- Canvas clears with fresh `createImageData` each frame (no stuck artifact)
- Effects disabled automatically on all `/admin/*` routes

### EPG
- Overlays on top of video (fixed position, `zIndex: 100`) — video fills full screen behind it
- 48-hour horizontal grid; pointer drag-to-pan; red NOW indicator
- Font sizes and row/column sizes scale with device pixel ratio and viewport width (up to 1.8x on 4K)
- Compact bar mode (38px) shows only current program + time; expands to full 440px grid
- Full mode shows ~7+ station rows

### Admin Portal
- All admin auth via Plex OAuth admin flag (no separate password system)
- Schedule editor: regenerate all/single station, drag-swap slots, manual slot overrides, audit trail
- Show progress: view episode pointer per show per station; reset all progress button
- Catalog: Plex catalog sync, holiday tag assignment, blocked media management
- YouTube pool: add/edit/delete filler IDs, preview opens YouTube in new tab
- VHS controls: 6 intensity sliders + debug overlay toggle (controls viewer HUD)
- Holiday settings: create/edit/delete named holidays with configurable date ranges
- Holiday overrides: per-year, per-station override rules with content priority
- Special events: one-off block injection (breaking news, marathons)
- Audit log: full history of all manual admin schedule changes

---

## Known Limitations / Not Yet Implemented

- No unit or integration tests
- Australian rating board image assets are placeholders (bug overlay text only)
- Station idents and bumpers not yet injected between programs
- Mobile layout not optimised (EPG uses pixel-based sizing that may not fit small screens)
- No automated detection of Plex token expiry (manual re-login required)
