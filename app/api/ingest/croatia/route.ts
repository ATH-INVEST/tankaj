import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MZOE_URL = "https://mzoe-gor.hr/data.json";
const SOURCE = "mzoe-gor.hr";
const LOCATION_BATCH_SIZE = 500;
const PRICE_BATCH_SIZE = 1000;

type CroatiaStation = {
  id: number;
  naziv: string;
  adresa?: string;
  mjesto?: string;
  lat: string | number | null;
  long: string | number | null;
  url?: string;
  obveznik_id?: number;
  cjenici?: { id: number; cijena: number; gorivo_id: number }[];
  radnaVremena?: unknown[];
};

type LocationRow = {
  id: string;
  source_id: string | null;
};

type PendingPrice = {
  sourceId: string;
  fuelType: string;
  price: number;
  rawProductName: string;
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

function cleanText(value?: string | null) {
  if (!value) return null;
  return value.replace(/\s+/g, " ").trim();
}

function normalizeFuelName(name: string): string | null {
  const v = name.toLowerCase();

  if (
    v.includes("adblue") ||
    v.includes("plavi") ||
    v.includes("lož") ||
    v.includes("loz")
  ) {
    return null;
  }

  if (v.includes("autoplin") || v.includes("lpg")) return "LPG";

  if (
    v.includes("diesel") ||
    v.includes("dizel") ||
    v.includes("eurodizel") ||
    v.includes("eurodiesel")
  ) {
    if (
      v.includes("premium") ||
      v.includes("class") ||
      v.includes("maxx") ||
      v.includes("q max")
    ) {
      return "PREMIUM_DIESEL";
    }

    return "DIESEL";
  }

  if (v.includes("100")) return "PETROL_100";
  if (v.includes("98")) return "PETROL_98";

  if (
    v.includes("95") ||
    v.includes("super") ||
    v.includes("benzin") ||
    v.includes("eurosuper")
  ) {
    return "PETROL_95";
  }

  return null;
}

function parseCoord(value: string | number | null) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num;
}

function getCoords(station: CroatiaStation) {
  // MZOE ima obratno poimenovanje:
  // long = latitude, lat = longitude
  const latitude = parseCoord(station.long);
  const longitude = parseCoord(station.lat);

  if (latitude === null || longitude === null) return null;
  if (latitude < 42 || latitude > 47) return null;
  if (longitude < 13 || longitude > 20) return null;

  return { lat: latitude, lng: longitude };
}

