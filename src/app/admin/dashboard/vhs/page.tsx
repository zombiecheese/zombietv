'use client'

import { useState, useEffect } from 'react'
import AdminShell from '@/components/admin/AdminShell'
import { DEFAULT_VHS_SETTINGS, type VHSSettings } from '@/lib/vhs-defaults'

type NumericVHSKey = Exclude<keyof VHSSettings, 'debugOverlayEnabled'>

const KNOBS: Array<{ key: NumericVHSKey; label: string; desc: string }> = [
  { key: 'scanlines',           label: 'Scanlines',            desc: 'Horizontal scan-line density and opacity.' },
  { key: 'noise',               label: 'Noise',                desc: 'Random pixel noise — simulates VHS tape grain.' },
  { key: 'chromaticAberration', label: 'Chromatic Aberration', desc: 'Red/blue colour-fringe at screen edges.' },
  { key: 'ghosting',            label: 'Ghosting',             desc: 'Subtle duplicate-image trails and analogue colour smear.' },
  { key: 'vignette',            label: 'Vignette',             desc: 'Edge darkening — simulates CRT tube fall-off.' },
  { key: 'crtCurvature',        label: 'CRT Barrel Distortion', desc: 'SVG-filter barrel warp applied to the whole viewport.' },
  { key: 'trackingNoise',       label: 'Tracking Noise',       desc: 'Rolling horizontal tape-tracking bars and line shimmer.' },
  { key: 'horizontalJitter',    label: 'Horizontal Jitter',    desc: 'Minor left-right frame instability from dirty signal lock.' },
  { key: 'flicker',             label: 'Flicker',              desc: 'Subtle brightness flicker on the overlay.' },
]

