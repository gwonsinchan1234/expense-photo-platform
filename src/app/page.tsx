"use client";

import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabaseClient";

/**
 * [이 파일의 목적]
 * - 문서(doc) 선택
 * - 엑셀 업로드 → DB 저장(upsert/insert) → 품목 재조회
 * - 품목 선택(타이핑 가능) + "중복 제거 확정"
 *
 * [중복 제거 전략]
 * - items는 절대 누적 setItems(prev...) 하지 않고 "치환(setItems(data))"만 한다.
 * - StrictMode(dev)에서 useEffect가 2번 도는 것을 docId 기준 가드한다.
 * - UI는 ItemCombobox에서 "표시 직전 Map dedupe"를 수행한다. (1차 목표 확정)
 */

// ✅ 방금 만드신 컴포넌트 경로
import ItemCombobox, { ExpenseItem } from "@/components/ItemCombobox";

// (선택) 품목 선택 후 사진 섹션을 붙일 경우 사용
// import PhotoSection from "@/components/PhotoSection";

type ExpenseDoc = {
  id: string;
  site_name: string;
  month_key: string; // 예: "2026-01"
};

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toStringSafe(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/**
 * 엑셀 날짜 입력을 YYYY-MM-DD로 최대한 안전하게 통일
 * - Date 객체
 * - 엑셀 일련번호
 * - "2026-01-27", "2026.01.27", "2026/01/27"
 */
function toDateISO(v: unknown): string | null {
  if (v === null || v === undefined) return null;

  if (v instanceof Date && !isNaN(v.getTime())) {
    const yyyy = v.getFullYear();
    const mm = String(v.getMonth() + 1).padStart(2, "0");
    const dd = String(v.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  if (typeof v === "number" && Number.isFinite(v)) {
    const parsed = XLSX.SSF.parse_date_code(v);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      const yyyy = parsed.y;
      const mm = String(parsed.m).padStart(2, "0");
      const dd = String(parsed.d).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
  }

  const s = toStringSafe(v);
  if (!s) return null;

  const normalized = s.replace(/[./]/g, "-");
  const m = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const yyyy = m[1];
    const mm = String(Number(m[2])).padStart(2, "0");
    const dd = String(Number(m[3])).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

export default function Page() {
  // ====== 상태 ======
  const [docs, setDocs] = useState<ExpenseDoc[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  const [items, setItems] = useState<ExpenseItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const [loadingDocs, setLoadingDocs] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [busyUpload, setBusyUpload] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ✅ StrictMode(dev) 2회 실행 방지 가드
  const lastLoadedDocIdRef = useRef<string | null>(null);

  // ====== 1) 문서 목록 로드 ======
  async function loadDocs() {
    setLoadingDocs(true);
    setErrorMsg(null);

    try {
      /**
       * ⚠️ 테이블명은 실제 DB에 맞아야 합니다.
       * - 문서 테이블: expense_docs
       */
      const { data, error } = await supabase
        .from("expense_docs")
        .select("id, site_name, month_key")
        .order("month_key", { ascending: false });

      if (error) throw error;

      const nextDocs = (data ?? []) as ExpenseDoc[];
      setDocs(nextDocs);

      // 최초 자동 선택(원치 않으면 제거)
      if (!selectedDocId && nextDocs.length > 0) {
        setSelectedDocId(nextDocs[0].id);
      }
    } catch (e: any) {
      setErrorMsg(e?.message ?? "문서 목록 로드 실패");
    } finally {
      setLoadingDocs(false);
    }
  }

  // ====== 2) 품목 로드 (docId 기준) ======
  async function loadItems(docId: string) {
    setLoadingItems(true);
    setErrorMsg(null);

    try {
      /**
       * ⚠️ 테이블명은 실제 DB에 맞아야 합니다.
       * - 품목 테이블: expense_items
       */
      const { data, error } = await supabase
        .from("expense_items")
        .select("id, doc_id, evidence_no, item_name, qty, unit_price, amount, used_at")
        .eq("doc_id", docId)
        .order("evidence_no", { ascending: true });

      if (error) throw error;

      // ✅ 절대 누적 금지: 항상 치환(중복 누적 차단)
      const nextItems = (data ?? []) as ExpenseItem[];
      setItems(nextItems);

      // 선택 품목이 해당 doc의 목록에 없으면 초기화
      if (selectedItemId) {
        const exists = nextItems.some((it) => it.id === selectedItemId);
        if (!exists) setSelectedItemId(null);
      }
    } catch (e: any) {
      setErrorMsg(e?.message ?? "품목 로드 실패");
      setItems([]);
      setSelectedItemId(null);
    } finally {
      setLoadingItems(false);
    }
  }

  // ====== 최초 문서 로드 ======
  useEffect(() => {
    void loadDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ====== 문서 선택 시 품목 로드 ======
  useEffect(() => {
    if (!selectedDocId) return;

    // ✅ StrictMode 2회 실행 가드
    if (lastLoadedDocIdRef.current === selectedDocId) return;
    lastLoadedDocIdRef.current = selectedDocId;

    void loadItems(selectedDocId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDocId]);

  // ====== 3) 엑셀 업로드 → 파싱 → DB 저장 → 재조회 ======
  async function handleExcelUpload(file: File) {
    if (!selectedDocId) {
      setErrorMsg("문서를 먼저 선택해주세요.");
      return;
    }

    setBusyUpload(true);
    setErrorMsg(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const wb = XLSX.read(arrayBuffer, { type: "array" });

      const wsName = wb.SheetNames[0];
      const ws = wb.Sheets[wsName];
      if (!ws) throw new Error("엑셀 시트를 읽지 못했습니다.");

      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
      if (!rows || rows.length < 2) throw new Error("엑셀에 데이터가 없습니다.");

      const header = rows[0].map((h) => toStringSafe(h));

      // 엑셀 헤더 자동 매칭(필요하면 여러분 양식에 맞게 수정)
      const idxNo = header.findIndex((h) => /^(NO|증빙번호|번호)$/i.test(h));
      const idxName = header.findIndex((h) => /(품명|내용|품목)/.test(h));
      const idxQty = header.findIndex((h) => /(수량)/.test(h));
      const idxUnit = header.findIndex((h) => /(단가)/.test(h));
      const idxAmt = header.findIndex((h) => /(금액|합계)/.test(h));
      const idxUsedAt = header.findIndex((h) => /(일자|사용일|사용일자|날짜)/.test(h));

      if (idxName === -1) {
        throw new Error("엑셀 헤더에서 '품명/내용/품목' 컬럼을 찾지 못했습니다.");
      }

      const payload = rows
        .slice(1)
        .map((r) => {
          const itemName = toStringSafe(r[idxName]);
          if (!itemName) return null;

          const evidenceNo = idxNo >= 0 ? toNumber(r[idxNo]) : null;
          const qty = idxQty >= 0 ? toNumber(r[idxQty]) : null;
          const unitPrice = idxUnit >= 0 ? toNumber(r[idxUnit]) : null;
          const amount = idxAmt >= 0 ? toNumber(r[idxAmt]) : null;
          const usedAt = idxUsedAt >= 0 ? toDateISO(r[idxUsedAt]) : null;

          return {
            doc_id: selectedDocId,
            evidence_no: evidenceNo, // null 가능 여부는 DB 스키마에 따라 다름
            item_name: itemName,
            qty: qty ?? 0,
            unit_price: unitPrice,
            amount: amount,
            used_at: usedAt,
          };
        })
        .filter(Boolean) as Array<{
        doc_id: string;
        evidence_no: number | null;
        item_name: string;
        qty: number;
        unit_price: number | null;
        amount: number | null;
        used_at: string | null;
      }>;

      if (payload.length === 0) throw new Error("업로드할 유효 데이터가 없습니다.");

      const withNo = payload.filter((p) => p.evidence_no !== null);
      const withoutNo = payload.filter((p) => p.evidence_no === null);

      /**
       * ✅ upsert(증빙번호 있는 행) + insert(증빙번호 없는 행)
       * - onConflict는 DB에 UNIQUE(doc_id, evidence_no) 있어야 안정 동작
       */
      if (withNo.length > 0) {
        const { error } = await supabase
          .from("expense_items")
          .upsert(withNo, { onConflict: "doc_id,evidence_no" });

        if (error) throw error;
      }

      if (withoutNo.length > 0) {
        const { error } = await supabase.from("expense_items").insert(withoutNo);
        if (error) throw error;
      }

      // 업로드 후: 같은 docId 재조회(가드 초기화)
      lastLoadedDocIdRef.current = null;
      await loadItems(selectedDocId);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "엑셀 업로드 실패");
    } finally {
      setBusyUpload(false);
    }
  }

  return (
    <main style={{ padding: 16, maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 12 }}>
        안전관리비 사용내역 (문서/품목 선택)
      </h1>

      {errorMsg && (
        <div
          style={{
            border: "1px solid #ddd",
            padding: 12,
            borderRadius: 10,
            marginBottom: 12,
            fontSize: 14,
            background: "#fff8f8",
          }}
        >
          <b>오류:</b> {errorMsg}
        </div>
      )}

      {/* 문서 선택 */}
      <section style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>문서 선택</div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={selectedDocId ?? ""}
            onChange={(e) => {
              const v = e.target.value || null;
              setSelectedDocId(v);
              setSelectedItemId(null);

              // 문서 변경 시 가드 초기화(바로 재로드)
              lastLoadedDocIdRef.current = null;
            }}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ccc",
            }}
            disabled={loadingDocs}
          >
            <option value="">{loadingDocs ? "불러오는 중..." : "문서를 선택하세요"}</option>
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {`${d.site_name} / ${d.month_key}`}
              </option>
            ))}
          </select>

          <button
            onClick={() => void loadDocs()}
            disabled={loadingDocs}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ccc",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            새로고침
          </button>
        </div>
      </section>

      {/* 엑셀 업로드 */}
      <section style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>엑셀 업로드</div>

        <input
          type="file"
          accept=".xlsx,.xls"
          disabled={!selectedDocId || busyUpload}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            void handleExcelUpload(f);
            e.currentTarget.value = "";
          }}
        />

        <div style={{ fontSize: 12, marginTop: 6, opacity: 0.8 }}>
          {busyUpload ? "업로드/저장 중..." : "※ 업로드 후 자동으로 품목을 다시 불러옵니다."}
        </div>
      </section>

<section style={{ marginBottom: 16 }}>
  <div style={{ padding: 8, border: "2px solid red", borderRadius: 8, marginBottom: 8 }}>
    ✅ DEBUG: ItemCombobox 렌더링 구간 (이 박스가 안 보이면 page.tsx가 아닌 다른 페이지를 보고 있는 겁니다)
  </div>

  <ItemCombobox
    items={items}
    value={selectedItemId}
    onChange={setSelectedItemId}
    dedupeBy="item_name"
    placeholder="품목 선택(타이핑 가능)"
  />
</section>

        
      </section>

      {/* 선택 품목 상세 */}
      <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>선택 품목 상세</div>

        {!selectedItemId ? (
          <div style={{ fontSize: 13, opacity: 0.8 }}>품목을 선택하면 상세가 표시됩니다.</div>
        ) : (
          (() => {
            const it = items.find((x) => x.id === selectedItemId) ?? null;
            if (!it) {
              return <div style={{ fontSize: 13 }}>선택된 품목을 찾지 못했습니다.</div>;
            }

            return (
              <div style={{ fontSize: 13, lineHeight: 1.7 }}>
                <div>증빙번호: NO.{it.evidence_no}</div>
                <div>품명: {it.item_name}</div>
                <div>수량: {it.qty}</div>
                <div>단가: {it.unit_price ?? "-"}</div>
                <div>금액: {it.amount ?? "-"}</div>
                <div>사용일자: {it.used_at ?? "-"}</div>
                <div style={{ marginTop: 10, opacity: 0.8 }}>
                  다음 단계: 이 item.id({it.id}) 기준으로 사진(반입 1장, 지급/설치 최대 4장) 매칭합니다.
                </div>
              </div>
            );
          })()
        )}
      </section>

      {/* (선택) 사진 섹션을 붙일 경우: 500 이슈 재발하면 /api/photos 원인분석으로 넘어가야 합니다 */}
      {/* {selectedDocId && selectedItemId && <PhotoSection docId={selectedDocId} itemId={selectedItemId} />} */}
    </main>
  );
}
