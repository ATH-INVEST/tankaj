import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCanonicalBrand } from "@/lib/normalizeBrand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const INGEST_SECRET =
  process.env.INGEST_SECRET || process.env.CRON_SECRET || "";
const TANKERKOENIG_API_KEY = process.env.TANKERKOENIG_API_KEY ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type FuelType = "e5" | "e10" | "diesel";

type TankerkoenigStation = {
  id: string;
  name: string;
  brand?: string | null;
  street?: string | null;
  houseNumber?: string | null;
  postCode?: number | string | null;
  place?: string | null;
  lat: number;
  lng: number;
  dist?: number;
  price?: number | null;
  isOpen?: boolean;
};

type TankerkoenigResponse = {
  ok: boolean;
  license?: string;
  data?: string;
  stations?: TankerkoenigStation[];
  message?: string;
};

const GERMANY_GRID: Array<{ lat: number; lng: number; label: string }> = [
  { label: "DE-Berlin", lat: 52.52, lng: 13.405 },
  { label: "DE-Hamburg", lat: 53.5511, lng: 9.9937 },
  { label: "DE-Munich", lat: 48.1351, lng: 11.582 },
  { label: "DE-Cologne", lat: 50.9375, lng: 6.9603 },
  { label: "DE-Frankfurt", lat: 50.1109, lng: 8.6821 },
  { label: "DE-Stuttgart", lat: 48.7758, lng: 9.1829 },
  { label: "DE-Dusseldorf", lat: 51.2277, lng: 6.7735 },
  { label: "DE-Dortmund", lat: 51.5136, lng: 7.4653 },
  { label: "DE-Essen", lat: 51.4556, lng: 7.0116 },
  { label: "DE-Leipzig", lat: 51.3397, lng: 12.3731 },
  { label: "DE-Bremen", lat: 53.0793, lng: 8.8017 },
  { label: "DE-Dresden", lat: 51.0504, lng: 13.7373 },
  { label: "DE-Hanover", lat: 52.3759, lng: 9.732 },
  { label: "DE-Nuremberg", lat: 49.4521, lng: 11.0767 },
  { label: "DE-Duisburg", lat: 51.4344, lng: 6.7623 },
  { label: "DE-Bochum", lat: 51.4818, lng: 7.2162 },
  { label: "DE-Wuppertal", lat: 51.2562, lng: 7.1508 },
  { label: "DE-Bielefeld", lat: 52.0302, lng: 8.5325 },
  { label: "DE-Bonn", lat: 50.7374, lng: 7.0982 },
  { label: "DE-Muenster", lat: 51.9607, lng: 7.6261 },
  { label: "DE-Karlsruhe", lat: 49.0069, lng: 8.4037 },
  { label: "DE-Mannheim", lat: 49.4875, lng: 8.466 },
  { label: "DE-Augsburg", lat: 48.3705, lng: 10.8978 },
  { label: "DE-Wiesbaden", lat: 50.0782, lng: 8.2398 },
  { label: "DE-Gelsenkirchen", lat: 51.5177, lng: 7.0857 },
  { label: "DE-Moenchengladbach", lat: 51.1805, lng: 6.4428 },
  { label: "DE-Braunschweig", lat: 52.2689, lng: 10.5268 },
  { label: "DE-Chemnitz", lat: 50.8278, lng: 12.9214 },
  { label: "DE-Kiel", lat: 54.3233, lng: 10.1228 },
  { label: "DE-Aachen", lat: 50.7753, lng: 6.0839 },
  { label: "DE-Halle", lat: 51.4969, lng: 11.9688 },
  { label: "DE-Magdeburg", lat: 52.1205, lng: 11.6276 },
  { label: "DE-Freiburg", lat: 47.999, lng: 7.8421 },
  { label: "DE-Kassel", lat: 51.3127, lng: 9.4797 },
  { label: "DE-Regensburg", lat: 49.0134, lng: 12.1016 },
  { label: "DE-Rostock", lat: 54.0924, lng: 12.0991 },
  { label: "DE-Erfurt", lat: 50.9848, lng: 11.0299 },
  { label: "DE-Mainz", lat: 49.9929, lng: 8.2473 },
  { label: "DE-Saarbruecken", lat: 49.2402, lng: 6.9969 },
  { label: "DE-Potsdam", lat: 52.3906, lng: 13.0645 },
  { label: "DE-Ulm", lat: 48.4011, lng: 9.9876 },
  { label: "DE-Luebeck", lat: 53.8655, lng: 10.6866 },
  { label: "DE-Osnabrueck", lat: 52.2799, lng: 8.0472 },
  { label: "DE-Heilbronn", lat: 49.1427, lng: 9.2109 },
  { label: "DE-Oldenburg", lat: 53.1435, lng: 8.2146 },
  { label: "DE-Paderborn", lat: 51.7189, lng: 8.7575 },
  { label: "DE-Wuerzburg", lat: 49.7913, lng: 9.9534 },
  { label: "DE-Goettingen", lat: 51.5413, lng: 9.9158 },
  { label: "DE-Ingolstadt", lat: 48.7665, lng: 11.4258 },
  { label: "DE-Trier", lat: 49.7499, lng: 6.6371 },
];

