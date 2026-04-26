import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getDrivingDistance } from '@/lib/ors'

type Result = {
  location_id: string
  name: string
  brand: string | null
  address: string | null
  city: string | null
  country_code?: string | null
  lat?: number
  lng?: number
  distance_km: number
  estimated_drive_minutes?: number | null
  fuel_type: string
  price: number
  total_cost?: number
  fuel_cost?: number
  effective_total_cost?: number
  source?: string
  captured_at?: string
}

type AnyResult = Result & {
  route_source?: string
  travel_fuel_cost?: number
  time_cost?: number
  tankaj_score?: number
  is_cross_border?: boolean
  is_outside_smart_limit?: boolean
  smart_warning?: string | null
  mode?: string
}

const SMART_NEARBY_MAX_DISTANCE_KM = 20
const SMART_NEARBY_MAX_DRIVE_MINUTES = 25

// Pomembno: pri sortiranju po ceni moramo routati tudi najcenejše kandidate,
// sicer UI lahko pokaže zračno razdaljo namesto realne vožnje.
const ROUTED_CANDIDATES_NEARBY = 44

function normalizeBrand(value?: string | null) {
  return value ? value.trim().toUpperCase() : ''
}

function inferUserCountry(lat: number, lng: number) {
  if (lat >= 45 && lat <= 47 && lng >= 13 && lng <= 17) return 'SI'
  if (lat >= 42 && lat <= 47 && lng >= 13 && lng <= 20) return 'HR'
  return null
}

