import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ANAGRAFICA_URL =
  'https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv'
const PREZZI_URL =
  'https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv'

const SOURCE = 'mimit.gov.it'
const LOCATION_BATCH_SIZE = 500
const PRICE_BATCH_SIZE = 1000

type LocationRow = {
  id: string
  source_id: string | null
}

type PendingPrice = {
  sourceId: string
  fuelType: string
  price: number
  rawProductName: string
  sourceUpdatedAt: string | null
}

function isAuthorized(req: NextRequest) {
  if (process.env.NODE_ENV !== 'production') return true

  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  const userAgent = req.headers.get('user-agent') || ''

  if (userAgent.toLowerCase().includes('vercel-cron')) return true
  if (!cronSecret) return false

  return authHeader === `Bearer ${cronSecret}`
}

function cleanText(value?: string | null) {
  if (!value) return null
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeKey(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]/g, '')
}

function getField(row: Record<string, string>, aliases: string[]) {
  const wanted = aliases.map(normalizeKey)

  for (const [key, value] of Object.entries(row)) {
    if (wanted.includes(normalizeKey(key))) {
      return cleanText(value)
    }
  }

  return null
}

function getSourceId(row: Record<string, string>) {
  return getField(row, [
    'idImpianto',
    'id impianto',
    'idimpianto',
    'id',
    'codiceimpianto',
    'codice impianto',
    'impianto',
    'codice',
  ])
}

function splitCsvLine(line: string, delimiter: string) {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const next = line[i + 1]

    if (char === '"' && next === '"') {
      current += '"'
      i++
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === delimiter && !inQuotes) {
      result.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  result.push(current.trim())
  return result
}

function parseCsv(text: string) {
  const clean = text.replace(/^\uFEFF/, '').trim()
  const lines = clean.split(/\r?\n/).filter(Boolean)

  if (lines.length < 2) return []

  const headerLineIndex = lines.findIndex((line) => {
    const normalized = line.toLowerCase()
    return (
      normalized.includes('idimpianto') ||
      normalized.includes('id impianto') ||
      normalized.includes('desccarburante')
    )
  })

  if (headerLineIndex === -1) return []

  const headerLine = lines[headerLineIndex]
  const delimiter = headerLine.includes('|') ? '|' : ';'
  const headers = splitCsvLine(headerLine, delimiter).map((h) => h.trim())

  return lines.slice(headerLineIndex + 1).map((line) => {
    const values = splitCsvLine(line, delimiter)
    const row: Record<string, string> = {}

    headers.forEach((header, index) => {
      row[header] = values[index] || ''
    })

    return row
  })
}

function parseNumber(value?: string | null) {
  if (!value) return null

  const normalized = value
    .replace(/\s+/g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '')

  const num = Number(normalized)
  if (!Number.isFinite(num)) return null

  return num
}

function getCoords(row: Record<string, string>) {
  const lat = parseNumber(
    getField(row, ['latitudine', 'latitude', 'lat', 'y'])
  )
  const lng = parseNumber(
    getField(row, ['longitudine', 'longitude', 'lon', 'lng', 'x'])
  )

  if (lat === null || lng === null) return null
  if (lat < 35 || lat > 48) return null
  if (lng < 6 || lng > 19) return null

  return { lat, lng }
}

function normalizeFuelName(name: string): string | null {
  const v = name.toLowerCase()

  if (
    v.includes('adblue') ||
    v.includes('metano') ||
    v.includes('gnl') ||
    v.includes('lng') ||
    v.includes('hvo') ||
    v.includes('olio')
  ) {
    return null
  }

  if (v.includes('gpl') || v.includes('lpg')) return 'LPG'

  if (
    v.includes('gasolio') ||
    v.includes('diesel') ||
    v.includes('dieselone') ||
    v.includes('hi-q diesel') ||
    v.includes('bludiesel')
  ) {
    if (
      v.includes('premium') ||
      v.includes('plus') ||
      v.includes('speciale') ||
      v.includes('dieselone') ||
      v.includes('hi-q') ||
      v.includes('blu')
    ) {
      return 'PREMIUM_DIESEL'
    }

    return 'DIESEL'
  }

  if (v.includes('100')) return 'PETROL_100'
  if (v.includes('98')) return 'PETROL_98'

  if (v.includes('benzina') || v.includes('super') || v.includes('95')) {
    return 'PETROL_95'
  }

  return null
}

function normalizeBrand(
  rawBrand?: string | null,
  rawName?: string | null,
  rawOperator?: string | null
) {
  const text = `${rawBrand || ''} ${rawName || ''} ${rawOperator || ''}`.toUpperCase()

  if (text.includes('ENI') || text.includes('AGIP')) return 'ENI'
  if (text.includes('Q8') || text.includes('KUWAIT')) return 'Q8'
  if (text.includes('ITALIANA PETROLI')) return 'IP'
  if (text.includes('IP ')) return 'IP'
  if (text === 'IP') return 'IP'
  if (text.includes('TAMOIL')) return 'TAMOIL'
  if (text.includes('ESSO')) return 'ESSO'
  if (text.includes('TOTAL')) return 'TOTALENERGIES'
  if (text.includes('SHELL')) return 'SHELL'
  if (text.includes('REPSOL')) return 'REPSOL'

  return rawBrand || rawOperator?.split(' ')[0] || rawName?.split(' ')[0] || null
}

function isSelfService(row: Record<string, string>) {
  const value = getField(row, ['isSelf', 'self', 'selfService', 'modalita'])
  if (!value) return false

  const normalized = value.toLowerCase()

  return (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'self' ||
    normalized.includes('self')
  )
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }

  return chunks
}

