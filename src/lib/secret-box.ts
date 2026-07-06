// Secret-at-rest encryption for tokens persisted in the database
// (e.g. Plex auth tokens inside User.preferences JSON).
//
// AES-256-GCM with a key derived from SESSION_SECRET. Values are stored as
//   enc:v1:<iv b64>:<authTag b64>:<ciphertext b64>
// decryptSecret transparently passes through legacy plaintext values, so
// existing rows keep working and are upgraded on their next write.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

const PREFIX = 'enc:v1:'

function deriveKey(): Buffer {
  const secret = process.env.SESSION_SECRET ?? ''
  // db.ts already enforces SESSION_SECRET at startup; this is a safety net.
  if (!secret) throw new Error('SESSION_SECRET is required for secret encryption')
  return createHash('sha256').update(`zombietv-secret-box:${secret}`).digest()
}

export function encryptSecret(plain: string): string {
  const value = String(plain ?? '')
  if (!value) return ''
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`
}

export function isEncryptedSecret(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX)
}

// Returns the decrypted secret. Legacy plaintext values pass through
// unchanged; undecryptable values return '' rather than throwing.
export function decryptSecret(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  if (!raw) return ''
  if (!raw.startsWith(PREFIX)) return raw

  try {
    const [ivB64, tagB64, dataB64] = raw.slice(PREFIX.length).split(':')
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(), Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    return ''
  }
}
