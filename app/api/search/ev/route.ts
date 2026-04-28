import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { getDrivingDistance } from "@/lib/ors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteSource = "openrouteservice" | "osrm";
type SortBy = "smart" | "price" | "distance";
type PowerType = "AC" | "DC";

type EvLocation = {
  id: string;
  name: string;
  operator?: string | null;
  address?: string | null;
  city?: string | null;
  country_code?: string | null;
  lat: number;
  lng: number;
  max_power_kw?: number | null;
  connector_types?: string[] | null;
  captured_at?: string | null;
};

type EvPrice = {
  ev_location_id: string;
  price_per_kwh?: number | null;
  source?: string | null;
  operator_name?: string | null;
  source_url?: string | null;
  verified_at?: string | null;
  is_verified?: boolean | null;
  power_type?: string | null;
  tariff_scope?: string | null;
  tariff_note?: string | null;
  captured_at?: string | null;
};

type ReferenceTariff = {
  country_code: string;
  power_type: string;
  price_per_kwh: number;
  source_name?: string | null;
  source_url?: string | null;
  note?: string | null;
  verified_at?: string | null;
};

const INITIAL_LIMIT = 16;
const MORE_LIMIT = 5;
const ROUTING_CONCURRENCY = 8;
const TIME_VALUE_DEFAULT = 12;
const EV_CONSUMPTION_DEFAULT = 18;
const ROUTE_CACHE_DAYS = 30;

function round(value: number, decimals = 2) {
  return Number(value.toFixed(decimals));
}

