'use client'

// WeatherChannel
// A 1990s "local on the 8s" style continuous weather channel.
// Data comes from the free Open-Meteo APIs (forecast + marine) through a
// server-side proxy; station rules provide location details.
// Pages cycle automatically through a richer screen stack:
// Current Conditions -> Local Radar -> Hourly Planner -> Weekly Outlook
// -> Almanac (Sun/Moon) -> Marine/Tide Status.

import { useEffect, useMemo, useRef, useState } from 'react'

export interface WeatherChannelConfig {
  latitude: number
  longitude: number
  locationName: string
  musicVideoId?: string | null
}

interface Props {
  config: WeatherChannelConfig | null
}

interface CurrentWeather {
  temperature: number
  apparentTemperature: number
  humidity: number
  windSpeed: number
  windDirection: number
  pressure: number
  weatherCode: number
  isDay: boolean
}

interface HourlyEntry {
  timeMs: number
  temperature: number
  weatherCode: number
  precipProbability: number
  precipitationMm: number
  cloudCover: number
  visibilityMeters: number
}

interface DailyEntry {
  dateMs: number
  weatherCode: number
  tempMax: number
  tempMin: number
  precipProbability: number
  sunriseMs: number | null
  sunsetMs: number | null
  daylightSeconds: number | null
  uvIndexMax: number | null
  moonPhase: number | null
  moonriseMs: number | null
  moonsetMs: number | null
}

interface MarineEntry {
  timeMs: number
  waveHeightM: number
  windWaveHeightM: number
  swellWaveHeightM: number
  seaTempC: number
}

interface WeatherData {
  current: CurrentWeather
  hourly: HourlyEntry[]
  daily: DailyEntry[]
  marineHourly: MarineEntry[]
  timezoneId: string
  timezoneLabel: string
  fetchedAtMs: number
}

const PAGE_DURATION_MS = 12_000
const REFRESH_INTERVAL_MS = 10 * 60_000
const PAGE_LABELS = ['CURRENT', 'RADAR', 'HOURLY', 'WEEKLY', 'ALMANAC', 'MARINE'] as const

// WMO weather interpretation codes → label + glyph.
function describeWeatherCode(code: number): { label: string; glyph: string } {
  if (code === 0) return { label: 'CLEAR', glyph: 'SUN' }
  if (code === 1) return { label: 'MOSTLY CLEAR', glyph: 'FAIR' }
  if (code === 2) return { label: 'PARTLY CLOUDY', glyph: 'PCLD' }
  if (code === 3) return { label: 'OVERCAST', glyph: 'CLDY' }
  if (code === 45 || code === 48) return { label: 'FOG', glyph: 'FOG' }
  if (code >= 51 && code <= 57) return { label: 'DRIZZLE', glyph: 'DRZL' }
  if (code >= 61 && code <= 67) return { label: 'RAIN', glyph: 'RAIN' }
  if (code >= 71 && code <= 77) return { label: 'SNOW', glyph: 'SNOW' }
  if (code >= 80 && code <= 82) return { label: 'SHOWERS', glyph: 'SHWR' }
  if (code === 85 || code === 86) return { label: 'SNOW SHOWERS', glyph: 'SNSH' }
  if (code === 95) return { label: 'THUNDERSTORMS', glyph: 'TSTM' }
  if (code === 96 || code === 99) return { label: 'SEVERE STORMS', glyph: 'SVR' }
  return { label: 'CONDITIONS N/A', glyph: 'N/A' }
}

function windDirectionLabel(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  return dirs[Math.round(((deg % 360) / 22.5)) % 16]
}

