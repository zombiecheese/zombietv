// Plex API client
// Wraps all on-demand calls to the user's own Plex Media Server.
// Nothing is cached here — the MediaItem DB table is the scheduling index.

export interface PlexSection {
  key: string
  title: string
  type: 'movie' | 'show'
}

export interface PlexMediaItem {
  ratingKey: string
  title: string
  type: 'movie' | 'episode' | 'show'
  year: number
  durationMs: number   // milliseconds — divide by 60000 for minutes
  durationMins: number
  genres: string[]     // lower-cased
  languages?: string[] // best-effort inferred from Plex metadata
  contentRating: string
  scheduledCount?: number
  lastScheduledAt?: Date | null
  // Episode-specific (null for movies/shows)
  showPlexKey?: string
  showTitle?: string
  seasonNumber?: number
  episodeNumber?: number
  // Chapters
  chapters?: Array<{ title: string; startOffsetMs: number }>
  // Source library section metadata
  sourceSectionKey?: string
  sourceSectionTitle?: string
}

export interface PlexEpisodeRef {
  season: number
  episode: number
  ratingKey: string
}

export class PlexClient {
  private readonly serverUrl: string
  private readonly token: string

  constructor(serverUrl: string, token: string) {
    this.serverUrl = serverUrl.replace(/\/$/, '')
    this.token = token
  }

  private get headers() {
    return {
      'X-Plex-Token': this.token,
      Accept: 'application/json',
    }
  }

  private url(path: string, params: Record<string, string> = {}): string {
    const u = new URL(`${this.serverUrl}${path}`)
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
    return u.toString()
  }

  // ─── Library ─────────────────────────────────────────────────────────────

  async getSections(): Promise<PlexSection[]> {
    const res = await fetch(this.url('/library/sections'), { headers: this.headers, cache: 'no-store' })
    if (!res.ok) throw new Error(`Plex getSections failed: ${res.status}`)
    const data = await res.json()
    const dirs: any[] = data.MediaContainer?.Directory ?? []
    return dirs
      .filter((d) => d.type === 'movie' || d.type === 'show')
      .map((d) => ({ key: d.key, title: d.title, type: d.type }))
  }

  // ─── Search / filter library ─────────────────────────────────────────────

  async searchMovies(opts: {
    genres?: string[]
    excludeGenres?: string[]
    languages?: string[]
    excludeLanguages?: string[]
    contentRatings?: string[]  // e.g. ['G','PG','M']
    yearFrom?: number
    yearTo?: number
    sectionKeys?: string[]
  }): Promise<PlexMediaItem[]> {
    const sections = await this.getSections()
    const allowedSectionKeys = new Set((opts.sectionKeys ?? []).map((key) => String(key)))
    const movieSections = sections.filter(
      (s) => s.type === 'movie' && (!allowedSectionKeys.size || allowedSectionKeys.has(String(s.key))),
    )
    const results: PlexMediaItem[] = []

    for (const section of movieSections) {
      const params: Record<string, string> = { type: '1' }
      if (opts.yearFrom) params['year>>'] = String(opts.yearFrom)
      if (opts.yearTo)   params['year<<'] = String(opts.yearTo)

      const res = await fetch(
        this.url(`/library/sections/${section.key}/all`, params),
        { headers: this.headers, cache: 'no-store' },
      )
      if (!res.ok) continue
      const data = await res.json()
      const items: any[] = data.MediaContainer?.Metadata ?? []

      for (const item of items) {
        const genres: string[] = (item.Genre ?? []).map((g: any) =>
          String(g.tag).toLowerCase(),
        )
        const languages = inferItemLanguages(item)

        if (opts.genres?.length) {
          const allowed = opts.genres.map((g) => g.toLowerCase())
          if (!allowed.some((g) => genres.includes(g))) continue
        }
        if (opts.excludeGenres?.length) {
          const denied = opts.excludeGenres.map((g) => g.toLowerCase())
          if (denied.some((g) => genres.includes(g))) continue
        }
        if (opts.contentRatings?.length) {
          if (!opts.contentRatings.includes(item.contentRating ?? '')) continue
        }

        if (opts.languages?.length) {
          const allowed = opts.languages.map((l) => l.toLowerCase())
          if (!languages.some((l) => allowed.includes(l))) continue
        }
        if (opts.excludeLanguages?.length) {
          const denied = opts.excludeLanguages.map((l) => l.toLowerCase())
          if (languages.some((l) => denied.includes(l))) continue
        }

        results.push(this.mapItem(item, 'movie', genres, languages, section.key, section.title))
      }
    }
    return results
  }

