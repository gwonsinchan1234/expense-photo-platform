"use client";

/**
 * ExpensePage (최소 안정판)
 * - 문서(doc) 생성/조회
 * - 품목(item) 목록 로딩
 * - 품목 선택(selectedItemId) → PhotoSection에 docId/itemId 전달
 *
 * [주의]
 * - 현재 typecheck 통과/꼬임 제거가 목적
 * - 엑셀 업로드 로직은 나중에 다시 붙입니다(지금은 placeholder)
 */

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import PhotoSection from "@/components/PhotoSection";

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
  source_fingerprint?: string | null;
  source_row_no?: number | null;
};

export default function ExpensePage() {
  const [doc, setDoc] = useState<ExpenseDoc | null>(null);
  const [items, setItems] = useState<ExpenseItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);


  /** 최근 문서 로드 */
  const loadLatestDoc = async () => {
    const { data, error } = await supabase
      .from("expense_docs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      alert(`doc 조회 에러: ${error.message}`);
      return;
    }

    setDoc((data as ExpenseDoc) ?? null);
    setSelectedItemId(null);
  };

  /** 품목 로드 */
  const loadItems = async (docId: string) => {
    const { data, error } = await supabase
      .from("expense_items")
      .select("*")
      .eq("doc_id", docId)
      .order("evidence_no", { ascending: true });

    if (error) {
      alert(`items 조회 에러: ${error.message}`);
      return;
    }

    setItems((data ?? []) as ExpenseItem[]);
  };

  useEffect(() => {
    loadLatestDoc();
  }, []);

  useEffect(() => {
    if (doc?.id) loadItems(doc.id);
  }, [doc?.id]);


  return (
    <main style={{ padding: 16 }}>
      <h1>안전관리비 관리(문서/품목 + 사진)</h1>

      <section style={{ marginTop: 16, padding: 12, border: "1px solid #333" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>품목 선택</h2>
          <button onClick={loadLatestDoc}>최근 문서 불러오기</button>
        </div>
        <div style={{ marginTop: 8 }}>
          <b>현재 문서:</b> {doc ? `${doc.site_name} / ${doc.month_key}` : "없음"}
        </div>
      </section>

      <section style={{ marginTop: 16, padding: 12, border: "1px solid #333" }}>
        <h2>품목 리스트 (행 선택)</h2>

        <ul>
          {items.map((it) => (
            <li key={it.id}>
              <label>
                <input
                  type="radio"
                  checked={selectedItemId === it.id}
                  onChange={() => setSelectedItemId(it.id)}
                />
                <b> NO.{it.evidence_no}</b> / {it.item_name} / 수량 {it.qty}
              </label>
            </li>
          ))}
        </ul>

        <div>
          <b>선택된 품목 ID:</b> {selectedItemId ?? "없음"}
        </div>
      </section>

      <section style={{ marginTop: 16, padding: 12, border: "1px solid #333" }}>
        <h2>사진 업로드</h2>

        {!doc?.id ? (
          <div>먼저 문서(doc)를 생성/선택하세요.</div>
        ) : !selectedItemId ? (
          <div>먼저 위에서 품목을 선택하세요.</div>
        ) : (
          <PhotoSection docId={doc.id} itemId={selectedItemId} />
        )}
      </section>
    </main>
  );
}
