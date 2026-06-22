// Prisma client singleton
// Re-uses the same instance across hot reloads in development.
// In production a new PrismaClient is created once per process.

import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient({ log: ['warn', 'error'] })

let dbInitPromise: Promise<void> | null = null

// ─── Environment Validation ───────────────────────────────────────────────────
// Check critical environment variables at startup to fail fast with clear messages.
function validateEnvironment(): void {
  const required = ['DATABASE_URL', 'SESSION_SECRET', 'PLEX_CLIENT_ID']
  const missing = required.filter((key) => !process.env[key] || process.env[key]!.trim() === '')

  if (missing.length > 0) {
    const msg = `[DB] Critical environment variables missing: ${missing.join(', ')}. Check your .env file.`
    console.error(msg)
    process.exit(1)
  }
}

export async function ensureDatabaseReady(): Promise<void> {
  if (dbInitPromise) return dbInitPromise

  dbInitPromise = (async () => {
    validateEnvironment()
    await prisma.$connect()
  })().catch((err) => {
    dbInitPromise = null
    throw err
  })

  return dbInitPromise
}

// Initialize the database connection as early as possible.
void ensureDatabaseReady().catch((err) => {
  console.error('[DB] Failed to initialize database connection:', err)
})

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
