import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SOURCE = "openchargemap";
const COUNTRIES = ["SI", "HR", "AT", "IT"] as const;
const LOCATION_BATCH_SIZE = 500;

type OcmConnection = {
  ConnectionType?: { Title?: string | null } | null;
  PowerKW?: number | null;
};

type OcmPoi = {
  ID: number;
  AddressInfo?: {
    Title?: string | null;
    AddressLine1?: string | null;
    Town?: string | null;
    Latitude?: number | null;
    Longitude?: number | null;
  } | null;
  OperatorInfo?: { Title?: string | null } | null;
  UsageType?: { Title?: string | null } | null;
  StatusType?: { IsOperational?: boolean | null } | null;
  Connections?: OcmConnection[];
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

function cleanText(value?: string | null) {
  if (!value) return null;
  return value.replace(/\s+/g, " ").trim();
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    chunks.push(items.slice(i, i + size));
  return chunks;
}

function isValidCoord(country: string, lat: number, lng: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (country === "SI") return lat >= 45 && lat <= 47 && lng >= 13 && lng <= 17;
  if (country === "HR") return lat >= 42 && lat <= 47 && lng >= 13 && lng <= 20;
  if (country === "AT") return lat >= 46 && lat <= 50 && lng >= 9 && lng <= 18;
  if (country === "IT") return lat >= 35 && lat <= 48 && lng >= 6 && lng <= 19;
  return false;
}

function normalizeConnectorTypes(connections?: OcmConnection[]) {
  const values = (connections || [])
    .map((c) => cleanText(c.ConnectionType?.Title || null))
    .filter((v): v is string => Boolean(v));
  return Array.from(new Set(values));
}

function getMaxPowerKw(connections?: OcmConnection[]) {
  const powers = (connections || [])
    .map((c) => Number(c.PowerKW))
    .filter((v) => Number.isFinite(v) && v > 0 && v <= 500);
  return powers.length ? Math.max(...powers) : null;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const apiKey = process.env.OPENCHARGEMAP_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: "Missing OPENCHARGEMAP_API_KEY" },
      { status: 500 },
    );
  }

  const startedAt = new Date().toISOString();
  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get("limit") || 0);

  const syncRun = await supabase
    .from("source_sync_runs")
    .insert({ source: SOURCE, status: "running", started_at: startedAt })
    .select("id")
    .single();

  try {
    const locationPayloads = [];
    let recordsFound = 0;
    let skippedNoCoords = 0;
    let skippedInvalidCoords = 0;

    for (const country of COUNTRIES) {
      const maxresults = limit > 0 ? limit : 5000;
      const url =
        `https://api.openchargemap.io/v3/poi/?output=json` +
        `&countrycode=${country}` +
        `&maxresults=${maxresults}` +
        `&compact=false&verbose=false` +
        `&key=${encodeURIComponent(apiKey)}`;

      const res = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "Tankaj.si EV importer",
        },
        cache: "no-store",
      });

      if (!res.ok)
        throw new Error(`${SOURCE} ${country} returned ${res.status}`);

      const json: OcmPoi[] = await res.json();
      const pois = Array.isArray(json) ? json : [];
      recordsFound += pois.length;

      for (const item of pois) {
        const lat = Number(item.AddressInfo?.Latitude);
        const lng = Number(item.AddressInfo?.Longitude);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          skippedNoCoords++;
          continue;
        }

        if (!isValidCoord(country, lat, lng)) {
          skippedInvalidCoords++;
          continue;
        }

        const externalId = String(item.ID);
        const connectorTypes = normalizeConnectorTypes(item.Connections);
        const maxPowerKw = getMaxPowerKw(item.Connections);

        locationPayloads.push({
          external_id: externalId,
          source: SOURCE,
          name:
            cleanText(item.AddressInfo?.Title || null) ||
            `EV polnilnica ${externalId}`,
          operator: cleanText(item.OperatorInfo?.Title || null),
          address: cleanText(item.AddressInfo?.AddressLine1 || null),
          city: cleanText(item.AddressInfo?.Town || null),
          country_code: country,
          lat,
          lng,
          max_power_kw: maxPowerKw,
          connector_types: connectorTypes,
          is_operational: item.StatusType?.IsOperational ?? true,
          access_type: cleanText(item.UsageType?.Title || null),
          captured_at: startedAt,
        });
      }
    }

    for (const part of chunk(locationPayloads, LOCATION_BATCH_SIZE)) {
      const { error } = await supabase.from("ev_locations").upsert(part, {
        onConflict: "external_id",
      });
      if (error) throw error;
    }

    if (syncRun.data?.id) {
      await supabase
        .from("source_sync_runs")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          records_found: recordsFound,
          records_updated: locationPayloads.length,
        })
        .eq("id", syncRun.data.id);
    }

    return NextResponse.json({
      success: true,
      source: SOURCE,
      countries: COUNTRIES,
      recordsFound,
      locationsUpserted: locationPayloads.length,
      skippedNoCoords,
      skippedInvalidCoords,
      limitedToPerCountry: limit || null,
      priceNote:
        "EV ingest imports locations only. Prices come from verified ev_prices rows or ev_tariffs_reference fallback.",
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
