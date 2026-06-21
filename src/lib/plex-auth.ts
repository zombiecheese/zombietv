// Plex pin-based OAuth helpers
//
// Plex does not use standard OAuth2 redirect-with-code.
// The flow is:
//   1. App POSTs to plex.tv → gets a { id, code } pin
//   2. App redirects the browser to app.plex.tv/auth with that pin code
//   3. User logs in on plex.tv; plex.tv redirects back to our forwardUrl
//   4. App GETs the pin by id — if the user authenticated, authToken is set
//   5. App uses authToken to fetch the user profile and server list

const PLEX_CLIENT_ID = process.env.PLEX_CLIENT_ID as string
const PLEX_APP_NAME  = 'ZombieTV'
const PLEX_VERSION   = '1.0.0'

// Headers required on every call to plex.tv
function plexHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
    'X-Plex-Product':           PLEX_APP_NAME,
    'X-Plex-Version':           PLEX_VERSION,
    'Accept':                   'application/json',
    'Content-Type':             'application/json',
  }
  if (token) h['X-Plex-Token'] = token
  return h
}

// ─── Step 1: Create a pin ────────────────────────────────────────────────────

export interface PlexPin {
  id: number
  code: string
}

export async function createPlexPin(): Promise<PlexPin> {
  const res = await fetch('https://plex.tv/api/v2/pins?strong=true', {
    method: 'POST',
    headers: plexHeaders(),
  })
  if (!res.ok) {
    throw new Error(`Plex pin creation failed: ${res.status} ${res.statusText}`)
  }
  const data = await res.json()
  return { id: data.id, code: data.code }
}

// ─── Step 2: Build the redirect URL ─────────────────────────────────────────

export function buildPlexAuthUrl(pin: PlexPin, callbackUrl: string): string {
  const params = new URLSearchParams({
    clientID:                      PLEX_CLIENT_ID,
    code:                          pin.code,
    forwardUrl:                    callbackUrl,
    'context[device][product]':    PLEX_APP_NAME,
    'context[device][version]':    PLEX_VERSION,
    'context[device][platform]':   'Web',
  })
  return `https://app.plex.tv/auth#?${params.toString()}`
}

// ─── Step 3: Poll the pin for the auth token ─────────────────────────────────

export async function checkPlexPin(pinId: number): Promise<string | null> {
  const res = await fetch(`https://plex.tv/api/v2/pins/${pinId}`, {
    headers: plexHeaders(),
  })
  if (!res.ok) return null
  const data = await res.json()
  return (data.authToken as string) ?? null
}

// ─── Step 4a: Fetch the Plex user profile ────────────────────────────────────

export interface PlexUser {
  id: string       // Plex numeric account ID as string
  email: string
  username: string
}

export async function getPlexUser(authToken: string): Promise<PlexUser> {
  const res = await fetch('https://plex.tv/api/v2/user', {
    headers: plexHeaders(authToken),
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch Plex user: ${res.status} ${res.statusText}`)
  }
  const data = await res.json()
  return {
    id:       String(data.id),
    email:    data.email as string,
    username: (data.username ?? data.title ?? data.email) as string,
  }
}

// ─── Step 4b: Discover the user's Plex server URL ────────────────────────────
// Returns the best reachable connection URI for the first owned Plex Media Server.

export async function getPlexServerUrl(authToken: string): Promise<string> {
  const details = await getPlexServerDetails(authToken)
  return details.url
}

export interface PlexServerDetails {
  url: string
  name: string
}

export async function getPlexServerDetails(authToken: string): Promise<PlexServerDetails> {
  const res = await fetch(
    'https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1&includeIPv6=1',
    { headers: plexHeaders(authToken) },
  )
  if (!res.ok) {
    throw new Error(`Failed to fetch Plex resources: ${res.status} ${res.statusText}`)
  }
  const data: any[] = await res.json()

  // First owned Plex Media Server
  const server = data.find(
    (r) => r.product === 'Plex Media Server' && r.owned === true,
  )
  if (!server) {
    throw new Error('No owned Plex Media Server found on this account.')
  }

  // Prefer a direct HTTPS local connection, fall back to relay
  const connections: any[] = server.connections ?? []
  const preferred =
    connections.find((c) => c.protocol === 'https' && !c.relay) ??
    connections.find((c) => c.protocol === 'https') ??
    connections[0]

  if (!preferred) {
    throw new Error('Plex server has no usable connection endpoints.')
  }

  const name = String(server.name ?? server.title ?? server.friendlyName ?? preferred.name ?? new URL(preferred.uri as string).hostname)

  return {
    url: preferred.uri as string,
    name,
  }
}
