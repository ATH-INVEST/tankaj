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
  recommendation_reason?: string | null
  mode?: string
}

const SMART_NEARBY_MAX_DISTANCE_KM = 12
const SMART_NEARBY_MAX_DRIVE_MINUTES = 18
const ROUTED_CANDIDATES_NEARBY = 56

const MIN_ABSOLUTE_SAVING_TO_DRIVE_FURTHER = 1.25
const REQUIRED_SAVING_PER_EXTRA_KM = 0.32
const REQUIRED_SAVING_PER_EXTRA_MIN = 0.14

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
    if (!map.has(row.location_id)) map.set(row.location_id, row)
  }
  return Array.from(map.values())
}

function routeFallbackDistance(distanceKm: number) {
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
            r.estimated_drive_minutes ?? Math.max(1, Math.round((fallbackKm / 45) * 60)),
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
          r.estimated_drive_minutes ?? Math.max(1, Math.round((fallbackKm / 45) * 60)),
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
    .slice(0, 42)

  const cheapestCandidates = [...rows]
    .sort((a, b) => {
      if (a.price !== b.price) return a.price - b.price
      return n(a.distance_km) - n(b.distance_km)
    })
    .slice(0, 42)

  const basicSmartCandidates = [...rows]
    .sort((a, b) => {
      const aBasic = n(a.price) * amount + n(a.distance_km) * 1.05
      const bBasic = n(b.price) * amount + n(b.distance_km) * 1.05
      return aBasic - bBasic
    })
    .slice(0, 56)

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

function reasonForMathematicalBest(
  candidate: AnyResult,
  nearest: AnyResult,
  sortBy: string,
  savingIfFurther: number,
  requiredSaving: number
) {
  if (sortBy === 'price') {
    return 'Najnižja cena na liter v smiselni bližini. Dodatno pot upoštevamo v končnem strošku.'
  }

  if (sortBy === 'total') {
    return 'Najnižji skupni strošek, razlika pa je dovolj velika glede na dodatno vožnjo.'
  }

  if (sortBy === 'distance') {
    return 'Najbližja smiselna možnost v izbranem radiusu.'
  }

  if (savingIfFurther >= requiredSaving) {
    return `Dodatna pot je smiselna, ker prihrani približno ${round(savingIfFurther, 2).toFixed(2)} €.`
  }

  return 'Najboljše razmerje med ceno goriva, razdaljo, časom in stroškom poti.'
}

function chooseHumanBest(results: AnyResult[], sortBy: string) {
  if (!results.length) return null

  const nearest = [...results].sort((a, b) => a.distance_km - b.distance_km)[0]
  const mathematicalBest = sortScored(results, sortBy)[0]

  if (!nearest || !mathematicalBest) return mathematicalBest || nearest || null

  if (nearest.location_id === mathematicalBest.location_id) {
    return {
      ...mathematicalBest,
      recommendation_reason:
        sortBy === 'price'
          ? 'Najnižja cena na liter med najbližjimi smiselnimi možnostmi.'
          : sortBy === 'total'
            ? 'Najnižji skupni strošek v tvoji bližini.'
            : sortBy === 'distance'
              ? 'Najbližja črpalka v izbranem radiusu.'
              : 'Najbolj smiselna izbira v tvoji bližini.',
    }
  }

  if (sortBy === 'distance') {
    return {
      ...nearest,
      recommendation_reason: 'Najbližja smiselna možnost v izbranem radiusu.',
    }
  }

  const savingIfFurther =
    n(nearest.effective_total_cost) - n(mathematicalBest.effective_total_cost)
  const requiredSaving = requiredSavingToRecommendFurther(mathematicalBest, nearest)

  // Ključni popravek:
  // tudi pri "Najnižji skupni strošek" ne priporočamo dodatne vožnje,
  // če je prihranek premajhen. Matematični vrstni red ostane v seznamu spodaj.
  if (savingIfFurther >= requiredSaving) {
    return {
      ...mathematicalBest,
      recommendation_reason: reasonForMathematicalBest(
        mathematicalBest,
        nearest,
        sortBy,
        savingIfFurther,
        requiredSaving
      ),
    }
  }

  return {
    ...nearest,
    recommendation_reason:
      savingIfFurther > 0
        ? `Najcenejša opcija prihrani samo ${round(
            savingIfFurther,
            2
          ).toFixed(2)} €, zato priporočamo bližjo izbiro.`
        : 'Najbližja možnost je tudi najbolj smiselna izbira.',
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
  const timeValue = Number(searchParams.get('timeValue') || 6)

  const brandFilter = normalizeBrand(searchParams.get('brand') || searchParams.get('brandFilter'))
  const mode = searchParams.get('mode') === 'route' ? 'route' : 'nearby'
  const sortBy = searchParams.get('sortBy') || 'smart'

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
      Math.max(1, Math.round((distanceKm / 45) * 60))
    )

    const fuelCost = round(n(r.fuel_cost ?? r.total_cost, r.price * amount), 2)
    const travelFuelCost = round(((distanceKm * tripMultiplier) * consumption / 100) * n(r.price), 2)
    const timeCost = round((driveMinutes / 60) * timeValue, 2)
    const effectiveTotalCost = round(fuelCost + travelFuelCost + timeCost, 2)

    const outsideSmartLimit =
      mode === 'nearby' &&
      (distanceKm > SMART_NEARBY_MAX_DISTANCE_KM ||
        driveMinutes > SMART_NEARBY_MAX_DRIVE_MINUTES)

    const conveniencePenalty =
      mode === 'nearby'
        ? Math.max(0, distanceKm - 2) * 0.6 + Math.max(0, driveMinutes - 4) * 0.22
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
        ? 'Smiselno predvsem, če si že na poti v to smer.'
        : r.smart_warning || null,
      mode,
    }
  }) as AnyResult[]

  const eligibleNearby =
    mode === 'nearby' ? scored.filter((r) => isInsideNearbyLimit(r, radius)) : scored

  const fallbackNearby =
    eligibleNearby.length > 0
      ? eligibleNearby
      : scored
          .sort((a, b) => a.distance_km - b.distance_km)
          .slice(0, 12)
          .map((r) => ({
            ...r,
            smart_warning:
              'V bližini ni dovolj dobrih zadetkov; prikazujemo najbližje možnosti.',
          }))

  const humanBest = chooseHumanBest(fallbackNearby, sortBy)
  const sortedForList = sortScored(
    fallbackNearby.filter((r) => r.location_id !== humanBest?.location_id),
    sortBy
  )

  const resultsRaw = humanBest ? [humanBest, ...sortedForList] : sortedForList

  const results = resultsRaw.map((item, index) => {
    if (index === 0 && item.recommendation_reason) return item

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
          item.recommendation_reason || 'Razvrščeno po najbližji črpalki.',
      }
    }

    return {
      ...item,
      recommendation_reason:
        item.recommendation_reason || 'Dobra alternativa glede na ceno, pot in čas.',
    }
  })

  const bestOverall = results[0] || null
  const nearest = [...fallbackNearby].sort((a, b) => a.distance_km - b.distance_km)[0] || null

  const cheapestFuel =
    [...fallbackNearby].sort((a, b) => {
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
    smart_results_count: eligibleNearby.length,
  })
}
