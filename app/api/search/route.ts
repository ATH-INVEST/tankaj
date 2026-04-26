import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

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
  real_trip_cost?: number
  time_penalty?: number
  tankaj_score?: number
  source?: string
  captured_at?: string
}

function normalizeBrand(value?: string | null) {
  if (!value) return ''
  return value.trim().toUpperCase()
}

function inferUserCountry(lat: number, lng: number) {
  // dovolj dobro za MVP
  if (lat >= 42 && lat <= 47 && lng >= 13 && lng <= 20) return 'HR'
  if (lat >= 45 && lat <= 47 && lng >= 13 && lng <= 17) return 'SI'
  return null
}

function n(value: any, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function round(value: number, decimals = 2) {
  return Number(value.toFixed(decimals))
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)

  const lat = Number(searchParams.get('lat'))
  const lng = Number(searchParams.get('lng'))
  const radius = Number(searchParams.get('radius') || 25)
  const type = searchParams.get('type') || 'PETROL_95'
  const amount = Number(searchParams.get('amount') || 50)

  const consumption = Number(searchParams.get('consumption') || 7)
  const avgSpeed = Number(searchParams.get('avgSpeed') || 55)
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
    avg_speed_kmh: avgSpeed,
    time_value_eur_per_hour: timeValue,
  })

  if (error) {
    return NextResponse.json({ success: false, error }, { status: 500 })
  }

  const userCountry = inferUserCountry(lat, lng)

  let baseResults = ((data || []) as Result[])
    .filter((r) => Number.isFinite(Number(r.price)))
    .map((r) => {
      const distanceKm = n(r.distance_km)
      const driveMinutes =
        r.estimated_drive_minutes !== undefined && r.estimated_drive_minutes !== null
          ? n(r.estimated_drive_minutes)
          : Math.max(1, Math.round((distanceKm / avgSpeed) * 60))

      const fuelCost = round(n(r.fuel_cost ?? r.total_cost, r.price * amount), 2)

      // MVP strošek poti: vožnja tja + približen čas.
      // Za zdaj uporabimo konservativen model, da ne forsiramo vožnje daleč samo zaradi 1–2 € razlike.
      const travelFuelCost = round(((distanceKm * 2) * consumption / 100) * n(r.price), 2)
      const timeCost = round((driveMinutes / 60) * timeValue, 2)

      const effectiveTotalCost = round(fuelCost + travelFuelCost + timeCost, 2)

      const brand = normalizeBrand(r.brand)
      const isPreferred = preferredBrand && brand === preferredBrand

      // Preference je samo tie-breaker, ne sme povoziti realno boljše izbire.
      const preferenceBonus = isPreferred ? 0.35 : 0

      const tankajScore = round(effectiveTotalCost - preferenceBonus, 2)

      return {
        ...r,
        brand: r.brand || null,
        country_code: r.country_code || null,
        distance_km: round(distanceKm, 2),
        estimated_drive_minutes: Math.round(driveMinutes),
        fuel_cost: fuelCost,
        travel_fuel_cost: travelFuelCost,
        time_cost: timeCost,
        effective_total_cost: effectiveTotalCost,
        tankaj_score: tankajScore,
        is_preferred_brand: Boolean(isPreferred),
        is_cross_border: userCountry ? r.country_code && r.country_code !== userCountry : false,
      }
    })

  if (brandFilter && brandFilter !== 'ALL') {
    baseResults = baseResults.filter((r: any) => normalizeBrand(r.brand) === brandFilter)
  }

  const results = [...baseResults].sort((a: any, b: any) => {
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

  const savingVsNearest =
    bestOverall && nearest
      ? round((nearest.effective_total_cost as number) - (bestOverall.effective_total_cost as number), 2)
      : 0

  const savingVsCheapestFuel =
    bestOverall && cheapestFuel
      ? round(
          (cheapestFuel.effective_total_cost as number) -
            (bestOverall.effective_total_cost as number),
          2
        )
      : 0

  return NextResponse.json({
    success: true,
    ranking: 'smart_tankaj_score',
    user: {
      lat,
      lng,
      inferred_country: userCountry,
    },
    params: {
      fuel_type: type,
      radius_km: radius,
      amount_liters: amount,
      consumption_l_per_100km: consumption,
      avg_speed_kmh: avgSpeed,
      time_value_eur_per_hour: timeValue,
      brand_filter: brandFilter || 'ALL',
      preferred_brand: preferredBrand || null,
    },
    summary: {
      best_overall: bestOverall,
      nearest,
      cheapest_fuel: cheapestFuel,
      best_cross_border: bestCrossBorder,
      preferred_best: preferredBest,
      saving_vs_nearest: savingVsNearest,
      saving_vs_cheapest_fuel: savingVsCheapestFuel,
    },
    results,
  })
}