import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(req: NextRequest) {
  if (process.env.NODE_ENV !== "production") return true;

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const userAgent = req.headers.get("user-agent") || "";

  if (userAgent.toLowerCase().includes("vercel-cron")) return true;
  if (!cronSecret) return false;

  return authHeader === `Bearer ${cronSecret}`;
}

function getInternalAuthHeader(req: NextRequest) {
  const authHeader = req.headers.get("authorization");

  if (authHeader) return authHeader;

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) return `Bearer ${cronSecret}`;

  return undefined;
}

async function callIngest(origin: string, path: string, req: NextRequest) {
  const authorization = getInternalAuthHeader(req);

  try {
    const res = await fetch(`${origin}${path}`, {
      headers: authorization ? { authorization } : undefined,
      cache: "no-store",
    });

    const response = await res.json().catch(() => null);

    return {
      path,
      ok: res.ok,
      status: res.status,
      response,
    };
  } catch (err) {
    return {
      path,
      ok: false,
      status: 500,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const origin = new URL(req.url).origin;
  const startedAt = new Date().toISOString();

  const results = await Promise.all([
    callIngest(origin, "/api/ingest/slovenia", req),
    callIngest(origin, "/api/ingest/croatia", req),
    callIngest(origin, "/api/ingest/italy", req),
    callIngest(origin, "/api/ingest/ev", req),
    callIngest(origin, "/api/ingest/ev-prices", req),
  ]);

  return NextResponse.json({
    success: results.every((item) => item.ok),
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
  });
}
