// Database Initialization Script
// Run with: node scripts/init-db.js
// Seeds initial stations, holiday overrides, and the default admin user.
// Uses CommonJS require() so Node can execute it directly without a bundler.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
  console.log('🚀 Initializing database...')

  // ── Stations ──────────────────────────────────────────────────────
  const stations = [
    {
      id: 'stn',
      name: 'Subtitle Television Network',
      branding: { logo: '/assets/stn-logo.png', ident_pack: 'stn-idents', colour_theme: '#2c3e50' },
      rules: {
        // STN = the SBS-equivalent: subtitled, multicultural, foreign-language
        // programming. No in-program ads (ads only between programmes), and the
        // network closes down overnight. Japanese/Korean are denied so they stay
        // the exclusive domain of the Nippon Network.
        allow_genres: 'foreign,drama,art-house,multicultural,documentary,world-movies',
        deny_genres: 'horror',
        allow_languages: 'chinese,indonesian,tagalog,french,spanish,italian,german,arabic,greek,vietnamese',
        deny_languages: 'japanese,korean',
        ad_policy: { enabled: false, break_interval_tv: 0, break_interval_movie: 0 },
        overnight_closedown: true,
      },
      holidayOverrides: {},
      fillerPools: { ads: null, music: null, bumpers: null }
    },
    {
      id: 'zbc',
      name: 'Zombie Cheese Broadcasting Network',
      branding: { logo: '/assets/zbc-logo.png', ident_pack: 'zbc-idents', colour_theme: '#8b0000' },
      rules: {
        // ZBC = the ABC-equivalent: public broadcaster, no ads, strong children's
        // and documentary/UK-drama identity, and an overnight close-down.
        allow_genres: 'documentary,uk-drama,children,comedy,drama,nature',
        deny_genres: 'horror,violence',
        allow_languages: 'english',
        deny_languages: '',
        ad_policy: { enabled: false, break_interval_tv: 0, break_interval_movie: 0 },
        overnight_closedown: true,
      },
      holidayOverrides: { christmas: { replace_schedule: true, ad_free: true } },
      fillerPools: { ads: null, music: 'RDLzk0sygecu4', bumpers: null }
    },
    {
      id: 'nnwk',
      name: 'Nippon Network',
      branding: { logo: '/assets/nnwk-logo.png', ident_pack: 'nnwk-idents', colour_theme: '#003366' },
      rules: {
        // Nippon Network: strictly Japanese content only — Japanese language and
        // anime / Japanese drama. Korean and English are denied so the channel
        // stays exclusively Japanese.
        allow_genres: 'anime,japanese-drama,japanese',
        deny_genres: '',
        allow_languages: 'japanese',
        deny_languages: 'korean,english',
        ad_policy: { enabled: true, break_interval_tv: 15, break_interval_movie: 30 },
        overnight_closedown: false,
      },
      holidayOverrides: {},
      fillerPools: { ads: null, music: null, bumpers: null }
    },
    {
      id: 'seven',
      name: 'Seven',
      branding: { logo: '/assets/seven-logo.png', ident_pack: 'seven-idents', colour_theme: '#ff6600' },
      rules: {
        // Seven: mainstream commercial network — drama, sitcoms, documentaries and
        // a marquee Saturday-night movie.
        allow_genres: 'drama,sitcom,documentary,reality,family',
        deny_genres: '',
        allow_languages: 'english',
        deny_languages: '',
        ad_policy: { enabled: true, break_interval_tv: 15, break_interval_movie: 30 },
        overnight_closedown: false,
      },
      holidayOverrides: {},
      fillerPools: { ads: null, music: null, bumpers: null }
    },
    {
      id: 'nine',
      name: 'Nine',
      branding: { logo: '/assets/nine-logo.png', ident_pack: 'nine-idents', colour_theme: '#cc0000' },
      rules: {
        // Nine: mainstream commercial network — US sitcoms, drama and reality, with
        // a marquee Sunday-night movie.
        allow_genres: 'sitcom,drama,reality,crime,family',
        deny_genres: '',
        allow_languages: 'english',
        deny_languages: '',
        ad_policy: { enabled: true, break_interval_tv: 15, break_interval_movie: 30 },
        overnight_closedown: false,
      },
      holidayOverrides: {},
      fillerPools: { ads: null, music: null, bumpers: null }
    },
    {
      id: 'ten',
      name: 'Ten',
      branding: { logo: '/assets/ten-logo.png', ident_pack: 'ten-idents', colour_theme: '#0066cc' },
      rules: {
        // Ten: the youth-skewed commercial network — teen drama, comedy, action and
        // late-night teen movies.
        allow_genres: 'teen,comedy,action,sci-fi,music',
        deny_genres: '',
        allow_languages: 'english',
        deny_languages: '',
        ad_policy: { enabled: true, break_interval_tv: 15, break_interval_movie: 30 },
        overnight_closedown: false,
      },
      holidayOverrides: { halloween: { replace_schedule: true, ad_free: false } },
      fillerPools: { ads: null, music: null, bumpers: null }
    }
  ]

  for (const s of stations) {
    await prisma.station.upsert({
      where: { id: s.id },
      // Re-seeding realigns the canonical rules/branding for the built-in base
      // channels (name is left as-is to preserve any admin rename).
      update: {
        branding:         JSON.stringify(s.branding),
        rules:            JSON.stringify(s.rules),
        holidayOverrides: JSON.stringify(s.holidayOverrides),
        fillerPools:      JSON.stringify(s.fillerPools)
      },
      create: {
        id:               s.id,
        name:             s.name,
        branding:         JSON.stringify(s.branding),
        rules:            JSON.stringify(s.rules),
        holidayOverrides: JSON.stringify(s.holidayOverrides),
        fillerPools:      JSON.stringify(s.fillerPools)
      }
    })
  }

  console.log('✅ Stations seeded')

  // ── Holiday overrides ─────────────────────────────────────────────
  const currentYear = new Date().getFullYear()
  const holidays = [
    { name: 'christmas',  adFree: false, genres: 'family,religious' },
    { name: 'good_friday', adFree: true,  genres: 'religious,drama' },
    { name: 'easter',     adFree: false, genres: 'family,drama' },
    { name: 'halloween',  adFree: false, genres: 'horror,teen' }
  ]

  for (const h of holidays) {
    // Prisma does not support null in compound-unique where clauses in this path,
    // so we use findFirst + create instead of upsert.
    const existing = await prisma.holidayOverride.findFirst({
      where: { holidayName: h.name, year: currentYear, stationId: null }
    })
    if (!existing) {
      await prisma.holidayOverride.create({
        data: {
          holidayName:     h.name,
          year:            currentYear,
          stationId:       null,
          replaceSchedule: true,
          adFree:          h.adFree,
          contentPriority: h.genres
        }
      })
    }
  }

  console.log('✅ Holiday overrides seeded')

  // ── Default admin user ────────────────────────────────────────────
  // Password is "admin123" — CHANGE THIS before deploying to production.
  // Hash generated with: node -e "require('bcryptjs').hash('admin123',10).then(console.log)"
  const bcrypt = require('bcryptjs')
  const hash = await bcrypt.hash('admin123', 10)

  const existingAdmin = await prisma.user.findUnique({ where: { email: 'admin@zombietv.com' } })
  if (existingAdmin) {
    await prisma.user.update({
      where: { id: existingAdmin.id },
      data: { isAdmin: true },
    })
  } else {
    await prisma.user.create({
      data: {
        email: 'admin@zombietv.com',
        isAdmin: true,
        preferences: JSON.stringify({ passwordHash: hash, vhs_intensity: 0.5, noise_intensity: 0.3, crt_curvature: 0.4 }),
      },
    })
  }

  console.log('✅ Admin user seeded')

  console.log('✨ Database initialization complete!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
