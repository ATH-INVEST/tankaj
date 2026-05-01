import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COUNTRY_CODES = "si,hr,at,it,hu,de";

function cleanQuery(q: string) {
  return q
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s,.-]/gu, "")
    .trim();
}

async function fetchWithTimeout(url: string, timeoutMs = 1800) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Tankaj.si/1.0 (https://tankaj.si)",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function mapResults(data: any[]) {
  return (Array.isArray(data) ? data : [])
    .map((item: any) => ({
      label: item.display_name,
      lat: Number(item.lat),
      lng: Number(item.lon),
      country_code: String(item.address?.country_code || "").toUpperCase(),
    }))
    .filter(
      (item: any) => Number.isFinite(item.lat) && Number.isFinite(item.lng),
    )
    .slice(0, 8);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  let q = String(searchParams.get("q") || "");

  q = cleanQuery(q);

  if (q.length < 2) {
    return NextResponse.json(
      { success: false, results: [] },
      { status: 200 },
    );
  }

  // 1️⃣ PRIMARY (z country filterjem)
  const urlPrimary = new URL("https://nominatim.openstreetmap.org/search");
  urlPrimary.searchParams.set("q", q);
  urlPrimary.searchParams.set("format", "jsonv2");
  urlPrimary.searchParams.set("limit", "8");
  urlPrimary.searchParams.set("addressdetails", "1");
  urlPrimary.searchParams.set("accept-language", "sl,en");
  urlPrimary.searchParams.set("countrycodes", COUNTRY_CODES);

  let data = await fetchWithTimeout(urlPrimary.toString());

  // 2️⃣ FALLBACK (brez country filterja — pomembno za AT/DE robne primere)
  if (!data || data.length === 0) {
    const urlFallback = new URL(
      "https://nominatim.openstreetmap.org/search",
    );

    urlFallback.searchParams.set("q", q);
    urlFallback.searchParams.set("format", "jsonv2");
    urlFallback.searchParams.set("limit", "8");
    urlFallback.searchParams.set("addressdetails", "1");
    urlFallback.searchParams.set("accept-language", "sl,en");

    data = await fetchWithTimeout(urlFallback.toString());
  }

  let results = mapResults(data || []);

  // 🇸🇮 Slovenija naj ima rahlo prednost (UX hack)
  results = results.sort((a, b) => {
    if (a.country_code === "SI") return -1;
    if (b.country_code === "SI") return 1;
    return 0;
  });

  return NextResponse.json({
    success: true,
    results,
  });
}