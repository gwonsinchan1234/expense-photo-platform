// src/app/api/photos/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * [GET] /api/photos?docId=...&itemId=...
 * - 선택된 품목(itemId)에 연결된 사진 목록 조회용
 *
 * 주의: 여기서는 "조회"만 합니다. 업로드는 /api/photos/upload (POST)로 분리.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, serviceRole);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const docId = searchParams.get("docId");
    const itemId = searchParams.get("itemId");

    if (!docId || !itemId) {
      return NextResponse.json({ error: "docId, itemId가 필요합니다." }, { status: 400 });
    }

    // ✅ 테이블명이 다르면 여기만 바꾸면 됩니다.
    // 예: expense_item_photos / photos / item_photos 등
    const { data, error } = await supabaseAdmin
      .from("expense_item_photos")
      .select("id, slot_key, file_path, public_url, created_at")
      .eq("doc_id", docId)
      .eq("item_id", itemId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ photos: data ?? [] }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown error" }, { status: 500 });
  }
}
