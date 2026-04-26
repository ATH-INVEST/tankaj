import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getDrivingDistance } from '@/lib/ors'

type RouteSource = 'openrouteservice' | 'osrm'

type Result = {
  location_id: string
  name: string
  brand: string | null
  address: string | null
  city: string | null
  country_code?: string | null
  lat?: number | null
  lng?: number | null
  distance_km: number
  estimated_drive_minutes?: number | null
  fuel_type: string
  price: number
  total_cost?: number | null
  fuel_cost?: number | null
  effective_total_cost?: number | null
  source?: string | null
  captured_at?: string | null
}

type AnyResult = Result & {
  lat: number
  lng: number
  air_distance_km: number
  distance_km: number
  estimated_drive_minutes: number
  route_source: RouteSource
  is_real_route: true
  travel_fuel_cost: number
  time_cost: number
  tankaj_score: number
  is_cross_border: boolean
  is_outside_smart_limit: boolean
  smart_warning: string | null
  recommendation_reason: string | null
  mode: 'nearby' | 'route'
}

const SMART_NEARBY_MAX_DISTANCE_KM = 12
const SMART_NEARBY_MAX_DRIVE_MINUTES = 18
const ROUTED_CANDIDATES_NEARBY = 72
const ROUTING_CONCURRENCY = 6

const DEFAULT_TIME_VALUE_EUR_PER_HOUR = 12
const DEFAULT_CONSUMPTION_L_PER_100KM = 7

const MIN_ABSOLUTE_SAVING_TO_DRIVE_FURTHER = 1.5
const REQUIRED_SAVING_PER_EXTRA_KM = 0.38
const REQUIRED_SAVING_PER_EXTRA_MIN = 0.18

function normalizeBrand(value?: string | null) {
  return value ? value.trim().toUpperCase() : ''
}

function inferUserCountry(lat: number, lng: number) {
  if (lat >= 45 && lat <= 47 && lng >= 13 && lng <= 17) return 'SI'
  if (lat >= 42 && lat <= 47 && lng >= 13 && lng <= 20) return 'HR'
  return null
}

function n(value: unknown, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function round(value: number, decimals = 2) {
  return Number(value.toFixed(decimals))
}

function hasCoordinates(row: Result): row is Result & { lat: number; lng: number } {
  return Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.lng))
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

