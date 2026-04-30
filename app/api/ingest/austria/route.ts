import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { getCanonicalBrand } from "@/lib/normalizeBrand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SOURCE = "openstreetmap_at";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const BATCH_SIZE = 500;

type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: {
    lat?: number;
    lon?: number;
  };
  tags?: Record<string, string>;
};

function isAuthorized(req: NextRequest) {
  if (process.env.NODE_ENV !== "production") return true;

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const userAgent = req.headers.get("user-agent") || "";

  if (userAgent.toLowerCase().includes("vercel-cron")) return true;
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

function cleanText(value?: string | null) {
  if (!value) return null;
  return value.replace(/\s+/g, " ").trim() || null;
}

function normalizeBrand(tags: Record<string, string>) {
  const raw = `${tags.brand || ""} ${tags.operator || ""} ${tags.name || ""}`
    .toUpperCase()
    .replace(/\s+/g, " ");

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
  if (raw.includes("ROTH")) return "ROTH";
  if (raw.includes("IQ")) return "IQ";

  return cleanText(tags.brand) || cleanText(tags.operator) || null;
}

function buildAddress(tags: Record<string, string>) {
  const street = cleanText(tags["addr:street"]);
  const houseNumber = cleanText(tags["addr:housenumber"]);
  const place = cleanText(tags["addr:place"]);

  if (street && houseNumber) return `${street} ${houseNumber}`;
  if (street) return street;
  if (place && houseNumber) return `${place} ${houseNumber}`;
  if (place) return place;

  return null;
}

function buildName(tags: Record<string, string>) {
  return (
    cleanText(tags.name) ||
    cleanText(tags.brand) ||
    cleanText(tags.operator) ||
    "Bencinski servis"
  );
}

async function fetchAustriaFuelStations() {
  const query = `
    [out:json][timeout:45];
    area["ISO3166-1"="AT"][admin_level=2]->.austria;
    (
      node["amenity"="fuel"](area.austria);
      way["amenity"="fuel"](area.austria);
      relation["amenity"="fuel"](area.austria);
    );
    out center tags;
  `;

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      accept: "application/json",
      "user-agent": "Tankaj.si importer (https://tankaj.si)",
    },
    body: new URLSearchParams({ data: query }).toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Overpass returned ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as { elements?: OsmElement[] };

  return json.elements || [];
}

function buildLocationPayload(element: OsmElement) {
  const tags = element.tags || {};
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const brand = normalizeBrand(tags);
  const name = buildName(tags);
  const address = buildAddress(tags);
  const city = cleanText(tags["addr:city"]) || cleanText(tags["addr:town"]);

  return {
    type: "fuel_station",
    name,
    brand,
    operator: cleanText(tags.operator) || brand,
    address,
    city,
    country_code: "AT",
    lat,
    lng,
    geo: `POINT(${lng} ${lat})`,
    source: SOURCE,
    source_id: `${element.type}/${element.id}`,
    is_active: true,
    external_url: tags.website || null,
    opening_hours: tags.opening_hours
      ? {
          raw: tags.opening_hours,
        }
      : null,
    metadata: {
      osm_type: element.type,
      osm_id: element.id,
      postcode: tags["addr:postcode"] || null,
      fuel_diesel: tags["fuel:diesel"] || null,
      fuel_octane_95: tags["fuel:octane_95"] || null,
      fuel_octane_98: tags["fuel:octane_98"] || null,
      fuel_lpg: tags["fuel:lpg"] || null,
      fuel_cng: tags["fuel:cng"] || null,
      shop: tags.shop || null,
      payment_cards: tags["payment:cards"] || null,
      raw_tags: tags,
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
  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get("limit") || 0);

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
    const elements = await fetchAustriaFuelStations();

    const payloadsRaw = elements
      .map(buildLocationPayload)
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    const payloads = limit > 0 ? payloadsRaw.slice(0, limit) : payloadsRaw;

    for (const batch of chunk(payloads, BATCH_SIZE)) {
      const { error } = await supabase.from("locations").upsert(batch, {
        onConflict: "source,source_id",
      });

      if (error) throw error;
    }

    if (syncRun.data?.id) {
      await supabase
        .from("source_sync_runs")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          records_found: elements.length,
          records_updated: payloads.length,
        })
        .eq("id", syncRun.data.id);
    }

    return NextResponse.json({
      success: true,
      source: SOURCE,
      startedAt,
      finishedAt: new Date().toISOString(),
      osmElementsFound: elements.length,
      locationsUpserted: payloads.length,
      limited: limit > 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);

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
