import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getDrivingDistance } from "@/lib/ors";

type RouteSource = "openrouteservice" | "osrm";
type SortBy = "smart" | "price" | "distance";
type Batch = "initial" | "more";
type AustriaFuelType = "DIE" | "SUP" | "GAS";

type Result = {
  location_id: string;
  name: string;
  brand: string | null;
  address: string | null;
  city: string | null;
  country_code?: string | null;
  lat?: number | null;
  lng?: number | null;
  distance_km: number;
  estimated_drive_minutes?: number | null;
  fuel_type: string;
  price: number;
  total_cost?: number | null;
  fuel_cost?: number | null;
  source?: string | null;
  captured_at?: string | null;
};

type AustriaStation = {
  id: number;
  name: string;
  location?: {
    address?: string;
    postalCode?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
  };
  prices?: {
    fuelType?: string;
    amount?: number;
    label?: string;
  }[];
};

type RoutedResult = Result & {
  lat: number;
  lng: number;
  distance_km: number;
  estimated_drive_minutes: number;
  route_source: RouteSource;
  is_real_route: true;
};

type AnyResult = RoutedResult & {
  travel_fuel_cost: number;
  time_cost: number;
  effective_total_cost: number;
  tankaj_score: number;
  is_cross_border: boolean;
  recommendation_reason: string | null;
};

const INITIAL_PER_BUCKET = 5;
const COUNTRY_COVERAGE_LIMIT = 1;
const BRAND_COVERAGE_LIMIT = 1;
const INITIAL_CANDIDATE_LIMIT = 16;
const MORE_LIMIT = 5;
const ROUTING_CONCURRENCY = 8;
const CONSUMPTION_DEFAULT = 7;
const TIME_VALUE_DEFAULT = 12;
const ROUTE_CACHE_DAYS = 30;

function n(v: unknown, fallback = 0) {
  const num = Number(v);
  return Number.isFinite(num) ? num : fallback;
}

function round(v: number, decimals = 2) {
  return Number(v.toFixed(decimals));
}

function isPlausibleFuelPrice(
  countryCode: string | null | undefined,
  fuelType: string,
  price: number,
) {
  const country = String(countryCode || "").toUpperCase();

  if (country === "SI") {
    if (fuelType === "PETROL_95") return price >= 1.5 && price <= 1.9;
    if (fuelType === "DIESEL") return price >= 1.45 && price <= 2.1;
    if (fuelType === "ELKO") return price >= 1.0 && price <= 1.6;
    if (fuelType === "PETROL_100") return price >= 1.6 && price <= 2.3;
    if (fuelType === "PREMIUM_DIESEL") return price >= 1.6 && price <= 2.3;
  }

  // fallback EU
  return price >= 0.8 && price <= 3.0;
}

function routeKeyCoord(value: number) {
  return Number(value.toFixed(4));
}

function normalizeBrand(value?: string | null) {
  return value ? value.trim().toUpperCase() : "";
}

function inferBrandKey(row: Pick<Result, "brand" | "name">) {
  const explicit = normalizeBrand(row.brand);
  if (explicit) return explicit;

  const name = normalizeBrand(row.name);
  const known = [
    "PETROL",
    "MOL",
    "SHELL",
    "OMV",
    "TURMÖL",
    "TURMOEL",
    "JET",
    "AVIA",
    "MAXEN",
    "INA",
    "TIFON",
    "CRODUX",
    "ENI",
    "Q8",
    "IP",
    "TAMOIL",
    "ESSO",
    "TOTALENERGIES",
  ];

  return known.find((brand) => name.includes(brand)) || "";
}

function brandMatches(
  row: Pick<Result, "brand" | "name">,
  selectedBrand: string,
) {
  if (!selectedBrand || selectedBrand === "ALL") return true;

  const selected = normalizeBrand(selectedBrand);
  const inferred = inferBrandKey(row);
  const name = normalizeBrand(row.name);

  if (!inferred && !name) return false;
  if (inferred === selected) return true;

  return (
    inferred.includes(selected) ||
    selected.includes(inferred) ||
    name.includes(selected)
  );
}

function countryMatches(
  rowCountry: string | null | undefined,
  selectedCountry: string,
) {
  if (!selectedCountry || selectedCountry === "ALL") return true;

  const row = String(rowCountry || "").toUpperCase();
  const selected = selectedCountry.toUpperCase();

  if (row === selected) return true;
  if (selected === "SI") return ["SI", "SLO", "SVN"].includes(row);
  if (selected === "HR") return ["HR", "HRV"].includes(row);
  if (selected === "AT") return ["AT", "AUT"].includes(row);
  if (selected === "IT") return ["IT", "ITA"].includes(row);
  if (selected === "HU") return ["HU", "HUN"].includes(row);

  return false;
}

