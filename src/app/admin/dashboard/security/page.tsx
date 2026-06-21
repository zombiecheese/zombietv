'use client'

import { useState } from 'react'
import AdminShell from '@/components/admin/AdminShell'

export default function AdminSecurityPage() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage('')

    if (!currentPassword || !newPassword || !confirmPassword) {
      setMessage('Fill in all password fields.')
      return
    }
    if (newPassword.length < 8) {
      setMessage('New password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setMessage('New password and confirmation do not match.')
      return
    }

    setIsSaving(true)
    const r = await fetch('/api/admin/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    })
    const data = await r.json().catch(() => ({}))
    setIsSaving(false)

    if (!r.ok) {
      setMessage(String(data?.error ?? 'Could not change password.'))
      return
    }

    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setMessage('Admin password updated successfully.')
  }

  return (
    <AdminShell>
      <h2 style={h2}>Admin Security</h2>
      <p style={{ color: '#4a7fb5', fontSize: '0.8rem', margin: '0 0 18px' }}>
        Update the admin login password used on the dashboard sign-in page.
      </p>

      <form onSubmit={submit} style={card}>
        <div style={label}>Current Password</div>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          style={input}
          autoComplete="current-password"
          required
        />

        <div style={{ ...label, marginTop: 12 }}>New Password</div>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          style={input}
          autoComplete="new-password"
          minLength={8}
          required
        />

        <div style={{ ...label, marginTop: 12 }}>Confirm New Password</div>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          style={input}
          autoComplete="new-password"
          minLength={8}
          required
        />

        {message ? <div style={{ fontSize: '0.75rem', color: '#a8c4e0', marginTop: 12 }}>{message}</div> : null}

        <button type="submit" style={button} disabled={isSaving}>
          {isSaving ? 'UPDATING...' : 'UPDATE PASSWORD'}
        </button>
      </form>
    </AdminShell>
  )
}

const h2: React.CSSProperties = {
  margin: '0 0 8px',
  color: '#ff6600',
  fontSize: '1rem',
  letterSpacing: '0.08em',
  fontWeight: 700,
}

const card: React.CSSProperties = {
  backgroundColor: '#0a1628',
  border: '1px solid #1e3a5f',
  padding: '20px',
  maxWidth: 520,
}

const label: React.CSSProperties = {
  fontSize: '0.72rem',
  color: '#a8c4e0',
  marginBottom: 4,
}

const input: React.CSSProperties = {
  width: '100%',
  backgroundColor: '#07111f',
  color: '#e8f0fe',
  border: '1px solid #1e3a5f',
  padding: '9px 10px',
  fontSize: '0.82rem',
}

const button: React.CSSProperties = {
  marginTop: 16,
  backgroundColor: '#ff6600',
  color: '#fff',
  border: 'none',
  padding: '8px 14px',
  cursor: 'pointer',
  fontSize: '0.72rem',
  fontWeight: 700,
  letterSpacing: '0.06em',
}
