import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

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
        'user-agent': 'Tankaj.si MVP importer',
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

export async function GET() {
  const startedAt = new Date().toISOString()

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
      const locationPayload = {
        type: 'fuel_station',
        name: station.name,
        brand: station.name.split(' ')[0] || null,
        operator: station.name.split(' ')[0] || null,
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

      if (locationError) {
        throw locationError
      }

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

        if (priceError) {
          throw priceError
        }

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
      stationsFound: stations.length,
      locationsUpserted,
      pricesInserted,
    })
  } catch (err) {
    const message =
  err instanceof Error
    ? err.message
    : JSON.stringify(err, null, 2)

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

    return NextResponse.json(
  { success: false, error: message },
  { status: 500 }
)
  }
}