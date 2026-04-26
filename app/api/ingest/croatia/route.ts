import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MZOE_URL = 'https://mzoe-gor.hr/data.json'

type NormalizedStation = {
  sourceId: string
  name: string
  brand: string | null
  address: string | null
  lat: number
  lng: number
  prices: Record<string, number>
  raw: any
}

function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (process.env.NODE_ENV !== 'production') return true
  if (!cronSecret) return false
  return req.headers.get('authorization') === `Bearer ${cronSecret}`
}

function hashId(value: string) {
  return createHash('sha1').update(value).digest('hex').slice(0, 16)
}

function asText(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function parsePrice(value: any): number | null {
  if (typeof value === 'number' && value > 0 && value < 5) return value

  if (typeof value !== 'string') return null

  const cleaned = value
    .replace(',', '.')
    .replace(/[^\d.]/g, '')
    .trim()

  const num = Number(cleaned)

  if (!Number.isFinite(num)) return null
  if (num <= 0 || num > 5) return null

  return Number(num.toFixed(3))
}

function normalizeFuelName(input: string): string | null {
  const value = input.toLowerCase()

  if (value.includes('adblue')) return null
  if (value.includes('plavi')) return null

  if (
    value.includes('eurosuper 95') ||
    value.includes('euro super 95') ||
    value.includes('super 95') ||
    value.includes('benzin 95') ||
    value.includes('95 bez') ||
    value.includes('95 s aditiv')
  ) {
    return 'PETROL_95'
  }

  if (
    value.includes('eurosuper 100') ||
    value.includes('super 100') ||
    value.includes('benzin 100') ||
    value.includes('100')
  ) {
    return 'PETROL_100'
  }

  if (
    value.includes('eurodizel') ||
    value.includes('euro diesel') ||
    value.includes('diesel') ||
    value.includes('dizel') ||
    value.includes('b7')
  ) {
    return 'DIESEL'
  }

  if (value.includes('autoplin') || value.includes('lpg')) {
    return 'LPG'
  }

  return null
}

function normalizeBrand(name: string, operator?: string | null) {
  const text = `${operator || ''} ${name || ''}`.toUpperCase()

  if (text.includes('PETROL')) return 'PETROL'
  if (text.includes('INA')) return 'INA'
  if (text.includes('TIFON')) return 'TIFON'
  if (text.includes('SHELL')) return 'SHELL'
  if (text.includes('CRODUX')) return 'CRODUX'
  if (text.includes('MOL')) return 'MOL'
  if (text.includes('LUKOIL')) return 'LUKOIL'

  return name.split(' ')[0] || null
}

function pick(obj: any, keys: string[]) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
      return obj[key]
    }
  }
  return null
}

function fixCroatiaCoords(latRaw: any, lngRaw: any) {
  let lat = Number(latRaw)
  let lng = Number(lngRaw)

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  // Croatia approx: lat 42–47, lng 13–20.
  // Some dumps have coords swapped.
  if (lat >= 13 && lat <= 20 && lng >= 42 && lng <= 47) {
    const tmp = lat
    lat = lng
    lng = tmp
  }

  if (lat < 42 || lat > 47 || lng < 13 || lng > 20) {
    return null
  }

  return { lat, lng }
}

function getCoords(obj: any) {
  const lat = pick(obj, ['lat', 'latitude', 'geo_lat', 'sirina', 'y'])
  const lng = pick(obj, ['lng', 'lon', 'longitude', 'geo_lng', 'duzina', 'x'])

  const direct = fixCroatiaCoords(lat, lng)
  if (direct) return direct

  const coords = pick(obj, ['coordinates', 'coord', 'coords', 'koordinate', 'lokacija'])
  if (Array.isArray(coords) && coords.length >= 2) {
    return fixCroatiaCoords(coords[1], coords[0]) || fixCroatiaCoords(coords[0], coords[1])
  }

  return null
}

