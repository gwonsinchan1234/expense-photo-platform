// app/api/photos/upload/route.ts
// [이유] 사진 업로드를 서버(API)에서 통제(슬롯/개수 제한, 교체, Storage+DB 동기화)하기 위함

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs"; // [이유] 파일 처리 안정성

type PhotoKind = "inbound" | "issue_install";

export async function POST(req: Request) {
  try {
    const form = await req.formData();

    // 프론트에서 보내는 키 이름을 그대로 사용
    const expenseItemId = String(form.get("expenseItemId") || "");
    const kindRaw = String(form.get("kind") || ""); // inbound | issue_install
    const slotRaw = String(form.get("slot") ?? "");
    const file = form.get("file") as File | null;

    // 1) 필수값 검사
    if (!expenseItemId || !kindRaw || !slotRaw || !file) {
      return NextResponse.json({ ok: false, error: "필수값 누락" }, { status: 400 });
    }

    const kind = kindRaw as PhotoKind;
    const slot = Number(slotRaw);

    // 2) 입력값 유효성(서버 강제)
    if (!["inbound", "issue_install"].includes(kind)) {
      return NextResponse.json({ ok: false, error: "kind 오류" }, { status: 400 });
    }

    if (!Number.isFinite(slot) || slot < 0 || slot > 3) {
      return NextResponse.json({ ok: false, error: "slot 범위 오류(0~3)" }, { status: 400 });
    }

    if (kind === "inbound" && slot !== 0) {
      return NextResponse.json({ ok: false, error: "반입은 slot=0만 허용" }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ ok: false, error: "이미지 파일만 허용" }, { status: 400 });
    }

    // 3) 기존 슬롯 사진 존재 여부(교체 목적)
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("expense_item_photos")
      .select("id, storage_path")
      .eq("expense_item_id", expenseItemId)
      .eq("kind", kind)
      .eq("slot", slot)
      .maybeSingle();

    if (exErr) throw exErr;

    // 4) issue_install은 최대 4장: "신규 추가"만 차단(교체는 허용)
    if (kind === "issue_install" && !existing?.id) {
      const { count, error: countErr } = await supabaseAdmin
        .from("expense_item_photos")
        .select("*", { count: "exact", head: true })
        .eq("expense_item_id", expenseItemId)
        .eq("kind", "issue_install");

      if (countErr) throw countErr;

      if ((count ?? 0) >= 4) {
        return NextResponse.json({ ok: false, error: "지급·설치 사진은 최대 4장" }, { status: 400 });
      }
    }

    // 5) Storage 경로(슬롯 고정: 같은 슬롯은 항상 같은 파일로 교체)
    const safeName = file.name.replaceAll(" ", "_");
    const ext = safeName.includes(".") ? (safeName.split(".").pop() || "jpg") : "jpg";
    const safeExt = ext.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "jpg";
    const path = `expense_items/${expenseItemId}/${kind}/${slot}.${safeExt}`;

    // 6) Storage 업로드(upsert=true로 같은 슬롯 교체)
    const buf = Buffer.from(await file.arrayBuffer());

    const { error: upErr } = await supabaseAdmin.storage
      .from("expense-evidence") // ✅ 버킷명 통일(치명 오류 방지)
      .upload(path, buf, {
        upsert: true, // [이유] 같은 슬롯은 교체(덮어쓰기)
        contentType: file.type,
      });

    if (upErr) throw upErr;

    // 7) DB 메타 저장(기존 있으면 update, 없으면 insert)
    const payload = {
      expense_item_id: expenseItemId,
      kind,
      slot,
      storage_path: path,
      original_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
    };

    let dbRes;
    if (existing?.id) {
      dbRes = await supabaseAdmin
        .from("expense_item_photos")
        .update(payload)
        .eq("id", existing.id)
        .select("*")
        .single();
    } else {
      dbRes = await supabaseAdmin
        .from("expense_item_photos")
        .insert(payload)
        .select("*")
        .single();
    }

    if (dbRes.error) throw dbRes.error;

    return NextResponse.json({ ok: true, photo: dbRes.data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "서버 오류" }, { status: 500 });
  }
}
