import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { isAdminRequest } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdminRequest())) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const { data, error } = await supabase
    .from("source_sync_runs")
    .select(
      "id,source,status,started_at,finished_at,records_found,records_updated,error_message",
    )
    .order("started_at", { ascending: false })
    .limit(30);

  if (error) {
    return NextResponse.json({ success: false, error }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    runs: data || [],
  });
}
