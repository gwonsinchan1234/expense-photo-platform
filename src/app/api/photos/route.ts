import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const docId = searchParams.get("docId");
    const itemId = searchParams.get("itemId");

    console.log("[api/photos] query", { docId, itemId });

    if (!docId || !itemId) {
      return NextResponse.json(
        { ok: false, error: "docId/itemId required", docId, itemId },
        { status: 400 }
      );
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    console.log("[api/photos] env", {
      hasUrl: Boolean(url),
      hasServiceKey: Boolean(serviceKey),
    });

    if (!url || !serviceKey) {
      return NextResponse.json(
        { ok: false, error: "Missing env (SUPABASE URL or SERVICE ROLE KEY)" },
        { status: 500 }
      );
    }

    const supabaseAdmin = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });

    // ⚠️ 여기 테이블명/컬럼명은 여러분 DB에 맞춰야 합니다.
    // 우선 “쿼리 자체가 도는지” 확인용으로만 둡니다.
    const { data, error } = await supabaseAdmin
      .from("expense_item_photos")
      .select("*")
      .eq("doc_id", docId)
      .eq("item_id", itemId)
      .order("slot_index", { ascending: true });

    if (error) {
      console.error("[api/photos] supabase error", error);
      return NextResponse.json({ ok: false, error }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    console.error("[api/photos] fatal", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Internal Server Error" },
      { status: 500 }
    );
  }
}
