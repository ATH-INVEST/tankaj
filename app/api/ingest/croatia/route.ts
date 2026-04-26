import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MZOE_URL = 'https://mzoe-gor.hr/data.json'

type CroatiaFuel = {
  id: number
  naziv?: string
  ime?: string
  name?: string
}

type CroatiaStation = {
  id: number
  naziv: string
  adresa?: string
  mjesto?: string
  lat: string | number | null
  long: string | number | null
  url?: string
  obveznik_id?: number
  cjenici?: {
    id: number
    cijena: number
    gorivo_id: number
  }[]
  radnaVremena?: any[]
}

function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (process.env.NODE_ENV !== 'production') return true
  if (!cronSecret) return false
  return req.headers.get('authorization') === `Bearer ${cronSecret}`
}

function normalizeFuelName(name: string): string | null {
  const value = name.toLowerCase()

  if (value.includes('adblue')) return null
  if (value.includes('plavi')) return null
  if (value.includes('lož')) return null
  if (value.includes('loz')) return null

  if (
    value.includes('autoplin') ||
    value.includes('lpg') ||
    value.includes('ukapljeni naftni')
  ) {
    return 'LPG'
  }

  if (
    value.includes('diesel') ||
    value.includes('dizel') ||
    value.includes('eurodizel') ||
    value.includes('eurodiesel')
  ) {
    if (
      value.includes('premium') ||
      value.includes('class') ||
      value.includes('maxx') ||
      value.includes('q max') ||
      value.includes('euroclass')
    ) {
      return 'PREMIUM_DIESEL'
    }

    return 'DIESEL'
  }

  if (
    value.includes('100') ||
    value.includes('super 100') ||
    value.includes('eurosuper 100')
  ) {
    return 'PETROL_100'
  }

  if (
    value.includes('98') ||
    value.includes('super 98') ||
    value.includes('eurosuper 98')
  ) {
    return 'PETROL_98'
  }

  if (
    value.includes('95') ||
    value.includes('super') ||
    value.includes('benzin') ||
    value.includes('eurosuper')
  ) {
    return 'PETROL_95'
  }

  return null
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

function parseCoordinate(value: string | number | null) {
  if (value === null || value === undefined) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return n
}

function getCoords(station: CroatiaStation) {
  // MZOE uporablja zavajajoča imena:
  // long = latitude, lat = longitude
  const latitude = parseCoordinate(station.long)
  const longitude = parseCoordinate(station.lat)

  if (!latitude || !longitude) return null

  if (latitude < 42 || latitude > 47) return null
  if (longitude < 13 || longitude > 20) return null

  return {
    lat: latitude,
    lng: longitude,
  }
}

function cleanText(value?: string | null) {
  if (!value) return null
  return value.replace(/\s+/g, ' ').trim()
}

function getFuelName(fuel: CroatiaFuel | undefined) {
  return cleanText(fuel?.naziv || fuel?.ime || fuel?.name || null)
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

    const stations: CroatiaStation[] = Array.isArray(json.postajas) ? json.postajas : []
    const fuels: CroatiaFuel[] = Array.isArray(json.gorivos) ? json.gorivos : []
    const companies: any[] = Array.isArray(json.obvezniks) ? json.obvezniks : []

    const fuelById = new Map<number, CroatiaFuel>()
    for (const fuel of fuels) {
      fuelById.set(Number(fuel.id), fuel)
    }

    const companyById = new Map<number, string>()
    for (const company of companies) {
      const name = cleanText(company.naziv || company.ime || company.name || company.tvrtka || null)
      if (company.id && name) {
        companyById.set(Number(company.id), name)
      }
    }

    let locationsUpserted = 0
    let pricesInserted = 0
    let skippedNoCoords = 0
    let skippedNoPrices = 0

    for (const station of stations) {
      const coords = getCoords(station)

      if (!coords) {
        skippedNoCoords++
        continue
      }

      const name = cleanText(station.naziv) || `HR station ${station.id}`
      const address = cleanText(station.adresa)
      const city = cleanText(station.mjesto)
      const companyName = station.obveznik_id
        ? companyById.get(Number(station.obveznik_id)) || null
        : null

      const prices: {
        fuelType: string
        price: number
        rawProductName: string
      }[] = []

      for (const priceRow of station.cjenici || []) {
        const price = Number(priceRow.cijena)

        if (!Number.isFinite(price)) continue
        if (price <= 0 || price > 5) continue

        const fuel = fuelById.get(Number(priceRow.gorivo_id))
        const fuelName = getFuelName(fuel) || `gorivo_id:${priceRow.gorivo_id}`
        const fuelType = normalizeFuelName(fuelName)

        if (!fuelType) continue

        prices.push({
          fuelType,
          price: Number(price.toFixed(3)),
          rawProductName: fuelName,
        })
      }

      if (prices.length === 0) {
        skippedNoPrices++
        continue
      }

      const brand = normalizeBrand(station, companyName)

      const locationPayload = {
        type: 'fuel_station',
        name,
        brand,
        operator: companyName || brand,
        address,
        city,
        country_code: 'HR',
        lat: coords.lat,
        lng: coords.lng,
        geo: `POINT(${coords.lng} ${coords.lat})`,
        source: 'mzoe-gor.hr',
        source_id: String(station.id),
        opening_hours: station.radnaVremena
          ? {
              raw: station.radnaVremena,
            }
          : null,
        metadata: {
          url: station.url || null,
          obveznik_id: station.obveznik_id || null,
          company_name: companyName,
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

      for (const item of prices) {
        const { error: priceError } = await supabase.from('fuel_prices').insert({
          location_id: location.id,
          fuel_type: item.fuelType,
          price: item.price,
          currency: 'EUR',
          source: 'mzoe-gor.hr',
          confidence: 'verified',
          raw_product_name: item.rawProductName,
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
      skippedNoCoords,
      skippedNoPrices,
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