function collectPrices(obj: any, depth = 0, out: Record<string, number> = {}) {
  if (!obj || depth > 8) return out

  if (Array.isArray(obj)) {
    for (const item of obj) collectPrices(item, depth + 1, out)
    return out
  }

  if (typeof obj !== 'object') return out

  const productName = asText(
    pick(obj, [
      'name',
      'naziv',
      'fuel',
      'gorivo',
      'derivat',
      'product',
      'label',
      'title',
      'vrsta',
    ])
  )

  const productPrice = pick(obj, ['price', 'cijena', 'cena', 'amount', 'value'])

  if (productName) {
    const fuelType = normalizeFuelName(productName)
    const price = parsePrice(productPrice)

    if (fuelType && price !== null) {
      out[fuelType] = price
    }
  }

  for (const [key, value] of Object.entries(obj)) {
    const fuelType = normalizeFuelName(key)
    const price = parsePrice(value)

    if (fuelType && price !== null) {
      out[fuelType] = price
    }

    if (value && typeof value === 'object') {
      collectPrices(value, depth + 1, out)
    }
  }

  return out
}

function flattenStationObjects(root: any) {
  const found: any[] = []

  function walk(value: any, depth = 0) {
    if (!value || depth > 8) return

    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1)
      return
    }

    if (typeof value !== 'object') return

    const coords = getCoords(value)
    const name = asText(pick(value, ['name', 'naziv', 'title', 'ime', 'stationName']))

    if (coords && name) {
      found.push(value)
      return
    }

    for (const child of Object.values(value)) {
      walk(child, depth + 1)
    }
  }

  walk(root)
  return found
}

async function fetchCroatiaStations(): Promise<NormalizedStation[]> {
  const res = await fetch(MZOE_URL, {
    headers: {
      accept: 'application/json',
      'user-agent': 'Tankaj.si importer',
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`mzoe-gor.hr returned ${res.status}`)
  }

  const json = await res.json()
  const stationObjects = flattenStationObjects(json)

  const stations: NormalizedStation[] = []

  for (const item of stationObjects) {
    const coords = getCoords(item)
    if (!coords) continue

    const name = asText(pick(item, ['name', 'naziv', 'title', 'ime', 'stationName']))
    if (!name) continue

    const address = asText(
      pick(item, ['address', 'adresa', 'location', 'lokacija', 'street', 'ulica'])
    )

    const operator = asText(
      pick(item, ['operator', 'trgovac', 'company', 'tvrtka', 'brand', 'vlasnik'])
    )

    const prices = collectPrices(item)

    if (Object.keys(prices).length === 0) continue

    const rawId = asText(pick(item, ['id', 'pk', 'sifra', 'slug', 'uid', 'stationId']))
    const sourceId =
      rawId || hashId(`${name}|${address}|${coords.lat}|${coords.lng}`)

    stations.push({
      sourceId,
      name,
      brand: normalizeBrand(name, operator),
      address: address || null,
      lat: coords.lat,
      lng: coords.lng,
      prices,
      raw: item,
    })
  }

  const unique = new Map<string, NormalizedStation>()

  for (const station of stations) {
    unique.set(station.sourceId, station)
  }

  return Array.from(unique.values())
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = new Date().toISOString()

  console.log('Tankaj.si HR INGEST RUN:', startedAt)

  const syncRun = await supabase
    .from('source_sync_runs')
    .insert({
      source: 'mzoe-gor.hr',
      status: 'running',
      started_at: startedAt,
    })
    .select('id')
    .single()

  try {
    const stations = await fetchCroatiaStations()

    let locationsUpserted = 0
    let pricesInserted = 0

    for (const station of stations) {
      const locationPayload = {
        type: 'fuel_station',
        name: station.name,
        brand: station.brand,
        operator: station.brand,
        address: station.address,
        city: null,
        country_code: 'HR',
        lat: station.lat,
        lng: station.lng,
        geo: `POINT(${station.lng} ${station.lat})`,
        source: 'mzoe-gor.hr',
        source_id: station.sourceId,
        opening_hours: null,
        metadata: {
          raw: station.raw,
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

      for (const [fuelType, price] of Object.entries(station.prices)) {
        const { error: priceError } = await supabase
          .from('fuel_prices')
          .insert({
            location_id: location.id,
            fuel_type: fuelType,
            price,
            currency: 'EUR',
            source: 'mzoe-gor.hr',
            confidence: 'verified',
            raw_product_name: fuelType,
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
      source: 'mzoe-gor.hr',
      startedAt,
      finishedAt: new Date().toISOString(),
      stationsFound: stations.length,
      locationsUpserted,
      pricesInserted,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err, null, 2)

    console.error('Tankaj.si HR INGEST ERROR:', message)

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