import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 🔑 dodamo HU in ohranimo fokus na regijo
const COUNTRY_CODES = "si,hr,at,it,hu,de";

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

  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "8"); // 🔥 več rezultatov
  url.searchParams.set("addressdetails", "1");

  // 🔑 KLJUČNO
  url.searchParams.set("accept-language", "sl,en");
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

  let results = (Array.isArray(data) ? data : [])
    .map((item: any) => ({
      label: item.display_name,
      lat: Number(item.lat),
      lng: Number(item.lon),
      country_code: String(item.address?.country_code || "").toUpperCase(),
    }))
    .filter(
      (item: any) => Number.isFinite(item.lat) && Number.isFinite(item.lng),
    );

  // 🔥 BONUS: da Slovenija vedno pride prva
  results = results.sort((a: any, b: any) => {
    if (a.country_code === "SI") return -1;
    if (b.country_code === "SI") return 1;
    return 0;
  });

  return NextResponse.json({
    success: true,
    results,
  });
}