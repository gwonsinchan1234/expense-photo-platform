// src/lib/importExcelExpenseItems.ts
"use client";

import * as XLSX from "xlsx";
import { SupabaseClient } from "@supabase/supabase-js";

/**
 * [목표]
 * - 엑셀 업로드 → expense_items upsert
 * - category_key 구간별로 evidence_no(=NO.x) 자동 부여(1부터 재시작)
 * - onConflict: doc_id,category_key,evidence_no 로 중복 누적 방지
 *
 * [전제]
 * - expense_items 테이블에 최소 컬럼 존재:
 *   - doc_id (uuid)
 *   - category_key (text)
 *   - category_no (int, 선택)
 *   - evidence_no (int)  ← 없으면 먼저 추가 필요
 *   - item_name (text)
 *   - used_at (date or text)
 *   - qty (numeric/int)
 *   - unit_price (numeric, 선택)
 *   - amount (numeric, 선택)
 *
 * [주의]
 * - "안전화" 같은 item_name은 반복이 정상 → unique로 막지 않음
 */

type ImportResult = {
  insertedOrUpdated: number;
  categoryCounters: Record<string, number>;
  warnings: string[];
};

type RowObj = {
  doc_id: string;
  category_key: string;
  category_no: number | null;
  evidence_no: number;

  used_at: string | null; // YYYY-MM-DD or null
  item_name: string;
  qty: number;

  unit_price: number | null;
  amount: number | null;

  // 출처/신뢰도(있으면 세팅)
  category_source?: string;
  category_confidence?: number | null;
};

