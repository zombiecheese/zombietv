// iron-session configuration
// All session data is stored in a signed, encrypted httpOnly cookie.
// No session table in the DB — the cookie IS the session.

import { SessionOptions } from 'iron-session'

export interface SessionData {
  isLoggedIn: boolean
  userId: string
  plexToken: string        // User's Plex auth token — attached to every Plex API request
  plexServerUrl: string    // Discovered Plex server base URL for this user
  plexId: string           // Plex account ID (numeric string)
  username: string
  email: string
  isAdmin: boolean
}

export const defaultSession: SessionData = {
  isLoggedIn: false,
  userId: '',
  plexToken: '',
  plexServerUrl: '',
  plexId: '',
  username: '',
  email: '',
  isAdmin: false,
}

export const sessionOptions: SessionOptions = {
  // SESSION_SECRET must be at least 32 chars. Generate with:
  //   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  password: process.env.SESSION_SECRET ?? 'zombietv-dev-secret-change-before-production-deploy',
  cookieName: 'zombietv_session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    // 30-day rolling session
    maxAge: 60 * 60 * 24 * 30,
  },
}
