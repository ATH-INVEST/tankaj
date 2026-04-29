import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, createAdminToken } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({ password: "" }));

  if (!process.env.ADMIN_PASSWORD) {
    return NextResponse.json(
      { success: false, error: "Missing ADMIN_PASSWORD" },
      { status: 500 },
    );
  }

  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json(
      { success: false, error: "Wrong password" },
      { status: 401 },
    );
  }

  const res = NextResponse.json({ success: true });

  res.cookies.set(COOKIE_NAME, createAdminToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return res;
}
