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
  air_distance_km?: number
  route_source?: 'openrouteservice' | 'osrm' | 'air_distance_fallback'
  is_real_route?: boolean
  travel_fuel_cost?: number
  time_cost?: number
  tankaj_score?: number
  is_cross_border?: boolean
  is_outside_smart_limit?: boolean
  smart_warning?: string | null
  recommendation_reason?: string | null
  mode?: string
}

const SMART_NEARBY_MAX_DISTANCE_KM = 12
const SMART_NEARBY_MAX_DRIVE_MINUTES = 18
const ROUTED_CANDIDATES_NEARBY = 64

// Bolj realna vrednost časa. 6 €/h je prenizko in preveč spodbuja nepotrebno vožnjo.
const DEFAULT_TIME_VALUE_EUR_PER_HOUR = 12

const MIN_ABSOLUTE_SAVING_TO_DRIVE_FURTHER = 1.50
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

function haversineKm(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const earthRadiusKm = 6371
  const dLat = ((to.lat - from.lat) * Math.PI) / 180
  const dLng = ((to.lng - from.lng) * Math.PI) / 180

  const lat1 = (from.lat * Math.PI) / 180
  const lat2 = (to.lat * Math.PI) / 180

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)

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

  // Realna cestna pot praviloma ne more biti krajša od zračne razdalje.
  if (routeKm < airKm * 0.98) return true

  // Posebej pomembno za obalo / mejo SI-HR: zračna razdalja čez morje je lahko 5–8 km,
  // realna vožnja pa 20–35 km. Če router vrne skoraj zračno razdaljo, je verjetno neuporabno.
  if (userCountry && stationCountry && userCountry !== stationCountry && airKm < 15 && routeKm < airKm * 2.1) {
    return true
  }

  return false
}

