import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const res = await fetch("https://mzoe-gor.hr/data.json", {
    headers: {
      accept: "application/json",
      "user-agent": "Tankaj.si debug",
    },
    cache: "no-store",
  });

  const text = await res.text();

  let json: any = null;

  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({
      success: false,
      status: res.status,
      contentType: res.headers.get("content-type"),
      preview: text.slice(0, 1000),
    });
  }

  return NextResponse.json({
    success: true,
    status: res.status,
    contentType: res.headers.get("content-type"),
    topLevelType: Array.isArray(json) ? "array" : typeof json,
    topLevelKeys:
      json && typeof json === "object" && !Array.isArray(json)
        ? Object.keys(json).slice(0, 50)
        : null,
    arrayLength: Array.isArray(json) ? json.length : null,
    firstItem: Array.isArray(json) ? json[0] : null,
    sample: json,
  });
}
