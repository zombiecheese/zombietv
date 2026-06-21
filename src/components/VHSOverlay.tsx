'use client'

// VHSOverlay — viewport-wide CRT/VHS effect
// All intensities are driven by the VHSSettings fetched from /api/vhs-settings
// and surfaced through the useVHSSettings hook. Defaults are used on first load.
//
// Layers (bottom → top):
//   1. Scanlines          — repeating-linear-gradient
//   2. Noise canvas       — random pixel noise, re-drawn on interval
//   3. Vignette           — radial-gradient darkening at edges
//   4. Chromatic fringes  — thin red/blue offset divs (mix-blend: screen)
//   5. CRT curvature      — applied via SVG filter on the parent in layout.tsx

import { useEffect, useRef } from 'react'
import type { VHSSettings }  from '@/hooks/useVHSSettings'

interface Props {
  settings: VHSSettings
}

export default function VHSOverlay({ settings }: Props) {
  const {
    scanlines,
    noise,
    chromaticAberration,
    vignette,
    flicker,
  } = settings

  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Draw random noise onto the canvas every 80ms (≈12fps — authentic VHS speed)
  useEffect(() => {
    if (noise <= 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: false })
    if (!ctx) return

    function resize() {
      if (!canvas) return
      // Use a reduced resolution for performance (1/3 of screen pixels for better quality)
      canvas.width  = Math.floor(window.innerWidth  / 3)
      canvas.height = Math.floor(window.innerHeight / 3)
    }
    resize()
    window.addEventListener('resize', resize)

    let frameId: ReturnType<typeof setInterval>

    function drawNoise() {
      if (!canvas || !ctx) return
      const w = canvas.width
      const h = canvas.height
      
      // Create fresh imageData to avoid any state artifacts
      const imageData = ctx.createImageData(w, h)
      const d = imageData.data
      // More conservative alpha to reduce visual harshness of noise
      const alpha = Math.floor(noise * 24)

      for (let i = 0; i < d.length; i += 4) {
        // Use mid-tone grayscale with tighter variance for subtler grain
        const v  = Math.floor(80 + Math.random() * 100)
        d[i]     = v
        d[i + 1] = v
        d[i + 2] = v
        d[i + 3] = Math.floor(Math.random() * alpha)
      }
      ctx.putImageData(imageData, 0, 0)
    }

    drawNoise()
    frameId = setInterval(drawNoise, 80)

    return () => {
      clearInterval(frameId)
      window.removeEventListener('resize', resize)
      // Clean up canvas on unmount
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [noise])

  return (
    <div style={{
      position:      'fixed',
      inset:         0,
      pointerEvents: 'none',
      zIndex:        9999,
      overflow:      'hidden',
      animation:     flicker > 0 ? `vhs-flicker ${0.15 + (1 - flicker) * 0.15}s infinite` : 'none',
    }}>
      <style>{`
        @keyframes vhs-flicker {
          0%, 19%, 21%, 23%, 25%, 54%, 56%, 100% { opacity: 1; }
          20%, 24%, 55% { opacity: ${Math.max(0.8, 1 - flicker * 0.5)}; }
        }
      `}</style>

      {/* 1. Scanlines */}
      {scanlines > 0 && (
        <div style={{
          position: 'absolute',
          inset:    0,
          background: [
            `repeating-linear-gradient(`,
            `  to bottom,`,
            `  rgba(0,0,0,${(scanlines * 0.45).toFixed(3)}) 0px,`,
            `  rgba(0,0,0,${(scanlines * 0.45).toFixed(3)}) 1px,`,
            `  transparent 1px,`,
            `  transparent 4px`,
            `)`,
          ].join(''),
          pointerEvents: 'none',
        }} />
      )}

      {/* 2. Noise canvas — stretched to viewport via CSS */}
      {noise > 0 && (
        <canvas
          ref={canvasRef}
          style={{
            position:        'absolute',
            inset:           0,
            width:           '100%',
            height:          '100%',
            imageRendering:  'pixelated',
            mixBlendMode:    'screen',
            opacity:         Math.min(noise * 0.18, 0.3),
            pointerEvents:   'none',
          }}
        />
      )}

      {/* 3. Vignette */}
      {vignette > 0 && (
        <div style={{
          position: 'absolute',
          inset:    0,
          background: `radial-gradient(ellipse at center, transparent ${Math.round((1 - vignette) * 60)}%, rgba(0,0,0,${(vignette * 0.85).toFixed(2)}) 100%)`,
          pointerEvents: 'none',
        }} />
      )}

      {/* 4. Chromatic aberration — red fringe left, blue fringe right */}
      {chromaticAberration > 0 && (
        <>
          <div style={{
            position:   'absolute',
            inset:      0,
            background: `linear-gradient(to right, rgba(255,0,0,${(chromaticAberration * 0.06).toFixed(3)}), transparent 10%)`,
            mixBlendMode: 'multiply',
            pointerEvents: 'none',
          }} />
          <div style={{
            position:   'absolute',
            inset:      0,
            background: `linear-gradient(to left, rgba(0,0,255,${(chromaticAberration * 0.06).toFixed(3)}), transparent 10%)`,
            mixBlendMode: 'lighten',
            pointerEvents: 'none',
          }} />
        </>
      )}

    </div>
  )
}
