// app/api/photos/list/route.ts
// [이유] 특정 expenseItemId에 매칭된 사진 목록을 가져와 슬롯 UI에 뿌리기 위함(버킷이 비공개면 signed URL 필요)

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const expenseItemId = String(searchParams.get("expenseItemId") || "");

    if (!expenseItemId) {
      return NextResponse.json({ ok: false, error: "expenseItemId 누락" }, { status: 400 });
    }

    // 1) DB 메타 조회
    const { data, error } = await supabaseAdmin
      .from("expense_item_photos")
      .select("id, expense_item_id, kind, slot, storage_path, original_name, mime_type, size_bytes, created_at")
      .eq("expense_item_id", expenseItemId)
      .order("kind", { ascending: true })
      .order("slot", { ascending: true });

    if (error) throw error;

    // 2) 버킷이 Private이면 화면 표시용 signed URL 발급
    const photos = await Promise.all(
      (data ?? []).map(async (row) => {
        const { data: signed, error: sErr } = await supabaseAdmin.storage
          .from("expense-evidence")
          .createSignedUrl(row.storage_path, 60 * 10); // 10분

        if (sErr) throw sErr;

        return { ...row, url: signed.signedUrl };
      })
    );

    return NextResponse.json({ ok: true, photos });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "서버 오류" }, { status: 500 });
  }
}
