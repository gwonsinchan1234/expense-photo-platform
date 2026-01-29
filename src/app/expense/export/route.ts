export const runtime = "nodejs";

import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import path from "path";
import { Buffer } from "node:buffer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * [목표]
 * 1) 항목별사용내역서_template.xlsx에 값 주입
 * 2) 사진대지 시트를 품목(item) 수만큼 복제하여 NO별 사진 삽입
 *    - 반입: inbound 1~4장 (셀 범위 분할)
 *    - 설치: install 1~4장 (셀 범위 분할)
 *
 * [주의]
 * - Storage 버킷명은 실제 Supabase Storage 버킷명과 반드시 동일해야 함.
 * - PHOTO_SHEET_NAME은 "엑셀 탭 이름"과 100% 동일해야 함.
 * - PHOTO_RANGES는 템플릿의 사진 칸 셀 범위로 반드시 맞춰야 함.
 */

// ✅ 버킷명(사용자 확인 완료)
const BUCKET = "expense-evidence";
const BUCKET_FALLBACK = "expense-photos";

// ✅ 시트명(사용자 확인 완료)
const PHOTO_SHEET_NAME = "2.안전시설물 사진대지";


type PhotoRow = {
  kind: "inbound" | "install";
  slot_index: number;
  storage_path: string;
};

async function fetchImageBufferFromBucket(
  bucket: string,
  storagePath: string
): Promise<{ buf: Buffer; ext: "png" | "jpeg" }> {
  const { data: signed, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(storagePath, 60 * 10);

  if (error) throw error;

  const res = await fetch(signed.signedUrl);
  if (!res.ok) throw new Error(`이미지 다운로드 실패: ${res.status}`);

  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);

  const lower = storagePath.toLowerCase();
  const ext: "png" | "jpeg" =
    lower.endsWith(".png") ? "png" : lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "jpeg" : "jpeg";

  return { buf, ext };
}

async function fetchImageBuffer(storagePath: string): Promise<{ buf: Buffer; ext: "png" | "jpeg" }> {
  try {
    return await fetchImageBufferFromBucket(BUCKET, storagePath);
  } catch {
    return await fetchImageBufferFromBucket(BUCKET_FALLBACK, storagePath);
  }
}

/**
 * ✅ [핵심 타입 안정화]
 * - ExcelJS 타입 정의의 Image.buffer는 Buffer(비제네릭)로 되어있는 경우가 많고,
 *   TS/Node 버전에서는 Buffer가 Buffer<T> 제네릭으로 잡히면서 타입 충돌이 납니다.
 * - 런타임은 문제 없으므로, addImage에 들어가는 buffer 타입만 안정적으로 유지합니다.
 */
function addImageToRange(
  workbook: ExcelJS.Workbook,
  worksheet: ExcelJS.Worksheet,
  imageBuf: Buffer,
  ext: "png" | "jpeg",
  range: string
): void {
  const imageId = workbook.addImage({ buffer: imageBuf, extension: ext });
  worksheet.addImage(imageId, range);
}

function getInboundRanges(count: number): string[] {
  if (count <= 1) return ["B6:E15"];
  if (count === 2) return ["B6:C15", "D6:E15"];
  if (count === 3) return ["B6:E10", "B11:C15", "D11:E15"];
  return ["B6:C10", "D6:E10", "B11:C15", "D11:E15"];
}

function getInstallRanges(count: number): string[] {
  if (count <= 1) return ["F6:I15"];
  if (count === 2) return ["F6:G15", "H6:I15"];
  if (count === 3) return ["F6:I10", "F11:G15", "H11:I15"];
  return ["F6:G10", "H6:I10", "F11:G15", "H11:I15"];
}

async function applyPhotosToRanges(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  ranges: string[],
  photos: PhotoRow[]
): Promise<void> {
  const limited = photos.slice(0, ranges.length);
  for (let i = 0; i < limited.length; i++) {
    const photo = limited[i];
    const range = ranges[i];
    const { buf, ext } = await fetchImageBuffer(photo.storage_path);
    addImageToRange(wb, ws, buf, ext, range);
  }
}


/**
 * ExcelJS는 “시트 완전 복제” API가 없어서,
 * 템플릿 시트의 (열너비/행높이/셀 값/스타일/병합)을 최소 복제하는 유틸
 */
