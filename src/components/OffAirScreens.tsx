'use client'

// Off-air screens: PM5544-inspired test card (the PAL/Australian classic),
// the saturated VCR blue screen, and full-screen analog static.

import { useEffect, useRef, useState } from 'react'
import { OSD_FONT_FAMILY, OSD_WHITE, osdOutline } from '@/lib/osd-style'

// ─── PM5544-style test card ──────────────────────────────────────────────────

export function TestCardScreen({ ident }: { ident: string }) {
  const [clock, setClock] = useState('')

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  const bars = ['#ffffff', '#ffff00', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#0000ff']

  return (
    <div style={{ position: 'absolute', inset: 0, backgroundColor: '#1a1a1a', overflow: 'hidden' }}>
      {/* Background grid */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'linear-gradient(to right, #e8e8e8 1px, transparent 1px), linear-gradient(to bottom, #e8e8e8 1px, transparent 1px)',
        backgroundSize: '7.5% 10%',
        opacity: 0.5,
      }} />

      {/* Central circle */}
      <div style={{
        position: 'absolute',
        left: '50%', top: '50%',
        width: 'min(88vh, 88vw)', height: 'min(88vh, 88vw)',
        transform: 'translate(-50%, -50%)',
        borderRadius: '50%',
        border: '3px solid #fff',
        backgroundColor: '#3a3a3a',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Ident strip */}
        <div style={{ flex: 2.2, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}>
          <span style={{ fontFamily: OSD_FONT_FAMILY, color: OSD_WHITE, fontWeight: 700, fontSize: 'clamp(1.2rem, 4vmin, 2.6rem)', letterSpacing: '0.25em' }}>
            {ident}
          </span>
        </div>
        {/* Colour bars */}
        <div style={{ flex: 3, display: 'flex' }}>
          {bars.map((c) => <div key={c} style={{ flex: 1, backgroundColor: c }} />)}
        </div>
        {/* Greyscale steps */}
        <div style={{ flex: 1.4, display: 'flex' }}>
          {['#000', '#333', '#666', '#999', '#ccc', '#fff'].map((c) => <div key={c} style={{ flex: 1, backgroundColor: c }} />)}
        </div>
        {/* Frequency gratings */}
        <div style={{ flex: 1.4, background: 'repeating-linear-gradient(to right, #000 0 2px, #fff 2px 4px)' }} />
        {/* Clock strip */}
        <div style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}>
          <span style={{ fontFamily: OSD_FONT_FAMILY, color: OSD_WHITE, fontWeight: 700, fontSize: 'clamp(1rem, 3.4vmin, 2.2rem)', letterSpacing: '0.2em' }}>
            {clock}
          </span>
        </div>
      </div>

      {/* Corner castellations */}
      {[['0', '0'], ['auto', '0'], ['0', 'auto'], ['auto', 'auto']].map(([r, b], i) => (
        <div key={i} style={{
          position: 'absolute',
          top: r === '0' ? 0 : 'auto', bottom: b === '0' ? 0 : (r === 'auto' && b === 'auto' ? 0 : 'auto'),
          left: i % 2 === 0 ? 0 : 'auto', right: i % 2 === 1 ? 0 : 'auto',
          width: '12%', height: '6%',
          background: 'repeating-linear-gradient(to right, #fff 0 25%, #000 25% 50%)',
        }} />
      ))}
    </div>
  )
}

// ─── VCR blue screen ─────────────────────────────────────────────────────────

export function BlueScreen({ message }: { message: string }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      backgroundColor: '#0000c8',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <span style={{
        fontFamily: OSD_FONT_FAMILY,
        color: '#fff',
        fontWeight: 700,
        fontSize: 'clamp(1.2rem, 4vmin, 2.4rem)',
        letterSpacing: '0.3em',
        textShadow: osdOutline(2, 'rgba(0,0,0,0.4)'),
      }}>
        {message}
      </span>
    </div>
  )
}

// ─── Analog static (dead channel) ────────────────────────────────────────────

export function StaticScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      canvas.width = Math.max(1, Math.floor(window.innerWidth / 3))
      canvas.height = Math.max(1, Math.floor(window.innerHeight / 3))
    }
    resize()
    window.addEventListener('resize', resize)

    let raf = 0
    const draw = () => {
      const image = ctx.createImageData(canvas.width, canvas.height)
      const d = image.data
      for (let i = 0; i < d.length; i += 4) {
        const v = Math.random() * 255
        d[i] = v
        d[i + 1] = v
        d[i + 2] = v
        d[i + 3] = 255
      }
      ctx.putImageData(image, 0, 0)
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: 'pixelated' }}
    />
  )
}
