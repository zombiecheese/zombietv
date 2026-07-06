'use client'

// WeatherChannel
// A 1990s "local on the 8s" style continuous weather channel.
// Data comes from the free Open-Meteo API (no API key required); the station's
// rules JSON provides the location (rules.weather.{latitude,longitude,locationName}).
// Pages cycle automatically: Current Conditions → Local Forecast → Extended Forecast.

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
}

interface HourlyEntry {
  timeMs: number
  temperature: number
  weatherCode: number
  precipProbability: number
}

interface DailyEntry {
  dateMs: number
  weatherCode: number
  tempMax: number
  tempMin: number
  precipProbability: number
}

interface WeatherData {
  current: CurrentWeather
  hourly: HourlyEntry[]
  daily: DailyEntry[]
  fetchedAtMs: number
}

const PAGE_DURATION_MS = 12_000
const REFRESH_INTERVAL_MS = 10 * 60_000

// WMO weather interpretation codes → label + glyph.
function describeWeatherCode(code: number): { label: string; glyph: string } {
  if (code === 0) return { label: 'CLEAR', glyph: '☀' }
  if (code === 1) return { label: 'MOSTLY CLEAR', glyph: '🌤' }
  if (code === 2) return { label: 'PARTLY CLOUDY', glyph: '⛅' }
  if (code === 3) return { label: 'OVERCAST', glyph: '☁' }
  if (code === 45 || code === 48) return { label: 'FOG', glyph: '🌫' }
  if (code >= 51 && code <= 57) return { label: 'DRIZZLE', glyph: '🌦' }
  if (code >= 61 && code <= 67) return { label: 'RAIN', glyph: '🌧' }
  if (code >= 71 && code <= 77) return { label: 'SNOW', glyph: '🌨' }
  if (code >= 80 && code <= 82) return { label: 'SHOWERS', glyph: '🌦' }
  if (code === 85 || code === 86) return { label: 'SNOW SHOWERS', glyph: '🌨' }
  if (code === 95) return { label: 'THUNDERSTORMS', glyph: '⛈' }
  if (code === 96 || code === 99) return { label: 'SEVERE STORMS', glyph: '⛈' }
  return { label: 'CONDITIONS N/A', glyph: '·' }
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
  const data = await res.json()

  const current: CurrentWeather = {
    temperature: Number(data?.current?.temperature_2m ?? NaN),
    apparentTemperature: Number(data?.current?.apparent_temperature ?? NaN),
    humidity: Number(data?.current?.relative_humidity_2m ?? NaN),
    windSpeed: Number(data?.current?.wind_speed_10m ?? NaN),
    windDirection: Number(data?.current?.wind_direction_10m ?? 0),
    pressure: Number(data?.current?.pressure_msl ?? NaN),
    weatherCode: Number(data?.current?.weather_code ?? -1),
  }

  const hourlyTimes: string[] = data?.hourly?.time ?? []
  const nowMs = Date.now()
  const hourly: HourlyEntry[] = hourlyTimes
    .map((t: string, i: number) => ({
      timeMs: new Date(t).getTime(),
      temperature: Number(data.hourly.temperature_2m?.[i] ?? NaN),
      weatherCode: Number(data.hourly.weather_code?.[i] ?? -1),
      precipProbability: Number(data.hourly.precipitation_probability?.[i] ?? 0),
    }))
    .filter((h: HourlyEntry) => h.timeMs >= nowMs - 30 * 60_000)
    .slice(0, 12)

  const dailyTimes: string[] = data?.daily?.time ?? []
  const daily: DailyEntry[] = dailyTimes.map((t: string, i: number) => ({
    dateMs: new Date(t).getTime(),
    weatherCode: Number(data.daily.weather_code?.[i] ?? -1),
    tempMax: Number(data.daily.temperature_2m_max?.[i] ?? NaN),
    tempMin: Number(data.daily.temperature_2m_min?.[i] ?? NaN),
    precipProbability: Number(data.daily.precipitation_probability_max?.[i] ?? 0),
  }))

  return { current, hourly, daily, fetchedAtMs: Date.now() }
}

