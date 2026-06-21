// GET /api/auth/test
// Simple test endpoint to verify iron-session is working

import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { sessionOptions, SessionData, defaultSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const response = new NextResponse(JSON.stringify({ message: 'Test successful' }))
    const session = await getIronSession<SessionData>(req, response, sessionOptions)
    
    console.log('[Test] Initial session state:', { isLoggedIn: session.isLoggedIn })
    
    // Set test session
    session.isLoggedIn = true
    session.userId = 'test-user-123'
    session.plexToken = 'test-token'
    session.plexServerUrl = 'http://test:32400'
    session.plexId = 'test-plex-id'
    session.username = 'testuser'
    session.email = 'test@example.com'
    session.isAdmin = false
    
    console.log('[Test] Before save:', { isLoggedIn: session.isLoggedIn, userId: session.userId })
    
    await session.save()
    
    console.log('[Test] Session saved successfully')
    
    return response
  } catch (err: any) {
    console.error('[Test] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
