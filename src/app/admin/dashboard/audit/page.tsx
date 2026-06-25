'use client'

import { useState, useEffect, useCallback } from 'react'
import AdminShell from '@/components/admin/AdminShell'

interface AuditEntry { id: string; slotId: string; scheduleId: string; reason: string; createdAt: string; user: string; oldContent: Record<string, unknown>; newContent: Record<string, unknown> }
interface AuditResponse { total: number; page: number; limit: number; entries: AuditEntry[] }

export default function AuditPage() {
  const [data,    setData]    = useState<AuditResponse | null>(null)
  const [page,    setPage]    = useState(1)
  const [loading, setLoading] = useState(false)
  const [expand,  setExpand]  = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch(`/api/admin/audit?page=${page}&limit=50`)
    setData(await r.json())
    setLoading(false)
  }, [page])

  useEffect(() => { load() }, [load])

  const totalPages = data ? Math.ceil(data.total / data.limit) : 1

  return (
    <AdminShell>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={h2}>Audit Log</h2>
          <p style={sub}>{data ? `${data.total} total changes recorded.` : 'Loading…'}</p>
        </div>
        <button onClick={load} style={btn}>⟳ Refresh</button>
      </div>

      {loading && <p style={{ color: '#4a7fb5', fontSize: '0.78rem' }}>Loading…</p>}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e3a5f', color: '#4a7fb5' }}>
              {['Time','User','Reason','Slot','Detail'].map(h => (
                <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.entries.map(e => (
              <>
                <tr
                  key={e.id}
                  onClick={() => setExpand(expand === e.id ? null : e.id)}
                  style={{ borderBottom: '1px solid #0d1f3c', cursor: 'pointer', backgroundColor: expand === e.id ? '#0a1628' : 'transparent' }}
                >
                  <td style={td}>{new Date(e.createdAt).toLocaleString('en-AU',{dateStyle:'short',timeStyle:'short'})}</td>
                  <td style={td}>{e.user}</td>
                  <td style={{ ...td, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.reason}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: '0.65rem', color: '#1e3a5f' }}>{e.slotId.slice(0, 8)}…</td>
                  <td style={td}><span style={{ color: '#4a7fb5' }}>▶</span></td>
                </tr>
                {expand === e.id && (
                  <tr key={`${e.id}-expand`} style={{ backgroundColor: '#060f1e' }}>
                    <td colSpan={5} style={{ padding: '10px 16px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <div>
                          <div style={{ color: '#4a7fb5', fontSize: '0.65rem', marginBottom: 6, letterSpacing: '0.1em' }}>BEFORE</div>
                          <pre style={{ margin: 0, color: '#a8c4e0', fontSize: '0.7rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                            {JSON.stringify(e.oldContent, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <div style={{ color: '#ff6600', fontSize: '0.65rem', marginBottom: 6, letterSpacing: '0.1em' }}>AFTER</div>
                          <pre style={{ margin: 0, color: '#a8c4e0', fontSize: '0.7rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                            {JSON.stringify(e.newContent, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
            {!loading && data?.entries.length === 0 && (
              <tr><td colSpan={5} style={{ ...td, color: '#4a7fb5', fontStyle: 'italic' }}>No changes recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 20, alignItems: 'center' }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={pgBtn}>← Prev</button>
          <span style={{ color: '#4a7fb5', fontSize: '0.75rem' }}>Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={pgBtn}>Next →</button>
        </div>
      )}
    </AdminShell>
  )
}

const h2: React.CSSProperties = { margin: 0, color: '#ff6600', fontSize: '1rem', letterSpacing: '0.08em', fontWeight: 700 }
const sub: React.CSSProperties = { color: '#4a7fb5', fontSize: '0.78rem', margin: '4px 0 0' }
const btn: React.CSSProperties = { backgroundColor: '#1e3a5f', color: '#a8c4e0', border: 'none', padding: '7px 14px', cursor: 'pointer', fontSize: '0.75rem' }
const td: React.CSSProperties  = { padding: '7px 10px', color: '#a8c4e0' }
const pgBtn: React.CSSProperties = { ...btn, backgroundColor: '#0a1628', border: '1px solid #1e3a5f' }