function normalizeBrand(station: CroatiaStation, companyName?: string | null) {
  const text =
    `${companyName || ""} ${station.naziv || ""} ${station.url || ""}`.toUpperCase();

  if (text.includes("INA")) return "INA";
  if (text.includes("PETROL")) return "PETROL";
  if (text.includes("TIFON")) return "TIFON";
  if (text.includes("SHELL") || text.includes("CORAL")) return "SHELL";
  if (text.includes("CRODUX")) return "CRODUX";
  if (text.includes("MOL")) return "MOL";
  if (text.includes("ADRIA")) return "ADRIA OIL";

  return companyName?.split(" ")[0] || station.naziv.split(" ")[0] || null;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
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
    const res = await fetch(MZOE_URL, {
      headers: {
        accept: "application/json",
        "user-agent": "Tankaj.si importer",
      },
      cache: "no-store",
    });

    if (!res.ok) throw new Error(`${SOURCE} returned ${res.status}`);

    const json = await res.json();

    const stationsRaw: CroatiaStation[] = Array.isArray(json.postajas)
      ? json.postajas
      : [];
    const stations = limit > 0 ? stationsRaw.slice(0, limit) : stationsRaw;
    const fuels: unknown[] = Array.isArray(json.gorivos) ? json.gorivos : [];
    const companies: unknown[] = Array.isArray(json.obvezniks)
      ? json.obvezniks
      : [];

    const fuelById = new Map<number, string>();
    for (const fuel of fuels as any[]) {
      const name = cleanText(fuel.naziv || fuel.ime || fuel.name || null);
      if (fuel.id && name) fuelById.set(Number(fuel.id), name);
    }

    const companyById = new Map<number, string>();
    for (const company of companies as any[]) {
      const name = cleanText(
        company.naziv || company.ime || company.name || company.tvrtka || null,
      );
      if (company.id && name) companyById.set(Number(company.id), name);
    }

    const locationPayloads = [];
    const pendingPrices: PendingPrice[] = [];

    let skippedNoCoords = 0;
    let skippedNoPrices = 0;

    for (const station of stations) {
      const coords = getCoords(station);

      if (!coords) {
        skippedNoCoords++;
        continue;
      }

      const prices: Omit<PendingPrice, "sourceId">[] = [];

      for (const priceRow of station.cjenici || []) {
        const price = Number(priceRow.cijena);

        if (!Number.isFinite(price) || price <= 0 || price > 5) continue;

        const rawFuelName =
          fuelById.get(Number(priceRow.gorivo_id)) ||
          `gorivo_id:${priceRow.gorivo_id}`;

        const fuelType = normalizeFuelName(rawFuelName);

        if (!fuelType) continue;

        if (fuelType === "PETROL_95" && (price < 1.2 || price > 2.5)) continue;
        if (fuelType === "DIESEL" && (price < 1.2 || price > 2.5)) continue;
        if (fuelType === "PETROL_100" && (price < 1.3 || price > 3.0)) continue;
        if (fuelType === "PETROL_98" && (price < 1.3 || price > 3.0)) continue;
        if (fuelType === "PREMIUM_DIESEL" && (price < 1.3 || price > 3.0))
          continue;
        if (fuelType === "LPG" && (price < 0.4 || price > 1.8)) continue;

        prices.push({
          fuelType,
          price: Number(price.toFixed(3)),
          rawProductName: rawFuelName,
        });

        if (!fuelType) continue;

        prices.push({
          fuelType,
          price: Number(price.toFixed(3)),
          rawProductName: rawFuelName,
        });
      }

      if (prices.length === 0) {
        skippedNoPrices++;
        continue;
      }

      const sourceId = String(station.id);
      const companyName = station.obveznik_id
        ? companyById.get(Number(station.obveznik_id)) || null
        : null;
      const brand = normalizeBrand(station, companyName);

      locationPayloads.push({
        type: "fuel_station",
        name: cleanText(station.naziv) || `HR station ${station.id}`,
        brand,
        operator: companyName || brand,
        address: cleanText(station.adresa),
        city: cleanText(station.mjesto),
        country_code: "HR",
        lat: coords.lat,
        lng: coords.lng,
        geo: `POINT(${coords.lng} ${coords.lat})`,
        source: SOURCE,
        source_id: sourceId,
        opening_hours: station.radnaVremena
          ? { raw: station.radnaVremena }
          : null,
        metadata: {
          url: station.url || null,
          obveznik_id: station.obveznik_id || null,
          company_name: companyName,
        },
      });

      for (const p of prices) {
        pendingPrices.push({
          sourceId,
          ...p,
        });
      }
    }

    for (const part of chunk(locationPayloads, LOCATION_BATCH_SIZE)) {
      const { error } = await supabase.from("locations").upsert(part, {
        onConflict: "source,source_id",
      });

      if (error) throw error;
    }

    const sourceIds = locationPayloads.map((location) =>
      String(location.source_id),
    );
    const locationRows: LocationRow[] = [];

    for (const part of chunk(sourceIds, LOCATION_BATCH_SIZE)) {
      const { data, error } = await supabase
        .from("locations")
        .select("id,source_id")
        .eq("source", SOURCE)
        .in("source_id", part);

      if (error) throw error;

      locationRows.push(...((data || []) as LocationRow[]));
    }

    const locationIdBySourceId = new Map(
      locationRows
        .filter((row) => row.source_id)
        .map((row) => [String(row.source_id), row.id]),
    );

    const now = new Date().toISOString();

    const pricePayloads = pendingPrices
      .map((p) => {
        const locationId = locationIdBySourceId.get(p.sourceId);

        if (!locationId) return null;

        return {
          location_id: locationId,
          fuel_type: p.fuelType,
          price: p.price,
          currency: "EUR",
          source: SOURCE,
          confidence: "verified",
          raw_product_name: p.rawProductName,
          source_updated_at: now,
          captured_at: now,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    for (const part of chunk(pricePayloads, PRICE_BATCH_SIZE)) {
      const uniqueMap = new Map<string, (typeof pricePayloads)[number]>();

      for (const row of part) {
        const key = `${row.location_id}-${row.fuel_type}-${row.source}`;

        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, row);
        }
      }

      const clean = Array.from(uniqueMap.values());

      const { error } = await supabase.from("fuel_prices").upsert(clean, {
        onConflict: "location_id,fuel_type,source",
      });

      if (error) {
        console.error("Croatia ingest error:", error);
        throw error;
      }
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
      skippedNoCoords,
      skippedNoPrices,
      limitedTo: limit || null,
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
