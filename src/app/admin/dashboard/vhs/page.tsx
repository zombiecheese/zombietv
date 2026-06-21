'use client'

import { useState, useEffect } from 'react'
import AdminShell from '@/components/admin/AdminShell'
import { DEFAULT_VHS_SETTINGS, type VHSSettings } from '@/lib/vhs-defaults'

type NumericVHSKey = Exclude<keyof VHSSettings, 'debugOverlayEnabled'>

const KNOBS: Array<{ key: NumericVHSKey; label: string; desc: string }> = [
  { key: 'scanlines',           label: 'Scanlines',            desc: 'Horizontal scan-line density and opacity.' },
  { key: 'noise',               label: 'Noise',                desc: 'Random pixel noise — simulates VHS tape grain.' },
  { key: 'chromaticAberration', label: 'Chromatic Aberration', desc: 'Red/blue colour-fringe at screen edges.' },
  { key: 'vignette',            label: 'Vignette',             desc: 'Edge darkening — simulates CRT tube fall-off.' },
  { key: 'crtCurvature',        label: 'CRT Barrel Distortion', desc: 'SVG-filter barrel warp applied to the whole viewport.' },
  { key: 'flicker',             label: 'Flicker',              desc: 'Subtle brightness flicker on the overlay.' },
]

export default function VHSPage() {
  const [settings, setSettings] = useState<VHSSettings>(DEFAULT_VHS_SETTINGS)
  const [saved,    setSaved]    = useState(false)
  const [msg,      setMsg]      = useState('')

  useEffect(() => {
    fetch('/api/vhs-settings').then(r => r.json()).then(d => setSettings({ ...DEFAULT_VHS_SETTINGS, ...d }))
  }, [])

  const save = async () => {
    const r = await fetch('/api/vhs-settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    setMsg(r.ok ? '✓ Settings applied — visible to all viewers within 30 seconds.' : '✗ Save failed.')
    if (r.ok) setSaved(true)
  }

  const reset = () => { setSettings(DEFAULT_VHS_SETTINGS); setSaved(false); setMsg('') }

  return (
    <AdminShell>
      <h2 style={h2}>VHS / CRT Effects</h2>
      <p style={sub}>Adjust the viewport-wide analogue TV effects. Changes propagate to all connected viewers within ~30 seconds.</p>

      {msg && <p style={{ color: saved ? '#4CAF50' : '#ff4444', fontSize: '0.78rem', margin: '12px 0' }}>{msg}</p>}

      <div style={{ maxWidth: 560, marginTop: 20 }}>
        {KNOBS.map(({ key, label, desc }) => (
          <div key={key} style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <label style={{ color: '#e8f0fe', fontSize: '0.82rem', fontWeight: 700 }}>{label}</label>
              <span style={{ color: '#ff6600', fontFamily: 'monospace', fontSize: '0.85rem', minWidth: 36, textAlign: 'right' }}>
                {settings[key].toFixed(2)}
              </span>
            </div>
            <input
              type="range" min={0} max={1} step={0.01}
              value={settings[key]}
              onChange={e => setSettings({ ...settings, [key]: Number(e.target.value) })}
              style={{ width: '100%', accentColor: '#ff6600', cursor: 'pointer' }}
            />
            <div style={{ color: '#4a7fb5', fontSize: '0.68rem', marginTop: 4 }}>{desc}</div>

            {/* Live preview bar */}
            <div style={{
              marginTop: 8, height: 4, borderRadius: 2,
              background: `linear-gradient(to right, #ff6600 ${settings[key] * 100}%, #1e3a5f ${settings[key] * 100}%)`,
            }} />
          </div>
        ))}

        <div style={{ marginBottom: 24, marginTop: 12, borderTop: '1px solid #1e3a5f', paddingTop: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label style={{ color: '#e8f0fe', fontSize: '0.82rem', fontWeight: 700 }} htmlFor="debug-overlay-toggle">
              Viewer Debug Overlay
            </label>
            <span style={{ color: settings.debugOverlayEnabled ? '#4CAF50' : '#4a7fb5', fontFamily: 'monospace', fontSize: '0.78rem' }}>
              {settings.debugOverlayEnabled ? 'ENABLED' : 'DISABLED'}
            </span>
          </div>
          <div style={{ color: '#4a7fb5', fontSize: '0.68rem', marginBottom: 10 }}>
            Controls whether viewers can see the technical playback HUD (source, ids, offsets, timing, and stream diagnostics).
          </div>
          <label style={{ display: 'inline-flex', gap: 10, alignItems: 'center', color: '#dbe8f7', fontSize: '0.78rem', cursor: 'pointer' }}>
            <input
              id="debug-overlay-toggle"
              type="checkbox"
              checked={settings.debugOverlayEnabled}
              onChange={(e) => setSettings({ ...settings, debugOverlayEnabled: e.target.checked })}
              style={{ accentColor: '#ff6600', cursor: 'pointer' }}
            />
            Allow debug overlay in viewer
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button onClick={save}  style={{ ...btn, flex: 1 }}>Apply to All Viewers</button>
          <button onClick={reset} style={{ ...btn, flex: 1, backgroundColor: '#1e3a5f' }}>Reset to Defaults</button>
        </div>
      </div>
    </AdminShell>
  )
}

const h2: React.CSSProperties = { margin: 0, color: '#ff6600', fontSize: '1rem', letterSpacing: '0.08em', fontWeight: 700 }
const sub: React.CSSProperties = { color: '#4a7fb5', fontSize: '0.78rem', margin: '6px 0 0' }
const btn: React.CSSProperties = { backgroundColor: '#ff6600', color: '#fff', border: 'none', padding: '9px 20px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.06em' }
