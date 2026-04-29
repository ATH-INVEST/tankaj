import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function triggerIngest(req: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json(
      { success: false, error: "Missing CRON_SECRET" },
      { status: 500 },
    );
  }

  const origin =
    process.env.NODE_ENV === "production"
      ? "https://www.tankaj.si"
      : req.nextUrl.origin;

  const res = await fetch(`${origin}/api/ingest/all`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${cronSecret}`,
    },
    cache: "no-store",
  });

  const json = await res.json().catch(() => null);

  return NextResponse.json(
    {
      success: res.ok && Boolean(json?.success),
      triggered: `${origin}/api/ingest/all`,
      response: json,
    },
    { status: 200 },
  );
}

export async function POST(req: NextRequest) {
  return triggerIngest(req);
}

export async function GET(req: NextRequest) {
  return triggerIngest(req);
}
