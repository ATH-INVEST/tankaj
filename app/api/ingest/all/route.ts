import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const INGEST_TIMEOUT_MS = 55_000

function isAuthorized(req: NextRequest) {
  if (process.env.NODE_ENV !== 'production') return true

  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  const userAgent = req.headers.get('user-agent') || ''

  if (userAgent.toLowerCase().includes('vercel-cron')) {
    return true
  }

  if (!cronSecret) return false

  return authHeader === `Bearer ${cronSecret}`
}

async function callIngest(origin: string, path: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), INGEST_TIMEOUT_MS)

  try {
    const res = await fetch(`${origin}${path}`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${process.env.CRON_SECRET || ''}`,
      },
      cache: 'no-store',
      signal: controller.signal,
    })

    const json = await res.json().catch(() => null)

    return {
      path,
      ok: res.ok,
      status: res.status,
      response: json,
    }
  } catch (err) {
    return {
      path,
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    )
  }

  const startedAt = new Date().toISOString()
  const origin = new URL(req.url).origin

  const results = await Promise.all([
    callIngest(origin, '/api/ingest/slovenia'),
    callIngest(origin, '/api/ingest/croatia'),
  ])

  return NextResponse.json({
    success: results.every((r) => r.ok),
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
  })
}