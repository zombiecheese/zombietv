'use client'

// VHSOverlay — viewport-wide CRT/VHS effect
// Layers (bottom -> top):
//   1. Scanlines
//   2. Noise canvas
//   3. Vignette
//   4. Tracking noise roll
//   5. Chromatic aberration
//   6. Ghosting

import { useEffect, useRef, useState } from 'react'
import type { VHSSettings } from '@/lib/vhs-defaults'

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
    ghosting,
    trackingNoise,
    horizontalJitter,
  } = settings

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [jitterPx, setJitterPx] = useState(0)

  useEffect(() => {
    if (horizontalJitter <= 0) {
      setJitterPx(0)
      return
    }

    const id = setInterval(() => {
      const maxPx = Math.max(0.2, horizontalJitter * 2.2)
      setJitterPx((Math.random() * 2 - 1) * maxPx)
    }, 70)

    return () => clearInterval(id)
  }, [horizontalJitter])

  useEffect(() => {
    if (noise <= 0) return
    const canvasRefValue = canvasRef.current
    if (!canvasRefValue) return
    const canvasEl: HTMLCanvasElement = canvasRefValue

    const ctxRefValue = canvasEl.getContext('2d', { alpha: true, willReadFrequently: false })
    if (!ctxRefValue) return
    const ctx: CanvasRenderingContext2D = ctxRefValue

    function resize() {
      canvasEl.width = Math.max(1, Math.floor(window.innerWidth / 3))
      canvasEl.height = Math.max(1, Math.floor(window.innerHeight / 3))
    }

    function drawNoise() {
      const w = canvasEl.width
      const h = canvasEl.height
      const imageData = ctx.createImageData(w, h)
      const d = imageData.data
      const alpha = Math.floor(noise * 24)

      for (let i = 0; i < d.length; i += 4) {
        const v = Math.floor(80 + Math.random() * 100)
        d[i] = v
        d[i + 1] = v
        d[i + 2] = v
        d[i + 3] = Math.floor(Math.random() * alpha)
      }

      ctx.putImageData(imageData, 0, 0)
    }

    resize()
    drawNoise()
    window.addEventListener('resize', resize)
    const timer = setInterval(drawNoise, 80)

    return () => {
      clearInterval(timer)
      window.removeEventListener('resize', resize)
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height)
    }
  }, [noise])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9999,
        overflow: 'hidden',
        transform: horizontalJitter > 0 ? `translateX(${jitterPx.toFixed(2)}px)` : 'none',
        animation: flicker > 0 ? `vhs-flicker ${0.15 + (1 - flicker) * 0.15}s infinite` : 'none',
      }}
    >
      <style>{`
        @keyframes vhs-flicker {
          0%, 8%, 12%, 20%, 56%, 100% { opacity: 1; }
          9%, 21%, 57% { opacity: ${Math.max(0.78, 1 - flicker * 0.55)}; }
        }

        @keyframes vhs-tracking-roll {
          0% { transform: translateY(-130%); }
          100% { transform: translateY(130%); }
        }
      `}</style>

      {scanlines > 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: [
              'repeating-linear-gradient(',
              'to bottom,',
              `rgba(0,0,0,${(scanlines * 0.45).toFixed(3)}) 0px,`,
              `rgba(0,0,0,${(scanlines * 0.45).toFixed(3)}) 1px,`,
              'transparent 1px,',
              'transparent 4px',
              ')',
            ].join(''),
          }}
        />
      )}

      {noise > 0 && (
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            imageRendering: 'pixelated',
            mixBlendMode: 'screen',
            opacity: Math.min(noise * 0.18, 0.3),
          }}
        />
      )}

      {vignette > 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(ellipse at center, transparent ${Math.round((1 - vignette) * 60)}%, rgba(0,0,0,${(vignette * 0.85).toFixed(2)}) 100%)`,
          }}
        />
      )}

      {trackingNoise > 0 && (
        <>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `repeating-linear-gradient(to bottom, transparent 0px, transparent 13px, rgba(180,220,255,${(trackingNoise * 0.05).toFixed(3)}) 13px, rgba(180,220,255,${(trackingNoise * 0.05).toFixed(3)}) 14px)`,
              opacity: 0.8,
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              height: '28%',
              background: `linear-gradient(to bottom, transparent 0%, rgba(255,255,255,${(trackingNoise * 0.07).toFixed(3)}) 45%, rgba(35,90,160,${(trackingNoise * 0.16).toFixed(3)}) 65%, transparent 100%)`,
              animation: 'vhs-tracking-roll 4.5s linear infinite',
              mixBlendMode: 'screen',
            }}
          />
        </>
      )}

      {chromaticAberration > 0 && (
        <>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(to right, rgba(255,0,0,${(chromaticAberration * 0.06).toFixed(3)}), transparent 10%)`,
              mixBlendMode: 'multiply',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(to left, rgba(0,0,255,${(chromaticAberration * 0.06).toFixed(3)}), transparent 10%)`,
              mixBlendMode: 'lighten',
            }}
          />
        </>
      )}

      {ghosting > 0 && (
        <>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              transform: `translateX(${(1 + ghosting * 2.2).toFixed(2)}px)`,
              borderLeft: `1px solid rgba(255,140,110,${(ghosting * 0.2).toFixed(3)})`,
              boxShadow: `inset ${Math.round(ghosting * 7)}px 0 ${Math.round(ghosting * 10)}px rgba(255,120,90,${(ghosting * 0.12).toFixed(3)})`,
              mixBlendMode: 'screen',
              opacity: 0.5,
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              transform: `translateX(-${(0.8 + ghosting * 2).toFixed(2)}px)`,
              borderRight: `1px solid rgba(120,170,255,${(ghosting * 0.2).toFixed(3)})`,
              boxShadow: `inset -${Math.round(ghosting * 6)}px 0 ${Math.round(ghosting * 10)}px rgba(110,160,255,${(ghosting * 0.12).toFixed(3)})`,
              mixBlendMode: 'screen',
              opacity: 0.45,
            }}
          />
        </>
      )}
    </div>
  )
}
