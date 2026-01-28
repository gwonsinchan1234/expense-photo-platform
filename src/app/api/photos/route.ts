// src/app/api/photos/route.ts
// [목표] /api/photos?docId=...&itemId=... → 해당 품목(item_id)의 사진 목록 반환
// [DB 스키마 정합] public.expense_item_photos 컬럼에 맞춤:
// - doc_id (uuid)
// - item_id (uuid)
// - kind (text)
// - slot_index (int4)
// - storage_path (text)
// - public_url (text)
// [안전] 원인 확정 가능하도록 모든 에러를 JSON으로 반환
// [보안] Service Role Key는 서버에서만 사용
// [안정] nodejs 런타임 고정

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("ENV_MISSING: NEXT_PUBLIC_SUPABASE_URL");
  if (!service) throw new Error("ENV_MISSING: SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, service, { auth: { persistSession: false } });
}

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();

  try {
    const { searchParams } = new URL(req.url);
    const docId = searchParams.get("docId");
    const itemId = searchParams.get("itemId");

    console.log("[api/photos] query", { docId, itemId });

    if (!docId || !itemId) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: "BAD_REQUEST",
          message: "docId and itemId are required",
          got: { docId, itemId },
        },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin();

    // ✅ DB 정합성: expense_item_photos는 doc_id + item_id로 조회 가능
    const { data, error } = await sb
      .from("expense_item_photos")
      .select(
        "id, doc_id, item_id, kind, slot_index, storage_path, public_url, created_at, updated_at"
      )
      .eq("doc_id", docId)
      .eq("item_id", itemId)
      .order("kind", { ascending: true })
      .order("slot_index", { ascending: true });

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: "DB_ERROR",
          message: error.message,
          details: error,
        },
        { status: 500 }
      );
    }

    // 프론트가 쓰기 편하게 형태 정리(선택)
    const photos = (data ?? []).map((r: any) => ({
      id: r.id,
      docId: r.doc_id,
      itemId: r.item_id,
      kind: r.kind,
      slot: r.slot_index,
      storagePath: r.storage_path,
      publicUrl: r.public_url,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    return NextResponse.json(
      {
        ok: true,
        requestId,
        docId,
        itemId,
        photos,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: "UNHANDLED",
        message: String(e?.message ?? e),
      },
      { status: 500 }
    );
  }
}
