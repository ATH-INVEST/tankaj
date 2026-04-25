import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const GORIVA_URL = 'https://goriva.si/api/v1/search/'

const FUEL_MAP: Record<string, string> = {
  '95': 'PETROL_95',
  '98': 'PETROL_98',
  '100': 'PETROL_100',
  dizel: 'DIESEL',
  'dizel-premium': 'PREMIUM_DIESEL',
  avtoplin_lpg: 'LPG',
  KOEL: 'ELKO',
  cng: 'CNG',
  lng: 'LNG',
}

type GorivaStation = {
  pk: number
  name: string
  address: string
  lat: number
  lng: number
  prices: Record<string, number | null>
  distance?: number
  direction?: string
  open_hours?: string
  zip_code?: string
}

async function fetchAllGorivaPages() {
  let url = `${GORIVA_URL}?position=46.1512%2C14.9955&radius=200000&o=distance`
  const all: GorivaStation[] = []

  while (url) {
    const res = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'Tankaj.si importer',
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      throw new Error(`goriva.si returned ${res.status}`)
    }

    const json = await res.json()
    all.push(...(json.results || []))
    url = json.next
  }

  return all
}

function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET

  if (process.env.NODE_ENV !== 'production') return true
  if (!cronSecret) return false

  return req.headers.get('authorization') === `Bearer ${cronSecret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = new Date().toISOString()

  console.log('Tankaj.si INGEST RUN:', startedAt)

  const syncRun = await supabase
    .from('source_sync_runs')
    .insert({
      source: 'goriva.si',
      status: 'running',
      started_at: startedAt,
    })
    .select('id')
    .single()

  try {
    const stations = await fetchAllGorivaPages()

    let locationsUpserted = 0
    let pricesInserted = 0

    for (const station of stations) {
      const brand = station.name.split(' ')[0] || null

      const locationPayload = {
        type: 'fuel_station',
        name: station.name,
        brand,
        operator: brand,
        address: station.address,
        city: null,
        country_code: 'SI',
        lat: station.lat,
        lng: station.lng,
        geo: `POINT(${station.lng} ${station.lat})`,
        source: 'goriva.si',
        source_id: String(station.pk),
        opening_hours: station.open_hours ? { raw: station.open_hours } : null,
        metadata: {
          zip_code: station.zip_code || null,
          distance: station.distance || null,
          direction: station.direction || null,
          raw: station,
        },
      }

      const { data: location, error: locationError } = await supabase
        .from('locations')
        .upsert(locationPayload, {
          onConflict: 'source,source_id',
        })
        .select('id')
        .single()

      if (locationError) throw locationError

      locationsUpserted++

      for (const [rawFuelName, price] of Object.entries(station.prices || {})) {
        if (price === null) continue

        const fuelType = FUEL_MAP[rawFuelName]
        if (!fuelType) continue

        const { error: priceError } = await supabase
          .from('fuel_prices')
          .insert({
            location_id: location.id,
            fuel_type: fuelType,
            price,
            currency: 'EUR',
            source: 'goriva.si',
            confidence: 'verified',
            raw_product_name: rawFuelName,
            source_updated_at: new Date().toISOString(),
          })

        if (priceError) throw priceError

        pricesInserted++
      }
    }

    if (syncRun.data?.id) {
      await supabase
        .from('source_sync_runs')
        .update({
          status: 'success',
          finished_at: new Date().toISOString(),
          records_found: stations.length,
          records_updated: locationsUpserted,
        })
        .eq('id', syncRun.data.id)
    }

    return NextResponse.json({
      success: true,
      source: 'goriva.si',
      startedAt,
      finishedAt: new Date().toISOString(),
      stationsFound: stations.length,
      locationsUpserted,
      pricesInserted,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err, null, 2)

    console.error('Tankaj.si INGEST ERROR:', message)

    if (syncRun.data?.id) {
      await supabase
        .from('source_sync_runs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error_message: message,
        })
        .eq('id', syncRun.data.id)
    }

    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}