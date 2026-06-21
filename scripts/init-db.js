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
        allow_genres: 'foreign,drama,art-house,multicultural',
        deny_genres: 'japanese,anime',
        allow_languages: 'chinese,indonesian,tagalog,french,spanish',
        deny_languages: 'japanese,korean',
        ad_policy: { enabled: true, break_interval_tv: 15, break_interval_movie: 30 }
      },
      holidayOverrides: {},
      fillerPools: { ads: null, music: null, bumpers: null }
    },
    {
      id: 'zbc',
      name: 'Zombie Cheese Broadcasting Network',
      branding: { logo: '/assets/zbc-logo.png', ident_pack: 'zbc-idents', colour_theme: '#8b0000' },
      rules: {
        allow_genres: 'documentary,uk-drama,children,comedy',
        deny_genres: 'horror,violence',
        allow_languages: 'english',
        deny_languages: '',
        ad_policy: { enabled: false, break_interval_tv: 0, break_interval_movie: 0 }
      },
      holidayOverrides: { christmas: { replace_schedule: true, ad_free: true } },
      fillerPools: { ads: null, music: 'RDLzk0sygecu4', bumpers: null }
    },
    {
      id: 'nnwk',
      name: 'Nippon Network',
      branding: { logo: '/assets/nnwk-logo.png', ident_pack: 'nnwk-idents', colour_theme: '#003366' },
      rules: {
        allow_genres: 'japanese-drama,korean-drama,anime',
        deny_genres: '',
        allow_languages: 'japanese,korean',
        deny_languages: '',
        ad_policy: { enabled: true, break_interval_tv: 15, break_interval_movie: 30 }
      },
      holidayOverrides: {},
      fillerPools: { ads: null, music: null, bumpers: null }
    },
    {
      id: 'seven',
      name: 'Seven',
      branding: { logo: '/assets/seven-logo.png', ident_pack: 'seven-idents', colour_theme: '#ff6600' },
      rules: {
        allow_genres: 'documentary,drama,sitcom',
        deny_genres: '',
        allow_languages: 'english',
        deny_languages: '',
        ad_policy: { enabled: true, break_interval_tv: 15, break_interval_movie: 30 }
      },
      holidayOverrides: {},
      fillerPools: { ads: null, music: null, bumpers: null }
    },
    {
      id: 'nine',
      name: 'Nine',
      branding: { logo: '/assets/nine-logo.png', ident_pack: 'nine-idents', colour_theme: '#cc0000' },
      rules: {
        allow_genres: 'sitcom,drama,reality',
        deny_genres: '',
        allow_languages: 'english',
        deny_languages: '',
        ad_policy: { enabled: true, break_interval_tv: 15, break_interval_movie: 30 }
      },
      holidayOverrides: {},
      fillerPools: { ads: null, music: null, bumpers: null }
    },
    {
      id: 'ten',
      name: 'Ten',
      branding: { logo: '/assets/ten-logo.png', ident_pack: 'ten-idents', colour_theme: '#0066cc' },
      rules: {
        allow_genres: 'teen,comedy,action',
        deny_genres: '',
        allow_languages: 'english',
        deny_languages: '',
        ad_policy: { enabled: true, break_interval_tv: 15, break_interval_movie: 30 }
      },
      holidayOverrides: { halloween: { replace_schedule: true, ad_free: false } },
      fillerPools: { ads: null, music: null, bumpers: null }
    }
  ]

  for (const s of stations) {
    await prisma.station.upsert({
      where: { id: s.id },
      update: {},
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
    // Prisma does not support null in compound-unique where clauses (SQLite limitation).
    // Use findFirst + create instead of upsert.
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

  await prisma.user.upsert({
    where: { email: 'admin@zombietv.com' },
    update: {
      // Re-hash on every seed run so a fresh dev environment always has a known password.
      preferences: JSON.stringify({ passwordHash: hash, vhs_intensity: 0.5, noise_intensity: 0.3, crt_curvature: 0.4 }),
    },
    create: {
      email: 'admin@zombietv.com',
      isAdmin: true,
      // passwordHash is stored inside preferences (SQLite has no dedicated column).
      preferences: JSON.stringify({ passwordHash: hash, vhs_intensity: 0.5, noise_intensity: 0.3, crt_curvature: 0.4 }),
    }
  })

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
