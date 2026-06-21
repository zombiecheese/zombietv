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

  const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; ZombieTV/1.0)',
    Accept: 'application/xml,text/xml,text/html;q=0.9,*/*;q=0.8',
  }

  const feedRes = await fetch(feedUrl, { headers })
  let feedParsed: Omit<YouTubePlaylistImport, 'playlistId'> | null = null
  if (feedRes.ok) {
    const feedXml = await feedRes.text()
    feedParsed = parseFeedXml(feedXml)
  }

  let pageParsed: Omit<YouTubePlaylistImport, 'playlistId'> | null = null
  const pageUrl = `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=en&gl=US`
  try {
    const pageRes = await fetch(pageUrl, { headers })
    if (pageRes.ok) {
      const html = await pageRes.text()
      pageParsed = parsePlaylistHtml(html)
    }
  } catch {
    // Ignore page failures if the feed was usable.
  }

  const merged = mergePlaylistImports(feedParsed, pageParsed)
  if (!merged.items.length) {
    throw new Error(`No videos were found in playlist ${playlistId}.`)
  }

  const items = await attachDurations(merged.items, headers)

  return { playlistId, playlistTitle: merged.playlistTitle, items }
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
  const enriched = await Promise.all(items.map(async (item) => {
    const durationMins = await fetchVideoDurationMins(item.videoId, headers).catch(() => null)
    return { ...item, durationMins }
  }))

  return enriched
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