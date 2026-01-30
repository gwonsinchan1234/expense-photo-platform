import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const BUCKET = "expense-photos";
const MAX_BYTES = 10 * 1024 * 1024;
const SIGNED_TTL = 60 * 60; // 1시간

type Kind = "inbound" | "install";

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

function parseKind(v: string): Kind | null {
  if (v === "inbound" || v === "install") return v;
  return null;
}

async function makeSignedUrl(storagePath: string) {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_TTL);

  if (error) throw new Error(`SignedUrl 생성 실패: ${error.message}`);
  return data.signedUrl;
}

/**
 * GET /api/photos/upload?docId=...&itemId=...
 * - DB에서 해당 item의 사진 목록 조회
 * - 각 storage_path에 대해 signedUrl 생성해서 반환
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const docId = String(searchParams.get("docId") || "").trim();
    const itemId = String(searchParams.get("itemId") || "").trim();

    if (!docId) return bad("docId 누락");
    if (!itemId) return bad("itemId 누락");

    const { data, error } = await supabaseAdmin
      .from("expense_item_photos")
      .select("id, kind, slot_index, storage_path, updated_at")
      .eq("doc_id", docId)
      .eq("item_id", itemId);

    if (error) return bad(`DB 조회 실패: ${error.message}`, 500);

    const rows = (data ?? []) as Array<{
      id: string;
      kind: Kind;
      slot_index: number;
      storage_path: string;
      updated_at: string;
    }>;

    // signedUrl 생성
    const withUrls = await Promise.all(
      rows.map(async (r) => {
        const signedUrl = await makeSignedUrl(r.storage_path);
        return { ...r, signedUrl };
      })
    );

    return NextResponse.json({ ok: true, rows: withUrls });
  } catch (e: any) {
    return bad(`서버 오류(GET): ${e?.message ?? "unknown"}`, 500);
  }
}

/**
 * POST /api/photos/upload
 * - 업로드 + DB upsert
 * - 업로드 직후 해당 파일 signedUrl 반환(미리보기용)
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();

    const docId = String(form.get("docId") || "").trim();
    const itemId = String(form.get("itemId") || "").trim();
    const kindRaw = String(form.get("kind") || "").trim();
    const slotIndexRaw = String(form.get("slotIndex") || "").trim();
    const file = form.get("file");

    if (!docId) return bad("docId 누락");
    if (!itemId) return bad("itemId 누락");

    const kind = parseKind(kindRaw);
    if (!kind) return bad("kind 값 오류(inbound|install)");

    if (!slotIndexRaw) return bad("slotIndex 누락");
    const slotIndex = Number(slotIndexRaw);
    if (!Number.isInteger(slotIndex)) return bad("slotIndex 정수 아님");

    if (!(file instanceof File)) return bad("file 누락");

    // ✅ 슬롯 규칙(서버 강제) - 반입·지급·설치 모두 0~3
    if (slotIndex < 0 || slotIndex > 3) return bad("slotIndex는 0~3만 허용");

    const arrayBuf = await file.arrayBuffer();
    if (arrayBuf.byteLength > MAX_BYTES) return bad(`파일 용량 초과(최대 ${MAX_BYTES} bytes)`);

    const contentType = file.type || "application/octet-stream";
    const ext =
      contentType.includes("png") ? "png" :
      contentType.includes("jpeg") ? "jpg" :
      contentType.includes("webp") ? "webp" :
      "bin";

    // 같은 슬롯은 같은 경로 -> upsert 덮어쓰기
    const storagePath = `docs/${docId}/items/${itemId}/${kind}/slot-${slotIndex}.${ext}`;

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, arrayBuf, { contentType, upsert: true });

    if (uploadErr) return bad(`Storage 업로드 실패: ${uploadErr.message}`, 500);

    const { error: dbErr } = await supabaseAdmin
      .from("expense_item_photos")
      .upsert(
        {
          doc_id: docId,
          item_id: itemId,
          kind,
          slot_index: slotIndex,
          storage_path: storagePath,
        },
        { onConflict: "item_id,kind,slot_index" }
      );

    if (dbErr) return bad(`DB 저장 실패: ${dbErr.message}`, 500);

    // ✅ 업로드 직후 미리보기는 signedUrl로 반환(버킷 private여도 OK)
    const signedUrl = await makeSignedUrl(storagePath);

    return NextResponse.json({
      ok: true,
      docId,
      itemId,
      kind,
      slotIndex,
      storagePath,
      signedUrl,
    });
  } catch (e: any) {
    return bad(`서버 처리 중 오류(POST): ${e?.message ?? "unknown"}`, 500);
  }
}
