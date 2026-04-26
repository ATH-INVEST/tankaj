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

function normalizeBrand(value?: string | null) {
  return value ? value.trim().toUpperCase() : ''
}

function inferUserCountry(lat: number, lng: number) {
  // SI mora biti pred HR, ker se geografsko prekrivata po grobih mejah.
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

async function enrichWithRealRoutes(
  rows: Result[],
  user: { lat: number; lng: number },
  maxRoutes = 15
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
        return {
          ...r,
          estimated_drive_minutes:
            r.estimated_drive_minutes ?? Math.max(1, Math.round((n(r.distance_km) / 55) * 60)),
          route_source: 'air_distance_fallback',
        }
      }
    })
  )

  return [
    ...enriched,
    ...rows.slice(maxRoutes).map((r) => ({
      ...r,
      estimated_drive_minutes:
        r.estimated_drive_minutes ?? Math.max(1, Math.round((n(r.distance_km) / 55) * 60)),
      route_source: 'air_distance_not_routed',
    })),
  ]
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
  const preferredBrand = normalizeBrand(searchParams.get('preferredBrand'))

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

  // Najprej izberemo dovolj kandidatov po zračni razdalji + ceni,
  // nato za top kandidate izračunamo realno cestno vožnjo.
  const preSorted = [...rows]
    .sort((a, b) => {
      const aBasic = n(a.price) * amount + n(a.distance_km) * 0.2
      const bBasic = n(b.price) * amount + n(b.distance_km) * 0.2
      return aBasic - bBasic
    })
    .slice(0, 40)

  const routedRows = await enrichWithRealRoutes(preSorted, { lat, lng }, 15)

  const scored = routedRows.map((r: any) => {
    const distanceKm = n(r.distance_km)
    const driveMinutes = n(r.estimated_drive_minutes, Math.max(1, Math.round((distanceKm / 55) * 60)))
    const fuelCost = round(n(r.fuel_cost ?? r.total_cost, r.price * amount), 2)

    // Realističen MVP model:
    // - gorivo za dodatno pot šteje v obe smeri
    // - čas šteje v obe smeri
    // Tako ne bo priporočal 30 km vožnje za 0.50 € razlike.
    const travelFuelCost = round(((distanceKm * 2) * consumption / 100) * n(r.price), 2)
    const timeCost = round(((driveMinutes * 2) / 60) * timeValue, 2)
    const effectiveTotalCost = round(fuelCost + travelFuelCost + timeCost, 2)

    const isPreferred = preferredBrand && normalizeBrand(r.brand) === preferredBrand
    const preferenceBonus = isPreferred ? 0.35 : 0

    return {
      ...r,
      distance_km: round(distanceKm, 2),
      estimated_drive_minutes: Math.round(driveMinutes),
      fuel_cost: fuelCost,
      travel_fuel_cost: travelFuelCost,
      time_cost: timeCost,
      effective_total_cost: effectiveTotalCost,
      tankaj_score: round(effectiveTotalCost - preferenceBonus, 2),
      is_preferred_brand: Boolean(isPreferred),
      is_cross_border: userCountry ? Boolean(r.country_code && r.country_code !== userCountry) : false,
    }
  })

  const results = [...scored].sort((a: any, b: any) => {
    if (a.tankaj_score !== b.tankaj_score) return a.tankaj_score - b.tankaj_score
    if (a.price !== b.price) return a.price - b.price
    return a.distance_km - b.distance_km
  })

  const bestOverall = results[0] || null
  const nearest = [...results].sort((a, b) => a.distance_km - b.distance_km)[0] || null

  const cheapestFuel =
    [...results].sort((a, b) => {
      if (a.price !== b.price) return a.price - b.price
      return a.distance_km - b.distance_km
    })[0] || null

  const bestCrossBorder =
    results.find((r: any) => r.is_cross_border) ||
    results.find((r) => r.country_code === 'HR') ||
    null

  const preferredBest = preferredBrand
    ? results.find((r: any) => normalizeBrand(r.brand) === preferredBrand) || null
    : null

  return NextResponse.json({
    success: true,
    ranking: 'smart_tankaj_score_real_routes',
    user: { lat, lng, inferred_country: userCountry },
    params: {
      fuel_type: type,
      radius_km: radius,
      amount_liters: amount,
      consumption_l_per_100km: consumption,
      time_value_eur_per_hour: timeValue,
      brand_filter: brandFilter || 'ALL',
      preferred_brand: preferredBrand || null,
      routed_candidates: 15,
    },
    summary: {
      best_overall: bestOverall,
      nearest,
      cheapest_fuel: cheapestFuel,
      best_cross_border: bestCrossBorder,
      preferred_best: preferredBest,
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
  })
}