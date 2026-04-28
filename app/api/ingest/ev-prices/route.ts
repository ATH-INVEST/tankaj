import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SOURCE = "public-operator-tariff";

type PowerType = "AC" | "DC";

type TariffRule = {
  operatorMatch: string[];
  countries: string[];
  powerType: PowerType;
  minPowerKw?: number;
  maxPowerKw?: number;
  pricePerKwh: number;
  sessionFee?: number;
  pricePerMinute?: number | null;
  sourceName: string;
  sourceUrl: string;
  note: string;
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

function normalize(value?: string | null) {
  return String(value || "").trim().toUpperCase();
}

function matchesOperator(location: any, rule: TariffRule) {
  const text = normalize(`${location.operator || ""} ${location.name || ""}`);
  return rule.operatorMatch.some((match) => text.includes(normalize(match)));
}

function matchesPower(location: any, rule: TariffRule) {
  const maxPower = Number(location.max_power_kw || 0);

  if (rule.minPowerKw && maxPower > 0 && maxPower < rule.minPowerKw) return false;
  if (rule.maxPowerKw && maxPower > 0 && maxPower > rule.maxPowerKw) return false;

  return true;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Conservative public tariffs.
 * Important: we store these as verified because they come from public operator price lists,
 * but still show source + note in UI.
 */
const TARIFF_RULES: TariffRule[] = [
  {
    operatorMatch: ["PETROL"],
    countries: ["SI"],
    powerType: "AC",
    maxPowerKw: 22,
    pricePerKwh: 0.41,
    sourceName: "Petrol javni cenik",
    sourceUrl:
      "https://www.petrol.si/mobilnost/zasebni-uporabniki/javne-elektricne-polnilnice/cenik-polnjenje-eng",
    note: "Petrol Slovenija, ad-hoc/javni cenik, priključki do 22 kW.",
  },
  {
    operatorMatch: ["PETROL"],
    countries: ["SI"],
    powerType: "DC",
    minPowerKw: 22.01,
    maxPowerKw: 50,
    pricePerKwh: 0.51,
    sourceName: "Petrol javni cenik",
    sourceUrl:
      "https://www.petrol.si/mobilnost/zasebni-uporabniki/javne-elektricne-polnilnice/cenik-polnjenje-eng",
    note: "Petrol Slovenija, ad-hoc/javni cenik, priključki 22.01–50 kW.",
  },
  {
    operatorMatch: ["PETROL"],
    countries: ["SI"],
    powerType: "DC",
    minPowerKw: 50.01,
    pricePerKwh: 0.73,
    sourceName: "Petrol javni cenik",
    sourceUrl:
      "https://www.petrol.si/mobilnost/zasebni-uporabniki/javne-elektricne-polnilnice/cenik-polnjenje-eng",
    note: "Petrol Slovenija, ad-hoc/javni cenik, priključki nad 50 kW.",
  },
  {
    operatorMatch: ["GNE", "GREMO NA ELEKTRIKO", "ELEKTRO LJUBLJANA"],
    countries: ["SI"],
    powerType: "AC",
    maxPowerKw: 22,
    pricePerKwh: 0.35,
    sessionFee: 0.5,
    sourceName: "Gremo na elektriko cenik",
    sourceUrl:
      "https://www.gremonaelektriko.si/Portals/1/Ceniki/2023%2007%20Cenik%20storitve%20polnjenja%20GNE.pdf",
    note: "Gremo na elektriko, AC do 22 kW; dodana pristojbina po ceniku.",
  },
  {
    operatorMatch: ["GNE", "GREMO NA ELEKTRIKO", "ELEKTRO LJUBLJANA"],
    countries: ["SI"],
    powerType: "DC",
    minPowerKw: 22.01,
    pricePerKwh: 0.45,
    sessionFee: 1,
    sourceName: "Gremo na elektriko cenik",
    sourceUrl:
      "https://www.gremonaelektriko.si/Portals/1/Ceniki/2023%2007%20Cenik%20storitve%20polnjenja%20GNE.pdf",
    note: "Gremo na elektriko, DC; dodana pristojbina po ceniku.",
  },
  {
    operatorMatch: ["MOL", "PLUGEE"],
    countries: ["SI"],
    powerType: "AC",
    pricePerKwh: 0.7,
    sourceName: "MOL Plugee Slovenija",
    sourceUrl: "https://molplugee.si/si/cene",
    note: "MOL Plugee Slovenija, paketna cena preračunana na kWh.",
  },
  {
    operatorMatch: ["MOL", "PLUGEE"],
    countries: ["SI"],
    powerType: "DC",
    pricePerKwh: 0.9,
    sourceName: "MOL Plugee Slovenija",
    sourceUrl: "https://molplugee.si/si/cene",
    note: "MOL Plugee Slovenija, paketna cena preračunana na kWh.",
  },
  {
    operatorMatch: ["IONITY"],
    countries: ["SI", "HR", "AT", "IT"],
    powerType: "DC",
    pricePerKwh: 0.73,
    sourceName: "IONITY Direct",
    sourceUrl: "https://www.ionity.eu/",
    note: "IONITY Direct javna tarifa; točno ceno preveri na polnilnici, v IONITY appu ali QR plačilni strani.",
  },
  {
    operatorMatch: ["SMATRICS"],
    countries: ["AT"],
    powerType: "AC",
    pricePerKwh: 0.81,
    sourceName: "Smatrics / Petrol roaming cenik",
    sourceUrl:
      "https://www.petrol.si/mobilnost/zasebni-uporabniki/javne-elektricne-polnilnice/cenik-polnjenje",
    note: "Smatrics AC tarifa iz javnega cenika/roaming cenika.",
  },
  {
    operatorMatch: ["SMATRICS"],
    countries: ["AT"],
    powerType: "DC",
    maxPowerKw: 50,
    pricePerKwh: 0.87,
    sourceName: "Smatrics / Petrol roaming cenik",
    sourceUrl:
      "https://www.petrol.si/mobilnost/zasebni-uporabniki/javne-elektricne-polnilnice/cenik-polnjenje",
    note: "Smatrics DC do 50 kW tarifa iz javnega cenika/roaming cenika.",
  },
  {
    operatorMatch: ["SMATRICS"],
    countries: ["AT"],
    powerType: "DC",
    minPowerKw: 50.01,
    pricePerKwh: 0.94,
    sourceName: "Smatrics / Petrol roaming cenik",
    sourceUrl:
      "https://www.petrol.si/mobilnost/zasebni-uporabniki/javne-elektricne-polnilnice/cenik-polnjenje",
    note: "Smatrics DC nad 50 kW tarifa iz javnega cenika/roaming cenika.",
  },
];

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date().toISOString();

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
    const { data: locations, error: locationsError } = await supabase
      .from("ev_locations")
      .select("id,name,operator,country_code,max_power_kw")
      .not("max_power_kw", "is", null);

    if (locationsError) throw locationsError;

    const locationRows = locations || [];

    const { error: deleteError } = await supabase
      .from("ev_prices")
      .delete()
      .eq("source", SOURCE);

    if (deleteError) throw deleteError;

    const now = new Date().toISOString();

    const payloads = [];

    for (const location of locationRows) {
      const country = normalize(location.country_code);

      for (const rule of TARIFF_RULES) {
        if (!rule.countries.includes(country)) continue;
        if (!matchesOperator(location, rule)) continue;
        if (!matchesPower(location, rule)) continue;

        payloads.push({
          ev_location_id: location.id,
          connector_type: rule.powerType,
          power_type: rule.powerType,
          price_per_kwh: rule.pricePerKwh,
          price_per_minute: rule.pricePerMinute ?? null,
          session_fee: rule.sessionFee ?? 0,
          currency: "EUR",
          confidence: "verified",
          source: SOURCE,
          tariff_scope: "operator",
          operator_name: rule.operatorMatch[0],
          source_url: rule.sourceUrl,
          verified_at: now,
          is_verified: true,
          tariff_note: rule.note,
          captured_at: now,
        });
      }
    }

    for (const part of chunk(payloads, 1000)) {
      const { error } = await supabase.from("ev_prices").insert(part);
      if (error) throw error;
    }

    if (syncRun.data?.id) {
      await supabase
        .from("source_sync_runs")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          records_found: locationRows.length,
          records_updated: payloads.length,
        })
        .eq("id", syncRun.data.id);
    }

    return NextResponse.json({
      success: true,
      source: SOURCE,
      startedAt,
      finishedAt: new Date().toISOString(),
      locationsChecked: locationRows.length,
      verifiedTariffsInserted: payloads.length,
      rules: TARIFF_RULES.length,
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