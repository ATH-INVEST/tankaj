import { NextRequest, NextResponse } from "next/server";

import { GET as ingestSlovenia } from "@/app/api/ingest/slovenia/route";
import { GET as ingestCroatia } from "@/app/api/ingest/croatia/route";
import { GET as ingestItaly } from "@/app/api/ingest/italy/route";
import { GET as ingestAustria } from "@/app/api/ingest/austria/route";
import { GET as ingestAustriaPrices } from "@/app/api/ingest/austria-prices/route";
import { GET as ingestEv } from "@/app/api/ingest/ev/route";
import { GET as ingestEvPrices } from "@/app/api/ingest/ev-prices/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

type IngestHandler = (req: NextRequest) => Promise<Response> | Response;

type IngestStep = {
  label: string;
  path: string;
  handler: IngestHandler;
};

type IngestResult = {
  label: string;
  path: string;
  ok: boolean;
  status: number;
  durationMs: number;
  response?: unknown;
  error?: string;
};

function isAuthorized(req: NextRequest) {
  if (process.env.NODE_ENV !== "production") return true;

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const userAgent = req.headers.get("user-agent") || "";
  const keyParam = req.nextUrl.searchParams.get("key");

  if (userAgent.toLowerCase().includes("vercel-cron")) return true;
  if (keyParam && cronSecret && keyParam === cronSecret) return true;
  if (!cronSecret) return false;

  return authHeader === `Bearer ${cronSecret}`;
}

function getInternalAuthHeader(req: NextRequest) {
  const existingAuth = req.headers.get("authorization");
  if (existingAuth) return existingAuth;

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) return `Bearer ${cronSecret}`;

  return undefined;
}

function makeInternalRequest(req: NextRequest, path: string) {
  const url = new URL(path, req.nextUrl.origin);
  const headers = new Headers();

  const authorization = getInternalAuthHeader(req);
  const userAgent = req.headers.get("user-agent");

  if (authorization) headers.set("authorization", authorization);
  if (userAgent) headers.set("user-agent", userAgent);

  headers.set("x-tankaj-internal-ingest", "1");

  return new NextRequest(url, {
    method: "GET",
    headers,
  });
}

async function readResponseBody(response: Response) {
  const text = await response.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function runStep(
  req: NextRequest,
  step: IngestStep,
): Promise<IngestResult> {
  const started = Date.now();

  try {
    console.log(`[INGEST ALL] START ${step.label} ${step.path}`);

    const internalReq = makeInternalRequest(req, step.path);
    const response = await step.handler(internalReq);
    const body = await readResponseBody(response);

    const result: IngestResult = {
      label: step.label,
      path: step.path,
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - started,
      response: body,
    };

    console.log(`[INGEST ALL] END ${step.label}`, result);

    return result;
  } catch (err) {
    const result: IngestResult = {
      label: step.label,
      path: step.path,
      ok: false,
      status: 500,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };

    console.error(`[INGEST ALL] ERROR ${step.label}`, result);

    return result;
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const startedAt = new Date().toISOString();

  console.log("[INGEST ALL] STARTED", startedAt);

  const steps: IngestStep[] = [
    {
      label: "slovenia",
      path: "/api/ingest/slovenia",
      handler: ingestSlovenia,
    },
    {
      label: "croatia",
      path: "/api/ingest/croatia",
      handler: ingestCroatia,
    },
    {
      label: "italy",
      path: "/api/ingest/italy",
      handler: ingestItaly,
    },
    {
      label: "austria-locations",
      path: "/api/ingest/austria",
      handler: ingestAustria,
    },
    {
      label: "austria-prices-sup-180",
      path: "/api/ingest/austria-prices?fuel=SUP&limit=180&offset=180",
      handler: ingestAustriaPrices,
    },
    {
      label: "austria-prices-die-180",
      path: "/api/ingest/austria-prices?fuel=DIE&limit=180&offset=180",
      handler: ingestAustriaPrices,
    },
    {
      label: "austria-prices-sup-360",
      path: "/api/ingest/austria-prices?fuel=SUP&limit=180&offset=360",
      handler: ingestAustriaPrices,
    },
    {
      label: "austria-prices-die-360",
      path: "/api/ingest/austria-prices?fuel=DIE&limit=180&offset=360",
      handler: ingestAustriaPrices,
    },
    {
      label: "ev-locations",
      path: "/api/ingest/ev",
      handler: ingestEv,
    },
    {
      label: "ev-prices",
      path: "/api/ingest/ev-prices",
      handler: ingestEvPrices,
    },
  ];

  const results = await Promise.all(steps.map((step) => runStep(req, step)));
  const finishedAt = new Date().toISOString();
  const success = results.every((item) => item.ok);

  console.log("[INGEST ALL] FINISHED", {
    success,
    startedAt,
    finishedAt,
    totalDurationMs: Date.now() - new Date(startedAt).getTime(),
    results,
  });

  if (!success) {
    console.error("[INGEST ALL] FAILED", results);
  }

  return NextResponse.json({
    success,
    startedAt,
    finishedAt,
    results,
  });
}
