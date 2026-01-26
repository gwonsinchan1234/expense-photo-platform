import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

// 이유: 서버에서만 쓰는 서비스키는 절대 NEXT_PUBLIC로 두지 않음 (보안)
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * 이유: 엑셀 날짜/문자/숫자 혼재를 YYYY-MM-DD로 정규화(가능한 경우만)
 * - "25.12.22" / "25/12/22" / "25-12-22" / "2025.12.22" 등 모두 처리
 * - 파싱 실패 시 null 반환 (DB로 절대 보내지 않게 skip 처리)
 */
function toISODate(value: any): string | null {
  if (value === null || value === undefined) return null;

  // 1) Date 객체
  if (value instanceof Date && !isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // 2) Excel serial number (숫자 날짜)
  if (typeof value === "number" && isFinite(value)) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const dt = new Date(excelEpoch.getTime() + value * 86400000);
    if (!isNaN(dt.getTime())) {
      const y = dt.getUTCFullYear();
      const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
      const d = String(dt.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
  }

  // 3) 문자열
  const raw = String(value).trim();
  if (!raw) return null;

  // 구분자 통일: "." "/" -> "-"
  const cleaned = raw.replace(/[\.\/]/g, "-").replace(/\s+/g, "");
  const parts = cleaned.split("-").filter(Boolean);
  if (parts.length !== 3) return null;

  let [a, b, c] = parts;

  // 숫자만 허용
  if (![a, b, c].every((x) => /^\d+$/.test(x))) return null;

  let y: number, m: number, d: number;

  // yyyy-mm-dd
  if (a.length === 4) {
    y = Number(a);
    m = Number(b);
    d = Number(c);
  }
  // yy-mm-dd  -> 20yy-mm-dd (신찬님 케이스: 25=2025)
  else if (a.length === 2) {
    y = 2000 + Number(a);
    m = Number(b);
    d = Number(c);
  } else {
    return null;
  }

  // 범위 검증
  if (y < 1900 || y > 2100) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > 31) return null;

  // 실제 달력 검증(예: 2/30 방지)
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }

  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 이유: 헤더/셀 비교 시 띄어쓰기/대소문자/특수문자 차이 흡수 */
function norm(v: any): string {
  return String(v ?? "")
    .replace(/\s+/g, "")
    .replace(/[\(\)\[\]\{\}\-_:]/g, "")
    .toLowerCase();
}

/** 이유: 숫자(쉼표 포함), 문자열 숫자, 빈칸 등을 안전하게 number로 */
function toNumber(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && isFinite(v)) return v;

  const s = String(v).trim();
  if (!s) return null;

  const cleaned = s.replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * 이유: 신찬님 엑셀은 상단에 제목/집계가 있고,
 *      "항목/사용일자/사용내역/수량/단가/금액/증빙번호" 행이 실제 헤더임
 */
function findHeaderRowIndex(rows: any[]): number {
  const mustHave = ["항목", "사용일자", "사용내역", "수량", "단가", "금액", "증빙번호"].map(norm);

  for (let i = 0; i < Math.min(rows.length, 80); i++) {
    const row = rows[i] ?? [];
    const cells = (row as any[]).map(norm).filter(Boolean);
    if (cells.length === 0) continue;

    const hit = mustHave.filter((k) => cells.some((c: string) => c.includes(k))).length;

    // 7개 중 4개 이상이면 헤더로 인정(보수적)
    if (hit >= 4) return i;
  }

  return -1;
}

/** 이유: 헤더에서 특정 컬럼의 위치를 유사명칭(aliases)로 찾기 */
function findColIndex(headerRow: any[], aliases: string[]): number {
  const header = headerRow.map(norm);
  const aliasNorm = aliases.map(norm);

  // 1) 완전일치 우선
  for (let i = 0; i < header.length; i++) {
    if (aliasNorm.includes(header[i])) return i;
  }
  // 2) 포함(부분일치) 허용
  for (let i = 0; i < header.length; i++) {
    if (aliasNorm.some((a) => header[i].includes(a))) return i;
  }
  return -1;
}

function isMostlyEmptyRow(row: any[]): boolean {
  const filled = row.map((c) => String(c ?? "").trim()).filter((s) => s.length > 0);
  return filled.length === 0;
}

/** 이유: 집계행(전월이월/누계/합계/총계 등)을 데이터에서 제외 */
function isSummaryRow(row: any[], idxDetails: number, idxAmount: number): boolean {
  const d = idxDetails !== -1 ? String(row[idxDetails] ?? "").trim() : "";
  const a = idxAmount !== -1 ? String(row[idxAmount] ?? "").trim() : "";
  const joined = `${d} ${a}`.replace(/\s+/g, "");

  const keywords = ["전월이월", "누계", "합계", "총계", "계", "소계"];
  return keywords.some((k) => joined.includes(k));
}

/**
 * ====== DB 컬럼명 매핑 ======
 * supabase expense_items 테이블 컬럼명과 1:1로 맞추면 됩니다.
 * (테이블 컬럼명이 다르면 오른쪽 문자열만 수정)
 */
const DB_KEYS = {
  item: "item",                    // 항목
  used_date: "used_date",          // 사용일자 (YYYY-MM-DD)
  details: "details",              // 사용내역
  quantity: "quantity",            // 수량
  unit_price: "unit_price",        // 단가
  amount: "amount",                // 금액
  proof_no: "proof_no",            // 증빙번호
  excel_row_index: "excel_row_index", // 원본 줄 번호(추적용)
} as const;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ ok: false, error: "file이 없습니다." }, { status: 400 });
    }

    // 1) 엑셀 읽기
    const arrayBuffer = await file.arrayBuffer();
    const wb = XLSX.read(arrayBuffer, { type: "array" });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];

    // 2) rows 생성(2차원 배열)
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as any[];

    // 디버그: 상단 확인
    console.log("TOP 10 ROWS:", rows.slice(0, 10));

    // 3) 헤더 행 찾기
    const headerRowIndex = findHeaderRowIndex(rows);
    if (headerRowIndex === -1) {
      return NextResponse.json(
        {
          ok: false,
          error:
            '헤더 행을 찾지 못했습니다. "항목/사용일자/사용내역/수량/단가/금액/증빙번호"가 있는 행이 상단 80행 내에 있어야 합니다.',
          top10: rows.slice(0, 10),
        },
        { status: 400 }
      );
    }

    const headerRow = rows[headerRowIndex] ?? [];
    const dataRows = rows.slice(headerRowIndex + 1);

    // 4) 컬럼 매핑(신찬님 형식 고정)
    const idxItem = findColIndex(headerRow, ["항목"]);
    const idxUsedDate = findColIndex(headerRow, ["사용일자", "일자", "날짜"]);
    const idxDetails = findColIndex(headerRow, ["사용내역", "내역"]);
    const idxQty = findColIndex(headerRow, ["수량", "qty", "개수"]);
    const idxUnitPrice = findColIndex(headerRow, ["단가"]);
    const idxAmount = findColIndex(headerRow, ["금액", "합계", "사용금액"]);
    const idxProofNo = findColIndex(headerRow, ["증빙번호", "증빙", "no", "번호"]);

    // 필수 컬럼 검증(전부 필수로 보는 게 안전)
    const missing: string[] = [];
    if (idxItem === -1) missing.push("항목");
    if (idxUsedDate === -1) missing.push("사용일자");
    if (idxDetails === -1) missing.push("사용내역");
    if (idxQty === -1) missing.push("수량");
    if (idxUnitPrice === -1) missing.push("단가");
    if (idxAmount === -1) missing.push("금액");
    if (idxProofNo === -1) missing.push("증빙번호");

    if (missing.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `필수 컬럼이 없습니다: ${missing.join(", ")}`,
          headerRowIndex,
          headerRow,
        },
        { status: 400 }
      );
    }

    // 5) 데이터 추출(items 생성) + 날짜 파싱 실패는 무조건 skip(핵심)
    const items: any[] = [];
    const skipped: Array<{ rowIndex: number; reason: string }> = [];

    let emptyStreak = 0;

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i] ?? [];
      const absoluteRowIndex = headerRowIndex + 1 + i; // 엑셀 줄 추적용(대략)

      // 완전 빈행 처리(연속이면 종료)
      if (isMostlyEmptyRow(row)) {
        emptyStreak += 1;
        if (emptyStreak >= 10) break;
        continue;
      }
      emptyStreak = 0;

      // 집계행 제외
      if (isSummaryRow(row, idxDetails, idxAmount)) {
        skipped.push({ rowIndex: absoluteRowIndex, reason: "집계/총계 행 제외" });
        continue;
      }

      const item = String(row[idxItem] ?? "").trim();
      const rawDate = row[idxUsedDate];
      const used_date = toISODate(rawDate); // ⭐ 핵심: ISO만 허용
      const details = String(row[idxDetails] ?? "").trim();
      const quantity = toNumber(row[idxQty]);
      const unit_price = toNumber(row[idxUnitPrice]);
      const amount = toNumber(row[idxAmount]);
      const proof_no = String(row[idxProofNo] ?? "").trim();

      // 디버그(문제 해결 후 제거 가능)
      // console.log("DATE CHECK:", rawDate, "=>", used_date);

      // ⭐ 날짜 파싱 실패는 무조건 저장 금지(재발 방지 핵심)
      if (!used_date) {
        skipped.push({
          rowIndex: absoluteRowIndex,
          reason: `사용일자 파싱 실패: 원본="${String(rawDate)}"`,
        });
        continue;
      }

      // 기타 필수값 검증(보수적)
      if (!item || !details || quantity === null || unit_price === null || amount === null || !proof_no) {
        skipped.push({
          rowIndex: absoluteRowIndex,
          reason: `필수값 누락/형식 오류 (항목="${item}", 사용일자="${String(rawDate)}", 사용내역="${details}", 수량="${String(row[idxQty])}", 단가="${String(row[idxUnitPrice])}", 금액="${String(row[idxAmount])}", 증빙번호="${proof_no}")`,
        });
        continue;
      }

      items.push({
        [DB_KEYS.item]: item,
        [DB_KEYS.used_date]: used_date, // ⭐ ISO만 들어감
        [DB_KEYS.details]: details,
        [DB_KEYS.quantity]: quantity,
        [DB_KEYS.unit_price]: unit_price,
        [DB_KEYS.amount]: amount,
        [DB_KEYS.proof_no]: proof_no,
        [DB_KEYS.excel_row_index]: absoluteRowIndex,
      });
    }

    if (items.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "저장할 데이터가 0건입니다. (사용일자 파싱/필수값 확인 필요)",
          headerRowIndex,
          headerRow,
          skipped,
        },
        { status: 400 }
      );
    }

    // 6) Supabase 저장
    const { error } = await supabase.from("expense_items").insert(items);
    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          hint:
            "expense_items 테이블 컬럼명과 DB_KEYS(item, used_date, details, quantity, unit_price, amount, proof_no, excel_row_index)가 일치하는지 확인하세요.",
          headerRowIndex,
          headerRow,
          savedAttempt: items.length,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      sheetName,
      headerRowIndex,
      saved: items.length,
      skippedCount: skipped.length,
      skipped: skipped.slice(0, 50),
      msg: `완료: ${items.length}건 저장 (스킵 ${skipped.length}건)`,
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown error" }, { status: 500 });
  }
}