  async searchShows(opts: {
    genres?: string[]
    excludeGenres?: string[]
    languages?: string[]
    excludeLanguages?: string[]
    sectionKeys?: string[]
  }): Promise<PlexMediaItem[]> {
    const sections = await this.getSections()
    const allowedSectionKeys = new Set((opts.sectionKeys ?? []).map((key) => String(key)))
    const showSections = sections.filter(
      (s) => s.type === 'show' && (!allowedSectionKeys.size || allowedSectionKeys.has(String(s.key))),
    )
    const results: PlexMediaItem[] = []

    for (const section of showSections) {
      const res = await fetch(
        this.url(`/library/sections/${section.key}/all`, { type: '2' }),
        { headers: this.headers, cache: 'no-store' },
      )
      if (!res.ok) continue
      const data = await res.json()
      const items: any[] = data.MediaContainer?.Metadata ?? []

      for (const item of items) {
        const genres: string[] = (item.Genre ?? []).map((g: any) =>
          String(g.tag).toLowerCase(),
        )
        const languages = inferItemLanguages(item)
        if (opts.genres?.length) {
          const allowed = opts.genres.map((g) => g.toLowerCase())
          if (!allowed.some((g) => genres.includes(g))) continue
        }
        if (opts.excludeGenres?.length) {
          const denied = opts.excludeGenres.map((g) => g.toLowerCase())
          if (denied.some((g) => genres.includes(g))) continue
        }
        if (opts.languages?.length) {
          const allowed = opts.languages.map((l) => l.toLowerCase())
          if (!languages.some((l) => allowed.includes(l))) continue
        }
        if (opts.excludeLanguages?.length) {
          const denied = opts.excludeLanguages.map((l) => l.toLowerCase())
          if (languages.some((l) => denied.includes(l))) continue
        }
        results.push(this.mapItem(item, 'show', genres, languages, section.key, section.title))
      }
    }
    return results
  }

  // ─── Episode handling ─────────────────────────────────────────────────────

  // Returns all episode refs for a show, ordered by season then episode
  async getEpisodeList(showKey: string): Promise<PlexEpisodeRef[]> {
    const res = await fetch(
      this.url(`/library/metadata/${showKey}/allLeaves`),
      { headers: this.headers, cache: 'no-store' },
    )
    if (!res.ok) throw new Error(`getEpisodeList failed: ${res.status}`)
    const data = await res.json()
    const eps: any[] = data.MediaContainer?.Metadata ?? []
    return eps
      .map((e) => ({
        season:     e.parentIndex as number,
        episode:    e.index as number,
        ratingKey:  e.ratingKey as string,
      }))
      .sort((a, b) => a.season - b.season || a.episode - b.episode)
  }

  // Fetch a specific episode's full metadata
  async getEpisode(
    showKey: string,
    season: number,
    episode: number,
  ): Promise<PlexMediaItem | null> {
    const list = await this.getEpisodeList(showKey)
    const ref = list.find((e) => e.season === season && e.episode === episode)
    if (!ref) return null
    return this.getItemByKey(ref.ratingKey)
  }

