"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabaseClient";
import PhotoSection from "@/components/PhotoSection";
import Link from "next/link";

/**
 * [핵심 수정 요약]
 * - 엑셀 업로드: 파일 선택 → 미리보기 테이블 → 확인 후 DB 저장
 * - 409/23505: NO 빈값일 때 evidence_no omit
 */

const DOC_TABLE = "expense_docs";
const ITEM_TABLE = "expense_items";

type ExpenseDoc = {
  id: string;
  site_name: string;
  month_key: string;
};

type ExpenseItem = {
  id: string;
  doc_id: string;
  evidence_no: number;
  item_name: string;
  qty: number;
  unit_price: number | null;
  amount: number | null;
  used_at: string | null;
  work_type?: string | null;
  sheet_template?: string | null;
};

/** 시트 양식 목록 (엑셀 시트명과 매칭) */
const SHEET_TEMPLATES = [
  { id: "개인보호구사진대지", label: "개인보호구사진대지" },
  { id: "안전시설비사진대지", label: "안전시설비사진대지" },
  { id: "기타", label: "기타" },
];

const thStyle = { padding: "10px 12px", textAlign: "left" as const, border: "1px solid #ccc" };
const tdStyle = { padding: "8px 12px", border: "1px solid #ddd" };
const HIGHLIGHT_BG = "#fff59d";