export default function VHSPage() {
  const [settings, setSettings] = useState<VHSSettings>(DEFAULT_VHS_SETTINGS)
  const [saved,    setSaved]    = useState(false)
  const [msg,      setMsg]      = useState('')
  const [appName,  setAppName]  = useState('Zombie TV')

  useEffect(() => {
    fetch('/api/app-settings').then((r) => r.ok ? r.json() : null).then((d) => { if (d?.appName) setAppName(d.appName) }).catch(() => {})
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
      <style>{`
        @keyframes vhs-preview-flicker {
          0%, 8%, 12%, 20%, 56%, 100% { opacity: 1; }
          9%, 21%, 57% { opacity: 0.82; }
        }
        @keyframes vhs-preview-roll {
          0% { transform: translateY(-130%); }
          100% { transform: translateY(130%); }
        }
      `}</style>
      <h2 style={h2}>VHS / CRT Effects</h2>
      <p style={sub}>Adjust the viewport-wide analogue TV effects. Changes propagate to all connected viewers within ~30 seconds.</p>

      {msg && <p style={{ color: saved ? '#4CAF50' : '#ff4444', fontSize: '0.78rem', margin: '12px 0' }}>{msg}</p>}

      <div style={{
        marginTop: 16,
        marginBottom: 20,
        width: '100%',
        maxWidth: 560,
        border: '1px solid #1e3a5f',
        backgroundColor: '#07111f',
        padding: 10,
      }}>
        <div style={{ color: '#a8c4e0', fontSize: '0.68rem', letterSpacing: '0.08em', marginBottom: 8 }}>
          LIVE PREVIEW
        </div>
        <div style={{
          position: 'relative',
          height: 130,
          border: '1px solid #0f2a4d',
          overflow: 'hidden',
          background: 'linear-gradient(135deg, #1a3960 0%, #0d1e39 45%, #112c4a 100%)',
          filter: `saturate(${(1 - settings.noise * 0.22).toFixed(2)}) contrast(${(1 + settings.vignette * 0.25).toFixed(2)})`,
          transform: settings.horizontalJitter > 0 ? `translateX(${((Math.random() * 2 - 1) * settings.horizontalJitter * 1.6).toFixed(2)}px)` : 'none',
        }}>
          <div style={{
            position: 'absolute',
            left: 12,
            top: 16,
            right: 12,
            color: '#e8f0fe',
            fontWeight: 700,
            fontSize: '0.92rem',
            letterSpacing: '0.05em',
            opacity: 0.95,
          }}>
            {appName.toUpperCase()} BROADCAST
          </div>
          <div style={{
            position: 'absolute',
            left: 12,
            right: 12,
            top: 46,
            color: '#9fc1e4',
            fontSize: '0.72rem',
            lineHeight: 1.4,
            opacity: 0.95,
          }}>
            Signal drift, tape wear, and analog noise simulation.
          </div>

          {settings.scanlines > 0 && (
            <div style={{
              position: 'absolute',
              inset: 0,
              background: `repeating-linear-gradient(to bottom, rgba(0,0,0,${(settings.scanlines * 0.5).toFixed(3)}) 0px, rgba(0,0,0,${(settings.scanlines * 0.5).toFixed(3)}) 1px, transparent 1px, transparent 4px)`,
            }} />
          )}

          {settings.noise > 0 && (
            <div style={{
              position: 'absolute',
              inset: 0,
              opacity: Math.min(0.28, settings.noise * 0.24),
              backgroundImage: 'radial-gradient(rgba(255,255,255,0.35) 0.7px, transparent 0.7px)',
              backgroundSize: '3px 3px',
              mixBlendMode: 'screen',
            }} />
          )}

          {settings.trackingNoise > 0 && (
            <>
              <div style={{
                position: 'absolute',
                inset: 0,
                background: `repeating-linear-gradient(to bottom, transparent 0px, transparent 13px, rgba(180,220,255,${(settings.trackingNoise * 0.05).toFixed(3)}) 13px, rgba(180,220,255,${(settings.trackingNoise * 0.05).toFixed(3)}) 14px)`,
                mixBlendMode: 'screen',
              }} />
              <div style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: '-30%',
                height: '36%',
                background: `linear-gradient(to bottom, transparent 0%, rgba(255,255,255,${(settings.trackingNoise * 0.07).toFixed(3)}) 45%, rgba(35,90,160,${(settings.trackingNoise * 0.16).toFixed(3)}) 65%, transparent 100%)`,
                animation: 'vhs-preview-roll 5.5s linear infinite',
                mixBlendMode: 'screen',
              }} />
            </>
          )}

          {settings.chromaticAberration > 0 && (
            <>
              <div style={{
                position: 'absolute', inset: 0,
                background: `linear-gradient(to right, rgba(255,0,0,${(settings.chromaticAberration * 0.08).toFixed(3)}), transparent 12%)`,
                mixBlendMode: 'multiply',
              }} />
              <div style={{
                position: 'absolute', inset: 0,
                background: `linear-gradient(to left, rgba(0,0,255,${(settings.chromaticAberration * 0.08).toFixed(3)}), transparent 12%)`,
                mixBlendMode: 'lighten',
              }} />
            </>
          )}

          {settings.ghosting > 0 && (
            <>
              <div style={{
                position: 'absolute',
                inset: 0,
                transform: `translateX(${(1 + settings.ghosting * 2.2).toFixed(2)}px)`,
                borderLeft: `1px solid rgba(255,140,110,${(settings.ghosting * 0.2).toFixed(3)})`,
                boxShadow: `inset ${Math.round(settings.ghosting * 7)}px 0 ${Math.round(settings.ghosting * 10)}px rgba(255,120,90,${(settings.ghosting * 0.12).toFixed(3)})`,
                mixBlendMode: 'screen',
              }} />
              <div style={{
                position: 'absolute',
                inset: 0,
                transform: `translateX(-${(0.8 + settings.ghosting * 2).toFixed(2)}px)`,
                borderRight: `1px solid rgba(120,170,255,${(settings.ghosting * 0.2).toFixed(3)})`,
                boxShadow: `inset -${Math.round(settings.ghosting * 6)}px 0 ${Math.round(settings.ghosting * 10)}px rgba(110,160,255,${(settings.ghosting * 0.12).toFixed(3)})`,
                mixBlendMode: 'lighten',
              }} />
            </>
          )}

          {settings.vignette > 0 && (
            <div style={{
              position: 'absolute',
              inset: 0,
              background: `radial-gradient(ellipse at center, transparent ${Math.round((1 - settings.vignette) * 62)}%, rgba(0,0,0,${(settings.vignette * 0.88).toFixed(2)}) 100%)`,
            }} />
          )}

          <div style={{
            position: 'absolute',
            inset: 0,
            animation: settings.flicker > 0 ? `vhs-preview-flicker ${(0.18 + (1 - settings.flicker) * 0.18).toFixed(2)}s infinite` : 'none',
            opacity: 1,
          }} />
        </div>
      </div>

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
