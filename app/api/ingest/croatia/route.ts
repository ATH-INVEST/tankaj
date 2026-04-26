import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MZOE_URL = 'https://mzoe-gor.hr/data.json'

type CroatiaStation = {
  id: number
  naziv: string
  adresa?: string
  mjesto?: string
  lat: string | number | null
  long: string | number | null
  url?: string
  obveznik_id?: number
  cjenici?: { id: number; cijena: number; gorivo_id: number }[]
  radnaVremena?: any[]
}

function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (process.env.NODE_ENV !== 'production') return true
  if (!cronSecret) return false
  return req.headers.get('authorization') === `Bearer ${cronSecret}`
}

function cleanText(value?: string | null) {
  if (!value) return null
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeFuelName(name: string): string | null {
  const v = name.toLowerCase()

  if (v.includes('adblue') || v.includes('plavi') || v.includes('lož') || v.includes('loz')) return null
  if (v.includes('autoplin') || v.includes('lpg')) return 'LPG'
  if (v.includes('diesel') || v.includes('dizel') || v.includes('eurodizel') || v.includes('eurodiesel')) {
    if (v.includes('premium') || v.includes('class') || v.includes('maxx') || v.includes('q max')) {
      return 'PREMIUM_DIESEL'
    }
    return 'DIESEL'
  }
  if (v.includes('100')) return 'PETROL_100'
  if (v.includes('98')) return 'PETROL_98'
  if (v.includes('95') || v.includes('super') || v.includes('benzin') || v.includes('eurosuper')) return 'PETROL_95'

  return null
}

function parseCoord(value: string | number | null) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return n
}

function getCoords(station: CroatiaStation) {
  // MZOE ima obratno poimenovanje:
  // long = latitude, lat = longitude
  const latitude = parseCoord(station.long)
  const longitude = parseCoord(station.lat)

  if (!latitude || !longitude) return null
  if (latitude < 42 || latitude > 47) return null
  if (longitude < 13 || longitude > 20) return null

  return { lat: latitude, lng: longitude }
}

function normalizeBrand(station: CroatiaStation, companyName?: string | null) {
  const text = `${companyName || ''} ${station.naziv || ''} ${station.url || ''}`.toUpperCase()

  if (text.includes('INA')) return 'INA'
  if (text.includes('PETROL')) return 'PETROL'
  if (text.includes('TIFON')) return 'TIFON'
  if (text.includes('SHELL') || text.includes('CORAL')) return 'SHELL'
  if (text.includes('CRODUX')) return 'CRODUX'
  if (text.includes('MOL')) return 'MOL'
  if (text.includes('ADRIA')) return 'ADRIA OIL'

  return companyName?.split(' ')[0] || station.naziv.split(' ')[0] || null
}