async function fetchWeather(latitude: number, longitude: number): Promise<WeatherData> {
  // Server-side proxy: shared 10-min cache across viewers, no third-party
  // requests from the browser.
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
  })
  const res = await fetch(`/api/weather?${params}`)
  if (!res.ok) throw new Error(`Weather API HTTP ${res.status}`)
  const payload = await res.json()
  const data = payload?.forecast ?? payload
  const marineData = payload?.marine ?? null

  const current: CurrentWeather = {
    temperature: Number(data?.current?.temperature_2m ?? NaN),
    apparentTemperature: Number(data?.current?.apparent_temperature ?? NaN),
    humidity: Number(data?.current?.relative_humidity_2m ?? NaN),
    windSpeed: Number(data?.current?.wind_speed_10m ?? NaN),
    windDirection: Number(data?.current?.wind_direction_10m ?? 0),
    pressure: Number(data?.current?.pressure_msl ?? NaN),
    weatherCode: Number(data?.current?.weather_code ?? -1),
    isDay: Boolean(data?.current?.is_day ?? true),
  }

  const hourlyTimes: string[] = data?.hourly?.time ?? []
  const nowMs = Date.now()
  const hourly: HourlyEntry[] = hourlyTimes
    .map((t: string, i: number) => ({
      timeMs: new Date(t).getTime(),
      temperature: Number(data.hourly.temperature_2m?.[i] ?? NaN),
      weatherCode: Number(data.hourly.weather_code?.[i] ?? -1),
      precipProbability: Number(data.hourly.precipitation_probability?.[i] ?? 0),
      precipitationMm: Number(data.hourly.precipitation?.[i] ?? 0),
      cloudCover: Number(data.hourly.cloud_cover?.[i] ?? 0),
      visibilityMeters: Number(data.hourly.visibility?.[i] ?? NaN),
    }))
    .filter((h: HourlyEntry) => h.timeMs >= nowMs - 30 * 60_000)
    .slice(0, 24)

  const dailyTimes: string[] = data?.daily?.time ?? []
  const daily: DailyEntry[] = dailyTimes.map((t: string, i: number) => ({
    dateMs: new Date(t).getTime(),
    weatherCode: Number(data.daily.weather_code?.[i] ?? -1),
    tempMax: Number(data.daily.temperature_2m_max?.[i] ?? NaN),
    tempMin: Number(data.daily.temperature_2m_min?.[i] ?? NaN),
    precipProbability: Number(data.daily.precipitation_probability_max?.[i] ?? 0),
    sunriseMs: data?.daily?.sunrise?.[i] ? new Date(data.daily.sunrise[i]).getTime() : null,
    sunsetMs: data?.daily?.sunset?.[i] ? new Date(data.daily.sunset[i]).getTime() : null,
    daylightSeconds: Number.isFinite(Number(data?.daily?.daylight_duration?.[i]))
      ? Number(data.daily.daylight_duration[i])
      : null,
    uvIndexMax: Number.isFinite(Number(data?.daily?.uv_index_max?.[i]))
      ? Number(data.daily.uv_index_max[i])
      : null,
    moonPhase: Number.isFinite(Number(data?.daily?.moon_phase?.[i]))
      ? Number(data.daily.moon_phase[i])
      : null,
    moonriseMs: data?.daily?.moonrise?.[i] ? new Date(data.daily.moonrise[i]).getTime() : null,
    moonsetMs: data?.daily?.moonset?.[i] ? new Date(data.daily.moonset[i]).getTime() : null,
  }))

  const marineTimes: string[] = marineData?.hourly?.time ?? []
  const marineHourly: MarineEntry[] = marineTimes
    .map((t: string, i: number) => ({
      timeMs: new Date(t).getTime(),
      waveHeightM: Number(marineData?.hourly?.wave_height?.[i] ?? NaN),
      windWaveHeightM: Number(marineData?.hourly?.wind_wave_height?.[i] ?? NaN),
      swellWaveHeightM: Number(marineData?.hourly?.swell_wave_height?.[i] ?? NaN),
      seaTempC: Number(marineData?.hourly?.sea_surface_temperature?.[i] ?? NaN),
    }))
    .filter((h: MarineEntry) => h.timeMs >= nowMs - 60 * 60_000)
    .slice(0, 12)

  return {
    current,
    hourly,
    daily,
    marineHourly,
    timezoneId: String(data?.timezone ?? 'UTC'),
    timezoneLabel: String(data?.timezone_abbreviation ?? data?.timezone ?? 'LOCAL'),
    fetchedAtMs: Date.now(),
  }
}