function inferUserCountry(lat: number, lng: number) {
  if (lat >= 46.3 && lat <= 49.2 && lng >= 9.4 && lng <= 17.3) return "AT";
  if (lat >= 45 && lat <= 47 && lng >= 13 && lng <= 17) return "SI";
  if (lat >= 42 && lat <= 47 && lng >= 13 && lng <= 20) return "HR";
  if (lat >= 35 && lat <= 48 && lng >= 6 && lng <= 19) return "IT";
  return null;
}

function hasCoords(r: Result): r is Result & { lat: number; lng: number } {
  return Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng));
}

function candidateScore(row: Result, amount: number) {
  return Number(row.price) * amount + Number(row.distance_km || 999) * 0.35;
}

function uniqueByLocation(rows: Result[]) {
  const map = new Map<string, Result>();

  for (const row of rows) {
    if (!map.has(row.location_id)) map.set(row.location_id, row);
  }

  return Array.from(map.values());
}

function buildInitialCandidatePool(rows: Result[], amount: number) {
  const smart = [...rows]
    .sort((a, b) => candidateScore(a, amount) - candidateScore(b, amount))
    .slice(0, INITIAL_PER_BUCKET);

  const cheapest = [...rows]
    .sort((a, b) => {
      if (a.price !== b.price) return a.price - b.price;
      return n(a.distance_km, 999) - n(b.distance_km, 999);
    })
    .slice(0, INITIAL_PER_BUCKET);

  const nearest = [...rows]
    .sort((a, b) => n(a.distance_km, 999) - n(b.distance_km, 999))
    .slice(0, INITIAL_PER_BUCKET);

  const byCountry = new Map<string, Result[]>();
  const byBrand = new Map<string, Result[]>();

  for (const row of rows) {
    const country = String(row.country_code || "UNKNOWN").toUpperCase();
    byCountry.set(country, [...(byCountry.get(country) || []), row]);

    const brand = inferBrandKey(row);
    if (brand) byBrand.set(brand, [...(byBrand.get(brand) || []), row]);
  }

  const coverage: Result[] = [];

  for (const group of byCountry.values()) {
    coverage.push(
      ...[...group]
        .sort((a, b) => n(a.distance_km, 999) - n(b.distance_km, 999))
        .slice(0, COUNTRY_COVERAGE_LIMIT),
    );
  }

  for (const group of byBrand.values()) {
    coverage.push(
      ...[...group]
        .sort((a, b) => n(a.distance_km, 999) - n(b.distance_km, 999))
        .slice(0, BRAND_COVERAGE_LIMIT),
    );
  }

  const mandatory = uniqueByLocation([...nearest, ...cheapest, ...coverage]);
  const optional = uniqueByLocation([...smart]);

  return uniqueByLocation([...mandatory, ...optional]).slice(
    0,
    INITIAL_CANDIDATE_LIMIT,
  );
}

function buildMoreCandidatePool(
  rows: Result[],
  amount: number,
  sortBy: SortBy,
  offset: number,
) {
  const sorted = [...rows].sort((a, b) => {
    if (sortBy === "price") {
      if (a.price !== b.price) return a.price - b.price;
      return n(a.distance_km, 999) - n(b.distance_km, 999);
    }

    if (sortBy === "distance") {
      if (n(a.distance_km, 999) !== n(b.distance_km, 999)) {
        return n(a.distance_km, 999) - n(b.distance_km, 999);
      }

      return a.price - b.price;
    }

    return candidateScore(a, amount) - candidateScore(b, amount);
  });

  return sorted.slice(offset, offset + MORE_LIMIT);
}

function mapAustriaFuelType(type: string): AustriaFuelType {
  const value = type.toUpperCase();

  if (
    value.includes("DIESEL") ||
    value.includes("DIE") ||
    value.includes("DIZEL")
  ) {
    return "DIE";
  }

  if (value.includes("CNG") || value.includes("GAS")) {
    return "GAS";
  }

  return "SUP";
}

function normalizeAustriaFuelType(fuel: AustriaFuelType) {
  if (fuel === "DIE") return "DIESEL";
  if (fuel === "SUP") return "PETROL_95";
  return "CNG";
}

function normalizeAustriaBrand(name: string): string | null {
  const upper = name.toUpperCase();

  if (upper.includes("OMV")) return "OMV";
  if (upper.includes("SHELL")) return "SHELL";
  if (upper.includes("JET")) return "JET";
  if (upper.includes("AVIA")) return "AVIA";
  if (upper.includes("ENI") || upper.includes("AGIP")) return "ENI";
  if (upper.includes("BP")) return "BP";
  if (upper.includes("TURMÖL") || upper.includes("TURMOEL")) return "TURMÖL";

  return null;
}

