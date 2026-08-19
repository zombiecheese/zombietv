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

interface NavItem { href: string; label: string; icon: string }
interface NavGroup { title: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Programming',
    items: [
      { href: '/admin/dashboard',          label: 'Overview',         icon: '📊' },
      { href: '/admin/dashboard/schedule', label: 'Schedule Editor',  icon: '📅' },
      { href: '/admin/dashboard/stations', label: 'Station Rules',    icon: '📡' },
      { href: '/admin/dashboard/shows',    label: 'Show Progress',    icon: '🎬' },
    ],
  },
  {
    title: 'Content',
    items: [
      { href: '/admin/dashboard/catalog',  label: 'Plex Catalog',      icon: '🎞️' },
      { href: '/admin/dashboard/youtube',  label: 'Filler Content',    icon: '▶️'  },
      { href: '/admin/dashboard/holidays', label: 'Holiday Overrides', icon: '🎄' },
      { href: '/admin/dashboard/events',   label: 'Special Events',    icon: '⚡' },
    ],
  },
  {
    title: 'Presentation',
    items: [
      { href: '/admin/dashboard/vhs',      label: 'VHS / CRT Effects', icon: '📼' },
    ],
  },
  {
    title: 'System',
    items: [
      { href: '/admin/dashboard/security', label: 'Admin Security',   icon: '🔑' },
      { href: '/admin/dashboard/audit',    label: 'Audit Log',        icon: '📋' },
    ],
  },
]

const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)

interface Props { children: React.ReactNode }

export default function AdminShell({ children }: Props) {
  const router  = useRouter()
  const path    = usePathname()
  const [user, setUser]       = useState<{ username: string; email: string } | null>(null)
  const [checking, setCheck]  = useState(true)
  const [appName, setAppName] = useState('Zombie TV')

  useEffect(() => {
    fetch('/api/app-settings').then((r) => r.ok ? r.json() : null).then((d) => { if (d?.appName) setAppName(d.appName) }).catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    const probeSession = async () => {
      const delays = [0, 250, 750]
      for (const delay of delays) {
        if (delay > 0) await wait(delay)
        try {
          const res = await fetch('/api/auth/session', {
            credentials: 'include',
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' },
          })
          if (!res.ok) continue
          const d = await res.json()
          if (cancelled) return
          if (d?.isLoggedIn && d?.isAdmin) {
            setUser({ username: d.username, email: d.email })
            setCheck(false)
            return
          }
        } catch {
          // Retry once the cookie write settles.
        }
      }

      if (!cancelled) {
        router.replace('/admin')
        setCheck(false)
      }
    }

    probeSession()
    return () => { cancelled = true }
  }, [router])

  const handleLogout = useCallback(async () => {
    await fetch('/api/admin/logout', { method: 'POST' })
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
            {appName.toUpperCase()}
          </span>
          <span style={{ color: '#4a7fb5', fontSize: '0.55rem', letterSpacing: '0.15em', marginTop: 2 }}>
            BROADCAST MANAGEMENT
          </span>
        </div>

        <nav style={{ flex: 1, overflowY: 'auto', paddingTop: 6 }}>
          {NAV_GROUPS.map((group) => (
            <div key={group.title} style={{ marginBottom: 10 }}>
              <div style={shell.navGroupTitle}>{group.title.toUpperCase()}</div>
              {group.items.map((item) => {
                const active = path === item.href || (item.href !== '/admin/dashboard' && path.startsWith(item.href))
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    style={{
                      ...shell.navItem,
                      backgroundColor: active ? '#1a3a6e' : 'transparent',
                      borderLeft:      active ? '3px solid #ff6600' : '3px solid transparent',
                      color:           active ? '#fff' : '#7c9cc4',
                    }}
                  >
                    <span style={{ fontSize: '0.85rem', width: 20, textAlign: 'center', opacity: active ? 1 : 0.75 }}>{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                )
              })}
            </div>
          ))}
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
            {[...NAV].sort((a, b) => b.href.length - a.href.length).find((n) => path.startsWith(n.href))?.label ?? 'Admin'}
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
    padding:         '9px 16px',
    textDecoration:  'none',
    fontSize:        '0.75rem',
    transition:      'background-color 0.1s',
    cursor:          'pointer',
  } as React.CSSProperties,

  navGroupTitle: {
    padding:       '10px 16px 4px',
    color:         '#3a5a85',
    fontSize:      '0.56rem',
    fontWeight:    700,
    letterSpacing: '0.2em',
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