export default function WeatherChannel({ config }: Props) {
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const musicRef = useRef<HTMLIFrameElement | null>(null)

  const hasLocation = Boolean(
    config
    && Number.isFinite(config.latitude)
    && Number.isFinite(config.longitude)
    && !(config.latitude === 0 && config.longitude === 0),
  )

  // Clock
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Weather fetch + refresh
  useEffect(() => {
    if (!hasLocation || !config) return
    let alive = true

    const load = () => {
      fetchWeather(config.latitude, config.longitude)
        .then((data) => { if (alive) { setWeather(data); setError(null) } })
        .catch((err) => { if (alive) setError(err?.message ?? 'Weather unavailable') })
    }

    load()
    const timer = setInterval(load, REFRESH_INTERVAL_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [hasLocation, config?.latitude, config?.longitude]) // eslint-disable-line react-hooks/exhaustive-deps

  // Page cycle
  useEffect(() => {
    const timer = setInterval(() => setPage((p) => (p + 1) % PAGE_LABELS.length), PAGE_DURATION_MS)
    return () => clearInterval(timer)
  }, [])

  // Background music: the iframe mounts muted (autoplay-policy safe) and is
  // unmuted in place via the YouTube IFrame API. If the viewer has already
  // interacted with the page (e.g. changed channel), the unmute succeeds
  // immediately; otherwise the gesture listeners below pick it up.
  useEffect(() => {
    if (!config?.musicVideoId) return

    const post = (func: string, args: unknown[] = []) => {
      musicRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'command', func, args }),
        'https://www.youtube.com',
      )
    }
    const nudge = () => {
      musicRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'listening', id: 'zombietv-weather' }),
        'https://www.youtube.com',
      )
      post('playVideo')
      post('unMute')
      post('setVolume', [100])
    }

    // Re-assert a few times while the player boots, then keep trying at a
    // slow cadence in case autoplay unmute was initially blocked.
    const timers = [400, 1200, 2500, 5000].map((ms) => setTimeout(nudge, ms))
    const retry = setInterval(nudge, 8_000)

    window.addEventListener('pointerdown', nudge, true)
    window.addEventListener('keydown', nudge, true)
    window.addEventListener('touchstart', nudge, true)

    return () => {
      timers.forEach(clearTimeout)
      clearInterval(retry)
      window.removeEventListener('pointerdown', nudge, true)
      window.removeEventListener('keydown', nudge, true)
      window.removeEventListener('touchstart', nudge, true)
    }
  }, [config?.musicVideoId])

  const activeTimeZone = weather?.timezoneId

  const timeLabel = useMemo(
    () => formatTimeOfDay(nowMs, activeTimeZone, { includeSeconds: true }),
    [nowMs, activeTimeZone],
  )
  const dateLabel = useMemo(
    () => formatLongDate(nowMs, activeTimeZone),
    [nowMs, activeTimeZone],
  )

  const tickerText = useMemo(() => {
    if (!weather) return 'FETCHING LATEST OBSERVATIONS…'
    const cur = weather.current
    const desc = describeWeatherCode(cur.weatherCode)
    const parts = [
      `CURRENTLY ${desc.label} ${Math.round(cur.temperature)}°C`,
      `FEELS LIKE ${Math.round(cur.apparentTemperature)}°C`,
      `HUMIDITY ${Math.round(cur.humidity)}%`,
      `WIND ${windDirectionLabel(cur.windDirection)} AT ${Math.round(cur.windSpeed)} KM/H`,
      `PRESSURE ${Math.round(cur.pressure)} hPa`,
    ]
    const today = weather.daily[0]
    if (today?.sunriseMs && today?.sunsetMs) {
      parts.push(
        `SUNRISE ${formatTimeOfDay(today.sunriseMs, weather.timezoneId)}`,
        `SUNSET ${formatTimeOfDay(today.sunsetMs, weather.timezoneId)}`,
      )
    }
    const tomorrow = weather.daily[1]
    if (tomorrow) {
      parts.push(`TOMORROW: ${describeWeatherCode(tomorrow.weatherCode).label} ${Math.round(tomorrow.tempMin)}°–${Math.round(tomorrow.tempMax)}°C`)
    }
    return parts.join('  •  ')
  }, [weather])

  const locationName = config?.locationName?.trim() || 'LOCAL AREA'

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(180deg, #10154a 0%, #1b2168 45%, #0a0d38 100%)',
        color: '#fff',
        fontFamily: '"Arial Narrow", Arial, Helvetica, sans-serif',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 26px',
          background: 'linear-gradient(180deg, #2c3690 0%, #171d5e 100%)',
          borderBottom: '3px solid #f2a33c',
          textShadow: '2px 2px 0 rgba(0,0,0,0.65)',
        }}
      >
        <div>
          <div style={{ fontSize: '1.5rem', fontWeight: 900, letterSpacing: '0.12em' }}>WEATHER CENTRE</div>
          <div style={{ color: '#f2c34c', fontSize: '0.85rem', letterSpacing: '0.2em', fontWeight: 700 }}>{locationName.toUpperCase()}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'monospace', fontSize: '1.6rem', fontWeight: 700, color: '#ffe27a' }}>{timeLabel}</div>
          <div style={{ fontSize: '0.75rem', color: '#b9c2f0', letterSpacing: '0.1em' }}>{dateLabel.toUpperCase()}</div>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, position: 'relative', padding: '20px 30px', minHeight: 0 }}>
        {!hasLocation && (
          <CenterNotice title="WEATHER CENTRE OFFLINE" subtitle="No location configured — set latitude/longitude in Station Rules → Channel Type." />
        )}
        {hasLocation && error && !weather && (
          <CenterNotice title="NO DATA RECEIVED" subtitle={error} />
        )}
        {hasLocation && !error && !weather && (
          <CenterNotice title="STAND BY" subtitle="Receiving observations…" />
        )}

        {weather && page === 0 && <CurrentConditionsPage weather={weather} locationName={locationName} />}
        {weather && page === 1 && <RadarStylePage weather={weather} config={config} />}
        {weather && page === 2 && <HourlyPlannerPage weather={weather} />}
        {weather && page === 3 && <WeeklyOutlookPage weather={weather} />}
        {weather && page === 4 && <AlmanacPage weather={weather} />}
        {weather && page === 5 && <MarineTidesPage weather={weather} />}
      </div>

      {/* Page indicator */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', paddingBottom: 8 }}>
        {PAGE_LABELS.map((label, i) => (
          <span key={label} style={{ fontSize: '0.6rem', letterSpacing: '0.2em', color: page === i ? '#ffe27a' : '#4a5390', fontWeight: 700 }}>
            {label}
          </span>
        ))}
      </div>

      {/* Ticker */}
      <div
        style={{
          height: 42,
          background: 'linear-gradient(180deg, #d97b16 0%, #a85a08 100%)',
          borderTop: '2px solid #ffe27a',
          overflow: 'hidden',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            whiteSpace: 'nowrap',
            fontWeight: 800,
            fontSize: '1.05rem',
            color: '#1a1030',
            animation: 'weather-ticker 40s linear infinite',
            paddingLeft: '100%',
          }}
        >
          {tickerText}  •  {tickerText}
        </div>
        <style>{`@keyframes weather-ticker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`}</style>
      </div>

      {/* Background music: mounts muted for autoplay, unmuted via IFrame API */}
      {config?.musicVideoId && (
        <iframe
          ref={musicRef}
          title="weather-music"
          src={`https://www.youtube.com/embed/${encodeURIComponent(config.musicVideoId)}?autoplay=1&mute=1&loop=1&playlist=${encodeURIComponent(config.musicVideoId)}&controls=0&modestbranding=1&enablejsapi=1${typeof window !== 'undefined' ? `&origin=${encodeURIComponent(window.location.origin)}` : ''}`}
          allow="autoplay"
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        />
      )}
    </div>
  )
}