function haversineKm(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const earthRadiusKm = 6371
  const dLat = ((to.lat - from.lat) * Math.PI) / 180
  const dLng = ((to.lng - from.lng) * Math.PI) / 180
  const lat1 = (from.lat * Math.PI) / 180
  const lat2 = (to.lat * Math.PI) / 180

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function isSuspiciousRouteDistance(params: {
  routeKm: number
  airKm: number
  userCountry: string | null
  stationCountry?: string | null
}) {
  const { routeKm, airKm, userCountry, stationCountry } = params

  if (!Number.isFinite(routeKm) || routeKm <= 0) return true
  if (!Number.isFinite(airKm) || airKm <= 0) return false

  if (routeKm < airKm * 0.98) return true

  if (
    userCountry &&
    stationCountry &&
    userCountry !== stationCountry &&
    airKm < 15 &&
    routeKm < airKm * 2.1
  ) {
    return true
  }

  return false
}

async function getOsrmDrivingDistance(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${from.lng},${from.lat};${to.lng},${to.lat}?overview=false&alternatives=false&steps=false`

    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    })

    if (!res.ok) throw new Error(`OSRM failed with ${res.status}`)

    const json = await res.json()
    const route = json?.routes?.[0]

    if (!route?.distance || !route?.duration) {
      throw new Error('OSRM returned no route')
    }

    return {
      distance_km: route.distance / 1000,
      duration_min: route.duration / 60,
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function getBestRealRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  meta: { userCountry: string | null; stationCountry?: string | null; airKm: number }
) {
  try {
    const route = await getDrivingDistance(from, to)
    const routeKm = round(route.distance_km, 2)

    if (
      !isSuspiciousRouteDistance({
        routeKm,
        airKm: meta.airKm,
        userCountry: meta.userCountry,
        stationCountry: meta.stationCountry,
      })
    ) {
      return {
        distance_km: routeKm,
        duration_min: Math.max(1, Math.round(route.duration_min)),
        route_source: 'openrouteservice' as const,
      }
    }
  } catch {
    // fallback to OSRM
  }

  try {
    const route = await getOsrmDrivingDistance(from, to)
    const routeKm = round(route.distance_km, 2)

    if (
      !isSuspiciousRouteDistance({
        routeKm,
        airKm: meta.airKm,
        userCountry: meta.userCountry,
        stationCountry: meta.stationCountry,
      })
    ) {
      return {
        distance_km: routeKm,
        duration_min: Math.max(1, Math.round(route.duration_min)),
        route_source: 'osrm' as const,
      }
    }
  } catch {
    // no usable route
  }

  return null
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++
      results[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  )

  return results
}

async function enrichWithRealRoutes(
  rows: Result[],
  user: { lat: number; lng: number },
  userCountry: string | null,
  maxRoutes = ROUTED_CANDIDATES_NEARBY
) {
  const candidates = rows.slice(0, maxRoutes).filter(hasCoordinates)

  const routed = await mapWithConcurrency(candidates, ROUTING_CONCURRENCY, async (r) => {
    const to = { lat: Number(r.lat), lng: Number(r.lng) }
    const airKm = round(haversineKm(user, to), 2)

    const realRoute = await getBestRealRoute(user, to, {
      userCountry,
      stationCountry: r.country_code,
      airKm,
    })

    if (!realRoute) return null

    return {
      ...r,
      lat: to.lat,
      lng: to.lng,
      air_distance_km: airKm,
      distance_km: realRoute.distance_km,
      estimated_drive_minutes: realRoute.duration_min,
      route_source: realRoute.route_source,
      is_real_route: true as const,
    }
  })

  return routed.filter(Boolean) as Array<
    Result & {
      lat: number
      lng: number
      air_distance_km: number
      distance_km: number
      estimated_drive_minutes: number
      route_source: RouteSource
      is_real_route: true
    }
  >
}

function buildCandidatePool(rows: Result[], amount: number, sortBy: string) {
  const nearestCandidates = [...rows]
    .sort((a, b) => n(a.distance_km, Number.POSITIVE_INFINITY) - n(b.distance_km, Number.POSITIVE_INFINITY))
    .slice(0, 56)

  const cheapestCandidates = [...rows]
    .sort((a, b) => {
      if (a.price !== b.price) return a.price - b.price
      return n(a.distance_km, Number.POSITIVE_INFINITY) - n(b.distance_km, Number.POSITIVE_INFINITY)
    })
    .slice(0, 56)

  const smartCandidates = [...rows]
    .sort((a, b) => {
      const aBasic = n(a.price) * amount + n(a.distance_km, 999) * 1.25
      const bBasic = n(b.price) * amount + n(b.distance_km, 999) * 1.25
      return aBasic - bBasic
    })
    .slice(0, 72)

  if (sortBy === 'price') {
    return uniqueByLocation([...cheapestCandidates, ...nearestCandidates, ...smartCandidates])
  }

  if (sortBy === 'distance') {
    return uniqueByLocation([...nearestCandidates, ...cheapestCandidates, ...smartCandidates])
  }

  return uniqueByLocation([...nearestCandidates, ...smartCandidates, ...cheapestCandidates])
}

function scoreRows(
  rows: Awaited<ReturnType<typeof enrichWithRealRoutes>>,
  params: {
    amount: number
    consumption: number
    timeValue: number
    userCountry: string | null
    mode: 'nearby' | 'route'
  }
) {
  const { amount, consumption, timeValue, userCountry, mode } = params

  return rows.map((r) => {
    const distanceKm = round(n(r.distance_km), 2)
    const driveMinutes = Math.max(1, Math.round(n(r.estimated_drive_minutes)))

    const fuelCost = round(n(r.fuel_cost ?? r.total_cost, r.price * amount), 2)
    const travelFuelCost = round(((distanceKm * consumption) / 100) * n(r.price), 2)
    const timeCost = round((driveMinutes / 60) * timeValue, 2)
    const effectiveTotalCost = round(fuelCost + travelFuelCost + timeCost, 2)

    const outsideSmartLimit =
      mode === 'nearby' &&
      (distanceKm > SMART_NEARBY_MAX_DISTANCE_KM ||
        driveMinutes > SMART_NEARBY_MAX_DRIVE_MINUTES)

    const conveniencePenalty =
      mode === 'nearby'
        ? Math.max(0, distanceKm - 2) * 0.75 + Math.max(0, driveMinutes - 4) * 0.3
        : 0

    return {
      ...r,
      distance_km: distanceKm,
      estimated_drive_minutes: driveMinutes,
      fuel_cost: fuelCost,
      travel_fuel_cost: travelFuelCost,
      time_cost: timeCost,
      effective_total_cost: effectiveTotalCost,
      tankaj_score: round(effectiveTotalCost + conveniencePenalty, 2),
      is_cross_border: userCountry ? Boolean(r.country_code && r.country_code !== userCountry) : false,
      is_outside_smart_limit: outsideSmartLimit,
      smart_warning: outsideSmartLimit
        ? 'Izven smart limita. Smiselno predvsem, če si že na poti v to smer.'
        : null,
      recommendation_reason: null,
      mode,
    } satisfies AnyResult
  })
}

function sortBySelectedFilter(rows: AnyResult[], sortBy: string) {
  return [...rows].sort((a, b) => {
    const aDistance = a.distance_km ?? Number.POSITIVE_INFINITY
    const bDistance = b.distance_km ?? Number.POSITIVE_INFINITY
    const aTotal = a.effective_total_cost ?? Number.POSITIVE_INFINITY
    const bTotal = b.effective_total_cost ?? Number.POSITIVE_INFINITY
    const aScore = a.tankaj_score ?? Number.POSITIVE_INFINITY
    const bScore = b.tankaj_score ?? Number.POSITIVE_INFINITY

    if (sortBy === 'price') {
      if (a.price !== b.price) return a.price - b.price
      if (aDistance !== bDistance) return aDistance - bDistance
      return aTotal - bTotal
    }

    if (sortBy === 'distance') {
      if (aDistance !== bDistance) return aDistance - bDistance
      if (a.price !== b.price) return a.price - b.price
      return aTotal - bTotal
    }

    if (aScore !== bScore) return aScore - bScore
    if (aTotal !== bTotal) return aTotal - bTotal
    return aDistance - bDistance
  })
}

function requiredSavingToRecommendFurther(candidate: AnyResult, nearest: AnyResult) {
  const extraKm = Math.max(0, candidate.distance_km - nearest.distance_km)
  const extraMin = Math.max(0, candidate.estimated_drive_minutes - nearest.estimated_drive_minutes)

  return Math.max(
    MIN_ABSOLUTE_SAVING_TO_DRIVE_FURTHER,
    extraKm * REQUIRED_SAVING_PER_EXTRA_KM + extraMin * REQUIRED_SAVING_PER_EXTRA_MIN
  )
}

function pickWinner(rows: AnyResult[], sortBy: string, radius: number) {
  const insideRadius = rows.filter((r) => r.distance_km <= radius)

  if (!insideRadius.length) {
    const nearestAny = sortBySelectedFilter(rows, 'distance')[0]

    return nearestAny
      ? {
          ...nearestAny,
          recommendation_reason:
            'V izbranem radiusu ni realno izračunanih poti; prikazujemo najbližjo realno možnost.',
        }
      : null
  }

  if (sortBy === 'price') {
    const winner = sortBySelectedFilter(insideRadius, 'price')[0]

    return winner
      ? {
          ...winner,
          recommendation_reason: `Najcenejša cena na liter v izbranem radiusu ${radius} km.`,
        }
      : null
  }

  if (sortBy === 'distance') {
    const winner = sortBySelectedFilter(insideRadius, 'distance')[0]

    return winner
      ? {
          ...winner,
          recommendation_reason: 'Najbližja črpalka po realni cestni poti.',
        }
      : null
  }

  const smartPool = insideRadius.filter(
    (r) =>
      r.distance_km <= Math.min(radius, SMART_NEARBY_MAX_DISTANCE_KM) &&
      r.estimated_drive_minutes <= SMART_NEARBY_MAX_DRIVE_MINUTES
  )

  const usablePool = smartPool.length ? smartPool : insideRadius

  const nearest = sortBySelectedFilter(usablePool, 'distance')[0]
  const mathematicalBest = sortBySelectedFilter(usablePool, 'smart')[0]

  if (!nearest || !mathematicalBest) return mathematicalBest || nearest || null

  const savingIfFurther = round(
    Number(nearest.effective_total_cost) - Number(mathematicalBest.effective_total_cost),
    2
  )

  const requiredSaving = requiredSavingToRecommendFurther(mathematicalBest, nearest)

  if (nearest.location_id === mathematicalBest.location_id || savingIfFurther >= requiredSaving) {
    return {
      ...mathematicalBest,
      recommendation_reason:
        nearest.location_id === mathematicalBest.location_id
          ? 'Najbolj smiselna izbira v tvoji bližini.'
          : `Dodatna pot je smiselna, ker prihrani približno ${savingIfFurther.toFixed(2)} €.`,
    }
  }

  return {
    ...nearest,
    recommendation_reason:
      savingIfFurther > 0
        ? `Cenejša možnost prihrani samo ${savingIfFurther.toFixed(
            2
          )} €, zato priporočamo bližjo izbiro.`
        : 'Najbližja možnost je tudi najbolj smiselna izbira.',
  }
}

function reasonForListItem(item: AnyResult, sortBy: string) {
  if (sortBy === 'price') return 'Naslednja možnost po ceni na liter.'
  if (sortBy === 'distance') return 'Naslednja najbližja realna možnost.'
  if (item.is_outside_smart_limit) return 'Dobra možnost, vendar izven pametnega limita.'
  return 'Dobra alternativa glede na ceno, pot in čas.'
}

function buildFallbackResults(rows: Result[], radius: number, winnerId?: string) {
  return rows
    .filter((r) => r.location_id !== winnerId)
    .filter((r) => n(r.distance_km, Number.POSITIVE_INFINITY) <= radius)
    .slice(0, 12)
    .map((r) => ({
      ...r,
      is_real_route: false,
      recommendation_reason:
        'Prikazano samo kot dodatna možnost, ker realna cestna pot ni bila izračunana.',
    }))
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)

  const lat = Number(searchParams.get('lat'))
  const lng = Number(searchParams.get('lng'))
  const radius = Number(searchParams.get('radius') || 25)
  const type = searchParams.get('type') || 'PETROL_95'
  const amount = Number(searchParams.get('amount') || 50)

  const consumption = Number(
    searchParams.get('consumption') || DEFAULT_CONSUMPTION_L_PER_100KM
  )

  const timeValue = Number(
    searchParams.get('timeValue') || DEFAULT_TIME_VALUE_EUR_PER_HOUR
  )

  const brandFilter = normalizeBrand(searchParams.get('brand') || searchParams.get('brandFilter'))

  const mode: 'nearby' | 'route' = searchParams.get('mode') === 'route' ? 'route' : 'nearby'

  const requestedSortBy = searchParams.get('sortBy') || 'smart'
  const sortBy =
    requestedSortBy === 'price' || requestedSortBy === 'distance'
      ? requestedSortBy
      : 'smart'

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json(
      { success: false, error: 'Missing or invalid lat/lng' },
      { status: 400 }
    )
  }

  if (!Number.isFinite(radius) || radius <= 0) {
    return NextResponse.json(
      { success: false, error: 'Missing or invalid radius' },
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
    .filter(hasCoordinates)

  if (brandFilter && brandFilter !== 'ALL') {
    rows = rows.filter((r) => normalizeBrand(r.brand) === brandFilter)
  }

  const candidatePool = buildCandidatePool(rows, amount, sortBy)

  const routedRows = await enrichWithRealRoutes(
    candidatePool,
    { lat, lng },
    userCountry,
    ROUTED_CANDIDATES_NEARBY
  )

  const scored = scoreRows(routedRows, {
    amount,
    consumption,
    timeValue,
    userCountry,
    mode,
  })

  const validScored = scored.filter(
    (r) =>
      r.is_real_route === true &&
      Number.isFinite(r.distance_km) &&
      Number.isFinite(r.estimated_drive_minutes) &&
      Number.isFinite(Number(r.effective_total_cost)) &&
      Number.isFinite(Number(r.tankaj_score))
  )

  const winner = pickWinner(validScored, sortBy, radius)

  const sortedOtherOptions = sortBySelectedFilter(
    validScored.filter(
      (r) => r.location_id !== winner?.location_id && r.distance_km <= radius
    ),
    sortBy
  ).map((item) => ({
    ...item,
    recommendation_reason: item.recommendation_reason || reasonForListItem(item, sortBy),
  }))

  const results = winner ? [winner, ...sortedOtherOptions] : sortedOtherOptions

  const nearest =
    sortBySelectedFilter(
      validScored.filter((r) => r.distance_km <= radius),
      'distance'
    )[0] || null

  const cheapestFuel =
    sortBySelectedFilter(
      validScored.filter((r) => r.distance_km <= radius),
      'price'
    )[0] || null

  const bestCrossBorder = results.find((r) => r.is_cross_border) || null

  const fallbackResults = buildFallbackResults(rows, radius, winner?.location_id)

  return NextResponse.json({
    success: true,
    ranking: sortBy,
    mode,
    user: {
      lat,
      lng,
      inferred_country: userCountry,
    },
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
      routing_concurrency: ROUTING_CONCURRENCY,
    },
    summary: {
      best_overall: results[0] || null,
      nearest,
      cheapest_fuel: cheapestFuel,
      best_cross_border: bestCrossBorder,
      preferred_best: results[0] || null,
      saving_vs_nearest:
        results[0] && nearest
          ? round(
              Number(nearest.effective_total_cost) -
                Number(results[0].effective_total_cost),
              2
            )
          : 0,
      saving_vs_cheapest_fuel:
        results[0] && cheapestFuel
          ? round(
              Number(cheapestFuel.effective_total_cost) -
                Number(results[0].effective_total_cost),
              2
            )
          : 0,
    },
    results,
    fallback_results: fallbackResults,
    counts: {
      all_considered_count: rows.length,
      candidate_pool_count: candidatePool.length,
      real_routed_count: validScored.length,
      fallback_count: fallbackResults.length,
      smart_results_count: validScored.filter(
        (r) =>
          r.distance_km <= Math.min(radius, SMART_NEARBY_MAX_DISTANCE_KM) &&
          r.estimated_drive_minutes <= SMART_NEARBY_MAX_DRIVE_MINUTES
      ).length,
    },
  })
}