// YouTube playlist scraping helpers.
// We import playlist members from the public Atom feed, then fall back to the
// playlist page HTML if the feed is unavailable.

export interface YouTubePlaylistItem {
  videoId: string
  title: string
  durationMins: number | null
}

export interface YouTubePlaylistImport {
  playlistId: string
  playlistTitle: string | null
  items: YouTubePlaylistItem[]
}

// Public WEB innertube API key/version used as a fallback when they cannot be
// scraped from the playlist page.
const DEFAULT_INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'
const DEFAULT_CLIENT_VERSION = '2.20240101.00.00'

export function normalizePlaylistId(input: string): string {
  const value = input.trim()
  if (!value) return ''

  try {
    const url = new URL(value)
    const listId = url.searchParams.get('list')
    if (listId) return listId.trim()
  } catch {
    // Not a URL, treat it as a raw playlist ID.
  }

  return value
}

export async function scrapeYouTubePlaylist(input: string): Promise<YouTubePlaylistImport> {
  const playlistId = normalizePlaylistId(input)
  if (!playlistId) {
    throw new Error('A playlist ID is required.')
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; ZombieTV/1.0)',
    Accept: 'application/xml,text/xml,text/html;q=0.9,*/*;q=0.8',
  }

  // Primary strategy: read the API credentials off the playlist page, then pull
  // the full playlist through YouTube's internal browse endpoint (following
  // continuation tokens) so we capture every video, not just the first batch.
  let pageParsed: Omit<YouTubePlaylistImport, 'playlistId'> | null = null
  const pageUrl = `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=en&gl=US`
  try {
    const pageRes = await fetch(pageUrl, { headers })
    if (pageRes.ok) {
      const html = await pageRes.text()
      pageParsed = await parsePlaylistPage(playlistId, html, headers)
    }
  } catch {
    // Ignore page failures and fall back to the Atom feed below.
  }

  // Fallback: the public Atom feed only exposes the most recent ~15 entries,
  // but it is useful when the page strategy fails entirely.
  let feedParsed: Omit<YouTubePlaylistImport, 'playlistId'> | null = null
  if (!pageParsed || !pageParsed.items.length) {
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`
    const feedRes = await fetch(feedUrl, { headers })
    if (feedRes.ok) {
      const feedXml = await feedRes.text()
      feedParsed = parseFeedXml(feedXml)
    }
  }

  const merged = mergePlaylistImports(feedParsed, pageParsed)
  if (!merged.items.length) {
    throw new Error(`No videos were found in playlist ${playlistId}.`)
  }

  const items = await attachDurations(merged.items, headers)

  return { playlistId, playlistTitle: merged.playlistTitle, items }
}

// Parse the playlist watch page only to obtain the API key and client version,
// then pull the entire playlist through YouTube's internal browse endpoint,
// following continuation tokens until every video has been collected.
async function parsePlaylistPage(
  playlistId: string,
  html: string,
  headers: Record<string, string>,
): Promise<Omit<YouTubePlaylistImport, 'playlistId'>> {
  let playlistTitle = decodeHtmlEntities(matchFirst(html, /<meta property="og:title" content="([^"]+)"/i)) || null

  const apiKey = matchFirst(html, /"INNERTUBE_API_KEY":"([^"]+)"/) || DEFAULT_INNERTUBE_API_KEY
  const clientVersion = matchFirst(html, /"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)
    || matchFirst(html, /"clientVersion":"([^"]+)"/)
    || DEFAULT_CLIENT_VERSION

  const items = new Map<string, YouTubePlaylistItem>()

  // Seed the first batch from the browse endpoint (the playlist page itself no
  // longer embeds the video list).
  const initial = await fetchPlaylist(apiKey, clientVersion, { browseId: `VL${playlistId}` }, headers)
  if (!initial) {
    // Last resort: scrape whatever the loose regex can find on the page.
    return parsePlaylistHtml(html)
  }

  playlistTitle = playlistTitle || extractPlaylistTitle(initial)
  let { collected, continuation } = collectPlaylistItems(initial)
  for (const item of collected) {
    if (!items.has(item.videoId)) items.set(item.videoId, item)
  }

  let guard = 0
  while (continuation && guard < 200) {
    guard += 1
    const data = await fetchPlaylist(apiKey, clientVersion, { continuation }, headers)
    if (!data) break

    const next = collectPlaylistItems(data)
    let added = 0
    for (const item of next.collected) {
      if (!items.has(item.videoId)) {
        items.set(item.videoId, item)
        added += 1
      }
    }

    continuation = next.continuation
    // Stop once a page yields nothing new and offers no further continuation.
    if (added === 0 && !next.continuation) break
  }

  return { playlistTitle, items: [...items.values()] }
}

function extractPlaylistTitle(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  const metadata = record.metadata as Record<string, unknown> | undefined
  const meta = metadata?.playlistMetadataRenderer as Record<string, unknown> | undefined
  if (typeof meta?.title === 'string' && meta.title.trim()) return meta.title.trim()
  return null
}

// Recursively walk a youtubei data object collecting playlist video items and
// the next continuation token. YouTube now renders playlist entries as
// `lockupViewModel` objects, but we also handle the legacy
// `playlistVideoRenderer` shape. Walking the tree keeps this resilient to
// YouTube's frequent structural changes.
function collectPlaylistItems(data: unknown): {
  collected: YouTubePlaylistItem[]
  continuation: string | null
} {
  const collected: YouTubePlaylistItem[] = []
  const seen = new Set<string>()
  let continuation: string | null = null

  const addItem = (item: YouTubePlaylistItem): void => {
    if (!seen.has(item.videoId)) {
      seen.add(item.videoId)
      collected.push(item)
    }
  }

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }

    const record = node as Record<string, unknown>

    // Current format: lockupViewModel.
    const lockup = record.lockupViewModel as Record<string, unknown> | undefined
    if (lockup && lockup.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && typeof lockup.contentId === 'string') {
      const videoId = lockup.contentId
      if (/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
        const metadata = lockup.metadata as Record<string, unknown> | undefined
        const metaVm = metadata?.lockupMetadataViewModel as Record<string, unknown> | undefined
        const titleObj = metaVm?.title as Record<string, unknown> | undefined
        const title = (typeof titleObj?.content === 'string' ? titleObj.content : '') || videoId
        const durationMins = parseDurationText(extractLockupDurationText(lockup))
        addItem({ videoId, title: title.trim(), durationMins })
      }
    }

    // Legacy format: playlistVideoRenderer.
    const renderer = record.playlistVideoRenderer as Record<string, unknown> | undefined
    if (renderer && typeof renderer.videoId === 'string') {
      const videoId = renderer.videoId
      if (/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
        const title = extractRendererText(renderer.title) || videoId
        const lengthSeconds = Number(renderer.lengthSeconds)
        const durationMins = Number.isFinite(lengthSeconds) && lengthSeconds > 0
          ? Math.max(1, Math.round(lengthSeconds / 60))
          : null
        addItem({ videoId, title: title.trim(), durationMins })
      }
    }

    const contRenderer = record.continuationItemRenderer as Record<string, unknown> | undefined
    if (contRenderer) {
      const token = extractContinuationToken(contRenderer)
      // Keep the first token only: playlist pages expose a second, dead
      // section-level token that returns no further items.
      if (token && !continuation) continuation = token
    }

    for (const key of Object.keys(record)) walk(record[key])
  }

  walk(data)
  return { collected, continuation }
}

// Pull the duration badge text (e.g. "12:34") from a lockupViewModel thumbnail.
function extractLockupDurationText(lockup: Record<string, unknown>): string {
  const contentImage = lockup.contentImage as Record<string, unknown> | undefined
  const thumbnail = contentImage?.thumbnailViewModel as Record<string, unknown> | undefined
  const overlays = thumbnail?.overlays
  if (!Array.isArray(overlays)) return ''
  for (const overlay of overlays) {
    if (!overlay || typeof overlay !== 'object') continue
    const bottom = (overlay as Record<string, unknown>).thumbnailBottomOverlayViewModel as Record<string, unknown> | undefined
    const badges = bottom?.badges
    if (!Array.isArray(badges)) continue
    for (const badge of badges) {
      if (!badge || typeof badge !== 'object') continue
      const vm = (badge as Record<string, unknown>).thumbnailBadgeViewModel as Record<string, unknown> | undefined
      if (typeof vm?.text === 'string' && /^\d+(:\d+)+$/.test(vm.text.trim())) {
        return vm.text.trim()
      }
    }
  }
  return ''
}

// Convert a "M:SS" or "H:MM:SS" duration string into whole minutes.
function parseDurationText(text: string): number | null {
  if (!text) return null
  const parts = text.split(':').map((part) => Number(part))
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return null
  const totalSeconds = parts.reduce((acc, part) => acc * 60 + part, 0)
  return totalSeconds > 0 ? Math.max(1, Math.round(totalSeconds / 60)) : null
}

function extractRendererText(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  if (typeof record.simpleText === 'string') return decodeHtmlEntities(record.simpleText)
  const runs = record.runs
  if (Array.isArray(runs)) {
    const text = runs
      .map((run) => (run && typeof run === 'object' ? (run as Record<string, unknown>).text : ''))
      .filter((part): part is string => typeof part === 'string')
      .join('')
    return decodeHtmlEntities(text)
  }
  return ''
}

function extractContinuationToken(contRenderer: Record<string, unknown>): string | null {
  const endpoint = contRenderer.continuationEndpoint as Record<string, unknown> | undefined
  const command = endpoint?.continuationCommand as Record<string, unknown> | undefined
  const token = command?.token
  return typeof token === 'string' && token ? token : null
}

async function fetchPlaylist(
  apiKey: string,
  clientVersion: string,
  payload: { browseId: string } | { continuation: string },
  headers: Record<string, string>,
): Promise<unknown | null> {
  try {
    const res = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: {
        'User-Agent': headers['User-Agent'],
        'Content-Type': 'application/json',
        Accept: '*/*',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion,
            hl: 'en',
            gl: 'US',
          },
        },
        ...payload,
      }),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

function parseFeedXml(xml: string): Omit<YouTubePlaylistImport, 'playlistId'> {
  const playlistTitle = decodeHtmlEntities(matchFirst(xml, /<feed[^>]*>[\s\S]*?<title>([^<]+)<\/title>/i))
  const items: YouTubePlaylistItem[] = []

  for (const entry of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
    const block = entry[1]
    const videoId = matchFirst(block, /<yt:videoId>([^<]+)<\/yt:videoId>/i)
    const title = decodeHtmlEntities(matchFirst(block, /<title>([\s\S]*?)<\/title>/i))

    if (videoId && title) {
      items.push({ videoId: videoId.trim(), title: title.trim(), durationMins: null })
    }
  }

  return { playlistTitle, items }
}

function parsePlaylistHtml(html: string): Omit<YouTubePlaylistImport, 'playlistId'> {
  const playlistTitle = decodeHtmlEntities(matchFirst(html, /<meta property="og:title" content="([^"]+)"/i))
  const items = new Map<string, YouTubePlaylistItem>()

  for (const match of html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"[\s\S]{0,600}?"title":\{(?:"simpleText":"([^"]+)"|"runs":\[\{"text":"([^"]+)"\}\])/g)) {
    const videoId = match[1]
    const title = decodeHtmlEntities(match[2] ?? match[3] ?? '').trim()
    if (!videoId || !title || items.has(videoId)) continue
    items.set(videoId, { videoId, title, durationMins: null })
  }

  return { playlistTitle, items: [...items.values()] }
}

async function attachDurations(
  items: YouTubePlaylistItem[],
  headers: Record<string, string>,
): Promise<YouTubePlaylistItem[]> {
  // Most items already carry a duration from the playlist JSON. Only the
  // remaining ones need an individual watch-page lookup, and we cap concurrency
  // so large playlists don't trigger a burst of hundreds of requests.
  const concurrency = 8
  let cursor = 0

  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      const item = items[index]
      if (item.durationMins != null) continue
      item.durationMins = await fetchVideoDurationMins(item.videoId, headers).catch(() => null)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))

  return items
}

async function fetchVideoDurationMins(videoId: string, headers: Record<string, string>): Promise<number | null> {
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en&gl=US`
  const res = await fetch(watchUrl, { headers })
  if (!res.ok) return null

  const html = await res.text()
  const secondsRaw = matchFirst(html, /"lengthSeconds":"(\d+)"/i)
    || matchFirst(html, /"approxDurationMs":"(\d+)"/i)

  const durationSeconds = Number(secondsRaw)
  if (!durationSeconds || !Number.isFinite(durationSeconds)) return null
  return Math.max(1, Math.round(durationSeconds / 60))
}

// Public helper: resolve a single YouTube video's runtime in minutes.
export async function getYouTubeVideoDurationMins(videoId: string): Promise<number | null> {
  const id = String(videoId ?? '').trim()
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; ZombieTV/1.0)',
    Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  }
  return fetchVideoDurationMins(id, headers).catch(() => null)
}

function mergePlaylistImports(
  feedParsed: Omit<YouTubePlaylistImport, 'playlistId'> | null,
  pageParsed: Omit<YouTubePlaylistImport, 'playlistId'> | null,
): Omit<YouTubePlaylistImport, 'playlistId'> {
  const items = new Map<string, YouTubePlaylistItem>()
  const playlistTitle = feedParsed?.playlistTitle || pageParsed?.playlistTitle || null

  for (const source of [feedParsed, pageParsed]) {
    if (!source) continue
    for (const item of source.items) {
      if (!items.has(item.videoId)) items.set(item.videoId, item)
    }
  }

  return { playlistTitle, items: [...items.values()] }
}

function matchFirst(input: string, pattern: RegExp): string {
  const match = input.match(pattern)
  return match?.[1] ?? ''
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}