function CenterNotice({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 30 }}>
      <div style={{ fontSize: '1.8rem', fontWeight: 900, letterSpacing: '0.15em', color: '#ffe27a', textShadow: '2px 2px 0 rgba(0,0,0,0.6)' }}>{title}</div>
      <div style={{ marginTop: 10, color: '#b9c2f0', fontSize: '0.85rem', maxWidth: 480 }}>{subtitle}</div>
    </div>
  )
}

const panelStyle: React.CSSProperties = {
  background: 'linear-gradient(180deg, rgba(38,46,120,0.85) 0%, rgba(18,22,70,0.85) 100%)',
  border: '2px solid #5a66c0',
  borderRadius: 6,
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 4px 14px rgba(0,0,0,0.5)',
  padding: '16px 20px',
}

const pageTitleStyle: React.CSSProperties = {
  fontSize: '1.15rem',
  fontWeight: 900,
  letterSpacing: '0.22em',
  color: '#f2c34c',
  textShadow: '2px 2px 0 rgba(0,0,0,0.6)',
  marginBottom: 14,
}

function CurrentConditionsPage({ weather, locationName }: { weather: WeatherData; locationName: string }) {
  const cur = weather.current
  const desc = describeWeatherCode(cur.weatherCode)
  return (
    <div>
      <div style={pageTitleStyle}>CURRENT CONDITIONS</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20 }}>
        <div style={{ ...panelStyle, display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ fontSize: '2.4rem', lineHeight: 1, color: '#8fd8ff', fontWeight: 900, letterSpacing: '0.06em' }}>{desc.glyph}</div>
          <div>
            <div style={{ fontSize: '4.2rem', fontWeight: 900, color: '#ffe27a', textShadow: '3px 3px 0 rgba(0,0,0,0.6)', lineHeight: 1 }}>
              {Math.round(cur.temperature)}°C
            </div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, letterSpacing: '0.15em', marginTop: 6 }}>{desc.label}</div>
            <div style={{ color: '#b9c2f0', fontSize: '0.85rem', marginTop: 4 }}>FEELS LIKE {Math.round(cur.apparentTemperature)}°C</div>
          </div>
        </div>
        <div style={{ ...panelStyle, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignContent: 'center' }}>
          <Stat label="HUMIDITY" value={`${Math.round(cur.humidity)}%`} />
          <Stat label="WIND" value={`${windDirectionLabel(cur.windDirection)} ${Math.round(cur.windSpeed)} km/h`} />
          <Stat label="PRESSURE" value={`${Math.round(cur.pressure)} hPa`} />
          <Stat label="UPDATED" value={formatTimeOfDay(weather.fetchedAtMs, weather.timezoneId)} />
          <Stat label="TIMEZONE" value={weather.timezoneLabel} />
          <Stat label="LIGHT" value={cur.isDay ? 'DAYTIME' : 'NIGHTTIME'} />
        </div>
      </div>
      <div style={{ ...panelStyle, marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: '#f2c34c', fontWeight: 800, letterSpacing: '0.12em' }}>LOCAL STATION</div>
        <div style={{ color: '#fff', fontWeight: 800 }}>{locationName.toUpperCase()}</div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: '#8f9bd8', fontSize: '0.62rem', letterSpacing: '0.2em', fontWeight: 700 }}>{label}</div>
      <div style={{ color: '#fff', fontSize: '1.05rem', fontWeight: 800 }}>{value}</div>
    </div>
  )
}

