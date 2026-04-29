import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(req: NextRequest) {
  if (process.env.NODE_ENV !== "production") return true;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  const authHeader = req.headers.get("authorization");
  const keyParam = req.nextUrl.searchParams.get("key");

  if (keyParam === cronSecret) return true;
  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const cronSecret = process.env.CRON_SECRET;
  const origin = req.nextUrl.origin;

  const res = await fetch(`${origin}/api/ingest/all`, {
    headers: {
      authorization: `Bearer ${cronSecret}`,
    },
    cache: "no-store",
  });

  const json = await res.json().catch(() => null);

  return NextResponse.json(
    {
      success: res.ok && Boolean(json?.success),
      triggered: "/api/ingest/all",
      response: json,
    },
    { status: res.status },
  );
}

export async function POST(req: NextRequest) {
  return GET(req);
}