function cloneWorksheetLikeTemplate(
  wb: ExcelJS.Workbook,
  templateWs: ExcelJS.Worksheet,
  newName: string
) {
  const newWs = wb.addWorksheet(newName);

  // 열 너비 복사
  templateWs.columns.forEach((c, i) => {
    newWs.getColumn(i + 1).width = c.width;
  });

  // 행 높이 + 셀 값/스타일 복사
  templateWs.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const targetRow = newWs.getRow(rowNumber);
    targetRow.height = row.height;

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const targetCell = targetRow.getCell(colNumber);
      targetCell.value = cell.value;
      targetCell.style = { ...cell.style };
    });

    targetRow.commit();
  });

  // 병합 복사 (내부 필드 접근)
  const anyTemplate = templateWs as any;
  const merges = anyTemplate?._merges;
  if (merges) {
    for (const mergeRange of Object.keys(merges)) {
      try {
        newWs.mergeCells(mergeRange);
      } catch {
        // 이미 병합 등 예외는 무시
      }
    }
  }

  return newWs;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const docId = searchParams.get("docId");
    if (!docId) {
      return NextResponse.json({ error: "docId required" }, { status: 400 });
    }

    // 1) doc 조회
    const { data: doc, error: docErr } = await supabaseAdmin
      .from("expense_docs")
      .select("*")
      .eq("id", docId)
      .single();

    if (docErr) {
      return NextResponse.json({ error: docErr.message }, { status: 500 });
    }

    // 2) items 조회
    const { data: items, error: itemErr } = await supabaseAdmin
      .from("expense_items")
      .select("*")
      .eq("doc_id", docId)
      .order("evidence_no", { ascending: true });

    if (itemErr) {
      return NextResponse.json({ error: itemErr.message }, { status: 500 });
    }

    // 3) 템플릿 로드
    const wb = new ExcelJS.Workbook();
    const templatePath = path.join(
      process.cwd(),
      "public",
      "templates",
      "항목별사용내역서_template.xlsx"
    );
    await wb.xlsx.readFile(templatePath);

    // 4) 첫 시트(항목별 사용내역서) 데이터 주입
    const ws = wb.worksheets[0];

    const rowStartMap: Record<number, number> = {
      2: 8,
      3: 20,
      9: 60,
    };

    const col = { usedAt: "B", name: "C", qty: "D", unit: "E", amt: "F", no: "G" };

    const byCat: Record<number, any[]> = {};
    for (const it of items ?? []) {
      const c = Number((it as any).category_no ?? 0);
      if (!byCat[c]) byCat[c] = [];
      byCat[c].push(it);
    }

    for (const [catStr, arr] of Object.entries(byCat)) {
      const cat = Number(catStr);
      const startRow = rowStartMap[cat];
      if (!startRow) continue;

      arr.forEach((it, idx) => {
        const r = startRow + idx;
        ws.getCell(`${col.usedAt}${r}`).value = (it as any).used_at ?? "";
        ws.getCell(`${col.name}${r}`).value = (it as any).item_name ?? "";
        ws.getCell(`${col.qty}${r}`).value = (it as any).qty ?? "";
        ws.getCell(`${col.unit}${r}`).value = (it as any).unit_price ?? "";
        ws.getCell(`${col.amt}${r}`).value = (it as any).amount ?? "";
        ws.getCell(`${col.no}${r}`).value = (it as any).evidence_no ?? "";
      });
    }

    // 5) 사진대지: 템플릿 시트 찾기
    const photoTemplateWs = wb.getWorksheet(PHOTO_SHEET_NAME);
    if (!photoTemplateWs) {
      return NextResponse.json(
        { error: `사진대지 시트를 찾을 수 없습니다. 시트명 확인 필요: ${PHOTO_SHEET_NAME}` },
        { status: 500 }
      );
    }

    // 템플릿 시트는 결과물에서 숨김 처리(원본 유지)
    photoTemplateWs.state = "veryHidden";

    // 6) item별로 사진대지 시트 생성 + 사진 삽입
    const itemList = (items ?? []) as any[];

    for (const it of itemList) {
      const evNo = it.evidence_no ?? "";
      const sheetName = `NO.${evNo || "미정"}`;

      // 같은 이름 시트 충돌 방지
      const finalName = wb.getWorksheet(sheetName)
        ? `${sheetName}_${it.id.slice(0, 6)}`
        : sheetName;

      const photoWs = cloneWorksheetLikeTemplate(wb, photoTemplateWs, finalName);

      const { data: photos, error: pErr } = await supabaseAdmin
        .from("expense_item_photos")
        .select("kind, slot_index, storage_path")
        .eq("item_id", it.id)
        .order("kind", { ascending: true })
        .order("slot_index", { ascending: true });

      if (pErr) throw pErr;

      const list = (photos ?? []) as PhotoRow[];
      const inboundPhotos = list.filter((p) => p.kind === "inbound");
      const installPhotos = list.filter((p) => p.kind === "install");

      photoWs.views = [{ showGridLines: false }];
      const printable = photoWs as ExcelJS.Worksheet & {
        pageSetup: ExcelJS.PageSetup & { printGridLines?: boolean };
      };
      printable.pageSetup.printGridLines = false;

      const inboundRanges = getInboundRanges(Math.min(inboundPhotos.length, 4));
      const installRanges = getInstallRanges(Math.min(installPhotos.length, 4));

      await applyPhotosToRanges(wb, photoWs, inboundRanges, inboundPhotos);
      await applyPhotosToRanges(wb, photoWs, installRanges, installPhotos);
    }

    // 7) 반환
    const out = await wb.xlsx.writeBuffer();
    const body = Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
    const mime =
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    return new NextResponse(body, {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `attachment; filename="항목별사용내역서_${(doc as any).month_key}.xlsx"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "server error" },
      { status: 500 }
    );
  }
}