function n(value: any, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function round(value: number, decimals = 2) {
  return Number(value.toFixed(decimals))
}

function uniqueByLocation(rows: Result[]) {
  const map = new Map<string, Result>()

  for (const row of rows) {
    if (!map.has(row.location_id)) {
      map.set(row.location_id, row)
    }
  }

  return Array.from(map.values())
}

function routeFallbackDistance(distanceKm: number) {
  // Fallback ni realna navigacija. Zračna razdalja je pogosto prekratka,
  // zato jo konzervativno povečamo, da ne izgleda kot točna vožnja.
  return round(distanceKm * 1.35, 2)
}

async function enrichWithRealRoutes(
  rows: Result[],
  user: { lat: number; lng: number },
  maxRoutes = ROUTED_CANDIDATES_NEARBY
) {
  const candidates = rows.slice(0, maxRoutes)

  const enriched = await Promise.all(
    candidates.map(async (r) => {
      if (!r.lat || !r.lng) return r

      try {
        const route = await getDrivingDistance(
          { lat: user.lat, lng: user.lng },
          { lat: Number(r.lat), lng: Number(r.lng) }
        )

        return {
          ...r,
          distance_km: round(route.distance_km, 2),
          estimated_drive_minutes: Math.max(1, Math.round(route.duration_min)),
          route_source: 'openrouteservice',
        }
      } catch {
        const fallbackKm = routeFallbackDistance(n(r.distance_km))

        return {
          ...r,
          distance_km: fallbackKm,
          estimated_drive_minutes:
            r.estimated_drive_minutes ?? Math.max(1, Math.round((fallbackKm / 55) * 60)),
          route_source: 'air_distance_fallback_adjusted',
        }
      }
    })
  )

  return [
    ...enriched,
    ...rows.slice(maxRoutes).map((r) => {
      const fallbackKm = routeFallbackDistance(n(r.distance_km))

      return {
        ...r,
        distance_km: fallbackKm,
        estimated_drive_minutes:
          r.estimated_drive_minutes ?? Math.max(1, Math.round((fallbackKm / 55) * 60)),
        route_source: 'air_distance_not_routed_adjusted',
        smart_warning: 'Razdalja je ocenjena, ker kandidat ni bil routan.',
      }
    }),
  ]
}

function sortScored(rows: AnyResult[], sortBy: string) {
  return [...rows].sort((a, b) => {
    if (sortBy === 'price') {
      if (a.price !== b.price) return a.price - b.price
      return a.distance_km - b.distance_km
    }

    if (sortBy === 'distance') {
      if (a.distance_km !== b.distance_km) return a.distance_km - b.distance_km
      return a.price - b.price
    }

    if (sortBy === 'total') {
      if (a.effective_total_cost !== b.effective_total_cost) {
        return n(a.effective_total_cost) - n(b.effective_total_cost)
      }

      return a.distance_km - b.distance_km
    }

    if (a.tankaj_score !== b.tankaj_score) return n(a.tankaj_score) - n(b.tankaj_score)

    if (a.effective_total_cost !== b.effective_total_cost) {
      return n(a.effective_total_cost) - n(b.effective_total_cost)
    }

    return a.distance_km - b.distance_km
  })
}

function buildCandidatePool(rows: Result[], amount: number, sortBy: string) {
  const nearestCandidates = [...rows]
    .sort((a, b) => n(a.distance_km) - n(b.distance_km))
    .slice(0, 34)

  const cheapestCandidates = [...rows]
    .sort((a, b) => {
      if (a.price !== b.price) return a.price - b.price
      return n(a.distance_km) - n(b.distance_km)
    })
    .slice(0, 34)

  const basicSmartCandidates = [...rows]
    .sort((a, b) => {
      const aBasic = n(a.price) * amount + n(a.distance_km) * 0.45
      const bBasic = n(b.price) * amount + n(b.distance_km) * 0.45
      return aBasic - bBasic
    })
    .slice(0, 44)

  if (sortBy === 'price') {
    return uniqueByLocation([
      ...cheapestCandidates,
      ...nearestCandidates,
      ...basicSmartCandidates,
    ])
  }

  if (sortBy === 'distance') {
    return uniqueByLocation([
      ...nearestCandidates,
      ...cheapestCandidates,
      ...basicSmartCandidates,
    ])
  }

  return uniqueByLocation([
    ...basicSmartCandidates,
    ...nearestCandidates,
    ...cheapestCandidates,
  ])
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)

  const lat = Number(searchParams.get('lat'))
  const lng = Number(searchParams.get('lng'))
  const radius = Number(searchParams.get('radius') || 25)
  const type = searchParams.get('type') || 'PETROL_95'
  const amount = Number(searchParams.get('amount') || 50)

  const consumption = Number(searchParams.get('consumption') || 7)
  const timeValue = Number(searchParams.get('timeValue') || 6)

  const brandFilter = normalizeBrand(searchParams.get('brand') || searchParams.get('brandFilter'))
  const mode = searchParams.get('mode') === 'route' ? 'route' : 'nearby'
  const sortBy = searchParams.get('sortBy') || 'smart'

  // MVP: za "Okoli mene" računamo pot DO črpalke.
  const tripMultiplier = 1

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json(
      { success: false, error: 'Missing or invalid lat/lng' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase.rpc('search_fuel_locations', {
    user_lat: lat,
    user_lng: lng,
    radius_km: radius,
    wanted_fuel_type: type,
    amount,
    car_consumption_l_per_100km: consumption,
    avg_speed_kmh: 55,
    time_value_eur_per_hour: timeValue,
  })

  if (error) {
    return NextResponse.json({ success: false, error }, { status: 500 })
  }

  const userCountry = inferUserCountry(lat, lng)

  let rows = ((data || []) as Result[])
    .filter((r) => Number.isFinite(Number(r.price)))
    .filter((r) => r.lat && r.lng)

  if (brandFilter && brandFilter !== 'ALL') {
    rows = rows.filter((r) => normalizeBrand(r.brand) === brandFilter)
  }

  const candidatePool = buildCandidatePool(rows, amount, sortBy)
  const routedRows = await enrichWithRealRoutes(candidatePool, { lat, lng }, ROUTED_CANDIDATES_NEARBY)

  const scored = routedRows.map((r: any) => {
    const distanceKm = n(r.distance_km)
    const driveMinutes = n(
      r.estimated_drive_minutes,
      Math.max(1, Math.round((distanceKm / 55) * 60))
    )

    const fuelCost = round(n(r.fuel_cost ?? r.total_cost, r.price * amount), 2)
    const travelFuelCost = round(((distanceKm * tripMultiplier) * consumption / 100) * n(r.price), 2)
    const timeCost = round((driveMinutes / 60) * timeValue, 2)
    const effectiveTotalCost = round(fuelCost + travelFuelCost + timeCost, 2)

    const outsideSmartLimit =
      mode === 'nearby' &&
      (distanceKm > SMART_NEARBY_MAX_DISTANCE_KM || driveMinutes > SMART_NEARBY_MAX_DRIVE_MINUTES)

    const distancePenalty =
      mode === 'nearby'
        ? Math.max(0, distanceKm - 10) * 0.55 + Math.max(0, driveMinutes - 15) * 0.28
        : 0

    return {
      ...r,
      distance_km: round(distanceKm, 2),
      estimated_drive_minutes: Math.round(driveMinutes),
      fuel_cost: fuelCost,
      travel_fuel_cost: travelFuelCost,
      time_cost: timeCost,
      effective_total_cost: effectiveTotalCost,
      tankaj_score: round(effectiveTotalCost + distancePenalty, 2),
      is_cross_border: userCountry ? Boolean(r.country_code && r.country_code !== userCountry) : false,
      is_outside_smart_limit: outsideSmartLimit,
      smart_warning: outsideSmartLimit
        ? 'Smiselno predvsem, če si že na poti v to smer.'
        : r.smart_warning || null,
      mode,
    }
  }) as AnyResult[]

  const sortedAll = sortScored(scored, sortBy)

  const smartNearbyResults =
    mode === 'nearby'
      ? sortedAll.filter(
          (r) =>
            !r.is_outside_smart_limit &&
            r.distance_km <= Math.min(radius, SMART_NEARBY_MAX_DISTANCE_KM)
        )
      : sortedAll

  const results =
    smartNearbyResults.length > 0
      ? smartNearbyResults
      : sortScored(
          scored
            .sort((a, b) => a.distance_km - b.distance_km)
            .slice(0, 12)
            .map((r) => ({
              ...r,
              smart_warning: 'V bližini ni dovolj dobrih zadetkov; prikazujemo najbližje možnosti.',
            })),
          sortBy
        )

  const bestOverall = results[0] || null

  const nearest =
    [...scored]
      .filter((r) => !r.is_outside_smart_limit)
      .sort((a, b) => a.distance_km - b.distance_km)[0] ||
    [...scored].sort((a, b) => a.distance_km - b.distance_km)[0] ||
    null

  const cheapestFuel =
    [...results].sort((a, b) => {
      if (a.price !== b.price) return a.price - b.price
      return a.distance_km - b.distance_km
    })[0] || null

  const bestCrossBorder = results.find((r) => r.is_cross_border) || null

  return NextResponse.json({
    success: true,
    ranking: sortBy,
    mode,
    user: { lat, lng, inferred_country: userCountry },
    params: {
      mode,
      fuel_type: type,
      radius_km: radius,
      amount_liters: amount,
      consumption_l_per_100km: consumption,
      time_value_eur_per_hour: timeValue,
      brand_filter: brandFilter || 'ALL',
      smart_nearby_max_distance_km: SMART_NEARBY_MAX_DISTANCE_KM,
      smart_nearby_max_drive_minutes: SMART_NEARBY_MAX_DRIVE_MINUTES,
      routed_candidates: ROUTED_CANDIDATES_NEARBY,
    },
    summary: {
      best_overall: bestOverall,
      nearest,
      cheapest_fuel: cheapestFuel,
      best_cross_border: bestCrossBorder,
      preferred_best: null,
      saving_vs_nearest:
        bestOverall && nearest
          ? round(Number(nearest.effective_total_cost) - Number(bestOverall.effective_total_cost), 2)
          : 0,
      saving_vs_cheapest_fuel:
        bestOverall && cheapestFuel
          ? round(
              Number(cheapestFuel.effective_total_cost) -
                Number(bestOverall.effective_total_cost),
              2
            )
          : 0,
    },
    results,
    all_considered_count: scored.length,
    smart_results_count: smartNearbyResults.length,
  })
}
