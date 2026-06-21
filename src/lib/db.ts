// Prisma client singleton
// Re-uses the same instance across hot reloads in development.
// In production a new PrismaClient is created once per process.

import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }
const SQLITE_BUSY_TIMEOUT_MS = 15_000

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient({ log: ['warn', 'error'] })

let sqliteInitPromise: Promise<void> | null = null

export async function ensureSqlitePragmas(): Promise<void> {
  if (!String(process.env.DATABASE_URL ?? '').toLowerCase().startsWith('file:')) {
    return
  }
  if (sqliteInitPromise) return sqliteInitPromise

  sqliteInitPromise = (async () => {
    await prisma.$connect()
    await prisma.$executeRawUnsafe(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`)
    await prisma.$executeRawUnsafe('PRAGMA journal_mode = WAL')
    await prisma.$executeRawUnsafe('PRAGMA synchronous = NORMAL')
  })().catch((err) => {
    sqliteInitPromise = null
    throw err
  })

  return sqliteInitPromise
}

// Initialize lock-friendly SQLite pragmas as early as possible.
void ensureSqlitePragmas().catch((err) => {
  console.error('[DB] Failed to initialize SQLite pragmas:', err)
})

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