/** 검색어와 매칭되는 부분을 배경색으로 강조 */
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const s = String(text);
  const q = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${q})`, "gi");
  const parts = s.split(re);
  const qLower = query.trim().toLowerCase();
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === qLower ? (
          <mark key={i} style={{ background: HIGHLIGHT_BG, padding: "0 1px", borderRadius: 2 }}>
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}

/** 엑셀 파싱 결과 (미리보기용) - 항목|사용일자|사용내역|수량 */
type ExcelPreviewRow = {
  category: string; // 항목 (대분류: 1. 안전관리자..., 2. 안전시설비..., 계 등)
  used_at: string | null;
  item_name: string; // 사용내역
  qty: number;
  /** DB 저장 대상 여부 (사용내역 있는 행만) */
  isDetail: boolean;
  evidence_no?: number | null;
  unit_price?: number | null;
  amount?: number | null;
};

export default function HomePage() {
  const [doc, setDoc] = useState<ExpenseDoc | null>(null);
  const [items, setItems] = useState<ExpenseItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  /** 엑셀 미리보기: 파싱된 행들 (저장 전 확인용) */
  const [excelPreview, setExcelPreview] = useState<ExcelPreviewRow[] | null>(null);
  /** 미리보기 검색어 */
  const [excelPreviewSearch, setExcelPreviewSearch] = useState("");
  /** 품목 목록 테이블 미리보기 표시 여부 */
  const [showTablePreview, setShowTablePreview] = useState(false);
  /** 시트 배정용 다중 선택된 품목 ID */
  const [selectedItemIdsForSheet, setSelectedItemIdsForSheet] = useState<Set<string>>(new Set());
  /** 시트 배정 선택값 */
  const [selectedSheetTemplate, setSelectedSheetTemplate] = useState("");

  // 문서 기본값(원하시면 UI로 입력받게 바꾸면 됩니다)
  const defaultSiteName = "현장명";
  const defaultMonthKey = "2026-01";

  const loadItems = async (docId: string): Promise<ExpenseItem[]> => {
    const { data, error } = await supabase
      .from(ITEM_TABLE)
      .select("id, doc_id, evidence_no, item_name, qty, unit_price, amount, used_at, work_type, sheet_template")
      .eq("doc_id", docId)
      .order("evidence_no", { ascending: true });

    if (error) {
      alert(`품목 조회 실패: ${error.message}`);
      return [];
    }
    const list = (data ?? []) as ExpenseItem[];
    setItems(list);
    return list;
  };

  const createOrLoadDoc = async () => {
    setLoading(true);
    try {
      // 1) 기존 doc 하나 찾기(없으면 생성)
      const { data: found, error: findErr } = await supabase
        .from(DOC_TABLE)
        .select("id, site_name, month_key")
        .eq("site_name", defaultSiteName)
        .eq("month_key", defaultMonthKey)
        .limit(1);

      if (findErr) throw findErr;

      if (found && found.length > 0) {
        const d = found[0] as ExpenseDoc;
        setDoc(d);
        await loadItems(d.id);
        return;
      }

      const { data: created, error: createErr } = await supabase
        .from(DOC_TABLE)
        .insert([{ site_name: defaultSiteName, month_key: defaultMonthKey }])
        .select("id, site_name, month_key")
        .single();

      if (createErr) throw createErr;
      setDoc(created as ExpenseDoc);
      await loadItems((created as ExpenseDoc).id);
    } catch (e: any) {
      alert(`문서 생성/조회 실패: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    createOrLoadDoc();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setSelectedItemId(null);
  }, [doc?.id]);

  /** 선택된 품목들에 시트 양식 배정 */
  const assignSheetToItems = async () => {
    if (selectedItemIdsForSheet.size === 0) {
      setUploadMessage({ type: "error", text: "배정할 품목을 선택하세요." });
      return;
    }
    if (!selectedSheetTemplate) {
      setUploadMessage({ type: "error", text: "시트 양식을 선택하세요." });
      return;
    }
    setLoading(true);
    try {
      const ids = Array.from(selectedItemIdsForSheet);
      const { error } = await supabase
        .from(ITEM_TABLE)
        .update({ sheet_template: selectedSheetTemplate })
        .in("id", ids);
      if (error) throw error;
      await loadItems(doc!.id);
      setSelectedItemIdsForSheet(new Set());
      setSelectedSheetTemplate("");
      setUploadMessage({ type: "success", text: `${ids.length}건 시트 배정 완료: ${selectedSheetTemplate}` });
    } catch (e: any) {
      setUploadMessage({ type: "error", text: `배정 실패: ${e?.message ?? e}` });
    } finally {
      setLoading(false);
    }
  };

  const toggleItemForSheet = (id: string) => {
    setSelectedItemIdsForSheet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** 현재 문서의 품목 전체 삭제 (테스트용) */
  const deleteAllItems = async () => {
    if (!doc?.id) return;
    if (!confirm("현재 문서의 품목을 모두 삭제할까요?")) return;
    setLoading(true);
    try {
      const { error } = await supabase.from(ITEM_TABLE).delete().eq("doc_id", doc.id);
      if (error) throw error;
      await loadItems(doc.id);
      setSelectedItemId(null);
      setUploadMessage({ type: "success", text: "품목 전체 삭제 완료" });
    } catch (e: any) {
      setUploadMessage({ type: "error", text: `삭제 실패: ${e?.message ?? e}` });
    } finally {
      setLoading(false);
    }
  };

  const toNumberOrNull = (v: any): number | null => {
    const n = Number(String(v ?? "").trim().replace(/,/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  /** 단가·금액용 (0 허용) */
  const toNumberOrZero = (v: any): number | null => {
    if (v == null || v === "") return null;
    const n = Number(String(v).trim().replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  /** 날짜 → YY.MM.DD (미리보기용) */
  const toDateDisplay = (v: any): string | null => {
    if (v == null || v === "") return null;
    if (typeof v === "number") {
      const d = XLSX.SSF.parse_date_code(v);
      if (!d) return null;
      const yy = String(d.y).slice(-2);
      const mm = String(d.m).padStart(2, "0");
      const dd = String(d.d).padStart(2, "0");
      return `${yy}.${mm}.${dd}`;
    }
    const s = String(v).trim();
    return s || null;
  };
  /** YY.MM.DD 등 → YYYY-MM-DD (DB용) */
  const toDateForDb = (s: string | null): string | null => {
    if (!s) return null;
    const m = s.match(/^(\d{2})\.(\d{1,2})\.(\d{1,2})$/);
    if (m) {
      const yyyy = Number(m[1]) >= 70 ? `19${m[1]}` : `20${m[1]}`;
      return `${yyyy}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    }
    const m2 = s.match(/^(\d{4})[-.](\d{1,2})[-.](\d{1,2})$/);
    if (m2) return `${m2[1]}-${m2[2].padStart(2, "0")}-${m2[3].padStart(2, "0")}`;
    return s;
  };

  /**
   * 1단계: 엑셀 파싱 → 미리보기 표시
   */
  const parseExcelForPreview = async (file: File) => {
    if (!doc?.id) {
      setUploadMessage({ type: "error", text: "먼저 '문서 불러오기/생성'을 클릭하세요." });
      return;
    }
    setUploadMessage(null);
    setExcelPreview(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      const norm = (s: any) =>
        String(s ?? "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "")
          .replace(/[()【】[\]{}]/g, "")
          .replace(/[.:·]/g, "");

      const findHeaderRow = (r: any[][], scanMax = 30) => {
        const needKeys = ["항목", "사용내역", "수량"];
        const altKeys = ["품명", "내용", "적요", "사용일자", "일자"];
        let best = { idx: -1, score: 0 };
        for (let i = 0; i < Math.min(scanMax, r.length); i++) {
          const row = r[i].map(norm);
          let score = 0;
          if (row.includes("항목")) score += 3;
          if (row.includes("사용내역") || row.some((c) => ["품명", "내용", "적요"].includes(c))) score += 2;
          if (row.includes("사용일자") || row.includes("일자")) score += 1;
          if (row.includes("수량")) score += 2;
          if (score > best.score) best = { idx: i, score };
        }
        return best.idx;
      };

      const headerIdx = findHeaderRow(rows);
      if (headerIdx < 0) {
        setUploadMessage({ type: "error", text: "엑셀 헤더를 찾지 못했습니다. (항목, 사용일자, 사용내역, 수량 필요)" });
        return;
      }

      const header = rows[headerIdx].map(norm);
      const colIndex = (cands: string[]) => {
        for (let i = 0; i < header.length; i++) if (cands.includes(header[i])) return i;
        return -1;
      };

      const c항목 = colIndex(["항목", "구분", "대분류"]);
      const c사용일자 = colIndex(["사용일자", "일자", "사용일", "발행일자"]);
      const c사용내역 = colIndex(["사용내역", "품명", "내용", "적요", "품목", "품목명"]);
      const c수량 = colIndex(["수량"]);
      const c단가 = colIndex(["단가"]);
      const c금액 = colIndex(["금액", "사용금액", "합계"]);

      if (c사용내역 < 0 && c항목 < 0) {
        setUploadMessage({ type: "error", text: "'항목' 또는 '사용내역' 컬럼을 찾지 못했습니다." });
        return;
      }

      const body = rows.slice(headerIdx + 1);
      let lastCategory = "";
      const preview: ExcelPreviewRow[] = [];
      for (const r of body) {
        const raw항목 = c항목 >= 0 ? String(r[c항목] ?? "").trim() : "";
        const raw사용내역 = c사용내역 >= 0 ? String(r[c사용내역] ?? "").trim() : "";
        const raw수량 = c수량 >= 0 ? r[c수량] : null;
        const raw일자 = c사용일자 >= 0 ? r[c사용일자] : null;
        const raw단가 = c단가 >= 0 ? r[c단가] : null;
        const raw금액 = c금액 >= 0 ? r[c금액] : null;

        const category = raw항목 || lastCategory;
        if (raw항목) lastCategory = raw항목;

        const qty = toNumberOrNull(raw수량) ?? 0;
        const used_at = toDateDisplay(raw일자);
        const item_name = raw사용내역;
        const isDetail = !!item_name && !/^계$|^합계$/i.test(item_name);
        const unit_price = c단가 >= 0 ? toNumberOrZero(raw단가) : null;
        const amount = c금액 >= 0 ? toNumberOrZero(raw금액) : null;

        if (category || item_name || used_at || qty > 0) {
          preview.push({
            category,
            used_at,
            item_name: item_name || "",
            qty,
            isDetail,
            unit_price: unit_price ?? undefined,
            amount: amount ?? undefined,
            evidence_no: null,
          });
        }
      }

      // 인접한 카테고리 전용 행(데이터 없음) 병합 → 하나의 항목으로
      const collapsed: ExcelPreviewRow[] = [];
      let idx = 0;
      while (idx < preview.length) {
        const row = preview[idx];
        const isCategoryOnly = !row.isDetail && !row.item_name && !row.used_at && row.qty === 0 && row.amount == null && row.unit_price == null;
        const is계 = /^계$|^합계$/i.test(row.category);
        if (isCategoryOnly && !is계) {
          const parts: string[] = [row.category];
          while (idx + 1 < preview.length) {
            const next = preview[idx + 1];
            const nextCatOnly = !next.isDetail && !next.item_name && !next.used_at && next.qty === 0 && next.amount == null && next.unit_price == null;
            if (nextCatOnly && !/^계$|^합계$/i.test(next.category)) {
              if (next.category && !parts.includes(next.category)) parts.push(next.category);
              idx++;
            } else break;
          }
          collapsed.push({ ...row, category: parts.join(" ").trim() || row.category });
        } else {
          collapsed.push(row);
        }
        idx++;
      }

      // 데이터 있는 행만 유지 - 계/0만 있는 행 전부 제외
      const hasData = (p: ExcelPreviewRow) => {
        if (p.isDetail) return true; // 사용내역 있는 행
        if (!!p.used_at) return true;
        if (p.qty > 0) return true;
        if (p.amount != null && p.amount !== 0) return true;
        if (p.unit_price != null && p.unit_price !== 0) return true;
        if (/^계$|^합계$/i.test(p.category)) return false; // 계/합계 행은 무조건 제외
        return false;
      };
      const filtered = collapsed.filter(hasData);

      const detailCount = filtered.filter((p) => p.isDetail).length;
      if (detailCount === 0) {
        setUploadMessage({ type: "error", text: "저장할 세부 품목(사용내역)이 없습니다." });
        return;
      }

      // 증빙번호: 데이터 있는 행(isDetail)만 1부터 순차 부여
      let evidenceNo = 1;
      for (const p of filtered) {
        if (p.isDetail) p.evidence_no = evidenceNo++;
      }

      setExcelPreview(filtered);
      setExcelPreviewSearch("");
      setUploadMessage({ type: "success", text: `엑셀 ${filtered.length}행 파싱 (저장 ${detailCount}건). 미리보기 확인 후 [DB에 저장]` });
    } catch (e: any) {
      setUploadMessage({ type: "error", text: `파싱 실패: ${e?.message ?? e}` });
    }
  };

  /**
   * 2단계: 미리보기 → DB 저장
   * - evidence_no: 기존 최대값+1부터 순차 부여
   * - 내용 기반 중복: (item_name, used_at, qty) 동일 행은 건너뜀
   */
  const saveExcelPreviewToDb = async () => {
    if (!doc?.id || !excelPreview || excelPreview.length === 0) return;
    const detailRows = excelPreview.filter((p) => p.isDetail);
    if (detailRows.length === 0) return;
    setLoading(true);
    try {
      const { data: existing } = await supabase
        .from(ITEM_TABLE)
        .select("evidence_no, item_name, used_at, qty")
        .eq("doc_id", doc.id);

      const maxEvidenceNo = (existing ?? []).reduce(
        (max, r) => Math.max(max, (r as any).evidence_no ?? 0),
        0
      );

      const existingKeys = new Set(
        (existing ?? []).map((r: any) => {
          const u = r.used_at ? String(r.used_at).slice(0, 10) : "";
          return `${r.item_name}|${u}|${r.qty}`;
        })
      );

      const toInsert: typeof detailRows = [];
      for (const p of detailRows) {
        const u = toDateForDb(p.used_at) ? String(toDateForDb(p.used_at)).slice(0, 10) : "";
        const key = `${p.item_name}|${u}|${p.qty}`;
        if (!existingKeys.has(key)) {
          toInsert.push(p);
          existingKeys.add(key);
        }
      }

      if (toInsert.length === 0) {
        setUploadMessage({
          type: "error",
          text: `중복된 항목만 있습니다. ${detailRows.length}건 모두 기존 데이터와 동일하여 저장하지 않았습니다.`,
        });
        setLoading(false);
        return;
      }

      let nextNo = maxEvidenceNo + 1;
      const insertPayload = toInsert.map((p) => ({
        doc_id: doc.id,
        evidence_no: nextNo++,
        item_name: p.item_name,
        qty: p.qty,
        unit_price: p.unit_price ?? null,
        amount: p.amount ?? null,
        used_at: toDateForDb(p.used_at),
      }));

      const { error } = await supabase.from(ITEM_TABLE).insert(insertPayload);
      if (error) throw error;

      setExcelPreview(null);
      setExcelPreviewSearch("");
      const loaded = await loadItems(doc.id);
      const dupCount = detailRows.length - toInsert.length;
      const msg =
        dupCount > 0
          ? `엑셀 ${insertPayload.length}건 저장 완료 (${dupCount}건 중복 제외)`
          : `엑셀 ${insertPayload.length}건 저장 완료`;
      if (loaded.length === 0) {
        setUploadMessage({ type: "error", text: `DB에는 ${insertPayload.length}건 저장됐으나 목록이 비어 있습니다. RLS 확인하세요.` });
      } else {
        setUploadMessage({ type: "success", text: msg });
      }
    } catch (e: any) {
      setUploadMessage({ type: "error", text: `저장 실패: ${e?.message ?? e}` });
    } finally {
      setLoading(false);
    }
  };

  const itemsView = useMemo(() => items, [items]);

  return (
    <main style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>안전관리비 품목 관리</h2>
        <Link href="/expense" style={{ fontSize: 14, color: "#06c" }}>문서/사진 관리 (expense) →</Link>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <button
          onClick={createOrLoadDoc}
          disabled={loading}
          style={{ padding: "6px 10px", border: "1px solid #999", borderRadius: 4, background: "#fff", color: "#171717" }}
        >
          문서 불러오기/생성
        </button>

        <button
          onClick={deleteAllItems}
          disabled={loading || !doc?.id}
          style={{ background: "#c62828", color: "#fff", border: "none", borderRadius: 4, padding: "6px 10px", cursor: "pointer" }}
        >
          데이터 전체 삭제
        </button>

        <label
          htmlFor="excel-upload-input"
          style={{
            border: "1px solid #ccc",
            padding: "6px 10px",
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
            background: "#fff",
            color: "#171717",
          }}
        >
          엑셀 업로드
        </label>
        <input
          id="excel-upload-input"
          type="file"
          accept=".xlsx,.xls"
          style={{ display: "none" }}
          disabled={loading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) parseExcelForPreview(f);
            e.target.value = "";
          }}
        />
      </div>

      {uploadMessage && (
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            borderRadius: 8,
            background: uploadMessage.type === "error" ? "#fee" : "#efe",
            color: uploadMessage.type === "error" ? "#c00" : "#060",
            border: `1px solid ${uploadMessage.type === "error" ? "#fcc" : "#cfc"}`,
          }}
        >
          {uploadMessage.text}
        </div>
      )}

      {/* 엑셀 미리보기: 검색 | 항목 병합 | 금액 합계 */}
      {excelPreview && excelPreview.length > 0 && (() => {
        const searchQuery = excelPreviewSearch.trim();
        const q = searchQuery.toLowerCase();
        const filteredBySearch = q
          ? excelPreview.filter((row) => {
              const match = (s: string) => s.toLowerCase().includes(q);
              return (
                match(row.category) ||
                match(row.item_name) ||
                match(row.used_at || "") ||
                match(String(row.qty)) ||
                match(String(row.amount ?? "")) ||
                match(String(row.unit_price ?? "")) ||
                match(`no${row.evidence_no ?? ""}`)
              );
            })
          : excelPreview;

        // 항목 열 병합: 같은 카테고리 그룹에 rowSpan 부여
        const rowsWithSpan: { row: ExcelPreviewRow; rowSpan: number }[] = [];
        let i = 0;
        while (i < filteredBySearch.length) {
          const row = filteredBySearch[i];
          let span = 1;
          if (!row.isDetail && row.category) {
            while (i + span < filteredBySearch.length && filteredBySearch[i + span].category === row.category && filteredBySearch[i + span].isDetail) span++;
          } else if (row.isDetail && row.category) {
            while (i + span < filteredBySearch.length && filteredBySearch[i + span].category === row.category && filteredBySearch[i + span].isDetail) span++;
          }
          rowsWithSpan.push({ row, rowSpan: span });
          for (let j = 1; j < span; j++) rowsWithSpan.push({ row: filteredBySearch[i + j], rowSpan: 0 });
          i += span;
        }

        const totalAmount = filteredBySearch
          .filter((r) => r.isDetail)
          .reduce((sum, r) => {
            const amt = r.amount ?? (r.qty && r.unit_price ? r.qty * r.unit_price : 0);
            return sum + (Number.isFinite(amt) ? amt : 0);
          }, 0);
        const monthTitle = doc?.month_key
          ? `${doc.month_key.slice(0, 4)}년 ${doc.month_key.slice(5, 7)}월 항목별사용내역서`
          : "항목별사용내역서";
        return (
        <div style={{ marginBottom: 16, padding: 20, border: "1px solid #333", background: "#fff", maxWidth: 900, color: "#222" }}>
          <h2 style={{ margin: "0 0 16px 0", fontSize: 18, fontWeight: 700, textAlign: "center", color: "#222" }}>
            {monthTitle}
          </h2>
          <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="text"
              placeholder="항목, 사용내역, 날짜 등 검색..."
              value={excelPreviewSearch}
              onChange={(e) => setExcelPreviewSearch(e.target.value)}
              style={{
                flex: 1,
                maxWidth: 280,
                padding: "8px 12px",
                border: "1px solid #999",
                borderRadius: 6,
                fontSize: 14,
                color: "#222",
              }}
            />
            {q && (
              <span style={{ fontSize: 13, color: "#333" }}>
                {filteredBySearch.length}건
              </span>
            )}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, border: "1px solid #333", color: "#222" }}>
              <thead>
                <tr style={{ background: "#f0f0f0" }}>
                  <th style={{ ...thStyle, border: "1px solid #333", fontWeight: 600, color: "#222" }}>항목</th>
                  <th style={{ ...thStyle, border: "1px solid #333", fontWeight: 600, color: "#222" }}>사용일자</th>
                  <th style={{ ...thStyle, border: "1px solid #333", fontWeight: 600, color: "#222" }}>사용내역</th>
                  <th style={{ ...thStyle, border: "1px solid #333", fontWeight: 600, textAlign: "right", color: "#222" }}>수량</th>
                  <th style={{ ...thStyle, border: "1px solid #333", fontWeight: 600, textAlign: "right", color: "#222" }}>단가</th>
                  <th style={{ ...thStyle, border: "1px solid #333", fontWeight: 600, textAlign: "right", color: "#222" }}>금액</th>
                  <th style={{ ...thStyle, border: "1px solid #333", fontWeight: 600, textAlign: "center", color: "#222" }}>증빙번호</th>
                </tr>
              </thead>
              <tbody>
                {rowsWithSpan.map(({ row, rowSpan }, idx) => (
                  <tr key={idx} style={{ background: "#fff" }}>
                    {rowSpan > 0 && (
                      <td
                        rowSpan={rowSpan}
                        style={{
                          ...tdStyle,
                          border: "1px solid #333",
                          verticalAlign: rowSpan > 1 ? "middle" : undefined,
                          background: row.isDetail ? "#fff" : "#f8f8f8",
                          fontWeight: !row.isDetail ? 600 : 400,
                          minWidth: 140,
                          lineHeight: 1.4,
                          color: "#222",
                        }}
                      >
                        <HighlightText text={row.category || ""} query={searchQuery} />
                      </td>
                    )}
                    <td style={{ ...tdStyle, border: "1px solid #333", color: "#222" }}>
                      <HighlightText text={row.used_at || ""} query={searchQuery} />
                    </td>
                    <td style={{ ...tdStyle, border: "1px solid #333", color: "#222" }}>
                      <HighlightText text={row.item_name || ""} query={searchQuery} />
                    </td>
                    <td style={{ ...tdStyle, border: "1px solid #333", textAlign: "right", color: "#222" }}>
                      <HighlightText text={row.qty > 0 ? row.qty.toLocaleString() : ""} query={searchQuery} />
                    </td>
                    <td style={{ ...tdStyle, border: "1px solid #333", textAlign: "right", color: "#222" }}>
                      <HighlightText text={row.unit_price != null ? row.unit_price.toLocaleString() : ""} query={searchQuery} />
                    </td>
                    <td style={{ ...tdStyle, border: "1px solid #333", textAlign: "right", color: "#222" }}>
                      <HighlightText text={row.amount != null ? row.amount.toLocaleString() : ""} query={searchQuery} />
                    </td>
                    <td style={{ ...tdStyle, border: "1px solid #333", textAlign: "center", color: "#222" }}>
                      <HighlightText text={row.isDetail && row.evidence_no != null ? `no${row.evidence_no}` : ""} query={searchQuery} />
                    </td>
                  </tr>
                ))}
                <tr style={{ background: "#f5f5f5", fontWeight: 600 }}>
                  <td colSpan={5} style={{ ...tdStyle, border: "1px solid #333", textAlign: "right", color: "#222" }}>
                    합계
                  </td>
                  <td style={{ ...tdStyle, border: "1px solid #333", textAlign: "right", color: "#222" }}>
                    {totalAmount.toLocaleString()}
                  </td>
                  <td style={{ ...tdStyle, border: "1px solid #333", color: "#222" }} />
                </tr>
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 12, color: "#666", margin: "12px 0 8px 0" }}>
            확인 후 [DB에 저장]을 클릭하세요.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={saveExcelPreviewToDb}
              disabled={loading}
              style={{
                padding: "10px 20px",
                background: "#06c",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                cursor: loading ? "not-allowed" : "pointer",
                fontWeight: 600,
              }}
            >
              {loading ? "저장 중..." : "DB에 저장"}
            </button>
            <button
              onClick={() => { setExcelPreview(null); setExcelPreviewSearch(""); setUploadMessage(null); }}
              disabled={loading}
              style={{
                padding: "10px 20px",
                background: "#888",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              취소
            </button>
          </div>
        </div>
        );
      })()}

      <div style={{ marginBottom: 12 }}>
        <div>
          <b>doc_id:</b> {doc?.id ?? "-"}
        </div>
        <div>
          <b>현장/월:</b> {doc ? `${doc.site_name} / ${doc.month_key}` : "-"}
        </div>
      </div>

      <hr />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0 }}>품목 목록</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: "inherit", opacity: 0.9 }}>
            시트 배정: {selectedItemIdsForSheet.size}개 선택
          </span>
          <select
            value={selectedSheetTemplate}
            onChange={(e) => setSelectedSheetTemplate(e.target.value)}
            style={{ padding: "6px 10px", border: "1px solid #999", borderRadius: 6, background: "#fff", color: "#171717" }}
          >
            <option value="">시트 선택</option>
            {SHEET_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={assignSheetToItems}
            disabled={loading || selectedItemIdsForSheet.size === 0 || !selectedSheetTemplate}
            style={{
              padding: "6px 12px",
              background: "#1976d2",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            배정
          </button>
        </div>
        <button
          type="button"
          onClick={() => setShowTablePreview(!showTablePreview)}
          style={{
            padding: "6px 12px",
            border: "1px solid #999",
            borderRadius: 6,
            background: showTablePreview ? "#e3f2fd" : "#fff",
            color: "#171717",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          {showTablePreview ? "카드 보기" : "테이블 미리보기"}
        </button>
      </div>
      <p style={{ fontSize: 13, color: "inherit", opacity: 0.85, margin: "0 0 8px 0" }}>
        품목을 클릭하면 아래에 사진 미리보기·업로드가 나타납니다.
      </p>
      {showTablePreview ? (
        <div style={{ marginBottom: 16, border: "1px solid #333", background: "#fff", color: "#222" }}>
          <div style={{ padding: "12px 16px", background: "#f5f5f5", borderBottom: "1px solid #333", fontWeight: 600 }}>
            {doc?.month_key ? `${doc.month_key.slice(0, 4)}년 ${doc.month_key.slice(5, 7)}월 항목별사용내역서` : "항목별사용내역서"}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, border: "1px solid #333", color: "#222" }}>
              <thead>
                <tr style={{ background: "#f0f0f0" }}>
                  <th style={{ ...thStyle, border: "1px solid #333", fontWeight: 600, color: "#222", width: 40 }}>
                    <input
                      type="checkbox"
                      checked={itemsView.length > 0 && selectedItemIdsForSheet.size === itemsView.length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedItemIdsForSheet(new Set(itemsView.map((it) => it.id)));
                        } else {
                          setSelectedItemIdsForSheet(new Set());
                        }
                      }}
                    />
                  </th>
                  <th style={{ ...thStyle, border: "1px solid #333", fontWeight: 600, color: "#222", textAlign: "center" }}>증빙번호</th>
                  <th style={{ ...thStyle, border: "1px solid #333", fontWeight: 600, color: "#222" }}>사용일자</th>
                  <th style={{ ...thStyle, border: "1px solid #333", fontWeight: 600, color: "#222" }}>사용내역</th>
                  <th style={{ ...thStyle, border: "1px solid #333", fontWeight: 600, color: "#222", textAlign: "right" }}>수량</th>
                  <th style={{ ...thStyle, border: "1px solid #333", fontWeight: 600, color: "#222", textAlign: "right" }}>단가</th>
                  <th style={{ ...thStyle, border: "1px solid #333", fontWeight: 600, color: "#222", textAlign: "right" }}>금액</th>
                  <th style={{ ...thStyle, border: "1px solid #333", fontWeight: 600, color: "#222" }}>시트</th>
                </tr>
              </thead>
              <tbody>
                {itemsView.map((it) => (
                  <tr
                    key={it.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedItemId(it.id)}
                    onKeyDown={(e) => e.key === "Enter" && setSelectedItemId(it.id)}
                    style={{
                      background: selectedItemId === it.id ? "#e3f2fd" : "#fff",
                      cursor: "pointer",
                    }}
                  >
                    <td style={{ ...tdStyle, border: "1px solid #333", color: "#222" }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedItemIdsForSheet.has(it.id)}
                        onChange={() => toggleItemForSheet(it.id)}
                      />
                    </td>
                    <td style={{ ...tdStyle, border: "1px solid #333", textAlign: "center", color: "#222" }}>
                      {it.evidence_no != null ? `no${it.evidence_no}` : "-"}
                    </td>
                    <td style={{ ...tdStyle, border: "1px solid #333", color: "#222" }}>{it.used_at ?? "-"}</td>
                    <td style={{ ...tdStyle, border: "1px solid #333", color: "#222" }}>{it.item_name}</td>
                    <td style={{ ...tdStyle, border: "1px solid #333", textAlign: "right", color: "#222" }}>
                      {it.qty > 0 ? it.qty.toLocaleString() : "-"}
                    </td>
                    <td style={{ ...tdStyle, border: "1px solid #333", textAlign: "right", color: "#222" }}>
                      {it.unit_price != null ? it.unit_price.toLocaleString() : "-"}
                    </td>
                    <td style={{ ...tdStyle, border: "1px solid #333", textAlign: "right", color: "#222" }}>
                      {it.amount != null ? it.amount.toLocaleString() : "-"}
                    </td>
                    <td style={{ ...tdStyle, border: "1px solid #333", color: "#222", fontSize: 12 }}>
                      {it.sheet_template ?? "-"}
                    </td>
                  </tr>
                ))}
                {itemsView.length > 0 && (
                  <tr style={{ background: "#f5f5f5", fontWeight: 600 }}>
                    <td colSpan={5} style={{ ...tdStyle, border: "1px solid #333", textAlign: "right", color: "#222" }}>
                      합계
                    </td>
                    <td style={{ ...tdStyle, border: "1px solid #333", color: "#222" }} />
                    <td style={{ ...tdStyle, border: "1px solid #333", textAlign: "right", color: "#222" }}>
                      {itemsView
                        .reduce(
                          (s, r) =>
                            s + (r.amount ?? (r.qty && r.unit_price ? r.qty * r.unit_price : 0)),
                          0
                        )
                        .toLocaleString()}
                    </td>
                    <td style={{ ...tdStyle, border: "1px solid #333", color: "#222" }} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {itemsView.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "#666" }}>등록된 품목이 없습니다.</div>
          )}
        </div>
      ) : (
      <div style={{ display: "grid", gap: 6 }}>
        {itemsView.map((it) => (
          <div
            key={it.id}
            role="button"
            tabIndex={0}
            onClick={() => setSelectedItemId(it.id)}
            onKeyDown={(e) => e.key === "Enter" && setSelectedItemId(it.id)}
            style={{
              border: `1px solid ${selectedItemId === it.id ? "#06c" : "#ddd"}`,
              borderRadius: 8,
              padding: 10,
              cursor: "pointer",
              background: selectedItemId === it.id ? "#f0f8ff" : undefined,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <input
              type="checkbox"
              checked={selectedItemIdsForSheet.has(it.id)}
              onChange={() => toggleItemForSheet(it.id)}
              onClick={(e) => e.stopPropagation()}
            />
            <div style={{ flex: 1 }}>
              <b>NO:</b> {it.evidence_no ?? "-"} / <b>품명:</b> {it.item_name} / <b>수량:</b> {it.qty}
              {it.sheet_template && (
                <span style={{ marginLeft: 8, fontSize: 12, color: "#666" }}>시트: {it.sheet_template}</span>
              )}
            </div>
          </div>
        ))}
        {itemsView.length === 0 && <div style={{ color: "#666" }}>등록된 품목이 없습니다.</div>}
      </div>
      )}

      {doc?.id && selectedItemId && (
        <>
          <hr />
          <h3>사진 미리보기 / 업로드</h3>
          <div style={{ marginTop: 8, padding: 12, border: "1px solid #ddd", borderRadius: 8, background: "#fafafa" }}>
            <PhotoSection docId={doc.id} itemId={selectedItemId} />
          </div>
        </>
      )}
    </main>
  );
}
