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

export interface PlexPlaybackConnection {
  url: string
  token: string
}

function normalizeConnectionUri(uri: string): string {
  try {
    const parsed = new URL(String(uri || ''))
    parsed.hash = ''
    parsed.search = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

function sortConnections(connections: any[]): any[] {
  return [...connections].sort((a, b) => {
    const score = (c: any) => {
      const isHttps = c?.protocol === 'https'
      const isRelay = Boolean(c?.relay)
      if (isHttps && !isRelay) return 0
      if (isHttps && isRelay) return 1
      if (!isHttps && !isRelay) return 2
      return 3
    }
    return score(a) - score(b)
  })
}

async function fetchPlexResources(authToken: string): Promise<any[]> {
  const res = await fetch(
    'https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1&includeIPv6=1',
    { headers: plexHeaders(authToken) },
  )
  if (!res.ok) {
    throw new Error(`Failed to fetch Plex resources: ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as any[]
}

export function isPrivateHost(host: string): boolean {
  const h = String(host || '').trim().toLowerCase()
  if (!h) return false
  if (h === 'localhost' || h === '::1' || h === '127.0.0.1') return true

  // IPv4 private ranges
  if (/^10\./.test(h)) return true
  if (/^192\.168\./.test(h)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true

  // IPv6 unique-local and link-local
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(h)) return true
  if (/^fe80:/i.test(h)) return true

  return false
}

function isLanConnection(connection: any): boolean {
  if (Boolean(connection?.local)) return true
  try {
    const host = new URL(String(connection?.uri ?? '')).hostname
    return isPrivateHost(host)
  } catch {
    return false
  }
}

function isPlexMediaServer(resource: any): boolean {
  return resource?.product === 'Plex Media Server' && Boolean(resource?.connections?.length)
}

function getServerPreferenceScore(resource: any): number {
  // Prefer owned servers first, then reachable shared servers.
  if (resource?.owned === true) return 0
  if (resource?.accessToken) return 1
  return 2
}

function getServerDisplayName(resource: any, preferredConnection: any): string {
  return String(
    resource?.name ??
    resource?.title ??
    resource?.friendlyName ??
    preferredConnection?.name ??
    new URL(String(preferredConnection?.uri ?? 'http://localhost')).hostname,
  )
}

export async function getPlexServerDetails(authToken: string): Promise<PlexServerDetails> {
  return getPlexServerDetailsWithOptions(authToken, { allowLanFallback: true })
}

export async function getPlexServerDetailsWithOptions(
  authToken: string,
  options: { allowLanFallback?: boolean } = {},
): Promise<PlexServerDetails> {
  const allowLanFallback = options.allowLanFallback !== false
  const data = await fetchPlexResources(authToken)

  const servers = data
    .filter(isPlexMediaServer)
    .sort((a, b) => getServerPreferenceScore(a) - getServerPreferenceScore(b))

  if (!servers.length) {
    throw new Error('No Plex Media Server found on this account.')
  }

  const canReach = async (uri: string, token: string): Promise<boolean> => {
    try {
      const base = String(uri || '').replace(/\/$/, '')
      if (!base) return false
      const probeUrl = `${base}/identity?X-Plex-Token=${encodeURIComponent(token)}`
      const res = await fetch(probeUrl, {
        cache: 'no-store',
        signal: AbortSignal.timeout(3_000),
      })
      return res.ok
    } catch {
      return false
    }
  }

  for (const server of servers) {
    const serverToken = String(server?.accessToken ?? authToken).trim() || authToken
    const connections: any[] = server.connections ?? []
    const remoteConnections = connections.filter((c) => !isLanConnection(c))
    const candidatePool = remoteConnections.length
      ? remoteConnections
      : (allowLanFallback ? connections : [])
    const preferredConnections = sortConnections(candidatePool)

    let preferred = preferredConnections[0]
    for (const connection of preferredConnections) {
      const uri = String(connection?.uri ?? '')
      if (!uri) continue
      if (await canReach(uri, serverToken)) {
        preferred = connection
        break
      }
    }

    if (preferred) {
      return {
        url: preferred.uri as string,
        name: getServerDisplayName(server, preferred),
      }
    }
  }

  throw new Error('Plex server has no usable connection endpoints.')
}

export async function getPlexPlaybackConnectionForServer(
  authToken: string,
  preferredServerUrl: string,
  options: { allowLanFallback?: boolean } = {},
): Promise<PlexPlaybackConnection> {
  const allowLanFallback = options.allowLanFallback !== false
  const normalizedPreferredBase = normalizeConnectionUri(preferredServerUrl)

  if (!normalizedPreferredBase) {
    const fallback = await getPlexServerDetailsWithOptions(authToken, options)
    return {
      url: fallback.url.replace(/\/$/, ''),
      token: authToken,
    }
  }

  const preferredUrl = new URL(normalizedPreferredBase)
  const resources = await fetchPlexResources(authToken)
  const servers = resources
    .filter(isPlexMediaServer)
    .sort((a, b) => getServerPreferenceScore(a) - getServerPreferenceScore(b))

  for (const server of servers) {
    const serverToken = String(server?.accessToken ?? authToken).trim() || authToken
    const connections: any[] = server.connections ?? []
    const matched = connections.filter((connection) => {
      const uri = normalizeConnectionUri(String(connection?.uri ?? ''))
      if (!uri) return false
      try {
        const parsed = new URL(uri)
        return (
          uri === normalizedPreferredBase
          || parsed.origin === preferredUrl.origin
          || parsed.hostname === preferredUrl.hostname
        )
      } catch {
        return false
      }
    })

    if (!matched.length) continue

    const remoteMatched = matched.filter((c) => !isLanConnection(c))
    const preferredPool = remoteMatched.length
      ? remoteMatched
      : (allowLanFallback ? matched : [])
    const ordered = sortConnections(preferredPool)
    const selected = ordered[0]

    if (selected?.uri) {
      return {
        url: normalizeConnectionUri(String(selected.uri)),
        token: serverToken,
      }
    }
  }

  const fallback = await getPlexServerDetailsWithOptions(authToken, options)
  return {
    url: fallback.url.replace(/\/$/, ''),
    token: authToken,
  }
}

export async function getPlexServerUrlWithOptions(
  authToken: string,
  options: { allowLanFallback?: boolean } = {},
): Promise<string> {
  const details = await getPlexServerDetailsWithOptions(authToken, options)
  return details.url
}

export async function getPlexRemoteOrigins(authToken: string): Promise<string[]> {
  const data = await fetchPlexResources(authToken)

  const origins = new Set<string>()

  for (const server of data.filter(isPlexMediaServer).sort((a, b) => getServerPreferenceScore(a) - getServerPreferenceScore(b))) {
    const connections: any[] = server.connections ?? []
    const remoteConnections = connections.filter((c) => !isLanConnection(c))

    for (const connection of remoteConnections) {
      try {
        const uri = String(connection?.uri ?? '').trim()
        if (!uri) continue
        origins.add(new URL(uri).origin)
      } catch {
        // Ignore malformed URIs from upstream resource payloads.
      }
    }
  }

  return Array.from(origins)
}
