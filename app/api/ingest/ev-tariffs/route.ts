import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type PetrolCountry = {
  countryCode: "SI" | "HR";
  sourceUrl: string;
};

const PETROL_COUNTRIES: PetrolCountry[] = [
  {
    countryCode: "SI",
    sourceUrl:
      "https://www.petrol.si/mobilnost/zasebni-uporabniki/javne-elektricne-polnilnice/cenik-polnjenje",
  },
  {
    countryCode: "HR",
    sourceUrl:
      "https://www.petrol.hr/mobilnost/privatni-korisnici/javne-elektricne-punionice/charging-price-list",
  },
];

function parseEuro(value: string) {
  return Number(value.replace(",", "."));
}

function extractPetrolPrices(html: string) {
  const normalized = html
    .replace(/&nbsp;/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ");

  const registeredMatch = normalized.match(
    /(Registrirani uporabniki|Registered users|Registrirani korisnici)[^€]{0,600}?(\d+[,.]\d{2})\s*€\s*\/\s*kWh[^€]{0,120}?(\d+[,.]\d{2})\s*€\s*\/\s*kWh[^€]{0,120}?(\d+[,.]\d{2})\s*€\s*\/\s*kWh/i,
  );

  const publicMatch = normalized.match(
    /(Anonimni uporabniki|Anonymous users|Anonimni korisnici)[^€]{0,600}?(\d+[,.]\d{2})\s*€\s*\/\s*kWh[^€]{0,120}?(\d+[,.]\d{2})\s*€\s*\/\s*kWh[^€]{0,120}?(\d+[,.]\d{2})\s*€\s*\/\s*kWh/i,
  );

  if (!registeredMatch || !publicMatch) {
    const foundPrices = Array.from(
      new Set(
        Array.from(normalized.matchAll(/(\d+[,.]\d{2})\s*€\s*\/\s*kWh/gi)).map(
          (match) => parseEuro(match[1]),
        ),
      ),
    );

    throw new Error(
      `Petrol SI/HR cenik ni bil pravilno prebran. Najdene cene: ${foundPrices.join(", ")}`,
    );
  }

  return {
    registered: {
      ac22: parseEuro(registeredMatch[2]),
      dc50: parseEuro(registeredMatch[3]),
      dcFast: parseEuro(registeredMatch[4]),
    },
    public: {
      ac22: parseEuro(publicMatch[2]),
      dc50: parseEuro(publicMatch[3]),
      dcFast: parseEuro(publicMatch[4]),
    },
  };
}

function buildPetrolRows(params: {
  countryCode: "SI" | "HR";
  sourceUrl: string;
  prices: ReturnType<typeof extractPetrolPrices>;
}) {
  const { countryCode, sourceUrl, prices } = params;
  const capturedAt = new Date().toISOString();

  return [
    {
      provider: "PETROL",
      country_code: countryCode,
      tariff_code: "PETROL_PUBLIC_AC_22",
      tariff_name: "Petrol anonimni uporabnik / spletna aplikacija",
      power_type: "AC",
      min_power_kw: 0,
      max_power_kw: 22,
      price_per_kwh: prices.public.ac22,
      is_subscription: false,
      is_verified: true,
      source_url: sourceUrl,
      note: "Petrol javni cenik: priključki do 22 kW.",
      captured_at: capturedAt,
    },
    {
      provider: "PETROL",
      country_code: countryCode,
      tariff_code: "PETROL_PUBLIC_DC_50",
      tariff_name: "Petrol anonimni uporabnik / spletna aplikacija",
      power_type: "DC",
      min_power_kw: 22.01,
      max_power_kw: 50,
      price_per_kwh: prices.public.dc50,
      is_subscription: false,
      is_verified: true,
      source_url: sourceUrl,
      note: "Petrol javni cenik: priključki od 22,01 kW do 50 kW.",
      captured_at: capturedAt,
    },
    {
      provider: "PETROL",
      country_code: countryCode,
      tariff_code: "PETROL_PUBLIC_DC_FAST",
      tariff_name: "Petrol anonimni uporabnik / spletna aplikacija",
      power_type: "DC",
      min_power_kw: 50.01,
      max_power_kw: 999,
      price_per_kwh: prices.public.dcFast,
      is_subscription: false,
      is_verified: true,
      source_url: sourceUrl,
      note: "Petrol javni cenik: priključki nad 50,01 kW.",
      captured_at: capturedAt,
    },
    {
      provider: "PETROL",
      country_code: countryCode,
      tariff_code: "PETROL_REGISTERED_AC_22",
      tariff_name: "Petrol registriran uporabnik",
      power_type: "AC",
      min_power_kw: 0,
      max_power_kw: 22,
      price_per_kwh: prices.registered.ac22,
      is_subscription: true,
      is_verified: true,
      source_url: sourceUrl,
      note: "Petrol registrirani uporabniki in imetniki Petrolovih plačilnih kartic: do 22 kW.",
      captured_at: capturedAt,
    },
    {
      provider: "PETROL",
      country_code: countryCode,
      tariff_code: "PETROL_REGISTERED_DC_50",
      tariff_name: "Petrol registriran uporabnik",
      power_type: "DC",
      min_power_kw: 22.01,
      max_power_kw: 50,
      price_per_kwh: prices.registered.dc50,
      is_subscription: true,
      is_verified: true,
      source_url: sourceUrl,
      note: "Petrol registrirani uporabniki in imetniki Petrolovih plačilnih kartic: 22,01 kW do 50 kW.",
      captured_at: capturedAt,
    },
    {
      provider: "PETROL",
      country_code: countryCode,
      tariff_code: "PETROL_REGISTERED_DC_FAST",
      tariff_name: "Petrol registriran uporabnik",
      power_type: "DC",
      min_power_kw: 50.01,
      max_power_kw: 999,
      price_per_kwh: prices.registered.dcFast,
      is_subscription: true,
      is_verified: true,
      source_url: sourceUrl,
      note: "Petrol registrirani uporabniki in imetniki Petrolovih plačilnih kartic: nad 50,01 kW.",
      captured_at: capturedAt,
    },
  ];
}

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const allRows = [];
    const debug = [];

    for (const country of PETROL_COUNTRIES) {
      const res = await fetch(country.sourceUrl, {
        cache: "no-store",
        headers: {
          "user-agent": "Tankaj.si EV tariff ingest",
          accept: "text/html",
        },
      });

      if (!res.ok) {
        return NextResponse.json(
          {
            success: false,
            error: `Petrol ${country.countryCode} fetch failed: ${res.status}`,
            url: country.sourceUrl,
          },
          { status: 500 },
        );
      }

      const html = await res.text();

      debug.push({
        country: country.countryCode,
        html_length: html.length,
        sample: html.slice(0, 300),
      });

      const prices = extractPetrolPrices(html);

      allRows.push(
        ...buildPetrolRows({
          countryCode: country.countryCode,
          sourceUrl: country.sourceUrl,
          prices,
        }),
      );
    }

    const { error } = await supabase.from("ev_tariffs").upsert(allRows, {
      onConflict:
        "provider,country_code,tariff_code,power_type,min_power_kw,max_power_kw,is_subscription",
    });

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message, details: error },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      inserted_or_updated: allRows.length,
      providers: ["PETROL"],
      countries: PETROL_COUNTRIES.map((item) => item.countryCode),
      debug,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
