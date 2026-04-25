import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getDrivingDistance } from '@/lib/ors'

function normalizeBrand(row: any) {
  const text = `${row.brand || ''} ${row.name || ''}`.toUpperCase()

  if (text.includes('PETROL')) return 'PETROL'
  if (text.includes('MOL')) return 'MOL'
  if (text.includes('SHELL')) return 'SHELL'
  if (text.includes('OMV')) return 'OMV'
  if (text.includes('MAXEN')) return 'MAXEN'
  if (text.includes('INA')) return 'INA'
  if (text.includes('TIFON')) return 'TIFON'

  return row.brand || 'UNKNOWN'
}

function brandMatches(row: any, selectedBrand: string) {
  if (!selectedBrand || selectedBrand === 'ALL') return true
  return normalizeBrand(row) === selectedBrand
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)

  const lat = Number(searchParams.get('lat'))
  const lng = Number(searchParams.get('lng'))
  const radius = Number(searchParams.get('radius') || 25)
  const type = searchParams.get('type') || 'PETROL_95'
  const amount = Number(searchParams.get('amount') || 50)
  const selectedBrand = searchParams.get('brand') || 'ALL'
  const preferredBrand = searchParams.get('preferredBrand') || 'NONE'

  const consumption = Number(searchParams.get('consumption') || 7)
  const timeValue = Number(searchParams.get('timeValue') || 6)

  if (!lat || !lng) {
    return NextResponse.json(
      { success: false, error: 'Missing lat/lng' },
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
    avg_speed_kmh: 50,
    time_value_eur_per_hour: timeValue,
  })

  if (error) {
    return NextResponse.json({ success: false, error }, { status: 500 })
  }

  const allFiltered = (data || []).filter((row: any) =>
    brandMatches(row, selectedBrand)
  )

  const topClosest = allFiltered.slice(0, 10)

  const preferredCandidates =
    preferredBrand !== 'NONE'
      ? allFiltered
          .filter((row: any) => normalizeBrand(row) === preferredBrand)
          .slice(0, 8)
      : []

  const byId = new Map<string, any>()

  for (const row of [...topClosest, ...preferredCandidates]) {
    byId.set(row.location_id, row)
  }

  const candidates = Array.from(byId.values()).slice(0, 18)

  const routed = await Promise.all(
    candidates.map(async (row: any) => {
      const normalizedBrand = normalizeBrand(row)

      try {
        const route = await getDrivingDistance(
          { lat, lng },
          { lat: row.lat, lng: row.lng }
        )

        const distanceKm = Number(route.distance_km)
        const durationMin = Number(route.duration_min)
        const fuelCost = Number(row.fuel_cost || 0)
        const price = Number(row.price || 0)

        const travelFuelCost = (distanceKm * consumption / 100) * price
        const timeCost = (durationMin / 60) * timeValue
        const effectiveTotalCost = fuelCost + travelFuelCost + timeCost

        return {
          ...row,
          brand: normalizedBrand,
          distance_km: Number(distanceKm.toFixed(2)),
          estimated_drive_minutes: Math.round(durationMin),
          fuel_cost: Number(fuelCost.toFixed(2)),
          travel_fuel_cost: Number(travelFuelCost.toFixed(2)),
          time_cost: Number(timeCost.toFixed(2)),
          effective_total_cost: Number(effectiveTotalCost.toFixed(2)),
          route_source: 'openrouteservice',
        }
      } catch {
        return null
      }
    })
  )

  const realEnriched = routed.filter(Boolean) as any[]

  const baseBest = realEnriched.length
    ? [...realEnriched].sort(
        (a: any, b: any) =>
          Number(a.effective_total_cost) - Number(b.effective_total_cost)
      )[0]
    : null

  const ranked = realEnriched
    .map((row: any) => {
      const isPreferred =
        preferredBrand !== 'NONE' && row.brand === preferredBrand

      const isCloseEnough =
        baseBest &&
        isPreferred &&
        Number(row.effective_total_cost) <= Number(baseBest.effective_total_cost) + 0.75 &&
        (
          Math.abs(Number(row.distance_km) - Number(baseBest.distance_km)) <= 0.8 ||
          Math.abs(Number(row.estimated_drive_minutes) - Number(baseBest.estimated_drive_minutes)) <= 2
        )

      const preferenceBonus = isCloseEnough ? 0.5 : 0

      return {
        ...row,
        is_preferred_brand: isPreferred,
        preference_applied: Boolean(isCloseEnough),
        tankaj_rank_score: Number(
          (Number(row.effective_total_cost ?? 9999) - preferenceBonus).toFixed(2)
        ),
      }
    })
    .sort((a: any, b: any) => a.tankaj_rank_score - b.tankaj_rank_score)

  return NextResponse.json({
    success: true,
    ranking: 'real_world_cost_with_brand_preference',
    results: ranked,
  })
}