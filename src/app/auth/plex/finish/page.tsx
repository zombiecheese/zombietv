'use client'

import { useEffect, useState } from 'react'

export default function PlexFinishPage() {
  const [message, setMessage] = useState('Finalizing Plex sign-in...')

  useEffect(() => {
    let cancelled = false

    const finalize = async () => {
      const url = new URL(window.location.href)
      const pinID = url.searchParams.get('pinID')

      if (!pinID) {
        if (!cancelled) {
          setMessage('Missing sign-in token. Redirecting...')
          window.setTimeout(() => window.location.replace('/?auth=error&reason=missing_pin'), 600)
        }
        return
      }

      try {
        const completeRes = await fetch('/api/auth/plex/complete', {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
          },
          body: JSON.stringify({ pinID }),
        })

        if (!completeRes.ok) {
          if (!cancelled) {
            setMessage('Plex sign-in could not be completed. Redirecting...')
            window.setTimeout(() => window.location.replace('/?auth=error&reason=pin_not_authed'), 900)
          }
          return
        }

        // Verify the final session is readable before redirecting.
        const sessionRes = await fetch('/api/auth/session', {
          credentials: 'include',
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        })
        const sessionData = sessionRes.ok ? await sessionRes.json().catch(() => null) : null

        if (sessionData?.isLoggedIn) {
          if (!cancelled) {
            setMessage('Sign-in complete. Launching stream...')
            window.setTimeout(() => window.location.replace('/'), 300)
          }
          return
        }

        if (!cancelled) {
          setMessage('Session not available yet. Retrying...')
          window.setTimeout(() => window.location.reload(), 800)
        }
      } catch {
        if (!cancelled) {
          setMessage('Network issue while finalizing sign-in. Redirecting...')
          window.setTimeout(() => window.location.replace('/?auth=error&reason=network'), 900)
        }
      }
    }

    finalize()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(circle at 30% 20%, #102a4d 0%, #050a14 55%, #000 100%)',
        color: '#d8e7ff',
        fontFamily: 'Arial, sans-serif',
        letterSpacing: '0.08em',
        fontSize: '0.82rem',
        textTransform: 'uppercase',
      }}
    >
      {message}
    </div>
  )
}
