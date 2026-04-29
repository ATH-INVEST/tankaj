import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COUNTRY_CODES = "si,hr,at,it";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = String(searchParams.get("q") || "").trim();

  if (q.length < 2) {
    return NextResponse.json(
      { success: false, error: "Vnesi vsaj 2 znaka." },
      { status: 400 },
    );
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", COUNTRY_CODES);

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "Tankaj.si/1.0 (https://tankaj.si)",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    return NextResponse.json(
      { success: false, error: "Lokacije trenutno ni mogoče poiskati." },
      { status: 502 },
    );
  }

  const data = await res.json();

  const results = (Array.isArray(data) ? data : []).map((item: any) => ({
    label: item.display_name,
    lat: Number(item.lat),
    lng: Number(item.lon),
    country_code: String(item.address?.country_code || "").toUpperCase(),
  }));

  return NextResponse.json({
    success: true,
    results: results.filter(
      (item: any) => Number.isFinite(item.lat) && Number.isFinite(item.lng),
    ),
  });
}