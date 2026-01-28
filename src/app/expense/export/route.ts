import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import path from "path";
import { Buffer } from "node:buffer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * [목표]
 * 1) 항목별사용내역서_template.xlsx에 값 주입
 * 2) 사진대지 시트를 품목(item) 수만큼 복제하여 NO별 사진 삽입
 *    - 반입: inbound slot=0 (1장)
 *    - 설치: issue_install slot=0~3 (최대 4장)
 *
 * [주의]
 * - Storage 버킷명은 실제 Supabase Storage 버킷명과 반드시 동일해야 함.
 * - PHOTO_SHEET_NAME은 "엑셀 탭 이름"과 100% 동일해야 함.
 * - PHOTO_RANGES는 템플릿의 사진 칸 셀 범위로 반드시 맞춰야 함.
 */

// ✅ 버킷명(사용자 확인 완료)
const BUCKET = "expense-evidence";

// ✅ 시트명(사용자 확인 완료)
const PHOTO_SHEET_NAME = "2.안전시설물 사진대지";

// ✅ 템플릿의 사진 칸 범위(예시). 필요 시 템플릿 셀 주소로 조정
const PHOTO_RANGES = {
  inbound: "B6:F20",
  install0: "H6:K12",
  install1: "L6:O12",
  install2: "H13:K19",
  install3: "L13:O19",
} as const;

type PhotoRow = {
  kind: "inbound" | "issue_install";
  slot: number;
  storage_path: string;
};

async function fetchImageBuffer(storagePath: string) {
  const { data: signed, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 60 * 10);

  if (error) throw error;

  const res = await fetch(signed.signedUrl);
  if (!res.ok) throw new Error(`이미지 다운로드 실패: ${res.status}`);

  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);

  const lower = storagePath.toLowerCase();
  const ext =
    lower.endsWith(".png")
      ? "png"
      : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
      ? "jpeg"
      : "jpeg";

  return { buf, ext: ext as "png" | "jpeg" };
}

function addImageToRange(
  workbook: ExcelJS.Workbook,
  worksheet: ExcelJS.Worksheet,
  imageBuf: Buffer,
  ext: "png" | "jpeg",
  range: string
) {
  const imageId = workbook.addImage({ buffer: imageBuf, extension: ext });
  worksheet.addImage(imageId, range);
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

      // style 객체는 얕은 복사
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
    if (!docId) return NextResponse.json({ error: "docId required" }, { status: 400 });

    // 1) doc 조회
    const { data: doc, error: docErr } = await supabaseAdmin
      .from("expense_docs")
      .select("*")
      .eq("id", docId)
      .single();

    if (docErr) return NextResponse.json({ error: docErr.message }, { status: 500 });

    // 2) items 조회
    const { data: items, error: itemErr } = await supabaseAdmin
      .from("expense_items")
      .select("*")
      .eq("doc_id", docId)
      .order("evidence_no", { ascending: true });

    if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 });

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
      const finalName = wb.getWorksheet(sheetName) ? `${sheetName}_${it.id.slice(0, 6)}` : sheetName;

      const photoWs = cloneWorksheetLikeTemplate(wb, photoTemplateWs, finalName);

      const { data: photos, error: pErr } = await supabaseAdmin
        .from("expense_item_photos")
        .select("kind, slot, storage_path")
        .eq("expense_item_id", it.id);

      if (pErr) throw pErr;

      const list = (photos ?? []) as PhotoRow[];

      const inbound = list.find((p) => p.kind === "inbound" && p.slot === 0) ?? null;
      const install0 = list.find((p) => p.kind === "issue_install" && p.slot === 0) ?? null;
      const install1 = list.find((p) => p.kind === "issue_install" && p.slot === 1) ?? null;
      const install2 = list.find((p) => p.kind === "issue_install" && p.slot === 2) ?? null;
      const install3 = list.find((p) => p.kind === "issue_install" && p.slot === 3) ?? null;

      if (inbound) {
        const { buf, ext } = await fetchImageBuffer(inbound.storage_path);
        addImageToRange(wb, photoWs, buf, ext, PHOTO_RANGES.inbound);
      }
      if (install0) {
        const { buf, ext } = await fetchImageBuffer(install0.storage_path);
        addImageToRange(wb, photoWs, buf, ext, PHOTO_RANGES.install0);
      }
      if (install1) {
        const { buf, ext } = await fetchImageBuffer(install1.storage_path);
        addImageToRange(wb, photoWs, buf, ext, PHOTO_RANGES.install1);
      }
      if (install2) {
        const { buf, ext } = await fetchImageBuffer(install2.storage_path);
        addImageToRange(wb, photoWs, buf, ext, PHOTO_RANGES.install2);
      }
      if (install3) {
        const { buf, ext } = await fetchImageBuffer(install3.storage_path);
        addImageToRange(wb, photoWs, buf, ext, PHOTO_RANGES.install3);
      }
    }

    // 7) 반환
    // ✅ 핵심: NextResponse Body에는 ArrayBuffer/SharedArrayBuffer가 섞이면 타입이 깨질 수 있으므로
    //        "무조건 Uint8Array"로 만들어서 전달합니다.
    const out = (await wb.xlsx.writeBuffer()) as unknown as Uint8Array | ArrayBuffer;
    const bytes = out instanceof Uint8Array ? out : new Uint8Array(out);

    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="항목별사용내역서_${(doc as any).month_key}.xlsx"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "server error" }, { status: 500 });
  }
}