async function getOsrmDrivingDistance(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
) {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}?overview=false&alternatives=false&steps=false`

  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
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
        is_real_route: true,
      }
    }
  } catch {
    // nadaljuj na OSRM fallback
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
        is_real_route: true,
      }
    }
  } catch {
    // fallback spodaj
  }

  return null
}

async function enrichWithRealRoutes(
  rows: Result[],
  user: { lat: number; lng: number },
  userCountry: string | null,
  maxRoutes = ROUTED_CANDIDATES_NEARBY
) {
  const candidates = rows.slice(0, maxRoutes)

  const enriched = await Promise.all(
    candidates.map(async (r) => {
      if (!r.lat || !r.lng) return r as AnyResult

      const to = { lat: Number(r.lat), lng: Number(r.lng) }
      const airKm = round(haversineKm(user, to), 2)

      const realRoute = await getBestRealRoute(user, to, {
        userCountry,
        stationCountry: r.country_code,
        airKm,
      })

      if (realRoute) {
        return {
          ...r,
          air_distance_km: airKm,
          distance_km: realRoute.distance_km,
          estimated_drive_minutes: realRoute.duration_min,
          route_source: realRoute.route_source,
          is_real_route: true,
        } as AnyResult
      }

      const fallbackKm = round(Math.max(n(r.distance_km), airKm) * 1.35, 2)

      return {
        ...r,
        air_distance_km: airKm,
        distance_km: fallbackKm,
        estimated_drive_minutes:
          r.estimated_drive_minutes ?? Math.max(1, Math.round((fallbackKm / 45) * 60)),
        route_source: 'air_distance_fallback',
        is_real_route: false,
        smart_warning: 'Razdalja je ocenjena. Preveri v navigaciji.',
      } as AnyResult
    })
  )

  return [
    ...enriched,
    ...rows.slice(maxRoutes).map((r) => {
      const fallbackKm = round(n(r.distance_km) * 1.35, 2)

      return {
        ...r,
        air_distance_km: n(r.distance_km),
        distance_km: fallbackKm,
        estimated_drive_minutes:
          r.estimated_drive_minutes ?? Math.max(1, Math.round((fallbackKm / 45) * 60)),
        route_source: 'air_distance_fallback',
        is_real_route: false,
        smart_warning: 'Razdalja je ocenjena. Preveri v navigaciji.',
      } as AnyResult
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
    .slice(0, 48)

  const cheapestCandidates = [...rows]
    .sort((a, b) => {
      if (a.price !== b.price) return a.price - b.price
      return n(a.distance_km) - n(b.distance_km)
    })
    .slice(0, 48)

  const basicSmartCandidates = [...rows]
    .sort((a, b) => {
      const aBasic = n(a.price) * amount + n(a.distance_km) * 1.2
      const bBasic = n(b.price) * amount + n(b.distance_km) * 1.2
      return aBasic - bBasic
    })
    .slice(0, 64)

  if (sortBy === 'price') {
    return uniqueByLocation([...cheapestCandidates, ...nearestCandidates, ...basicSmartCandidates])
  }

  if (sortBy === 'distance') {
    return uniqueByLocation([...nearestCandidates, ...cheapestCandidates, ...basicSmartCandidates])
  }

  return uniqueByLocation([...nearestCandidates, ...basicSmartCandidates, ...cheapestCandidates])
}

function isInsideNearbyLimit(r: AnyResult, radius: number) {
  return (
    Boolean(r.is_real_route) &&
    r.distance_km <= Math.min(radius, SMART_NEARBY_MAX_DISTANCE_KM) &&
    n(r.estimated_drive_minutes) <= SMART_NEARBY_MAX_DRIVE_MINUTES
  )
}

function requiredSavingToRecommendFurther(candidate: AnyResult, nearest: AnyResult) {
  const extraKm = Math.max(0, candidate.distance_km - nearest.distance_km)
  const extraMin = Math.max(
    0,
    n(candidate.estimated_drive_minutes) - n(nearest.estimated_drive_minutes)
  )

  return Math.max(
    MIN_ABSOLUTE_SAVING_TO_DRIVE_FURTHER,
    extraKm * REQUIRED_SAVING_PER_EXTRA_KM + extraMin * REQUIRED_SAVING_PER_EXTRA_MIN
  )
}

function reasonForChoice(params: {
  sortBy: string
  candidate: AnyResult
  nearest: AnyResult
  savingIfFurther: number
  requiredSaving: number
}) {
  const { sortBy, candidate, nearest, savingIfFurther, requiredSaving } = params

  if (sortBy === 'distance') {
    return 'Najbližja črpalka po realni cestni poti.'
  }

  if (sortBy === 'price') {
    if (candidate.location_id !== nearest.location_id && savingIfFurther < requiredSaving) {
      return `Najcenejša opcija prihrani samo ${round(savingIfFurther, 2).toFixed(
        2
      )} €, zato priporočamo bližjo izbiro.`
    }

    return 'Najnižja cena na liter med realno dosegljivimi črpalkami.'
  }

  if (sortBy === 'total') {
    if (candidate.location_id !== nearest.location_id && savingIfFurther < requiredSaving) {
      return `Najnižji strošek prihrani samo ${round(savingIfFurther, 2).toFixed(
        2
      )} €, zato priporočamo bližjo izbiro.`
    }

    return 'Najnižji skupni strošek: gorivo + pot do črpalke + ocenjen čas.'
  }

  if (candidate.location_id !== nearest.location_id && savingIfFurther >= requiredSaving) {
    return `Dodatna pot je smiselna, ker prihrani približno ${round(savingIfFurther, 2).toFixed(
      2
    )} €.`
  }

  return 'Najbolj smiselna izbira v tvoji bližini.'
}

function chooseHumanBest(results: AnyResult[], sortBy: string) {
  if (!results.length) return null

  const nearest = [...results].sort((a, b) => a.distance_km - b.distance_km)[0]
  const mathematicalBest = sortScored(results, sortBy)[0]

  if (!nearest || !mathematicalBest) return mathematicalBest || nearest || null

  if (sortBy === 'distance') {
    return {
      ...nearest,
      recommendation_reason: reasonForChoice({
        sortBy,
        candidate: nearest,
        nearest,
        savingIfFurther: 0,
        requiredSaving: 0,
      }),
    }
  }

  const savingIfFurther =
    n(nearest.effective_total_cost) - n(mathematicalBest.effective_total_cost)

  const requiredSaving = requiredSavingToRecommendFurther(mathematicalBest, nearest)

  const shouldUseMathematicalBest =
    nearest.location_id === mathematicalBest.location_id || savingIfFurther >= requiredSaving

  const chosen = shouldUseMathematicalBest ? mathematicalBest : nearest

  return {
    ...chosen,
    recommendation_reason: reasonForChoice({
      sortBy,
      candidate: chosen,
      nearest,
      savingIfFurther,
      requiredSaving,
    }),
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)

  const lat = Number(searchParams.get('lat'))
  const lng = Number(searchParams.get('lng'))
  const radius = Number(searchParams.get('radius') || 25)
  const type = searchParams.get('type') || 'PETROL_95'
  const amount = Number(searchParams.get('amount') || 50)

  const consumption = Number(searchParams.get('consumption') || 7)
  const timeValue = Number(searchParams.get('timeValue') || DEFAULT_TIME_VALUE_EUR_PER_HOUR)

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
  const routedRows = await enrichWithRealRoutes(
    candidatePool,
    { lat, lng },
    userCountry,
    ROUTED_CANDIDATES_NEARBY
  )

  const scored = routedRows.map((r) => {
    const distanceKm = n(r.distance_km)
    const driveMinutes = n(
      r.estimated_drive_minutes,
      Math.max(1, Math.round((distanceKm / 45) * 60))
    )

    const fuelCost = round(n(r.fuel_cost ?? r.total_cost, r.price * amount), 2)
    const travelFuelCost = round(((distanceKm * tripMultiplier) * consumption / 100) * n(r.price), 2)
    const timeCost = round((driveMinutes / 60) * timeValue, 2)
    const effectiveTotalCost = round(fuelCost + travelFuelCost + timeCost, 2)

    const outsideSmartLimit =
      mode === 'nearby' &&
      (!r.is_real_route ||
        distanceKm > SMART_NEARBY_MAX_DISTANCE_KM ||
        driveMinutes > SMART_NEARBY_MAX_DRIVE_MINUTES)

    const conveniencePenalty =
      mode === 'nearby'
        ? Math.max(0, distanceKm - 2) * 0.75 + Math.max(0, driveMinutes - 4) * 0.3
        : 0

    return {
      ...r,
      distance_km: round(distanceKm, 2),
      estimated_drive_minutes: Math.round(driveMinutes),
      fuel_cost: fuelCost,
      travel_fuel_cost: travelFuelCost,
      time_cost: timeCost,
      effective_total_cost: effectiveTotalCost,
      tankaj_score: round(effectiveTotalCost + conveniencePenalty, 2),
      is_cross_border: userCountry ? Boolean(r.country_code && r.country_code !== userCountry) : false,
      is_outside_smart_limit: outsideSmartLimit,
      smart_warning: outsideSmartLimit
        ? r.is_real_route
          ? 'Izven smart limita. Smiselno predvsem, če si že na poti v to smer.'
          : 'Razdalja je ocenjena. Preveri v navigaciji.'
        : r.smart_warning || null,
      mode,
    } as AnyResult
  })

  const realRouted = scored.filter((r) => r.is_real_route)
  const eligibleNearby =
    mode === 'nearby' ? realRouted.filter((r) => isInsideNearbyLimit(r, radius)) : realRouted

  const fallbackCandidates =
    eligibleNearby.length > 0
      ? eligibleNearby
      : realRouted.length > 0
        ? realRouted
            .sort((a, b) => a.distance_km - b.distance_km)
            .slice(0, 12)
            .map((r) => ({
              ...r,
              smart_warning: 'Ni zadetkov znotraj smart limita; prikazujemo najbližje realne poti.',
            }))
        : scored
            .sort((a, b) => a.distance_km - b.distance_km)
            .slice(0, 12)
            .map((r) => ({
              ...r,
              smart_warning:
                'Ni uspelo pridobiti realnih poti; rezultati so samo informativna ocena.',
            }))

  const humanBest = chooseHumanBest(fallbackCandidates, sortBy)

  const sortedForList = sortScored(
    fallbackCandidates.filter((r) => r.location_id !== humanBest?.location_id),
    sortBy
  )

  const secondaryFallbacks = sortScored(
    scored.filter(
      (r) =>
        r.location_id !== humanBest?.location_id &&
        !fallbackCandidates.some((candidate) => candidate.location_id === r.location_id)
    ),
    sortBy
  ).slice(0, 8)

  const resultsRaw = humanBest
    ? [humanBest, ...sortedForList, ...secondaryFallbacks]
    : [...sortedForList, ...secondaryFallbacks]

  const results = resultsRaw.map((item, index) => {
    if (index === 0 && item.recommendation_reason) return item

    if (!item.is_real_route) {
      return {
        ...item,
        recommendation_reason: item.recommendation_reason || 'Informativna ocena razdalje; preveri v navigaciji.',
      }
    }

    if (sortBy === 'price') {
      return {
        ...item,
        recommendation_reason:
          item.recommendation_reason ||
          'Nižja cena na liter; končni strošek je prikazan posebej.',
      }
    }

    if (sortBy === 'total') {
      return {
        ...item,
        recommendation_reason:
          item.recommendation_reason ||
          'Razvrščeno po najnižjem skupnem strošku.',
      }
    }

    if (sortBy === 'distance') {
      return {
        ...item,
        recommendation_reason:
          item.recommendation_reason || 'Razvrščeno po najbližji realni poti.',
      }
    }

    return {
      ...item,
      recommendation_reason:
        item.recommendation_reason || 'Dobra alternativa glede na ceno, pot in čas.',
    }
  })

  const bestOverall = results[0] || null
  const nearest = [...fallbackCandidates].sort((a, b) => a.distance_km - b.distance_km)[0] || null

  const cheapestFuel =
    [...fallbackCandidates].sort((a, b) => {
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
      min_absolute_saving_to_drive_further: MIN_ABSOLUTE_SAVING_TO_DRIVE_FURTHER,
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
    real_routed_count: realRouted.length,
    smart_results_count: eligibleNearby.length,
  })
}