function routeKeyCoord(value: number) {
  return Number(value.toFixed(4));
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function inferUserCountry(lat: number, lng: number) {
  if (lat >= 46.3 && lat <= 49.2 && lng >= 9.4 && lng <= 17.3) return "AT";
  if (lat >= 45 && lat <= 47 && lng >= 13 && lng <= 17) return "SI";
  if (lat >= 42 && lat <= 47 && lng >= 13 && lng <= 20) return "HR";
  if (lat >= 35 && lat <= 48 && lng >= 6 && lng <= 19) return "IT";
  return null;
}

function countryMatches(
  rowCountry: string | null | undefined,
  selectedCountry: string,
) {
  if (!selectedCountry || selectedCountry === "ALL") return true;
  return (
    String(rowCountry || "").toUpperCase() === selectedCountry.toUpperCase()
  );
}

function powerMatches(
  location: EvLocation,
  powerType: PowerType,
  minPowerKw: number,
) {
  const maxPower = Number(location.max_power_kw || 0);
  const connectors = (location.connector_types || []).join(" ").toLowerCase();

  if (powerType === "DC") {
    if (maxPower > 0 && maxPower < 30) return false;
    if (minPowerKw > 0 && maxPower > 0 && maxPower < minPowerKw) return false;

    if (maxPower >= 40) return true;

    return (
      connectors.includes("ccs") ||
      connectors.includes("chademo") ||
      connectors.includes("tesla")
    );
  }

  if (powerType === "AC") {
    if (maxPower > 43) return false;

    return (
      connectors.includes("type 2") ||
      connectors.includes("type2") ||
      connectors.includes("schuko") ||
      maxPower <= 43
    );
  }

  return true;
}

function normalizeOperator(value?: string | null) {
  return value ? value.trim().toUpperCase() : "";
}

function pickVerifiedPrice(
  location: EvLocation,
  prices: EvPrice[],
  powerType: PowerType,
) {
  const operator = normalizeOperator(location.operator);

  const candidates = prices.filter((price) => {
    if (!price.is_verified) return false;
    if (!Number.isFinite(Number(price.price_per_kwh))) return false;

    const pricePowerType = String(price.power_type || "").toUpperCase();
    if (pricePowerType && pricePowerType !== powerType) return false;

    const priceOperator = normalizeOperator(price.operator_name);
    if (price.ev_location_id === location.id) return true;
    if (priceOperator && operator && operator.includes(priceOperator))
      return true;

    return false;
  });

  if (!candidates.length) return null;
  return candidates.sort(
    (a, b) =>
      (a.tariff_scope === "location" ? 0 : 1) -
      (b.tariff_scope === "location" ? 0 : 1),
  )[0];
}

function pickReferenceTariff(
  countryCode: string | null | undefined,
  powerType: PowerType,
  referenceTariffs: ReferenceTariff[],
) {
  const country = String(countryCode || "").toUpperCase();
  return (
    referenceTariffs.find(
      (tariff) =>
        String(tariff.country_code).toUpperCase() === country &&
        String(tariff.power_type).toUpperCase() === powerType,
    ) || null
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

async function getCachedRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
) {
  const { data, error } = await supabase
    .from("route_cache")
    .select("distance_km,duration_min,route_source")
    .eq("from_lat_rounded", routeKeyCoord(from.lat))
    .eq("from_lng_rounded", routeKeyCoord(from.lng))
    .eq("to_lat_rounded", routeKeyCoord(to.lat))
    .eq("to_lng_rounded", routeKeyCoord(to.lng))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error || !data) return null;

  return {
    distance_km: Number(data.distance_km),
    duration_min: Number(data.duration_min),
    route_source:
      data.route_source === "osrm"
        ? ("osrm" as const)
        : ("openrouteservice" as const),
  };
}

async function saveCachedRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  route: {
    distance_km: number;
    duration_min: number;
    route_source: RouteSource;
  },
) {
  await supabase.from("route_cache").upsert(
    {
      from_lat_rounded: routeKeyCoord(from.lat),
      from_lng_rounded: routeKeyCoord(from.lng),
      to_lat_rounded: routeKeyCoord(to.lat),
      to_lng_rounded: routeKeyCoord(to.lng),
      distance_km: round(route.distance_km),
      duration_min: Math.round(route.duration_min),
      route_source: route.route_source,
      expires_at: new Date(
        Date.now() + ROUTE_CACHE_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString(),
    },
    {
      onConflict:
        "from_lat_rounded,from_lng_rounded,to_lat_rounded,to_lng_rounded",
    },
  );
}

async function getOsrm(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false&alternatives=false&steps=false`,
      {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      },
    );

    if (!res.ok) throw new Error(`OSRM failed: ${res.status}`);
    const json = await res.json();
    const route = json?.routes?.[0];
    if (!route?.distance || !route?.duration)
      throw new Error("OSRM returned no route");

    return {
      distance_km: route.distance / 1000,
      duration_min: route.duration / 60,
      route_source: "osrm" as const,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
) {
  const cached = await getCachedRoute(from, to);
  if (cached) return cached;

  try {
    const route = await getOsrm(from, to);
    await saveCachedRoute(from, to, route);
    return route;
  } catch {
    const fallback = await getDrivingDistance(from, to);
    const route = {
      distance_km: fallback.distance_km,
      duration_min: fallback.duration_min,
      route_source: "openrouteservice" as const,
    };
    await saveCachedRoute(from, to, route);
    return route;
  }
}

function sortFinal(rows: any[], sortBy: SortBy) {
  return [...rows].sort((a, b) => {
    if (sortBy === "price") {
      if (a.price !== b.price) return a.price - b.price;
      return a.distance_km - b.distance_km;
    }
    if (sortBy === "distance") return a.distance_km - b.distance_km;
    if (a.tankaj_score !== b.tankaj_score)
      return a.tankaj_score - b.tankaj_score;
    return a.distance_km - b.distance_km;
  });
}

function buildRow(params: {
  location: EvLocation;
  pricePerKwh: number;
  amountKwh: number;
  consumption: number;
  timeValue: number;
  route: {
    distance_km: number;
    duration_min: number;
    route_source: RouteSource;
  };
  powerType: PowerType;
  userCountry: string | null;
  isVerified: boolean;
  sourceName: string | null;
  sourceUrl: string | null;
  tariffNote: string | null;
  capturedAt: string | null;
}) {
  const chargingCost = round(params.amountKwh * params.pricePerKwh);
  const travelFuelCost = round(
    (params.route.distance_km * params.consumption * params.pricePerKwh) / 100,
  );
  const timeCost = round((params.route.duration_min / 60) * params.timeValue);
  const maxPowerKw = Number(params.location.max_power_kw || 0);

  const usablePowerKw = Math.max(11, Math.min(maxPowerKw || 22, 250));

  const estimatedChargingMinutes = Math.round(
    (params.amountKwh / usablePowerKw) * 60,
  );

  const chargingSpeedPenalty = round(
    (estimatedChargingMinutes / 60) * params.timeValue,
  );

  const effectiveTotalCost = round(chargingCost + travelFuelCost + timeCost);

  const tankajScore = round(effectiveTotalCost + chargingSpeedPenalty);

  return {
    location_id: params.location.id,
    name: params.location.name,
    brand: params.location.operator || null,
    operator: params.location.operator || null,
    address: params.location.address || null,
    city: params.location.city || null,
    country_code: params.location.country_code || null,
    lat: Number(params.location.lat),
    lng: Number(params.location.lng),
    distance_km: round(params.route.distance_km),
    estimated_drive_minutes: Math.max(1, Math.round(params.route.duration_min)),
    route_source: params.route.route_source,
    is_real_route: true,
    fuel_type: `EV_${params.powerType}`,
    price: round(params.pricePerKwh, 3),
    price_unit: "€/kWh",
    fuel_cost: chargingCost,
    travel_fuel_cost: travelFuelCost,
    time_cost: timeCost,
    effective_total_cost: effectiveTotalCost,
    tankaj_score: tankajScore,
    estimated_charging_minutes: estimatedChargingMinutes,
    is_cross_border: params.userCountry
      ? Boolean(
          params.location.country_code &&
          params.location.country_code !== params.userCountry,
        )
      : false,
    recommendation_reason: params.isVerified
      ? "Najboljša kombinacija znane cene, poti in časa."
      : "Ocena na podlagi referenčne tarife za državo in tip polnjenja.",
    captured_at: params.capturedAt,
    max_power_kw: maxPowerKw || null,
    connector_types: params.location.connector_types || [],
    power_type: params.powerType,
    is_verified: params.isVerified,
    price_confidence: params.isVerified ? "verified" : "estimated",
    price_source_name: params.sourceName,
    price_source_url: params.sourceUrl,
    tariff_note: params.tariffNote,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const radius = Number(searchParams.get("radius") || 25);
  const amountKwh = Number(
    searchParams.get("amount") || searchParams.get("amountKwh") || 30,
  );
  const powerType: PowerType =
    String(
      searchParams.get("powerType") || searchParams.get("chargingMode") || "DC",
    ).toUpperCase() === "AC"
      ? "AC"
      : "DC";
  const minPowerKw = Math.max(
    0,
    Number(searchParams.get("minPowerKw") || (powerType === "DC" ? 50 : 0)),
  );
  const consumption = Number(
    searchParams.get("consumption") || EV_CONSUMPTION_DEFAULT,
  );
  const timeValue = Number(searchParams.get("timeValue") || TIME_VALUE_DEFAULT);
  const requestedSortBy = searchParams.get("sortBy") || "smart";
  const sortBy: SortBy =
    requestedSortBy === "price" || requestedSortBy === "distance"
      ? requestedSortBy
      : "smart";
  const batch = searchParams.get("batch") === "more" ? "more" : "initial";
  const offset = Math.max(
    0,
    Number(searchParams.get("offset") || INITIAL_LIMIT),
  );
  const countryFilter = searchParams.get("country") || "ALL";
  const includeEstimated = searchParams.get("includeEstimated") === "true";

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json(
      { success: false, error: "Missing or invalid coords" },
      { status: 400 },
    );
  }

  const marginKm = Math.max(radius * 1.4, radius + 10);
  const latDelta = marginKm / 111;
  const lngDelta =
    marginKm / (111 * Math.max(Math.cos((lat * Math.PI) / 180), 0.2));

  let locationQuery = supabase
    .from("ev_locations")
    .select(
      "id,name,operator,address,city,country_code,lat,lng,max_power_kw,connector_types,captured_at",
    )
    .gte("lat", lat - latDelta)
    .lte("lat", lat + latDelta)
    .gte("lng", lng - lngDelta)
    .lte("lng", lng + lngDelta)
    .eq("is_operational", true)
    .not("max_power_kw", "is", null)
    .limit(700);

  if (powerType === "DC") {
    locationQuery = locationQuery.gte(
      "max_power_kw",
      Math.max(30, minPowerKw || 30),
    );
  }

  if (countryFilter !== "ALL")
    locationQuery = locationQuery.eq("country_code", countryFilter);

  const { data: locationData, error: locationError } = await locationQuery;
  if (locationError)
    return NextResponse.json(
      { success: false, error: locationError },
      { status: 500 },
    );

  const locations = ((locationData || []) as EvLocation[])
    .filter(
      (l) => Number.isFinite(Number(l.lat)) && Number.isFinite(Number(l.lng)),
    )
    .filter((l) => countryMatches(l.country_code, countryFilter))
    .filter((l) => powerMatches(l, powerType, minPowerKw))
    .filter(
      (l) => haversineKm(lat, lng, Number(l.lat), Number(l.lng)) <= marginKm,
    );

  const locationIds = locations.map((l) => l.id);

  const { data: pricesData, error: pricesError } = locationIds.length
    ? await supabase
        .from("ev_prices")
        .select(
          "ev_location_id,price_per_kwh,source,operator_name,source_url,verified_at,is_verified,power_type,tariff_scope,tariff_note,captured_at",
        )
        .in("ev_location_id", locationIds)
    : { data: [], error: null };

  if (pricesError)
    return NextResponse.json(
      { success: false, error: pricesError },
      { status: 500 },
    );

  const { data: referenceData, error: referenceError } = await supabase
    .from("ev_tariffs_reference")
    .select(
      "country_code,power_type,price_per_kwh,source_name,source_url,note,verified_at",
    )
    .eq("power_type", powerType);

  if (referenceError)
    return NextResponse.json(
      { success: false, error: referenceError },
      { status: 500 },
    );

  const prices = (pricesData || []) as EvPrice[];
  const references = (referenceData || []) as ReferenceTariff[];

  const verifiedCandidates: any[] = [];
  const estimatedCandidates: any[] = [];

  for (const location of locations) {
    const verifiedPrice = pickVerifiedPrice(location, prices, powerType);

    if (verifiedPrice) {
      verifiedCandidates.push({
        location,
        pricePerKwh: Number(verifiedPrice.price_per_kwh),
        isVerified: true,
        sourceName:
          verifiedPrice.operator_name ||
          verifiedPrice.source ||
          "Preverjen cenik",
        sourceUrl: verifiedPrice.source_url || null,
        tariffNote: verifiedPrice.tariff_note || null,
        capturedAt:
          verifiedPrice.verified_at || verifiedPrice.captured_at || null,
      });
      continue;
    }

    const reference = pickReferenceTariff(
      location.country_code,
      powerType,
      references,
    );
    if (!reference) continue;

    estimatedCandidates.push({
      location,
      pricePerKwh: Number(reference.price_per_kwh),
      isVerified: false,
      sourceName: reference.source_name || "Referenčna tarifa",
      sourceUrl: reference.source_url || null,
      tariffNote:
        reference.note ||
        "Cena je ocena za državo in tip polnjenja, ne cenik konkretne polnilnice.",
      capturedAt: reference.verified_at || null,
    });
  }

  const primarySource =
    verifiedCandidates.length > 0 ? verifiedCandidates : estimatedCandidates;
  const airSorted = [...primarySource].sort((a, b) => {
    const aAir = haversineKm(
      lat,
      lng,
      Number(a.location.lat),
      Number(a.location.lng),
    );
    const bAir = haversineKm(
      lat,
      lng,
      Number(b.location.lat),
      Number(b.location.lng),
    );
    if (sortBy === "price" && a.pricePerKwh !== b.pricePerKwh)
      return a.pricePerKwh - b.pricePerKwh;
    if (sortBy === "distance") return aAir - bAir;
    return (
      a.pricePerKwh * amountKwh +
      aAir * 0.25 -
      (b.pricePerKwh * amountKwh + bAir * 0.25)
    );
  });

  const selected =
    batch === "more"
      ? airSorted.slice(offset, offset + MORE_LIMIT)
      : airSorted.slice(0, INITIAL_LIMIT);
  const userCountry = inferUserCountry(lat, lng);

  async function routeCandidates(candidates: any[]) {
    const routed = await mapWithConcurrency(
      candidates,
      ROUTING_CONCURRENCY,
      async (candidate) => {
        try {
          const route = await getRoute(
            { lat, lng },
            {
              lat: Number(candidate.location.lat),
              lng: Number(candidate.location.lng),
            },
          );
          if (route.distance_km > radius) return null;
          return buildRow({
            location: candidate.location,
            pricePerKwh: candidate.pricePerKwh,
            amountKwh,
            consumption,
            timeValue,
            route,
            powerType,
            userCountry,
            isVerified: candidate.isVerified,
            sourceName: candidate.sourceName,
            sourceUrl: candidate.sourceUrl,
            tariffNote: candidate.tariffNote,
            capturedAt: candidate.capturedAt,
          });
        } catch {
          return null;
        }
      },
    );

    return sortFinal(routed.filter(Boolean), sortBy);
  }

  const results = await routeCandidates(selected);

  const secondarySource =
    verifiedCandidates.length > 0 ? estimatedCandidates.slice(0, 8) : [];
  const secondaryResults = includeEstimated
    ? await routeCandidates(secondarySource)
    : [];

  const nextOffset = batch === "more" ? offset + MORE_LIMIT : INITIAL_LIMIT;

  return NextResponse.json({
    success: true,
    mode: "ev",
    batch,
    ranking: sortBy,
    power_type: powerType,
    winner: results[0] || null,
    results,
    secondary_results: secondaryResults,
    has_more: airSorted.length > nextOffset,
    has_estimated_more:
      verifiedCandidates.length > 0 && estimatedCandidates.length > 0,
    next_offset: nextOffset,
    pricing_mode:
      verifiedCandidates.length > 0 ? "verified_first" : "reference_fallback",
    disclaimer:
      verifiedCandidates.length > 0
        ? "Najprej prikazujemo polnilnice z znano tarifo. Ostale lahko prikažemo z ocenjeno referenčno tarifo."
        : "V izbranem radiusu ni preverjenih EV tarif. Prikazujemo oceno na podlagi referenčne tarife za državo in tip polnjenja.",
    counts: {
      all_locations_count: locations.length,
      verified_candidates_count: verifiedCandidates.length,
      estimated_candidates_count: estimatedCandidates.length,
      results_count: results.length,
      secondary_results_count: secondaryResults.length,
      min_power_kw: minPowerKw,
      amount_kwh: amountKwh,
    },
  });
}