function getAustriaPrice(
  station: AustriaStation,
  fuel: AustriaFuelType,
): number | null {
  const prices = station.prices ?? [];
  const match = prices.find((price) => price.fuelType === fuel);

  if (typeof match?.amount === "number") return match.amount;

  return null;
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

async function fetchAustriaRows(
  lat: number,
  lng: number,
  type: string,
): Promise<Result[]> {
  const fuel = mapAustriaFuelType(type);

  const url = new URL(
    "https://api.e-control.at/sprit/1.0/search/gas-stations/by-address",
  );
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("fuelType", fuel);
  url.searchParams.set("includeClosed", "false");

  try {
    const res = await fetch(url.toString(), {
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    if (!res.ok) return [];

    const raw = (await res.json()) as AustriaStation[];

    return raw
      .map((station): Result | null => {
        const price = getAustriaPrice(station, fuel);

        if (price === null) return null;

        const stationLat = station.location?.latitude;
        const stationLng = station.location?.longitude;

        if (typeof stationLat !== "number" || typeof stationLng !== "number") {
          return null;
        }

        return {
          location_id: `AT_${station.id}`,
          name: station.name,
          brand: normalizeAustriaBrand(station.name),
          address: station.location?.address ?? null,
          city: station.location?.city ?? null,
          country_code: "AT",
          lat: stationLat,
          lng: stationLng,
          distance_km: round(haversineKm(lat, lng, stationLat, stationLng)),
          estimated_drive_minutes: null,
          fuel_type: normalizeAustriaFuelType(fuel),
          price,
          fuel_cost: null,
          source: "e-control.at",
          captured_at: new Date().toISOString(),
        };
      })
      .filter((item): item is Result => item !== null);
  } catch {
    return [];
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
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

    if (!route?.distance || !route?.duration) {
      throw new Error("OSRM returned no route");
    }

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
    const finalRoute = await getOsrm(from, to);
    await saveCachedRoute(from, to, finalRoute);
    return finalRoute;
  } catch {
    const route = await getDrivingDistance(from, to);

    const finalRoute = {
      distance_km: route.distance_km,
      duration_min: route.duration_min,
      route_source: "openrouteservice" as const,
    };

    await saveCachedRoute(from, to, finalRoute);
    return finalRoute;
  }
}

async function enrich(rows: Result[], user: { lat: number; lng: number }) {
  const candidates = rows.filter(hasCoords);

  const routed = await mapWithConcurrency(
    candidates,
    ROUTING_CONCURRENCY,
    async (r) => {
      try {
        const to = { lat: Number(r.lat), lng: Number(r.lng) };
        const route = await getRoute(user, to);

        return {
          ...r,
          lat: to.lat,
          lng: to.lng,
          distance_km: round(route.distance_km),
          estimated_drive_minutes: Math.max(1, Math.round(route.duration_min)),
          route_source: route.route_source,
          is_real_route: true as const,
        };
      } catch {
        return null;
      }
    },
  );

  return routed.filter(Boolean) as RoutedResult[];
}

function score(
  rows: RoutedResult[],
  amount: number,
  consumption: number,
  timeValue: number,
  userCountry: string | null,
) {
  return rows.map((r) => {
    const existingFuelCost =
      typeof r.fuel_cost === "number" &&
      Number.isFinite(r.fuel_cost) &&
      r.fuel_cost > 0
        ? r.fuel_cost
        : typeof r.total_cost === "number" &&
            Number.isFinite(r.total_cost) &&
            r.total_cost > 0
          ? r.total_cost
          : null;

    const fuelCost = round(existingFuelCost ?? r.price * amount);
    const travelFuelCost = round((r.distance_km * consumption * r.price) / 100);
    const timeCost = round((r.estimated_drive_minutes / 60) * timeValue);
    const effectiveTotalCost = round(fuelCost + travelFuelCost + timeCost);

    return {
      ...r,
      fuel_cost: fuelCost,
      travel_fuel_cost: travelFuelCost,
      time_cost: timeCost,
      effective_total_cost: effectiveTotalCost,
      tankaj_score: effectiveTotalCost,
      is_cross_border: userCountry
        ? Boolean(r.country_code && r.country_code !== userCountry)
        : false,
      recommendation_reason: null,
    };
  });
}

function sortResults(rows: AnyResult[], sortBy: SortBy) {
  return [...rows].sort((a, b) => {
    if (sortBy === "price") {
      if (a.price !== b.price) return a.price - b.price;
      if (a.distance_km !== b.distance_km) return a.distance_km - b.distance_km;
      return a.effective_total_cost - b.effective_total_cost;
    }

    if (sortBy === "distance") {
      if (a.distance_km !== b.distance_km) return a.distance_km - b.distance_km;
      if (a.price !== b.price) return a.price - b.price;
      return a.effective_total_cost - b.effective_total_cost;
    }

    if (a.tankaj_score !== b.tankaj_score)
      return a.tankaj_score - b.tankaj_score;
    return a.distance_km - b.distance_km;
  });
}

function pickWinner(rows: AnyResult[], sortBy: SortBy, radius: number) {
  const insideRadius = rows.filter((r) => r.distance_km <= radius);
  if (!insideRadius.length) return null;

  const winner = sortResults(insideRadius, sortBy)[0];

  return {
    ...winner,
    recommendation_reason:
      sortBy === "price"
        ? "Najcenejša opcija v izbranem radiusu."
        : sortBy === "distance"
          ? "Najbližja črpalka po realni poti."
          : "Najboljša kombinacija cene, poti in časa.",
  };
}

function countByCountry(rows: { country_code?: string | null }[]) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = String(row.country_code || "UNKNOWN").toUpperCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const radius = Number(searchParams.get("radius") || 25);
  const amount = Number(searchParams.get("amount") || 50);
  const type =
    searchParams.get("type") ||
    searchParams.get("fuel_type") ||
    searchParams.get("fuelType") ||
    searchParams.get("fuel") ||
    "PETROL_95";

  const consumption = Number(
    searchParams.get("consumption") || CONSUMPTION_DEFAULT,
  );
  const timeValue = Number(searchParams.get("timeValue") || TIME_VALUE_DEFAULT);

  const requestedSortBy = searchParams.get("sortBy") || "smart";
  const sortBy: SortBy =
    requestedSortBy === "price" || requestedSortBy === "distance"
      ? requestedSortBy
      : "smart";

  const batch: Batch =
    searchParams.get("batch") === "more" ? "more" : "initial";
  const offset = Math.max(
    0,
    Number(searchParams.get("offset") || INITIAL_PER_BUCKET),
  );

  const brandFilter = normalizeBrand(
    searchParams.get("brand") || searchParams.get("brandFilter"),
  );
  const countryFilter = searchParams.get("country") || "ALL";

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json(
      { success: false, error: "Missing or invalid coords" },
      { status: 400 },
    );
  }

  if (!Number.isFinite(radius) || radius <= 0) {
    return NextResponse.json(
      { success: false, error: "Missing or invalid radius" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase.rpc("search_fuel_locations", {
    user_lat: lat,
    user_lng: lng,
    radius_km: radius,
    wanted_fuel_type: type,
    amount,
    car_consumption_l_per_100km: consumption,
    avg_speed_kmh: 55,
    time_value_eur_per_hour: timeValue,
  });

  if (error) {
    return NextResponse.json({ success: false, error }, { status: 500 });
  }

  const userCountry = inferUserCountry(lat, lng);

  const dbRows = ((data || []) as Result[])
    .filter((r) => Number.isFinite(Number(r.price)))
    .filter(hasCoords)
    .filter((r) =>
      isPlausibleFuelPrice(r.country_code, r.fuel_type, Number(r.price)),
    );

  const austriaRows =
    countryFilter === "ALL" || countryFilter === "AT"
      ? await fetchAustriaRows(lat, lng, type)
      : [];

  let rows = uniqueByLocation([...dbRows, ...austriaRows]);

  if (brandFilter && brandFilter !== "ALL") {
    rows = rows.filter((r) => brandMatches(r, brandFilter));
  }

  if (countryFilter && countryFilter !== "ALL") {
    rows = rows.filter((r) => countryMatches(r.country_code, countryFilter));
  }

  const candidatePool =
    batch === "more"
      ? buildMoreCandidatePool(rows, amount, sortBy, offset)
      : buildInitialCandidatePool(rows, amount);

  const routed = await enrich(candidatePool, { lat, lng });
  const scored = score(routed, amount, consumption, timeValue, userCountry);

  const valid = scored.filter(
    (r) =>
      r.is_real_route &&
      Number.isFinite(r.distance_km) &&
      Number.isFinite(r.estimated_drive_minutes) &&
      Number.isFinite(r.effective_total_cost),
  );

  const winner = pickWinner(valid, sortBy, radius);

  const results = sortResults(
    valid.filter((r) => r.distance_km <= radius),
    sortBy,
  );

  const nextOffset =
    batch === "more" ? offset + MORE_LIMIT : candidatePool.length;
  const hasMore = rows.length > nextOffset;

  return NextResponse.json({
    success: true,
    batch,
    ranking: sortBy,
    winner,
    results,
    has_more: hasMore,
    next_offset: nextOffset,
    counts: {
      all_considered_count: rows.length,
      db_count: dbRows.length,
      austria_count: austriaRows.length,
      candidate_pool_count: candidatePool.length,
      routed_count: routed.length,
      valid_count: valid.length,
      results_count: results.length,
      rows_by_country: countByCountry(rows),
      valid_by_country: countByCountry(valid),
      country_filter: countryFilter,
    },
  });
}