function chunk<T>(arr: T[], size: number) {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = new Date().toISOString()
  const { searchParams } = new URL(req.url)
  const limit = Number(searchParams.get('limit') || 0)

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
    const res = await fetch(MZOE_URL, {
      headers: {
        accept: 'application/json',
        'user-agent': 'Tankaj.si importer',
      },
      cache: 'no-store',
    })

    if (!res.ok) throw new Error(`mzoe-gor.hr returned ${res.status}`)

    const json = await res.json()

    const stationsRaw: CroatiaStation[] = Array.isArray(json.postajas) ? json.postajas : []
    const stations = limit > 0 ? stationsRaw.slice(0, limit) : stationsRaw
    const fuels: any[] = Array.isArray(json.gorivos) ? json.gorivos : []
    const companies: any[] = Array.isArray(json.obvezniks) ? json.obvezniks : []

    const fuelById = new Map<number, string>()
    for (const fuel of fuels) {
      const name = cleanText(fuel.naziv || fuel.ime || fuel.name || null)
      if (fuel.id && name) fuelById.set(Number(fuel.id), name)
    }

    const companyById = new Map<number, string>()
    for (const company of companies) {
      const name = cleanText(company.naziv || company.ime || company.name || company.tvrtka || null)
      if (company.id && name) companyById.set(Number(company.id), name)
    }

    const locationRows: any[] = []
    const pendingPrices: {
      sourceId: string
      fuelType: string
      price: number
      rawProductName: string
    }[] = []

    let skippedNoCoords = 0
    let skippedNoPrices = 0

    for (const station of stations) {
      const coords = getCoords(station)

      if (!coords) {
        skippedNoCoords++
        continue
      }

      const prices: {
        fuelType: string
        price: number
        rawProductName: string
      }[] = []

      for (const priceRow of station.cjenici || []) {
        const price = Number(priceRow.cijena)
        if (!Number.isFinite(price) || price <= 0 || price > 5) continue

        const rawFuelName = fuelById.get(Number(priceRow.gorivo_id)) || `gorivo_id:${priceRow.gorivo_id}`
        const fuelType = normalizeFuelName(rawFuelName)

        if (!fuelType) continue

        prices.push({
          fuelType,
          price: Number(price.toFixed(3)),
          rawProductName: rawFuelName,
        })
      }

      if (prices.length === 0) {
        skippedNoPrices++
        continue
      }

      const sourceId = String(station.id)
      const companyName = station.obveznik_id ? companyById.get(Number(station.obveznik_id)) || null : null
      const brand = normalizeBrand(station, companyName)

      locationRows.push({
        type: 'fuel_station',
        name: cleanText(station.naziv) || `HR station ${station.id}`,
        brand,
        operator: companyName || brand,
        address: cleanText(station.adresa),
        city: cleanText(station.mjesto),
        country_code: 'HR',
        lat: coords.lat,
        lng: coords.lng,
        geo: `POINT(${coords.lng} ${coords.lat})`,
        source: 'mzoe-gor.hr',
        source_id: sourceId,
        opening_hours: station.radnaVremena ? { raw: station.radnaVremena } : null,
        metadata: {
          url: station.url || null,
          obveznik_id: station.obveznik_id || null,
          company_name: companyName,
        },
      })

      for (const p of prices) {
        pendingPrices.push({
          sourceId,
          ...p,
        })
      }
    }

    const returnedLocations: { id: string; source_id: string }[] = []

    for (const part of chunk(locationRows, 200)) {
      const { data, error } = await supabase
        .from('locations')
        .upsert(part, { onConflict: 'source,source_id' })
        .select('id,source_id')

      if (error) throw error
      returnedLocations.push(...(data || []))
    }

    const locationIdBySourceId = new Map<string, string>()
    for (const loc of returnedLocations) {
      locationIdBySourceId.set(String(loc.source_id), loc.id)
    }

    const priceRows = pendingPrices
      .map((p) => {
        const locationId = locationIdBySourceId.get(p.sourceId)
        if (!locationId) return null

        return {
          location_id: locationId,
          fuel_type: p.fuelType,
          price: p.price,
          currency: 'EUR',
          source: 'mzoe-gor.hr',
          confidence: 'verified',
          raw_product_name: p.rawProductName,
          source_updated_at: new Date().toISOString(),
        }
      })
      .filter(Boolean)

    for (const part of chunk(priceRows, 500)) {
      const { error } = await supabase.from('fuel_prices').insert(part)
      if (error) throw error
    }

    if (syncRun.data?.id) {
      await supabase
        .from('source_sync_runs')
        .update({
          status: 'success',
          finished_at: new Date().toISOString(),
          records_found: stations.length,
          records_updated: returnedLocations.length,
        })
        .eq('id', syncRun.data.id)
    }

    return NextResponse.json({
      success: true,
      source: 'mzoe-gor.hr',
      startedAt,
      finishedAt: new Date().toISOString(),
      stationsFound: stations.length,
      locationsUpserted: returnedLocations.length,
      pricesInserted: priceRows.length,
      skippedNoCoords,
      skippedNoPrices,
      limitedTo: limit || null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err, null, 2)

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