export default function WeatherChannel({ config }: Props) {
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [audioOn, setAudioOn] = useState(false)
  const audioOnRef = useRef(false)

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
    const timer = setInterval(() => setPage((p) => (p + 1) % 3), PAGE_DURATION_MS)
    return () => clearInterval(timer)
  }, [])

  // Background music unlocks after the first interaction (autoplay policy).
  useEffect(() => {
    if (audioOnRef.current) return
    const unlock = () => { audioOnRef.current = true; setAudioOn(true) }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  const timeLabel = useMemo(
    () => new Date(nowMs).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }),
    [nowMs],
  )
  const dateLabel = useMemo(
    () => new Date(nowMs).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }),
    [nowMs],
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

        {weather && page === 0 && <CurrentConditionsPage weather={weather} />}
        {weather && page === 1 && <LocalForecastPage weather={weather} />}
        {weather && page === 2 && <ExtendedForecastPage weather={weather} />}
      </div>

      {/* Page indicator */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', paddingBottom: 8 }}>
        {['CURRENT', 'LOCAL', 'EXTENDED'].map((label, i) => (
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

      {/* Background music (unlocks after first interaction) */}
      {config?.musicVideoId && audioOn && (
        <iframe
          title="weather-music"
          src={`https://www.youtube.com/embed/${encodeURIComponent(config.musicVideoId)}?autoplay=1&loop=1&playlist=${encodeURIComponent(config.musicVideoId)}&controls=0&modestbranding=1`}
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

function CurrentConditionsPage({ weather }: { weather: WeatherData }) {
  const cur = weather.current
  const desc = describeWeatherCode(cur.weatherCode)
  return (
    <div>
      <div style={pageTitleStyle}>CURRENT CONDITIONS</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20 }}>
        <div style={{ ...panelStyle, display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ fontSize: '4rem', lineHeight: 1 }}>{desc.glyph}</div>
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
          <Stat label="UPDATED" value={new Date(weather.fetchedAtMs).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true })} />
        </div>
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

function LocalForecastPage({ weather }: { weather: WeatherData }) {
  const entries = weather.hourly.filter((_, i) => i % 2 === 0).slice(0, 6)
  return (
    <div>
      <div style={pageTitleStyle}>LOCAL FORECAST</div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, entries.length)}, 1fr)`, gap: 12 }}>
        {entries.map((h) => {
          const desc = describeWeatherCode(h.weatherCode)
          return (
            <div key={h.timeMs} style={{ ...panelStyle, textAlign: 'center', padding: '14px 8px' }}>
              <div style={{ color: '#f2c34c', fontWeight: 800, fontSize: '0.8rem', letterSpacing: '0.08em' }}>
                {new Date(h.timeMs).toLocaleTimeString('en-AU', { hour: 'numeric', hour12: true }).toUpperCase()}
              </div>
              <div style={{ fontSize: '1.8rem', margin: '8px 0' }}>{desc.glyph}</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#ffe27a' }}>{Math.round(h.temperature)}°</div>
              <div style={{ color: '#b9c2f0', fontSize: '0.62rem', marginTop: 6, letterSpacing: '0.06em' }}>{desc.label}</div>
              {h.precipProbability > 0 && (
                <div style={{ color: '#8fd8ff', fontSize: '0.66rem', marginTop: 4 }}>☂ {Math.round(h.precipProbability)}%</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ExtendedForecastPage({ weather }: { weather: WeatherData }) {
  const days = weather.daily.slice(0, 5)
  return (
    <div>
      <div style={pageTitleStyle}>EXTENDED FORECAST</div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, days.length)}, 1fr)`, gap: 12 }}>
        {days.map((d, i) => {
          const desc = describeWeatherCode(d.weatherCode)
          const dayName = i === 0
            ? 'TODAY'
            : new Date(d.dateMs).toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase()
          return (
            <div key={d.dateMs} style={{ ...panelStyle, textAlign: 'center', padding: '14px 8px' }}>
              <div style={{ color: '#f2c34c', fontWeight: 800, fontSize: '0.85rem', letterSpacing: '0.14em' }}>{dayName}</div>
              <div style={{ fontSize: '2rem', margin: '8px 0' }}>{desc.glyph}</div>
              <div style={{ color: '#b9c2f0', fontSize: '0.6rem', letterSpacing: '0.06em', minHeight: 24 }}>{desc.label}</div>
              <div style={{ marginTop: 6 }}>
                <span style={{ color: '#ffe27a', fontWeight: 900, fontSize: '1.2rem' }}>{Math.round(d.tempMax)}°</span>
                <span style={{ color: '#8f9bd8', fontWeight: 700, fontSize: '0.95rem', marginLeft: 8 }}>{Math.round(d.tempMin)}°</span>
              </div>
              {d.precipProbability > 0 && (
                <div style={{ color: '#8fd8ff', fontSize: '0.66rem', marginTop: 4 }}>☂ {Math.round(d.precipProbability)}%</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
