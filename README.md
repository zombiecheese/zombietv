# ZombieTV

> 1990s Broadcast Simulator — web-based, Plex-powered, Retro Stylings

A multi-station broadcast simulator that recreates the feel of watching free-to-air TV in the early-to-mid 1990s. All users share a single global timeline — tune in late and you join the show already in progress, just like real TV.

See [plan.md](./plan.md) for the full project specification, architecture, and progress tracker.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend + Backend | Next.js 14 (App Router, TypeScript) |
| Database | SQLite via Prisma ORM |
| Auth | Plex OAuth (plex.tv) |
| Primary media | Plex library (streamed via Plex SDK) |
| Filler / ads | YouTube (manually curated video/playlist IDs) |
| Styling | Inline styles + CSS-in-JS (VHS viewport overlay) |

---

## Quick Start

### Prerequisites
- Node.js 18+
- A running Plex Media Server with your library
- A Plex developer app (for OAuth) — register at https://www.plex.tv/media-server-downloads/

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Create a `.env` file in the project root:

```env
DATABASE_URL="file:./prisma/dev.db"
SESSION_SECRET="generate-a-long-random-string-at-least-32-chars"
PLEX_CLIENT_ID="your-plex-client-id"
```

#### How to set `PLEX_CLIENT_ID`

1. Sign in to Plex and open the developer app page:
    https://www.plex.tv/media-server-downloads/#plex-app
2. Create/register an app for local development (if you do not already have one).
3. Copy the app's Client ID value.
4. Paste it into `.env` as:

```env
PLEX_CLIENT_ID="your-real-client-id-here"
```

For local development, this ID can be any stable value tied to your app setup.
If `PLEX_CLIENT_ID` is blank or missing, Plex login will fail at `/api/auth/plex/init`.

#### Verify Plex OAuth setup (30-second check)

Run this from the project root after `npm run dev`:

```powershell
Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:3000/api/auth/plex/init" -Method POST | Select-Object StatusCode,Content
```

Expected result:
- `StatusCode` is `200`
- `Content` contains an `authUrl` that starts with `https://app.plex.tv/auth#?clientID=`

If this fails:
- confirm `.env` exists and has `PLEX_CLIENT_ID="..."`
- restart the dev server after changing `.env`
- ensure `SESSION_SECRET` is set and at least 32 characters

### 3. Initialise the database

```bash
npx prisma db push
node scripts/init-db.js
```

### 4. Add your YouTube filler content

Edit `config/youtube-fillers.json` and replace the placeholder IDs with real YouTube video or playlist IDs. See the file for instructions.

### 5. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to watch TV.
Open [http://localhost:3000/admin](http://localhost:3000/admin) for the admin portal.

### Docker

The project can also be delivered as a single container with persisted SQLite storage.

```bash
docker compose up --build
```

What it does:
- Builds the app image from the local source tree
- Uses the root `.env` file for Plex/session settings
- Stores the SQLite database in a named volume at `/data/dev.db`
- Runs `prisma db push` on startup and seeds the database the first time the volume is empty

If you want to run the container manually instead of compose, use the same image build and set `DATABASE_URL=file:/data/dev.db` plus a writable `/data` volume.

---

## Stations

| ID | Name | Character |
|---|---|---|
| STN | Subtitle Television Network | Multicultural, foreign/subtitled, art-house. No Japanese content. |
| ZBC | Zombie Cheese Broadcasting Network | No ads. Children's, UK drama, documentary. Late-night Rage music videos (≤2005). Sunday Monkey marathon. |
| NNWK | Nippon Network | Japanese and Korean content only. Japanese ads. |
| Seven | Seven | Documentary, drama. Blockbuster Saturday night movie. |
| Nine | Nine | US sitcoms. Blockbuster Sunday night movie. |
| Ten | Ten | Youth/teen programming. Horror priority on Halloween. |

---

## Admin Portal

Access at `/admin` — sign in with a Plex account that has the admin flag set in the database.

Admin features:
- **Schedule editor** — regenerate all stations or a single station; drag-swap slots; override individual slots; full audit trail
- **Show progress** — view episode pointer per show per station; reset all progress
- **Catalog** — Plex catalog sync; assign holiday tags per item; manage blocked media
- **YouTube pool** — add/edit/delete filler IDs (video or playlist); preview opens YouTube in new tab
- **VHS/CRT effects** — 6 intensity sliders (scanlines, noise, chromatic aberration, vignette, CRT curvature, flicker) + viewer debug overlay toggle
- **Holiday settings** — create/edit/delete named holidays with configurable date ranges
- **Holiday overrides** — per-year, per-station override rules with genre/content priority
- **Special events** — one-off block injection (breaking news, marathons, sports overruns)
- **Stations** — create/edit station rules, branding, filler pools
- **Audit log** — full history of all manual admin schedule changes

---

## Project Structure

```
zombietv/
├── config/
│   ├── stations.json          # Station rules, branding, filler pool IDs
│   └── youtube-fillers.json   # Manually curated YouTube IDs
├── prisma/
│   └── schema.prisma          # SQLite schema (Prisma ORM)
├── public/assets/             # Logos, rating boards, static files
├── scripts/
│   └── init-db.js             # DB seed — run once after prisma db push
└── src/
    ├── app/
    │   ├── layout.tsx          # Root layout — VHS overlay + CRT SVG filter
    │   ├── page.tsx            # Main viewer (EPG overlaid on full-screen video)
    │   └── admin/              # Admin portal pages (8 sections)
    ├── components/
    │   ├── EPG.tsx             # 48-hr program guide overlay (resolution-scalable)
    │   ├── VideoPlayer.tsx     # Plex HLS + YouTube iframe switcher
    │   ├── VHSOverlay.tsx      # Viewport-wide CRT/VHS effect layer
    │   ├── VHSSettingsSync.tsx # 30s settings polling from server
    │   ├── RouteVisualEffects.tsx
    │   ├── ChannelChange.tsx   # Static burst on station switch
    │   ├── NowBar.tsx
    │   └── RatingBug.tsx       # AU rating overlay at program start
    ├── hooks/
    │   ├── usePlayback.ts      # Server-authoritative playback state + drift correction
    │   └── useVHSSettings.ts
    └── lib/
        ├── scheduler.ts        # 2-week rolling schedule generator
        ├── plex-catalog.ts     # Catalog sync, holiday tags, blocked keys
        ├── holidays.ts         # Holiday detection + settings CRUD
        └── ...
```

---

## Key Behaviours

- **Global timeline:** The server is the single source of time truth. All viewers see the same frame at the same time.
- **2-week schedule lock:** Schedules are pre-generated and locked; they auto-extend as time progresses.
- **Episode progression:** TV shows advance their episode pointer at most once per 7 days per station.
- **Show exclusivity:** A show is owned by the first station to air it; other stations cannot schedule it.
- **Hour/half-hour alignment:** All programs start on the hour or half-hour. Gaps are filled with YouTube filler.
- **Ad breaks:** Every 15 minutes during TV shows; every 30 minutes during movies. ZBC has no ads.
- **Holiday-tagged content:** Items tagged for a holiday only appear in schedules on that matching holiday day.
- **Plex dashboard visibility:** Playback is reported to the Plex server every 10s so it appears in the Plex dashboard with accurate progress.
- **EPG overlay:** The program guide floats on top of the video and scales font/row size based on screen resolution.
- **Station expansion:** New stations created in admin automatically appear across all management views.

---

## Contributing

Pull requests welcome. Please open an issue first for major changes.