function parseItalianDate(value: string | null) {
  if (!value) return null

  const parts = value.split(' ')
  if (parts.length !== 2) return null

  const [date, time] = parts
  const [day, month, year] = date.split('/')

  if (!day || !month || !year || !time) return null

  return `${year}-${month}-${day}T${time}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    )
  }

  const startedAt = new Date().toISOString()
  const { searchParams } = new URL(req.url)
  const limit = Number(searchParams.get('limit') || 0)

  const syncRun = await supabase
    .from('source_sync_runs')
    .insert({
      source: SOURCE,
      status: 'running',
      started_at: startedAt,
    })
    .select('id')
    .single()

  try {
    const [stationsRes, pricesRes] = await Promise.all([
      fetch(ANAGRAFICA_URL, {
        headers: {
          accept: 'text/csv,text/plain,*/*',
          'user-agent': 'Tankaj.si importer',
        },
        cache: 'no-store',
      }),
      fetch(PREZZI_URL, {
        headers: {
          accept: 'text/csv,text/plain,*/*',
          'user-agent': 'Tankaj.si importer',
        },
        cache: 'no-store',
      }),
    ])

    if (!stationsRes.ok) {
      throw new Error(`${SOURCE} stations returned ${stationsRes.status}`)
    }

    if (!pricesRes.ok) {
      throw new Error(`${SOURCE} prices returned ${pricesRes.status}`)
    }

    const [stationsText, pricesText] = await Promise.all([
      stationsRes.text(),
      pricesRes.text(),
    ])

    const stationRowsRaw = parseCsv(stationsText)
    const priceRows = parseCsv(pricesText)

if (searchParams.get('debug') === '1') {
  return NextResponse.json({
    success: true,
    stationHeaders: Object.keys(stationRowsRaw[0] || {}),
    priceHeaders: Object.keys(priceRows[0] || {}),
    firstStation: stationRowsRaw[0] || null,
    firstPrice: priceRows[0] || null,
  })
}

    const stationRows = limit > 0 ? stationRowsRaw.slice(0, limit) : stationRowsRaw

    const allowedSourceIds = new Set(
      stationRows
        .map((row) => getSourceId(row))
        .filter((id): id is string => Boolean(id))
    )

    const pricesByStation = new Map<string, PendingPrice[]>()

    for (const row of priceRows) {
      const sourceId = getSourceId(row)
      if (!sourceId) continue
      if (limit > 0 && !allowedSourceIds.has(sourceId)) continue

      const rawProductName = getField(row, [
        'descCarburante',
        'desc carburante',
        'carburante',
        'nomeCarburante',
        'descrizione carburante',
      ])

      if (!rawProductName) continue

      const fuelType = normalizeFuelName(rawProductName)
      if (!fuelType) continue

      const price = parseNumber(getField(row, ['prezzo', 'price']))
      if (price === null || price <= 0 || price > 5) continue

      const sourceUpdatedAt =
        getField(row, [
          'dtComu',
          'data comunicazione',
          'dataComunicazione',
          'data',
        ]) || null

      const pending: PendingPrice = {
        sourceId,
        fuelType,
        price: Number(price.toFixed(3)),
        rawProductName: `${rawProductName}${isSelfService(row) ? ' self' : ''}`,
        sourceUpdatedAt,
      }

      const existing = pricesByStation.get(sourceId) || []
      existing.push(pending)
      pricesByStation.set(sourceId, existing)
    }

    const locationPayloads = []
    const pendingPrices: PendingPrice[] = []

    let skippedNoSourceId = 0
    let skippedNoCoords = 0
    let skippedNoPrices = 0

    for (const row of stationRows) {
      const sourceId = getSourceId(row)

      if (!sourceId) {
        skippedNoSourceId++
        continue
      }

      const coords = getCoords(row)

      if (!coords) {
        skippedNoCoords++
        continue
      }

      const stationPrices = pricesByStation.get(sourceId) || []

      if (stationPrices.length === 0) {
        skippedNoPrices++
        continue
      }

      const bestByFuel = new Map<string, PendingPrice>()

      for (const p of stationPrices) {
        const current = bestByFuel.get(p.fuelType)

        if (!current || p.price < current.price) {
          bestByFuel.set(p.fuelType, p)
        }
      }

      const name =
        getField(row, ['nomeImpianto', 'nome impianto', 'nome', 'name']) ||
        `IT station ${sourceId}`

      const rawBrand = getField(row, ['bandiera', 'brand', 'marchio'])
      const operator = getField(row, ['gestore', 'operator', 'company'])
      const brand = normalizeBrand(rawBrand, name, operator)

      const address = getField(row, ['indirizzo', 'address'])
      const city = getField(row, ['comune', 'city'])
      const province = getField(row, ['provincia', 'province', 'siglaProvincia'])

      locationPayloads.push({
        type: 'fuel_station',
        name,
        brand,
        operator: operator || brand,
        address,
        city,
        country_code: 'IT',
        lat: coords.lat,
        lng: coords.lng,
        geo: `POINT(${coords.lng} ${coords.lat})`,
        source: SOURCE,
        source_id: sourceId,
        opening_hours: null,
        metadata: {
          tipo_impianto: getField(row, ['tipoImpianto', 'tipo impianto']),
          bandiera: rawBrand,
          provincia: province,
        },
      })

      pendingPrices.push(...Array.from(bestByFuel.values()))
    }

    for (const part of chunk(locationPayloads, LOCATION_BATCH_SIZE)) {
      const { error } = await supabase
        .from('locations')
        .upsert(part, { onConflict: 'source,source_id' })

      if (error) throw error
    }

    const sourceIds = locationPayloads.map((location) =>
      String(location.source_id)
    )

    const locationRows: LocationRow[] = []

    for (const part of chunk(sourceIds, LOCATION_BATCH_SIZE)) {
      const { data, error } = await supabase
        .from('locations')
        .select('id,source_id')
        .eq('source', SOURCE)
        .in('source_id', part)

      if (error) throw error

      locationRows.push(...((data || []) as LocationRow[]))
    }

    const locationIdBySourceId = new Map(
      locationRows
        .filter((row) => row.source_id)
        .map((row) => [String(row.source_id), row.id])
    )

    const now = new Date().toISOString()

    const pricePayloads = pendingPrices
      .map((p) => {
        const locationId = locationIdBySourceId.get(p.sourceId)

        if (!locationId) return null

        return {
  location_id: locationId,
  fuel_type: p.fuelType,
  price: p.price,
  currency: 'EUR',
  source: SOURCE,
  confidence: 'verified',
  raw_product_name: p.rawProductName,
  source_updated_at: parseItalianDate(p.sourceUpdatedAt) || now,
  captured_at: now,
}
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)

    for (const part of chunk(pricePayloads, PRICE_BATCH_SIZE)) {
      const { error } = await supabase.from('fuel_prices').insert(part)
      if (error) throw error
    }

    if (syncRun.data?.id) {
      await supabase
        .from('source_sync_runs')
        .update({
          status: 'success',
          finished_at: new Date().toISOString(),
          records_found: stationRows.length,
          records_updated: locationPayloads.length,
        })
        .eq('id', syncRun.data.id)
    }

    return NextResponse.json({
      success: true,
      source: SOURCE,
      startedAt,
      finishedAt: new Date().toISOString(),
      stationsFound: stationRows.length,
      locationsUpserted: locationPayloads.length,
      pricesInserted: pricePayloads.length,
      skippedNoSourceId,
      skippedNoCoords,
      skippedNoPrices,
      limitedTo: limit || null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err)

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
      { success: false, source: SOURCE, error: message },
      { status: 500 }
    )
  }
}