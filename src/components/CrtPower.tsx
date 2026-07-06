'use client'

// CrtPower — CRT power-on / power-off animation.
// On: a white horizontal line expands from the centre with a bloom flash.
// Off: the picture collapses to a bright centre dot that fades.
// Power-off is triggered by dispatching the 'zombietv-power-off' window event;
// 'zombietv-power-off-done' fires when the collapse completes.

import { useEffect, useState } from 'react'

const ON_DURATION_MS = 700
const OFF_DURATION_MS = 650

type Phase = 'on' | 'off' | 'idle'

export default function CrtPower() {
  const [phase, setPhase] = useState<Phase>('on')

  // Power-on plays once on mount.
  useEffect(() => {
    const t = setTimeout(() => setPhase('idle'), ON_DURATION_MS)
    return () => clearTimeout(t)
  }, [])

  // Power-off on demand.
  useEffect(() => {
    const onPowerOff = () => {
      setPhase('off')
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('zombietv-power-off-done'))
      }, OFF_DURATION_MS)
    }
    window.addEventListener('zombietv-power-off', onPowerOff)
    return () => window.removeEventListener('zombietv-power-off', onPowerOff)
  }, [])

  if (phase === 'idle') return null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10010, pointerEvents: phase === 'off' ? 'auto' : 'none', backgroundColor: phase === 'off' ? 'transparent' : undefined }}>
      <style>{`
        @keyframes crt-on-mask {
          0%   { clip-path: inset(50% 50% 50% 50%); }
          35%  { clip-path: inset(49.6% 0% 49.6% 0%); }
          70%  { clip-path: inset(46% 0% 46% 0%); }
          100% { clip-path: inset(0% 0% 0% 0%); }
        }
        @keyframes crt-on-flash {
          0% { opacity: 1; }
          40% { opacity: 0.85; }
          100% { opacity: 0; }
        }
        @keyframes crt-off-collapse {
          0%   { clip-path: inset(0% 0% 0% 0%); background: transparent; }
          45%  { clip-path: inset(49.4% 0% 49.4% 0%); background: #000; }
          75%  { clip-path: inset(49.7% 46% 49.7% 46%); background: #000; }
          100% { clip-path: inset(50% 50% 50% 50%); background: #000; }
        }
        @keyframes crt-off-dot {
          0%, 40% { opacity: 0; }
          55% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes crt-off-black {
          0%, 50% { opacity: 0; }
          75%, 100% { opacity: 1; }
        }
      `}</style>

      {phase === 'on' && (
        <>
          {/* Black mask that opens from a centre line */}
          <div style={{
            position: 'absolute', inset: 0, backgroundColor: '#000',
            animation: `crt-on-mask ${ON_DURATION_MS}ms cubic-bezier(0.2, 0.7, 0.3, 1) forwards`,
            // invert: mask covers everything EXCEPT the clip region — implement as two bars
            display: 'none',
          }} />
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '50%', backgroundColor: '#000', transformOrigin: 'top', animation: `crt-open-top ${ON_DURATION_MS}ms cubic-bezier(0.25, 0.8, 0.3, 1) forwards` }} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '50%', backgroundColor: '#000', transformOrigin: 'bottom', animation: `crt-open-bottom ${ON_DURATION_MS}ms cubic-bezier(0.25, 0.8, 0.3, 1) forwards` }} />
          <style>{`
            @keyframes crt-open-top { 0% { transform: scaleY(1); } 30% { transform: scaleY(0.992); } 100% { transform: scaleY(0); } }
            @keyframes crt-open-bottom { 0% { transform: scaleY(1); } 30% { transform: scaleY(0.992); } 100% { transform: scaleY(0); } }
          `}</style>
          {/* Bright centre line / bloom flash */}
          <div style={{
            position: 'absolute', left: 0, right: 0, top: '50%', height: 3, marginTop: -1.5,
            background: '#fff', boxShadow: '0 0 26px 7px rgba(255,255,255,0.95), 0 0 80px 30px rgba(200,220,255,0.5)',
            animation: `crt-on-flash ${ON_DURATION_MS}ms ease-out forwards`,
          }} />
        </>
      )}

      {phase === 'off' && (
        <>
          {/* Blackout that closes to a line */}
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '50%', backgroundColor: '#000', transformOrigin: 'top', animation: `crt-close-top ${OFF_DURATION_MS * 0.6}ms cubic-bezier(0.6, 0, 0.9, 0.4) forwards` }} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '50%', backgroundColor: '#000', transformOrigin: 'bottom', animation: `crt-close-bottom ${OFF_DURATION_MS * 0.6}ms cubic-bezier(0.6, 0, 0.9, 0.4) forwards` }} />
          <style>{`
            @keyframes crt-close-top { 0% { transform: scaleY(0); } 100% { transform: scaleY(1); } }
            @keyframes crt-close-bottom { 0% { transform: scaleY(0); } 100% { transform: scaleY(1); } }
          `}</style>
          {/* Collapsing bright line → dot */}
          <div style={{
            position: 'absolute', left: 0, right: 0, top: '50%', height: 2, marginTop: -1,
            background: '#fff', boxShadow: '0 0 20px 5px rgba(255,255,255,0.9)',
            animation: `crt-line-shrink ${OFF_DURATION_MS}ms ease-in forwards`,
          }} />
          <style>{`
            @keyframes crt-line-shrink {
              0% { transform: scaleX(1); opacity: 1; }
              55% { transform: scaleX(1); opacity: 1; }
              85% { transform: scaleX(0.02); opacity: 1; }
              100% { transform: scaleX(0.001); opacity: 0; }
            }
          `}</style>
        </>
      )}
    </div>
  )
}