function RadarStylePage({ weather, config }: { weather: WeatherData; config: WeatherChannelConfig | null }) {
  const entries = weather.hourly.slice(0, 8)
  const lat = config?.latitude ?? 0
  const lon = config?.longitude ?? 0
  const markerLeft = 50 + Math.max(-35, Math.min(35, lon / 180 * 35))
  const markerTop = 50 - Math.max(-35, Math.min(35, lat / 90 * 35))

  return (
    <div>
      <div style={pageTitleStyle}>LOCAL RADAR</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16 }}>
        <div style={{ ...panelStyle, position: 'relative', height: 290, overflow: 'hidden' }}>
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle at center, rgba(143,216,255,0.16) 0%, rgba(143,216,255,0.06) 30%, rgba(16,22,68,0.8) 100%)',
          }} />
          {[20, 40, 60, 80].map((p) => (
            <div
              key={p}
              style={{
                position: 'absolute',
                left: `${50 - p / 2}%`,
                top: `${50 - p / 2}%`,
                width: `${p}%`,
                height: `${p}%`,
                border: '1px solid rgba(143,216,255,0.35)',
                borderRadius: '50%',
              }}
            />
          ))}
          <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'rgba(143,216,255,0.22)' }} />
          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'rgba(143,216,255,0.22)' }} />

          <div
            style={{
              position: 'absolute',
              left: `${markerLeft}%`,
              top: `${markerTop}%`,
              transform: 'translate(-50%, -50%)',
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: '#ffe27a',
              boxShadow: '0 0 0 5px rgba(255, 226, 122, 0.25)',
            }}
          />

          <div style={{ position: 'absolute', left: 10, top: 8, color: '#8fd8ff', fontSize: '0.7rem', letterSpacing: '0.14em', fontWeight: 800 }}>
            PRECIP INTENSITY
          </div>
          <div style={{ position: 'absolute', right: 10, top: 8, color: '#b9c2f0', fontSize: '0.7rem', fontFamily: 'monospace' }}>
            LAT {lat.toFixed(2)}  LON {lon.toFixed(2)}
          </div>
        </div>

        <div style={{ ...panelStyle, display: 'grid', gap: 8, alignContent: 'start' }}>
          <div style={{ color: '#f2c34c', fontSize: '0.8rem', letterSpacing: '0.12em', fontWeight: 900 }}>NEXT 8 HOURS</div>
          {entries.map((h) => {
            const intensity = Math.max(0, Math.min(100, Math.round((h.precipProbability || 0))))
            const mm = Number.isFinite(h.precipitationMm) ? h.precipitationMm : 0
            const bar = Math.max(4, Math.round(intensity * 0.92))
            return (
              <div key={h.timeMs} style={{ display: 'grid', gridTemplateColumns: '58px 1fr 52px', gap: 6, alignItems: 'center' }}>
                <div style={{ color: '#b9c2f0', fontSize: '0.7rem', fontWeight: 700 }}>
                  {formatHourShort(h.timeMs, weather.timezoneId)}
                </div>
                <div style={{ background: '#121a52', border: '1px solid #3a4390', height: 12, position: 'relative' }}>
                  <div style={{ width: `${bar}%`, height: '100%', background: 'linear-gradient(90deg, #46d47a 0%, #f2c34c 55%, #ff6f4d 100%)' }} />
                </div>
                <div style={{ color: '#fff', fontSize: '0.68rem', textAlign: 'right' }}>{mm.toFixed(1)}mm</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function HourlyPlannerPage({ weather }: { weather: WeatherData }) {
  const entries = weather.hourly.filter((_, i) => i % 2 === 0).slice(0, 6)
  return (
    <div>
      <div style={pageTitleStyle}>HOURLY PLANNER</div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, entries.length)}, 1fr)`, gap: 12 }}>
        {entries.map((h) => {
          const desc = describeWeatherCode(h.weatherCode)
          const visKm = Number.isFinite(h.visibilityMeters) ? Math.max(0, h.visibilityMeters / 1000) : NaN
          return (
            <div key={h.timeMs} style={{ ...panelStyle, textAlign: 'center', padding: '14px 8px' }}>
              <div style={{ color: '#f2c34c', fontWeight: 800, fontSize: '0.8rem', letterSpacing: '0.08em' }}>
                {formatHourShort(h.timeMs, weather.timezoneId)}
              </div>
              <div style={{ fontSize: '1rem', margin: '8px 0', color: '#8fd8ff', fontWeight: 900 }}>{desc.glyph}</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#ffe27a' }}>{Math.round(h.temperature)}°</div>
              <div style={{ color: '#b9c2f0', fontSize: '0.62rem', marginTop: 6, letterSpacing: '0.06em' }}>{desc.label}</div>
              <div style={{ color: '#8f9bd8', fontSize: '0.62rem', marginTop: 3 }}>CLOUD {Math.round(h.cloudCover)}%</div>
              {Number.isFinite(visKm) && <div style={{ color: '#8f9bd8', fontSize: '0.62rem' }}>VIS {visKm.toFixed(1)} km</div>}
              {h.precipProbability > 0 && (
                <div style={{ color: '#8fd8ff', fontSize: '0.66rem', marginTop: 4 }}>RAIN {Math.round(h.precipProbability)}%</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WeeklyOutlookPage({ weather }: { weather: WeatherData }) {
  const days = weather.daily.slice(0, 7)
  return (
    <div>
      <div style={pageTitleStyle}>WEEKLY OUTLOOK</div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, days.length)}, 1fr)`, gap: 12 }}>
        {days.map((d, i) => {
          const desc = describeWeatherCode(d.weatherCode)
          const dayName = i === 0
            ? 'TODAY'
            : formatWeekdayShort(d.dateMs, weather.timezoneId)
          return (
            <div key={d.dateMs} style={{ ...panelStyle, textAlign: 'center', padding: '14px 8px' }}>
              <div style={{ color: '#f2c34c', fontWeight: 800, fontSize: '0.85rem', letterSpacing: '0.14em' }}>{dayName}</div>
              <div style={{ fontSize: '0.95rem', margin: '8px 0', color: '#8fd8ff', fontWeight: 900 }}>{desc.glyph}</div>
              <div style={{ color: '#b9c2f0', fontSize: '0.6rem', letterSpacing: '0.06em', minHeight: 24 }}>{desc.label}</div>
              <div style={{ marginTop: 6 }}>
                <span style={{ color: '#ffe27a', fontWeight: 900, fontSize: '1.2rem' }}>{Math.round(d.tempMax)}°</span>
                <span style={{ color: '#8f9bd8', fontWeight: 700, fontSize: '0.95rem', marginLeft: 8 }}>{Math.round(d.tempMin)}°</span>
              </div>
              {d.precipProbability > 0 && (
                <div style={{ color: '#8fd8ff', fontSize: '0.66rem', marginTop: 4 }}>RAIN {Math.round(d.precipProbability)}%</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AlmanacPage({ weather }: { weather: WeatherData }) {
  const today = weather.daily[0]
  const tomorrow = weather.daily[1]
  const daylight = today?.daylightSeconds ? `${Math.floor(today.daylightSeconds / 3600)}h ${Math.round((today.daylightSeconds % 3600) / 60)}m` : '--'

  return (
    <div>
      <div style={pageTitleStyle}>ALMANAC</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ ...panelStyle }}>
          <div style={{ color: '#f2c34c', fontSize: '0.82rem', letterSpacing: '0.14em', fontWeight: 900, marginBottom: 10 }}>SUNRISE / SUNSET</div>
          <AlmanacRow label="TODAY SUNRISE" value={formatClock(today?.sunriseMs, weather.timezoneId)} />
          <AlmanacRow label="TODAY SUNSET" value={formatClock(today?.sunsetMs, weather.timezoneId)} />
          <AlmanacRow label="TOMORROW SUNRISE" value={formatClock(tomorrow?.sunriseMs, weather.timezoneId)} />
          <AlmanacRow label="TOMORROW SUNSET" value={formatClock(tomorrow?.sunsetMs, weather.timezoneId)} />
          <AlmanacRow label="DAYLIGHT" value={daylight} />
          <AlmanacRow label="UV INDEX" value={today?.uvIndexMax != null ? today.uvIndexMax.toFixed(1) : '--'} />
        </div>
        <div style={{ ...panelStyle }}>
          <div style={{ color: '#f2c34c', fontSize: '0.82rem', letterSpacing: '0.14em', fontWeight: 900, marginBottom: 10 }}>MOON DATA</div>
          <AlmanacRow label="PHASE" value={moonPhaseLabel(today?.moonPhase)} />
          <AlmanacRow label="MOONRISE" value={formatClock(today?.moonriseMs, weather.timezoneId)} />
          <AlmanacRow label="MOONSET" value={formatClock(today?.moonsetMs, weather.timezoneId)} />
          <div style={{ marginTop: 14, background: '#101743', border: '1px solid #3a4390', padding: '10px 12px' }}>
            <div style={{ color: '#8f9bd8', fontSize: '0.62rem', letterSpacing: '0.14em', marginBottom: 8 }}>NEXT FOUR DAYS</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {weather.daily.slice(0, 4).map((d) => (
                <div key={d.dateMs} style={{ textAlign: 'center' }}>
                  <div style={{ color: '#b9c2f0', fontSize: '0.6rem' }}>{formatWeekdayShort(d.dateMs, weather.timezoneId)}</div>
                  <div style={{ color: '#fff', fontSize: '0.66rem', marginTop: 3 }}>{moonPhaseShort(d.moonPhase)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function MarineTidesPage({ weather }: { weather: WeatherData }) {
  const marine = weather.marineHourly.slice(0, 6)
  const hasMarine = marine.some((m) => Number.isFinite(m.waveHeightM) || Number.isFinite(m.seaTempC))

  return (
    <div>
      <div style={pageTitleStyle}>MARINE / TIDES</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ ...panelStyle }}>
          <div style={{ color: '#f2c34c', fontSize: '0.82rem', letterSpacing: '0.14em', fontWeight: 900, marginBottom: 10 }}>COASTAL CONDITIONS</div>
          {!hasMarine && (
            <div style={{ color: '#b9c2f0', fontSize: '0.8rem' }}>
              Marine observations are unavailable for this location.
            </div>
          )}
          {hasMarine && marine.map((m) => (
            <div key={m.timeMs} style={{ display: 'grid', gridTemplateColumns: '58px 1fr auto', alignItems: 'center', gap: 8, marginBottom: 7 }}>
              <div style={{ color: '#b9c2f0', fontSize: '0.7rem' }}>
                {formatHourShort(m.timeMs, weather.timezoneId)}
              </div>
              <div style={{ color: '#fff', fontSize: '0.78rem' }}>
                WAVES {formatMeters(m.waveHeightM)}  SWELL {formatMeters(m.swellWaveHeightM)}
              </div>
              <div style={{ color: '#8fd8ff', fontSize: '0.74rem' }}>{formatTemp(m.seaTempC)}</div>
            </div>
          ))}
        </div>

        <div style={{ ...panelStyle }}>
          <div style={{ color: '#f2c34c', fontSize: '0.82rem', letterSpacing: '0.14em', fontWeight: 900, marginBottom: 10 }}>TIDE STATUS</div>
          <AlmanacRow label="HIGH TIDE" value="N/A" />
          <AlmanacRow label="LOW TIDE" value="N/A" />
          <AlmanacRow label="RANGE" value="N/A" />
          <div style={{ marginTop: 12, color: '#b9c2f0', fontSize: '0.74rem', lineHeight: 1.45 }}>
            Tide heights are not provided by the current free weather source.
            Connect a tide-specific provider to populate exact local high/low
            tide times.
          </div>
        </div>
      </div>
    </div>
  )
}

function AlmanacRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(143,155,216,0.22)', padding: '6px 0' }}>
      <span style={{ color: '#8f9bd8', fontSize: '0.68rem', letterSpacing: '0.12em', fontWeight: 700 }}>{label}</span>
      <span style={{ color: '#fff', fontSize: '0.88rem', fontWeight: 800 }}>{value}</span>
    </div>
  )
}

function formatClock(ms: number | null | undefined, timeZone?: string): string {
  if (!ms) return '--'
  return formatTimeOfDay(ms, timeZone)
}

function formatTimeOfDay(ms: number, timeZone?: string, options?: { includeSeconds?: boolean }): string {
  return new Intl.DateTimeFormat('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
    second: options?.includeSeconds ? '2-digit' : undefined,
    hour12: true,
    timeZone,
  }).format(new Date(ms)).toUpperCase()
}

function formatHourShort(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    hour: 'numeric',
    hour12: true,
    timeZone,
  }).format(new Date(ms)).toUpperCase()
}

function formatWeekdayShort(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    timeZone,
  }).format(new Date(ms)).toUpperCase()
}

function formatLongDate(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(new Date(ms))
}

function moonPhaseLabel(phase: number | null | undefined): string {
  if (phase == null || !Number.isFinite(phase)) return 'N/A'
  if (phase < 0.03 || phase >= 0.97) return 'NEW MOON'
  if (phase < 0.22) return 'WAXING CRESCENT'
  if (phase < 0.28) return 'FIRST QUARTER'
  if (phase < 0.47) return 'WAXING GIBBOUS'
  if (phase < 0.53) return 'FULL MOON'
  if (phase < 0.72) return 'WANING GIBBOUS'
  if (phase < 0.78) return 'LAST QUARTER'
  return 'WANING CRESCENT'
}

function moonPhaseShort(phase: number | null | undefined): string {
  const label = moonPhaseLabel(phase)
  if (label === 'FIRST QUARTER') return '1ST QTR'
  if (label === 'LAST QUARTER') return 'LAST QTR'
  if (label === 'WAXING CRESCENT') return 'WAX CRES'
  if (label === 'WANING CRESCENT') return 'WAN CRES'
  if (label === 'WAXING GIBBOUS') return 'WAX GIB'
  if (label === 'WANING GIBBOUS') return 'WAN GIB'
  return label
}

function formatMeters(value: number): string {
  if (!Number.isFinite(value)) return '--m'
  return `${value.toFixed(1)}m`
}

function formatTemp(value: number): string {
  if (!Number.isFinite(value)) return '--.-C'
  return `${value.toFixed(1)}C`
}