const FUEL_TYPES: FuelType[] = ["e5", "e10", "diesel"];

function authFailed(req: NextRequest) {
  const header = req.headers.get("authorization");
  return header !== `Bearer ${INGEST_SECRET}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeFuelType(type: FuelType) {
  switch (type) {
    case "diesel":
      return "DIESEL";
    case "e5":
      return "PETROL_95";
    case "e10":
      return "PETROL_E10";
  }
}

function buildAddress(station: TankerkoenigStation) {
  return (
    [station.street, station.houseNumber].filter(Boolean).join(" ").trim() ||
    null
  );
}

function isValidPrice(price: unknown) {
  const n = Number(price);
  return Number.isFinite(n) && n > 0 && n < 5;
}

async function fetchTankerkoenigStations(params: {
  lat: number;
  lng: number;
  radiusKm: number;
  fuelType: FuelType;
}) {
  const url = new URL("https://creativecommons.tankerkoenig.de/json/list.php");
  url.searchParams.set("lat", String(params.lat));
  url.searchParams.set("lng", String(params.lng));
  url.searchParams.set("rad", String(params.radiusKm));
  url.searchParams.set("sort", "dist");
  url.searchParams.set("type", params.fuelType);
  url.searchParams.set("apikey", TANKERKOENIG_API_KEY);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      accept: "application/json",
      "user-agent": "Tankaj.si/1.0 Germany fuel ingest",
    },
    cache: "no-store",
  });

  const json = (await res.json()) as TankerkoenigResponse;

  if (!res.ok || !json.ok) {
    throw new Error(
      `Tankerkönig API error: status=${res.status}, message=${
        json.message ?? json.data ?? "unknown"
      }`,
    );
  }

  return json.stations ?? [];
}

async function wasRecentlyIngested(cacheKey: string, ttlMinutes: number) {
  const since = new Date(Date.now() - ttlMinutes * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("ingest_cache")
    .select("cache_key, updated_at")
    .eq("cache_key", cacheKey)
    .gte("updated_at", since)
    .maybeSingle();

  if (error) return false;
  return Boolean(data);
}

async function touchCache(cacheKey: string, payload: Record<string, unknown>) {
  await supabase.from("ingest_cache").upsert(
    {
      cache_key: cacheKey,
      source: "tankerkoenig",
      payload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "cache_key" },
  );
}

export async function GET(req: NextRequest) {
  const startedAt = new Date().toISOString();

  try {
    if (authFailed(req)) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Missing env vars. Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY",
        },
        { status: 500 },
      );
    }

    if (!TANKERKOENIG_API_KEY) {
      return NextResponse.json({
        success: true,
        source: "tankerkoenig",
        country: "DE",
        ready: false,
        skipped: true,
        reason: "TANKERKOENIG_API_KEY is not configured yet",
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    }

    const searchParams = req.nextUrl.searchParams;

    const radiusKm = Math.min(Number(searchParams.get("radius") ?? 25), 25);
    const offset = Math.max(Number(searchParams.get("offset") ?? 0), 0);
    const limit = Math.min(
      Math.max(Number(searchParams.get("limit") ?? 3), 1),
      10,
    );
    const ttlMinutes = Math.max(Number(searchParams.get("ttl") ?? 360), 30);
    const delayMs = Math.max(Number(searchParams.get("delayMs") ?? 0), 0);

    const requestedFuel = searchParams.get("fuel") as FuelType | null;
    const fuelTypes =
      requestedFuel && FUEL_TYPES.includes(requestedFuel)
        ? [requestedFuel]
        : FUEL_TYPES;

    const selectedGrid = GERMANY_GRID.slice(offset, offset + limit);

    let apiCalls = 0;
    let skippedByCache = 0;
    let stationsFound = 0;
    let locationsUpserted = 0;
    let pricesInserted = 0;

    const errors: Array<{ label: string; fuelType: string; error: string }> =
      [];

    for (const point of selectedGrid) {
      for (const fuelType of fuelTypes) {
        const cacheKey = `germany:${point.label}:${fuelType}:r${radiusKm}`;

        const cached = await wasRecentlyIngested(cacheKey, ttlMinutes);
        if (cached) {
          skippedByCache += 1;
          continue;
        }

        try {
          const stations = await fetchTankerkoenigStations({
            lat: point.lat,
            lng: point.lng,
            radiusKm,
            fuelType,
          });

          apiCalls += 1;
          stationsFound += stations.length;

          const sourceIds = stations
            .filter((station) => station.id)
            .map((station) => String(station.id));

          const now = new Date().toISOString();

          const locationRows = stations
            .filter(
              (station) =>
                station.id &&
                Number.isFinite(station.lat) &&
                Number.isFinite(station.lng),
            )
            .map((station) => ({
              type: "fuel_station",
              name: station.name || station.brand || "Tankstelle",
              brand: getCanonicalBrand(
                `${station.brand || ""} ${station.name || ""}`,
              ),
              operator: getCanonicalBrand(
                `${station.brand || ""} ${station.name || ""}`,
              ),
              address: buildAddress(station),
              city: station.place || null,
              country_code: "DE",
              lat: station.lat,
              lng: station.lng,
              geo: `POINT(${station.lng} ${station.lat})`,
              source: "tankerkoenig",
              source_id: String(station.id),
              is_active: true,
              metadata: {
                post_code: station.postCode ? String(station.postCode) : null,
                dist: station.dist ?? null,
                is_open: station.isOpen ?? null,
                tankerkoenig: station,
              },
              updated_at: now,
            }));

          if (locationRows.length > 0) {
            const { error: locationError } = await supabase
              .from("locations")
              .upsert(locationRows, { onConflict: "source,source_id" });

            if (locationError) throw locationError;

            locationsUpserted += locationRows.length;
          }

          if (sourceIds.length === 0) {
            await touchCache(cacheKey, {
              point,
              fuelType,
              radiusKm,
              stationsFound: stations.length,
              note: "No valid source IDs returned",
            });
            continue;
          }

          const { data: locationRowsFromDb, error: locationReadError } =
            await supabase
              .from("locations")
              .select("id,source_id")
              .eq("source", "tankerkoenig")
              .eq("country_code", "DE")
              .in("source_id", sourceIds);

          if (locationReadError) throw locationReadError;

          const locationIdBySourceId = new Map(
            (locationRowsFromDb || []).map((row) => [
              String(row.source_id),
              row.id,
            ]),
          );

          const priceRows = stations
            .filter((station) => station.id && isValidPrice(station.price))
            .map((station) => {
              const locationId = locationIdBySourceId.get(String(station.id));
              if (!locationId) return null;

              return {
                location_id: locationId,
                fuel_type: normalizeFuelType(fuelType),
                price: toNumber(station.price),
                currency: "EUR",
                source: "tankerkoenig",
                confidence: "official",
                raw_product_name: fuelType,
                source_updated_at: now,
                captured_at: now,
              };
            })
            .filter((row): row is NonNullable<typeof row> => row !== null);

          if (priceRows.length > 0) {
            const { error: priceError } = await supabase
              .from("fuel_prices")
              .upsert(priceRows, {
                onConflict: "location_id,fuel_type,source",
              });

            if (priceError) throw priceError;

            pricesInserted += priceRows.length;
          }

          await touchCache(cacheKey, {
            point,
            fuelType,
            radiusKm,
            stationsFound: stations.length,
            locationsUpserted: locationRows.length,
            pricesInserted: priceRows.length,
          });

          if (delayMs > 0) {
            await sleep(delayMs);
          }
        } catch (error) {
          errors.push({
            label: point.label,
            fuelType,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      source: "tankerkoenig",
      country: "DE",
      startedAt,
      finishedAt: new Date().toISOString(),
      offset,
      limit,
      radiusKm,
      ttlMinutes,
      fuelTypes,
      gridProcessed: selectedGrid.map((p) => p.label),
      apiCalls,
      skippedByCache,
      stationsFound,
      locationsUpserted,
      pricesInserted,
      errors,
      attribution:
        "Fuel price data from Tankerkönig / MTS-K. Respect Tankerkönig API terms and MTS-K data usage rules.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        source: "tankerkoenig",
        country: "DE",
        startedAt,
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
