"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabaseClient";

/**
 * [핵심 수정 요약]
 * - 409/23505 원인: evidence_no(=NO)를 빈값일 때도 1로 강제 세팅해서 (doc_id, 1) 중복 Insert 발생
 * - 해결: NO가 비어 있으면 evidence_no 컬럼 자체를 DB로 보내지 않는다(=undefined / omit)
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
  evidence_no: number; // DB가 채우거나, 엑셀에 있을 때만 전달
  item_name: string;
  qty: number;
  unit_price: number | null;
  amount: number | null;
  used_at: string | null;
};

export default function HomePage() {
  const [doc, setDoc] = useState<ExpenseDoc | null>(null);
  const [items, setItems] = useState<ExpenseItem[]>([]);
  const [loading, setLoading] = useState(false);
  /** 업로드 결과 메시지 (알림이 막혀도 화면에서 확인 가능) */
  const [uploadMessage, setUploadMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 문서 기본값(원하시면 UI로 입력받게 바꾸면 됩니다)
  const defaultSiteName = "현장명";
  const defaultMonthKey = "2026-01";

  const loadItems = async (docId: string): Promise<ExpenseItem[]> => {
    const { data, error } = await supabase
      .from(ITEM_TABLE)
      .select("id, doc_id, evidence_no, item_name, qty, unit_price, amount, used_at")
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

  /**
   * ✅ 수동 품목 추가
   * - evidence_no는 절대 클라이언트에서 1로 기본값 넣지 않음
   * - DB 자동부여/트리거/서버처리 구조를 그대로 존중
   */
  const addManualItem = async () => {
    if (!doc?.id) return;

    setLoading(true);
    try {
      const payload = {
        doc_id: doc.id,
        item_name: "테스트품목",
        qty: 1,
        unit_price: null,
        amount: null,
        used_at: null,
        // ❌ evidence_no 보내지 않음 (중요)
      };

      const { error } = await supabase.from(ITEM_TABLE).insert([payload]);
      if (error) throw error;

      await loadItems(doc.id);
    } catch (e: any) {
      alert(`품목 추가 실패: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  };

  /**
   * ✅ 엑셀 업로드 → 품목 insert
   * - NO(증빙번호)가 비어 있으면 evidence_no를 "아예 보내지 않음"
   * - NO가 숫자로 명확히 있으면 그때만 evidence_no 포함
   */
  const importExcelToItems = async (file: File) => {
    if (!doc?.id) {
      setUploadMessage({ type: "error", text: "먼저 '문서 불러오기/생성'을 클릭하세요." });
      return;
    }

    setLoading(true);
    setUploadMessage(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      // 헤더 정규화
      const norm = (s: any) =>
        String(s ?? "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "")
          .replace(/[()【】[\]{}]/g, "")
          .replace(/[.:·]/g, "");

      // 헤더 행 찾기(상단 30행 스캔)
      const findHeaderRow = (r: any[][], scanMax = 30) => {
        const keys = ["no", "증빙번호", "연번", "번호"];
        const itemKeys = ["품명", "내용", "품목", "품목명", "항목", "적요"];
        const qtyKeys = ["수량"];

        let best = { idx: -1, score: 0 };

        for (let i = 0; i < Math.min(scanMax, r.length); i++) {
          const row = r[i].map(norm);
          let score = 0;
          if (row.some((c) => keys.includes(c))) score += 2;
          if (row.some((c) => itemKeys.includes(c))) score += 2;
          if (row.some((c) => qtyKeys.includes(c))) score += 1;

          if (score > best.score) best = { idx: i, score };
        }
        return best.idx;
      };

      const headerIdx = findHeaderRow(rows);
      if (headerIdx < 0) {
        setUploadMessage({ type: "error", text: "엑셀 헤더 행을 찾지 못했습니다. (NO/품명/수량 등의 헤더가 필요)" });
        setLoading(false);
        return;
      }

      const header = rows[headerIdx].map(norm);

      const colIndex = (cands: string[]) => {
        for (let i = 0; i < header.length; i++) {
          if (cands.includes(header[i])) return i;
        }
        return -1;
      };

      const cNo = colIndex(["no", "증빙번호", "연번"]);
      const cName = colIndex(["품명", "내용", "품목", "품목명", "항목", "적요"]);
      const cQty = colIndex(["수량"]);
      const cUnit = colIndex(["단가"]);
      const cAmt = colIndex(["금액", "사용금액", "합계"]);
      const cDate = colIndex(["일자", "사용일", "사용일자", "발행일자"]);

      if (cName < 0 || cQty < 0) {
        setUploadMessage({ type: "error", text: "엑셀에서 '품명(내용/품목)' 또는 '수량' 컬럼을 찾지 못했습니다." });
        setLoading(false);
        return;
      }

      const body = rows.slice(headerIdx + 1);

      // ✅ 여기서 NO 빈값을 1로 강제하지 말 것
      const toNumberOrNull = (v: any) => {
        const n = Number(String(v ?? "").trim());
        return Number.isFinite(n) && n > 0 ? n : null;
      };

      const toDateOrNull = (v: any) => {
        const s = String(v ?? "").trim();
        if (!s) return null;
        // 엑셀 날짜가 문자열이면 그대로 저장(서버/DB에서 파싱 가능)
        return s;
      };

      const insertPayload = body
        .map((r) => {
          const item_name = String(r[cName] ?? "").trim();
          if (!item_name) return null;

          const qty = toNumberOrNull(r[cQty]) ?? 0;

          const evidenceNo = cNo >= 0 ? toNumberOrNull(r[cNo]) : null;

          const base: any = {
            doc_id: doc.id,
            item_name,
            qty,
            unit_price: cUnit >= 0 ? toNumberOrNull(r[cUnit]) : null,
            amount: cAmt >= 0 ? toNumberOrNull(r[cAmt]) : null,
            used_at: cDate >= 0 ? toDateOrNull(r[cDate]) : null,
          };

          // ✅ 핵심: NO가 있을 때만 evidence_no 포함(없으면 아예 omit)
          if (evidenceNo) base.evidence_no = evidenceNo;

          return base;
        })
        .filter(Boolean) as any[];

      if (insertPayload.length === 0) {
        setUploadMessage({
          type: "error",
          text: "가져올 품목 데이터가 없습니다. 1번 시트에 품명/수량 컬럼·헤더 다음 행에 품명이 있는지 확인하세요.",
        });
        setLoading(false);
        return;
      }

      // ⚠️ 동일 엑셀 안에서 NO가 중복이면, DB Unique에서 또 막힙니다.
      // (엑셀에 NO가 명시된 경우만 체크)
      const noList = insertPayload
        .map((x) => x.evidence_no)
        .filter((v: any) => typeof v === "number") as number[];

      const dupNos = noList.filter((v, i) => noList.indexOf(v) !== i);
      if (dupNos.length > 0) {
        setUploadMessage({
          type: "error",
          text: `엑셀 내 NO(증빙번호) 중복: ${Array.from(new Set(dupNos)).join(", ")}. 중복 정리 후 다시 업로드하세요.`,
        });
        setLoading(false);
        return;
      }

      // insert 실행
      const { error } = await supabase.from(ITEM_TABLE).insert(insertPayload);
      if (error) throw error;

      const loaded = await loadItems(doc.id);
      if (loaded.length === 0) {
        const text = `DB에는 ${insertPayload.length}건 저장됐으나 목록이 비어 있습니다. Supabase RLS(SELECT 권한) 확인하세요.`;
        setUploadMessage({ type: "error", text });
        console.warn("[엑셀 업로드]", text);
      } else {
        const text = `엑셀 업로드 완료 (${loaded.length}건)`;
        setUploadMessage({ type: "success", text });
      }
    } catch (e: any) {
      const msg = e?.message ?? (typeof e === "string" ? e : JSON.stringify(e));
      setUploadMessage({ type: "error", text: `엑셀 업로드 실패: ${msg}` });
      console.error("[엑셀 업로드 실패]", e);
    } finally {
      setLoading(false);
    }
  };

  const itemsView = useMemo(() => items, [items]);

  return (
    <main style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
      <h2>안전관리비 품목 관리</h2>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <button onClick={createOrLoadDoc} disabled={loading}>
          문서 불러오기/생성
        </button>

        <button onClick={addManualItem} disabled={loading || !doc?.id}>
          품목 1개(테스트) 추가
        </button>

        <label
          htmlFor="excel-upload-input"
          style={{
            border: "1px solid #ccc",
            padding: "6px 10px",
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
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
            if (f) importExcelToItems(f);
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

      <div style={{ marginBottom: 12 }}>
        <div>
          <b>doc_id:</b> {doc?.id ?? "-"}
        </div>
        <div>
          <b>현장/월:</b> {doc ? `${doc.site_name} / ${doc.month_key}` : "-"}
        </div>
      </div>

      <hr />

      <h3>품목 목록</h3>
      <div style={{ display: "grid", gap: 6 }}>
        {itemsView.map((it) => (
          <div key={it.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 10 }}>
            <div>
              <b>NO:</b> {it.evidence_no ?? "-"} / <b>품명:</b> {it.item_name} / <b>수량:</b> {it.qty}
            </div>
          </div>
        ))}
        {itemsView.length === 0 && <div style={{ color: "#666" }}>등록된 품목이 없습니다.</div>}
      </div>
    </main>
  );
}
