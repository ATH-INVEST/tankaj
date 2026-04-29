import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type AustriaFuelType = "DIE" | "SUP" | "GAS";
type InternalFuelType = "DIESEL" | "PETROL_95" | "CNG";

type LocationRow = {
  id: string;
  name: string | null;
  brand: string | null;
  address: string | null;
  city: string | null;
  country_code: string | null;
  lat: number | null;
  lng: number | null;
  source: string | null;
  source_id: string | null;
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

const SOURCE = "e-control.at";
const OSM_SOURCE = "openstreetmap_at";
const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 180;
const REQUEST_CONCURRENCY = 6;
const MATCH_MAX_METERS = 180;

const FUEL_MAP: Record<AustriaFuelType, InternalFuelType> = {
  SUP: "PETROL_95",
  DIE: "DIESEL",
  GAS: "CNG",
};

function isAuthorized(req: NextRequest) {
  if (process.env.NODE_ENV !== "production") return true;

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const keyParam = req.nextUrl.searchParams.get("key");
  const userAgent = req.headers.get("user-agent") || "";

  if (userAgent.toLowerCase().includes("vercel-cron")) return true;
  if (!cronSecret) return false;

  if (keyParam === cronSecret) return true;
  return authHeader === `Bearer ${cronSecret}`;
}

function cleanText(value?: string | null) {
  if (!value) return null;
  return value.replace(/\s+/g, " ").trim() || null;
}

function normalizeBrand(value?: string | null) {
  const raw = String(value || "").toUpperCase();

  if (raw.includes("OMV")) return "OMV";
  if (raw.includes("SHELL")) return "SHELL";
  if (raw.includes("HOFER")) return "HOFER";
  if (raw.includes("JET")) return "JET";
  if (raw.includes("AVIA")) return "AVIA";
  if (raw.includes("ENI") || raw.includes("AGIP")) return "ENI";
  if (raw.includes("BP")) return "BP";
  if (raw.includes("TURMÖL") || raw.includes("TURMOEL")) return "TURMÖL";
  if (raw.includes("DISKONT")) return "DISKONT";
  if (raw.includes("GENOL")) return "GENOL";
  if (raw.includes("LAGERHAUS")) return "LAGERHAUS";
  if (raw.includes("IQ")) return "IQ";
  if (raw.includes("AVANTI")) return "AVANTI";

  return cleanText(value);
}

function normalizeStationBrand(station: AustriaStation) {
  return normalizeBrand(station.name);
}

function getPrice(station: AustriaStation, fuel: AustriaFuelType) {
  const match = station.prices?.find((price) => price.fuelType === fuel);
  return typeof match?.amount === "number" ? match.amount : null;
}

function isRealisticPrice(fuel: AustriaFuelType, price: number) {
  if (!Number.isFinite(price) || price <= 0) return false;
  if (fuel === "SUP") return price >= 1.2 && price <= 2.5;
  if (fuel === "DIE") return price >= 1.2 && price <= 2.5;
  if (fuel === "GAS") return price >= 0.7 && price <= 2.5;
  return false;
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

function brandCompatible(a?: string | null, b?: string | null) {
  const left = normalizeBrand(a) || "";
  const right = normalizeBrand(b) || "";

  if (!left || !right) return true;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;

  const lagerhausLike = ["GENOL", "LAGERHAUS"];
  if (lagerhausLike.includes(left) && lagerhausLike.includes(right))
    return true;

  return false;
}

function findNearestOsmMatch(
  station: AustriaStation,
  osmLocations: LocationRow[],
): LocationRow | null {
  const lat = station.location?.latitude;
  const lng = station.location?.longitude;

  if (typeof lat !== "number" || typeof lng !== "number") return null;

  const stationBrand = normalizeStationBrand(station);
  let best: { row: LocationRow; meters: number } | null = null;

  for (const row of osmLocations) {
    const rowLat = Number(row.lat);
    const rowLng = Number(row.lng);

    if (!Number.isFinite(rowLat) || !Number.isFinite(rowLng)) continue;
    if (!brandCompatible(stationBrand, row.brand || row.name)) continue;

    const meters = haversineKm(lat, lng, rowLat, rowLng) * 1000;
    if (meters > MATCH_MAX_METERS) continue;

    if (!best || meters < best.meters) {
      best = { row, meters };
    }
  }

  return best?.row || null;
}

function buildPoints(locations: LocationRow[]) {
  const seen = new Set<string>();
  const points: { lat: number; lng: number }[] = [];

  for (const location of locations) {
    const lat = Number(location.lat);
    const lng = Number(location.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    // Keep points close enough to individual stations to increase chance that
    // E-Control exposes a price for stations that are not returned from one big center search.
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (seen.has(key)) continue;

    seen.add(key);
    points.push({ lat, lng });
  }

  return points;
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

async function fetchEcontrolPoint(
  point: { lat: number; lng: number },
  fuel: AustriaFuelType,
) {
  const url = new URL(
    "https://api.e-control.at/sprit/1.0/search/gas-stations/by-address",
  );

  url.searchParams.set("latitude", String(point.lat));
  url.searchParams.set("longitude", String(point.lng));
  url.searchParams.set("fuelType", fuel);
  url.searchParams.set("includeClosed", "false");

  try {
    const res = await fetch(url.toString(), {
      headers: {
        accept: "application/json",
        "user-agent": "Tankaj.si Austria price refresh (https://tankaj.si)",
      },
      cache: "no-store",
    });

    if (!res.ok) return [];

    return (await res.json()) as AustriaStation[];
  } catch {
    return [];
  }
}

async function getOsmLocations(limit: number, offset: number) {
  const { data, error } = await supabase
    .from("locations")
    .select(
      "id,name,brand,address,city,country_code,lat,lng,source,source_id,is_active",
    )
    .eq("country_code", "AT")
    .eq("source", OSM_SOURCE)
    .eq("is_active", true)
    .not("lat", "is", null)
    .not("lng", "is", null)
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return (data || []) as LocationRow[];
}

async function upsertLocationsAndPrices(
  stations: AustriaStation[],
  fuel: AustriaFuelType,
  capturedAt: string,
  osmLocations: LocationRow[],
) {
  const stationById = new Map<number, AustriaStation>();

  for (const station of stations) {
    if (!station?.id) continue;
    const price = getPrice(station, fuel);
    if (price === null || !isRealisticPrice(fuel, price)) continue;

    const lat = station.location?.latitude;
    const lng = station.location?.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") continue;

    stationById.set(station.id, station);
  }

  const uniqueStations = Array.from(stationById.values());
  if (!uniqueStations.length) {
    return {
      econtrol_locations_upserted: 0,
      econtrol_prices_upserted: 0,
      osm_prices_matched: 0,
    };
  }

  const locationPayload = uniqueStations.map((station) => ({
    type: "fuel_station",
    name: cleanText(station.name) || "Bencinski servis",
    brand: normalizeStationBrand(station),
    operator: normalizeStationBrand(station),
    address: cleanText(station.location?.address),
    city: cleanText(station.location?.city),
    country_code: "AT",
    lat: station.location?.latitude,
    lng: station.location?.longitude,
    geo: `POINT(${station.location?.longitude} ${station.location?.latitude})`,
    source: SOURCE,
    source_id: String(station.id),
    is_active: true,
    metadata: {
      imported_from_price_refresh: true,
      postal_code: station.location?.postalCode || null,
    },
  }));

  const { error: locationError } = await supabase
    .from("locations")
    .upsert(locationPayload, { onConflict: "source,source_id" });

  if (locationError) throw locationError;

  const sourceIds = uniqueStations.map((station) => String(station.id));

  const { data: econtrolLocations, error: locationReadError } = await supabase
    .from("locations")
    .select("id,source_id")
    .eq("country_code", "AT")
    .eq("source", SOURCE)
    .in("source_id", sourceIds);

  if (locationReadError) throw locationReadError;

  const econtrolIdBySourceId = new Map(
    (econtrolLocations || []).map((row) => [String(row.source_id), row.id]),
  );

  const pricePayload: {
    location_id: string;
    fuel_type: InternalFuelType;
    price: number;
    currency: string;
    source: string;
    source_updated_at: string;
    captured_at: string;
    confidence: string;
    raw_product_name: string;
  }[] = [];

  for (const station of uniqueStations) {
    const price = getPrice(station, fuel);
    if (price === null || !isRealisticPrice(fuel, price)) continue;

    const econtrolLocationId = econtrolIdBySourceId.get(String(station.id));

    if (econtrolLocationId) {
      pricePayload.push({
        location_id: econtrolLocationId,
        fuel_type: FUEL_MAP[fuel],
        price,
        currency: "EUR",
        source: SOURCE,
        source_updated_at: capturedAt,
        captured_at: capturedAt,
        confidence: "official",
        raw_product_name: fuel,
      });
    }

    const osmMatch = findNearestOsmMatch(station, osmLocations);

    if (osmMatch?.id) {
      pricePayload.push({
        location_id: osmMatch.id,
        fuel_type: FUEL_MAP[fuel],
        price,
        currency: "EUR",
        source: `${SOURCE}:matched_osm`,
        source_updated_at: capturedAt,
        captured_at: capturedAt,
        confidence: "matched_by_coordinates",
        raw_product_name: fuel,
      });
    }
  }

  if (!pricePayload.length) {
    return {
      econtrol_locations_upserted: uniqueStations.length,
      econtrol_prices_upserted: 0,
      osm_prices_matched: 0,
    };
  }

  const uniquePricePayload = Array.from(
    new Map(
      pricePayload.map((item) => [
        `${item.location_id}:${item.fuel_type}:${item.source}`,
        item,
      ]),
    ).values(),
  );

  const { error: priceError } = await supabase
    .from("fuel_prices")
    .upsert(uniquePricePayload, {
      onConflict: "location_id,fuel_type,source",
    });

  if (priceError) throw priceError;

  return {
    econtrol_locations_upserted: uniqueStations.length,
    econtrol_prices_upserted: uniquePricePayload.filter(
      (row) => row.source === SOURCE,
    ).length,
    osm_prices_matched: uniquePricePayload.filter((row) =>
      row.source.endsWith(":matched_osm"),
    ).length,
  };
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const startedAt = new Date().toISOString();
  const { searchParams } = new URL(req.url);

  const requestedFuel = String(searchParams.get("fuel") || "SUP").toUpperCase();
  const fuels: AustriaFuelType[] =
    requestedFuel === "ALL"
      ? ["SUP", "DIE", "GAS"]
      : requestedFuel === "DIE" || requestedFuel === "GAS"
        ? [requestedFuel]
        : ["SUP"];

  const requestedLimit = Number(searchParams.get("limit") || DEFAULT_LIMIT);
  const limit = Math.min(
    Math.max(
      Number.isFinite(requestedLimit) ? requestedLimit : DEFAULT_LIMIT,
      1,
    ),
    MAX_LIMIT,
  );
  const offset = Math.max(Number(searchParams.get("offset") || 0), 0);

  try {
    const osmLocations = await getOsmLocations(limit, offset);
    const points = buildPoints(osmLocations);
    const capturedAt = new Date().toISOString();

    const perFuelResults = [];

    for (const fuel of fuels) {
      const responses = await mapWithConcurrency(
        points,
        REQUEST_CONCURRENCY,
        (point) => fetchEcontrolPoint(point, fuel),
      );

      const stations = responses.flat();
      const writeResult = await upsertLocationsAndPrices(
        stations,
        fuel,
        capturedAt,
        osmLocations,
      );

      perFuelResults.push({
        fuel,
        request_points: points.length,
        raw_station_rows: stations.length,
        ...writeResult,
      });
    }

    const nextOffset = offset + osmLocations.length;
    const hasMore = osmLocations.length === limit;

    return NextResponse.json({
      success: true,
      source: SOURCE,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      offset,
      limit,
      next_offset: nextOffset,
      has_more: hasMore,
      osm_locations_processed: osmLocations.length,
      fuels: perFuelResults,
      note: "E-Control does not expose every station price in every response. This endpoint maximizes coverage by querying around known OSM stations and storing every official price returned.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);

    return NextResponse.json(
      {
        success: false,
        source: SOURCE,
        error: message,
      },
      { status: 500 },
    );
  }
}
