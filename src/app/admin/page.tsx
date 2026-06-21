// Admin Portal — Login gate
// POSTs to /api/admin/login (bcrypt). On success redirects to /admin/dashboard.
// If a valid session already exists, redirects immediately.

'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function Admin() {
  const router = useRouter()
  const [creds, setCreds]     = useState({ email: '', password: '' })
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setCheck]  = useState(true)

  // If already logged in as admin, skip straight to dashboard
  useEffect(() => {
    fetch('/api/auth/session')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.isLoggedIn && d?.isAdmin) router.replace('/admin/dashboard') })
      .catch(() => {})
      .finally(() => setCheck(false))
  }, [router])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res  = await fetch('/api/admin/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(creds),
      })
      const data = await res.json()
      if (res.ok) {
        router.replace('/admin/dashboard')
      } else {
        setError(data.error ?? 'Invalid credentials')
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div style={{ position: 'fixed', inset: 0, backgroundColor: '#0a1628',
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#4a7fb5', fontSize: '0.8rem', letterSpacing: '0.2em' }}>LOADING…</span>
      </div>
    )
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: '#060f1e',
      color: '#fff', display: 'flex', alignItems: 'center',
      justifyContent: 'center', flexDirection: 'column', gap: 20,
      fontFamily: 'Arial, sans-serif',
    }}>
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <div style={{ color: '#ff6600', fontWeight: 900, fontSize: '1.4rem', letterSpacing: '0.15em' }}>
          ZOMBIE TV
        </div>
        <div style={{ color: '#4a7fb5', fontSize: '0.65rem', letterSpacing: '0.2em', marginTop: 4 }}>
          BROADCAST MANAGEMENT PORTAL
        </div>
      </div>

      <form onSubmit={handleLogin} style={{
        display: 'flex', flexDirection: 'column', gap: 12,
        width: '100%', maxWidth: 340,
        backgroundColor: '#0a1628', padding: 28,
        border: '1px solid #1e3a5f',
      }}>
        <input
          type="email" placeholder="Admin email" required autoFocus
          value={creds.email}
          onChange={(e) => setCreds({ ...creds, email: e.target.value })}
          style={inp}
        />
        <input
          type="password" placeholder="Password" required
          value={creds.password}
          onChange={(e) => setCreds({ ...creds, password: e.target.value })}
          style={inp}
        />
        {error && <p style={{ margin: 0, color: '#ff4444', fontSize: '0.78rem' }}>{error}</p>}
        <button type="submit" disabled={loading} style={{
          padding: '10px 0', backgroundColor: loading ? '#555' : '#ff6600',
          color: '#fff', border: 'none', cursor: loading ? 'default' : 'pointer',
          fontWeight: 700, fontSize: '0.85rem', letterSpacing: '0.1em',
        }}>
          {loading ? 'SIGNING IN…' : 'SIGN IN'}
        </button>
      </form>

      <Link href="/" style={{ color: '#1e3a5f', fontSize: '0.65rem', textDecoration: 'none' }}>
        ← Back to TV
      </Link>
    </div>
  )
}

const inp: React.CSSProperties = {
  padding: '9px 10px', backgroundColor: '#060f1e',
  border: '1px solid #1e3a5f', color: '#fff',
  fontSize: '0.85rem', outline: 'none', width: '100%',
  boxSizing: 'border-box',
}