  async getItemByKey(ratingKey: string): Promise<PlexMediaItem | null> {
    const res = await fetch(
      this.url(`/library/metadata/${ratingKey}`, { includeChapters: '1' }),
      { headers: this.headers, cache: 'no-store' },
    )
    if (!res.ok) return null
    const data = await res.json()
    const item = data.MediaContainer?.Metadata?.[0]
    if (!item) return null

    const genres: string[] = (item.Genre ?? []).map((g: any) =>
      String(g.tag).toLowerCase(),
    )
    const languages = inferItemLanguages(item)
    const type: PlexMediaItem['type'] =
      item.type === 'movie' ? 'movie' : item.type === 'show' ? 'show' : 'episode'
    const mapped = this.mapItem(item, type, genres, languages)

    // Attach chapters if present
    const chapters = (item.Chapter ?? []).map((c: any) => ({
      title:         c.title ?? '',
      startOffsetMs: c.startTimeOffset as number,
    }))
    mapped.chapters = chapters.length ? chapters : undefined

    return mapped
  }

  // ─── Stream URL ───────────────────────────────────────────────────────────
  // Returns a direct-play URL. The client must have the Plex token to use it.

  getStreamUrl(ratingKey: string): string {
    return `${this.serverUrl}/library/metadata/${ratingKey}/stream?X-Plex-Token=${this.token}`
  }

  // Transcode-safe playback session URL (for web clients that can't direct-play)
  getTranscodeUrl(ratingKey: string, offsetMs = 0): string {
    const params = new URLSearchParams({
      'X-Plex-Token':     this.token,
      'X-Plex-Platform':  'Web',
      offset:             String(Math.floor(offsetMs / 1000)),
    })
    return `${this.serverUrl}/video/:/transcode/universal/start.m3u8?${params}`
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private mapItem(
    item: any,
    type: PlexMediaItem['type'],
    genres: string[],
    languages: string[] = [],
    sourceSectionKey?: string,
    sourceSectionTitle?: string,
  ): PlexMediaItem {
    const durationMs = (item.duration as number) ?? 0
    return {
      ratingKey:     item.ratingKey as string,
      title:         item.title as string,
      type,
      year:          (item.year as number) ?? 0,
      durationMs,
      durationMins:  Math.round(durationMs / 60000),
      genres,
      languages,
      contentRating: (item.contentRating as string) ?? 'PG',
      showPlexKey:   type === 'episode' ? (item.grandparentRatingKey as string | undefined) : undefined,
      showTitle:     item.grandparentTitle as string | undefined,
      seasonNumber:  item.parentIndex as number | undefined,
      episodeNumber: item.index as number | undefined,
      sourceSectionKey,
      sourceSectionTitle,
    }
  }
}

function inferItemLanguages(item: any): string[] {
  const langs = new Set<string>()

  const rawLanguageTags = [
    ...(Array.isArray(item.Language) ? item.Language.map((l: any) => l?.tag) : []),
    item.audioLanguage,
    item.originallyAvailableAt,
  ]

  for (const value of rawLanguageTags) {
    const normalized = String(value ?? '').trim().toLowerCase()
    if (!normalized) continue
    if (normalized.includes('japan')) langs.add('japanese')
    if (normalized.includes('korea')) langs.add('korean')
    if (normalized.includes('english')) langs.add('english')
    if (normalized.includes('french')) langs.add('french')
    if (normalized.includes('spanish')) langs.add('spanish')
    if (normalized.includes('tagalog')) langs.add('tagalog')
    if (normalized.includes('indones')) langs.add('indonesian')
    if (normalized.includes('chinese') || normalized.includes('mandarin') || normalized.includes('cantonese')) langs.add('chinese')
  }

  for (const country of Array.isArray(item.Country) ? item.Country : []) {
    const tag = String(country?.tag ?? '').trim().toLowerCase()
    if (!tag) continue
    if (tag === 'japan') langs.add('japanese')
    else if (tag === 'south korea' || tag === 'korea') langs.add('korean')
    else if (['united states of america', 'united kingdom', 'australia', 'canada', 'new zealand', 'ireland'].includes(tag)) langs.add('english')
    else if (tag === 'france') langs.add('french')
    else if (['spain', 'mexico', 'argentina', 'colombia', 'peru', 'chile'].includes(tag)) langs.add('spanish')
    else if (tag === 'indonesia') langs.add('indonesian')
    else if (tag === 'philippines') langs.add('tagalog')
    else if (['china', 'hong kong', 'taiwan'].includes(tag)) langs.add('chinese')
  }

  return Array.from(langs)
}
