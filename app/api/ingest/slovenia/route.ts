import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GORIVA_URL = "https://goriva.si/api/v1/search/";
const SOURCE = "goriva.si";
const BATCH_SIZE = 500;

const FUEL_MAP: Record<string, string> = {
  "95": "PETROL_95",
  "98": "PETROL_98",
  "100": "PETROL_100",
  dizel: "DIESEL",
  "dizel-premium": "PREMIUM_DIESEL",
  avtoplin_lpg: "LPG",
  KOEL: "ELKO",
  cng: "CNG",
  lng: "LNG",
};

type GorivaStation = {
  pk: number;
  name: string;
  address: string;
  lat: number;
  lng: number;
  prices: Record<string, number | null>;
  distance?: number;
  direction?: string;
  open_hours?: string;
  zip_code?: string;
};

type LocationRow = {
  id: string;
  source_id: string | null;
};

function isAuthorized(req: NextRequest) {
  if (process.env.NODE_ENV !== "production") return true;

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const userAgent = req.headers.get("user-agent") || "";

  if (userAgent.toLowerCase().includes("vercel-cron")) {
    return true;
  }

  if (!cronSecret) return false;

  return authHeader === `Bearer ${cronSecret}`;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
}

async function fetchAllGorivaPages(): Promise<GorivaStation[]> {
  let url: string | null =
    `${GORIVA_URL}?position=46.1512%2C14.9955&radius=200000&o=distance`;
  const all: GorivaStation[] = [];

  while (url !== null) {
    const currentUrl: string = url;

    const res: Response = await fetch(currentUrl, {
      headers: {
        accept: "application/json",
        "user-agent": "Tankaj.si importer",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`goriva.si returned ${res.status}`);
    }

    const json: {
      results?: GorivaStation[];
      next?: string | null;
    } = await res.json();

    all.push(...(json.results || []));
    url = json.next || null;
  }

  return all;
}

function buildLocationPayload(station: GorivaStation) {
  const brand = station.name.split(" ")[0] || null;

  return {
    type: "fuel_station",
    name: station.name,
    brand,
    operator: brand,
    address: station.address,
    city: null,
    country_code: "SI",
    lat: station.lat,
    lng: station.lng,
    geo: `POINT(${station.lng} ${station.lat})`,
    source: SOURCE,
    source_id: String(station.pk),
    opening_hours: station.open_hours ? { raw: station.open_hours } : null,
    metadata: {
      zip_code: station.zip_code || null,
      distance: station.distance || null,
      direction: station.direction || null,
      raw: station,
    },
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

  console.log("Tankaj.si SI INGEST RUN:", startedAt);

  const syncRun = await supabase
    .from("source_sync_runs")
    .insert({
      source: SOURCE,
      status: "running",
      started_at: startedAt,
    })
    .select("id")
    .single();

  try {
    const stations = await fetchAllGorivaPages();

    const locationPayloads = stations.map(buildLocationPayload);

    for (const batch of chunk(locationPayloads, BATCH_SIZE)) {
      const { error } = await supabase.from("locations").upsert(batch, {
        onConflict: "source,source_id",
      });

      if (error) throw error;
    }

    const sourceIds = stations.map((station) => String(station.pk));

    const locationRows: LocationRow[] = [];

    for (const batch of chunk(sourceIds, BATCH_SIZE)) {
      const { data, error } = await supabase
        .from("locations")
        .select("id,source_id")
        .eq("source", SOURCE)
        .in("source_id", batch);

      if (error) throw error;

      locationRows.push(...((data || []) as LocationRow[]));
    }

    const locationIdBySourceId = new Map(
      locationRows
        .filter((row) => row.source_id)
        .map((row) => [String(row.source_id), row.id]),
    );

    const now = new Date().toISOString();

    const pricePayloads = stations.flatMap((station) => {
      const locationId = locationIdBySourceId.get(String(station.pk));

      if (!locationId) return [];

      return Object.entries(station.prices || [])
        .map(([rawFuelName, price]) => {
          if (price === null) return null;

          const fuelType = FUEL_MAP[rawFuelName];
          if (!fuelType) return null;

          return {
            location_id: locationId,
            fuel_type: fuelType,
            price,
            currency: "EUR",
            source: SOURCE,
            confidence: "verified",
            raw_product_name: rawFuelName,
            source_updated_at: now,
            captured_at: now,
          };
        })
        .filter(Boolean);
    });

    for (const batch of chunk(pricePayloads, BATCH_SIZE)) {
      const { error } = await supabase.from("fuel_prices").upsert(batch, {
        onConflict: "location_id,fuel_type,source",
      });

      if (error) throw error;
    }

    if (syncRun.data?.id) {
      await supabase
        .from("source_sync_runs")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          records_found: stations.length,
          records_updated: locationPayloads.length,
        })
        .eq("id", syncRun.data.id);
    }

    return NextResponse.json({
      success: true,
      source: SOURCE,
      startedAt,
      finishedAt: new Date().toISOString(),
      stationsFound: stations.length,
      locationsUpserted: locationPayloads.length,
      pricesInserted: pricePayloads.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);

    console.error("Tankaj.si SI INGEST ERROR:", message);

    if (syncRun.data?.id) {
      await supabase
        .from("source_sync_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error_message: message,
        })
        .eq("id", syncRun.data.id);
    }

    return NextResponse.json(
      { success: false, source: SOURCE, error: message },
      { status: 500 },
    );
  }
}