const norm = (s: any) =>
  String(s ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const toNumber = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;

  const s = String(v).trim().replace(/,/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// 엑셀 날짜(시리얼) / 문자열 날짜를 YYYY-MM-DD로
const toISODate = (v: any): string | null => {
  if (v === null || v === undefined || v === "") return null;

  // XLSX date serial
  if (typeof v === "number") {
    // Excel serial → JS Date
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    const yyyy = String(d.y).padStart(4, "0");
    const mm = String(d.m).padStart(2, "0");
    const dd = String(d.d).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  const s = String(v).trim();
  if (!s) return null;

  // 25.12.22 / 2025-12-22 / 2025.12.22 등 대응
  // 1) yy.mm.dd
  const m1 = s.match(/^(\d{2})\.(\d{1,2})\.(\d{1,2})$/);
  if (m1) {
    const yy = Number(m1[1]);
    const yyyy = yy >= 70 ? 1900 + yy : 2000 + yy; // 70 기준은 보수적(필요시 조정)
    const mm = String(Number(m1[2])).padStart(2, "0");
    const dd = String(Number(m1[3])).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  // 2) yyyy-mm-dd / yyyy.mm.dd
  const m2 = s.match(/^(\d{4})[-.](\d{1,2})[-.](\d{1,2})$/);
  if (m2) {
    const yyyy = m2[1];
    const mm = String(Number(m2[2])).padStart(2, "0");
    const dd = String(Number(m2[3])).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  return null; // 애매하면 null로 두고 추후 개선
};

/**
 * 카테고리(대항목) 감지:
 * - 행 어디든 "2." "3." 같은 형태가 있고, 그 주변 셀에 대항목명이 포함되는 경우가 많음(병합셀 대응)
 */
const detectCategoryFromRow = (row: any[]): { categoryNo: number; rawTitle: string } | null => {
  const joined = row.map((c) => String(c ?? "").trim()).filter(Boolean).join(" ");
  const m = joined.match(/^\s*(\d+)\.\s*(.+)$/);
  if (m) return { categoryNo: Number(m[1]), rawTitle: m[2].trim() };

  // 병합/중간셀에 "2. ..."가 들어오는 경우
  for (const cell of row) {
    const s = String(cell ?? "").trim();
    const mm = s.match(/^(\d+)\.\s*(.+)$/);
    if (mm) return { categoryNo: Number(mm[1]), rawTitle: mm[2].trim() };
  }
  return null;
};

// category_key 매핑(현장 표기 흔한 것만 우선 적용)
// 모르면 "cat_{번호}"로라도 고정(중요: 같은 번호면 항상 같은 key)
const mapCategoryKey = (categoryNo: number, rawTitle: string): string => {
  const t = norm(rawTitle);

  // 예시 매핑(필요하면 계속 추가)
  if (categoryNo === 2) return "safety_facility"; // 안전시설물 등 구입비 등
  if (categoryNo === 3) return "ppe"; // 개인보호구 및 안전장구
  if (categoryNo === 4) return "safety_diagnosis"; // 사업장 안전진단비 등

  // 제목 기반 힌트
  if (t.includes("개인보호구")) return "ppe";
  if (t.includes("안전시설")) return "safety_facility";
  if (t.includes("안전진단")) return "safety_diagnosis";

  // 최후: 번호 기반 고정키
  return `cat_${categoryNo}`;
};

/**
 * 세부 품목 행 추출:
 * 기본 가정(사용자 스샷 기준):
 * - 날짜 / 품명 / 수량 / 단가 / 금액 순으로 존재
 * 다만 병합셀/빈셀 많으니 "유연하게" 파싱
 */
const parseDetailRow = (
  row: any[]
): { used_at: string | null; item_name: string; qty: number; unit_price: number | null; amount: number | null } | null => {
  const cells = row.map((c) => (c === null || c === undefined ? "" : c));

  // 날짜 후보 찾기: 첫 3~4셀 중 하나가 날짜 형태일 가능성이 큼
  let used_at: string | null = null;
  let dateIdx = -1;
  for (let i = 0; i < Math.min(5, cells.length); i++) {
    const d = toISODate(cells[i]);
    if (d) {
      used_at = d;
      dateIdx = i;
      break;
    }
  }

  // 품명 후보: 날짜 다음 셀(또는 그 다음)에서 텍스트가 가장 그럴듯한 것
  let item_name = "";
  const nameCandidatesIdx = [];
  for (let i = Math.max(0, dateIdx + 1); i < Math.min(cells.length, dateIdx + 4); i++) {
    nameCandidatesIdx.push(i);
  }
  for (const i of nameCandidatesIdx) {
    const s = String(cells[i] ?? "").trim();
    if (s && !/^(계|합계)$/i.test(s)) {
      item_name = s;
      break;
    }
  }
  if (!item_name) return null; // 품명이 없으면 세부행으로 보지 않음

  // 수량/단가/금액: 뒤쪽 숫자열에서 추정
  const nums = cells.map((v) => toNumber(v));
  // qty는 보통 작은 정수, unit_price는 중간, amount는 큰 값
  // 단순히 오른쪽에서 숫자 3개를 순서대로 잡는 방식(현장 엑셀에서 대체로 맞음)
  const numIdxs = nums
    .map((n, i) => ({ n, i }))
    .filter((x) => x.n !== null)
    .map((x) => x.i);

  if (numIdxs.length === 0) return null;

  // 보통 마지막 3개가 qty/unit_price/amount(혹은 qty/amount만)
  const last = numIdxs.slice(-3);
  const qty = (last.length >= 3 ? nums[last[0]] : nums[last[0]]) ?? null;
  const unit_price = last.length >= 3 ? nums[last[1]] : null;
  const amount = last.length >= 3 ? nums[last[2]] : nums[last[last.length - 1]];

  // qty 최소 보정
  const qtyNum = qty ?? 0;
  if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
    // qty가 못 잡혔으면 다른 숫자 중 작은 값을 qty로 시도
    const small = numIdxs
      .map((i) => nums[i]!)
      .filter((n) => n > 0 && n < 100000)
      .sort((a, b) => a - b)[0];
    if (!small) return null;
    return { used_at, item_name, qty: small, unit_price, amount: amount ?? null };
  }

  return { used_at, item_name, qty: qtyNum, unit_price, amount: amount ?? null };
};

export async function importExcelExpenseItems(params: {
  supabase: SupabaseClient;
  file: File;
  docId: string;
}): Promise<ImportResult> {
  const { supabase, file, docId } = params;

  const warnings: string[] = [];

  // 1) 엑셀 읽기
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

  // 2) 카테고리별 카운터
  const counters: Record<string, number> = {};

  // 3) 현재 카테고리 상태
  let currentCategoryKey: string | null = null;
  let currentCategoryNo: number | null = null;

  // 4) 결과 rows 구성
  const upsertRows: RowObj[] = [];

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];

    // 빈줄 skip
    if (!row || row.every((c) => String(c ?? "").trim() === "")) continue;

    // (A) 대항목 감지
    const cat = detectCategoryFromRow(row);
    if (cat) {
      currentCategoryNo = cat.categoryNo;
      currentCategoryKey = mapCategoryKey(cat.categoryNo, cat.rawTitle);
      counters[currentCategoryKey] = 0; // 대항목 시작 → NO 카운터 초기화
      continue;
    }

    // (B) 대항목이 없으면 세부행 취급 불가
    if (!currentCategoryKey) continue;

    // (C) 세부 품목행 파싱
    const detail = parseDetailRow(row);
    if (!detail) continue;

    // (D) NO 자동부여(카테고리별)
    counters[currentCategoryKey] = (counters[currentCategoryKey] ?? 0) + 1;
    const evidence_no = counters[currentCategoryKey];

    // (E) DB row 생성
    upsertRows.push({
      doc_id: docId,
      category_key: currentCategoryKey,
      category_no: currentCategoryNo,
      evidence_no,

      used_at: detail.used_at,
      item_name: detail.item_name,
      qty: detail.qty,

      unit_price: detail.unit_price,
      amount: detail.amount,

      category_source: "excel",
      category_confidence: null,
    });
  }

  if (upsertRows.length === 0) {
    warnings.push("엑셀에서 저장할 세부 품목행을 찾지 못했습니다. (대항목/날짜/품명 파싱 실패 가능)");
    return { insertedOrUpdated: 0, categoryCounters: counters, warnings };
  }

  // 5) upsert (중복 누적 방지)
  const { error } = await supabase.from("expense_items").upsert(upsertRows, {
    onConflict: "doc_id,category_key,evidence_no",
  });

  if (error) {
    // 여기서 터지면 대부분: evidence_no 컬럼 없음 / onConflict 인덱스 없음 / 타입 불일치
    throw new Error(`expense_items upsert 실패: ${error.message}`);
  }

  return { insertedOrUpdated: upsertRows.length, categoryCounters: counters, warnings };
}
