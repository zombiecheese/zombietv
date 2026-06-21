'use client'

// AdminShell — wraps every admin dashboard page.
// Provides:
//   - Session guard: redirects to /admin if not logged in
//   - Sidebar navigation
//   - Top header with user info + logout
//   - Consistent dark-blue admin chrome

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

const NAV = [
  { href: '/admin/dashboard',          label: 'Overview',        icon: '📊' },
  { href: '/admin/dashboard/schedule', label: 'Schedule Editor', icon: '📅' },
  { href: '/admin/dashboard/stations', label: 'Station Rules',   icon: '📡' },
  { href: '/admin/dashboard/youtube',  label: 'YouTube Pool',    icon: '▶️'  },
  { href: '/admin/dashboard/holidays', label: 'Holiday Overrides', icon: '🎄' },
  { href: '/admin/dashboard/events',   label: 'Special Events',  icon: '⚡' },
  { href: '/admin/dashboard/catalog',  label: 'Plex Catalog',    icon: '🎞️' },
  { href: '/admin/dashboard/shows',    label: 'Show Progress',   icon: '🎬' },
  { href: '/admin/dashboard/vhs',      label: 'VHS / CRT Effects', icon: '📼' },
  { href: '/admin/dashboard/audit',    label: 'Audit Log',       icon: '📋' },
]

interface Props { children: React.ReactNode }

export default function AdminShell({ children }: Props) {
  const router  = useRouter()
  const path    = usePathname()
  const [user, setUser]       = useState<{ username: string; email: string } | null>(null)
  const [checking, setCheck]  = useState(true)

  useEffect(() => {
    fetch('/api/auth/session')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d?.isLoggedIn || !d?.isAdmin) {
          router.replace('/admin')
        } else {
          setUser({ username: d.username, email: d.email })
        }
      })
      .catch(() => router.replace('/admin'))
      .finally(() => setCheck(false))
  }, [router])

  const handleLogout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/admin')
  }, [router])

  if (checking) {
    return (
      <div style={shell.loading}>
        <span style={{ color: '#4a7fb5', fontSize: '0.8rem', letterSpacing: '0.2em' }}>
          VERIFYING SESSION…
        </span>
      </div>
    )
  }

  return (
    <div style={shell.root}>
      {/* ── Sidebar ── */}
      <aside style={shell.sidebar}>
        <div style={shell.logo}>
          <span style={{ color: '#ff6600', fontWeight: 900, fontSize: '1.1rem', letterSpacing: '0.1em' }}>
            ZOMBIE TV
          </span>
          <span style={{ color: '#4a7fb5', fontSize: '0.55rem', letterSpacing: '0.15em', marginTop: 2 }}>
            BROADCAST MANAGEMENT
          </span>
        </div>

        <nav style={{ flex: 1, overflowY: 'auto' }}>
          {NAV.map((item) => {
            const active = path === item.href || (item.href !== '/admin/dashboard' && path.startsWith(item.href))
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  ...shell.navItem,
                  backgroundColor: active ? '#1a3a6e' : 'transparent',
                  borderLeft:      active ? '3px solid #ff6600' : '3px solid transparent',
                  color:           active ? '#fff' : '#4a7fb5',
                }}
              >
                <span style={{ fontSize: '0.9rem', width: 20, textAlign: 'center' }}>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>

        <div style={shell.sidebarFooter}>
          <Link href="/" style={{ color: '#4a7fb5', fontSize: '0.65rem', textDecoration: 'none' }}>
            ← Back to TV
          </Link>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div style={shell.main}>
        {/* Top bar */}
        <header style={shell.topbar}>
          <span style={{ color: '#a8c4e0', fontSize: '0.75rem' }}>
            {NAV.find((n) => path.startsWith(n.href))?.label ?? 'Admin'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {user && (
              <span style={{ color: '#4a7fb5', fontSize: '0.7rem' }}>
                {user.username ?? user.email}
              </span>
            )}
            <button onClick={handleLogout} style={shell.logoutBtn}>
              LOG OUT
            </button>
          </div>
        </header>

        {/* Page content */}
        <div style={shell.content}>
          {children}
        </div>
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const shell = {
  root: {
    display:         'flex',
    width:           '100vw',
    height:          '100vh',
    backgroundColor: '#060f1e',
    color:           '#fff',
    fontFamily:      'Arial, sans-serif',
    overflow:        'hidden',
  } as React.CSSProperties,

  sidebar: {
    width:           220,
    flexShrink:      0,
    backgroundColor: '#0a1628',
    borderRight:     '1px solid #1e3a5f',
    display:         'flex',
    flexDirection:   'column' as const,
    height:          '100vh',
  } as React.CSSProperties,

  logo: {
    padding:         '20px 16px 16px',
    borderBottom:    '1px solid #1e3a5f',
    display:         'flex',
    flexDirection:   'column' as const,
    gap:             4,
  } as React.CSSProperties,

  navItem: {
    display:         'flex',
    alignItems:      'center',
    gap:             10,
    padding:         '10px 16px',
    textDecoration:  'none',
    fontSize:        '0.75rem',
    transition:      'background-color 0.1s',
    cursor:          'pointer',
  } as React.CSSProperties,

  sidebarFooter: {
    padding:      '12px 16px',
    borderTop:    '1px solid #1e3a5f',
  } as React.CSSProperties,

  main: {
    flex:            1,
    display:         'flex',
    flexDirection:   'column' as const,
    overflow:        'hidden',
    minWidth:        0,
  } as React.CSSProperties,

  topbar: {
    height:          48,
    flexShrink:      0,
    backgroundColor: '#0a1628',
    borderBottom:    '1px solid #1e3a5f',
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'space-between',
    padding:         '0 24px',
    letterSpacing:   '0.05em',
    fontSize:        '0.75rem',
  } as React.CSSProperties,

  content: {
    flex:       1,
    overflowY:  'auto' as const,
    padding:    24,
  } as React.CSSProperties,

  loading: {
    position:        'fixed' as const,
    inset:           0,
    backgroundColor: '#060f1e',
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'center',
  } as React.CSSProperties,

  logoutBtn: {
    background:    'none',
    border:        '1px solid #1e3a5f',
    color:         '#4a7fb5',
    fontSize:      '0.6rem',
    letterSpacing: '0.12em',
    padding:       '4px 10px',
    cursor:        'pointer',
  } as React.CSSProperties,
}
