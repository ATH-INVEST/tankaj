import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (process.env.NODE_ENV !== 'production') return true
  if (!cronSecret) return false
  return req.headers.get('authorization') === `Bearer ${cronSecret}`
}

async function callIngest(origin: string, path: string) {
  const res = await fetch(`${origin}${path}`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${process.env.CRON_SECRET}`,
    },
    cache: 'no-store',
  })

  const json = await res.json().catch(() => null)

  return {
    path,
    ok: res.ok,
    status: res.status,
    response: json,
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const origin = new URL(req.url).origin

  const results = []

  results.push(await callIngest(origin, '/api/ingest/slovenia'))
  results.push(await callIngest(origin, '/api/ingest/croatia'))

  return NextResponse.json({
    success: results.every((r) => r.ok),
    startedAt: new Date().toISOString(),
    results,
  })
}