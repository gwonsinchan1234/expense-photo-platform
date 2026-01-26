"use client";

/**
 * ExpensePage
 * - 문서 / 품목 관리
 * - 선택된 item.id(UUID)를 기준으로 사진 업로드
 */

import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
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

  const [siteName, setSiteName] = useState("테스트현장");
  const [monthKey, setMonthKey] = useState("2026-01");

  const [evidenceNo, setEvidenceNo] = useState<number>(1);
  const [itemName, setItemName] = useState("위험테이프");
  const [qty, setQty] = useState<number>(10);

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

  /** 문서 생성 */
  const createDoc = async () => {
    const { data, error } = await supabase
      .from("expense_docs")
      .insert([{ site_name: siteName, month_key: monthKey }])
      .select()
      .single();

    if (error) {
      alert(`doc 생성 에러: ${error.message}`);
      return;
    }

    setDoc(data as ExpenseDoc);
    setSelectedItemId(null);
  };

  /** 품목 수동 추가 */
  const addItem = async () => {
    if (!doc?.id) {
      alert("먼저 문서(doc)를 생성/선택하세요.");
      return;
    }

    const { error } = await supabase.from("expense_items").insert([
      {
        doc_id: doc.id,
        evidence_no: evidenceNo,
        item_name: itemName,
        qty,
        unit_price: null,
        amount: null,
        used_at: null,
      },
    ]);

    if (error) {
      alert(`item 추가 에러: ${error.message}`);
      return;
    }

    await loadItems(doc.id);
  };

  /** 엑셀 업로드 (기존 로직 그대로 유지) */
  const importExcelToItems = async (file: File) => {
    // 👉 당신 코드 그대로 (변경 없음)
  };

  return (
    <main style={{ padding: 16 }}>
      <h1>안전관리비 관리(1단계: 문서/품목 + 사진)</h1>

      {/* 1) 문서 */}
      <section style={{ marginTop: 16, padding: 12, border: "1px solid #333" }}>
        <h2>1) 문서(doc) 생성</h2>

        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <input value={siteName} onChange={(e) => setSiteName(e.target.value)} />
          <input value={monthKey} onChange={(e) => setMonthKey(e.target.value)} />
          <button onClick={createDoc}>문서 생성</button>
          <button onClick={loadLatestDoc}>최근 문서 불러오기</button>
        </div>

        <div style={{ marginTop: 8 }}>
          <b>현재 문서:</b>{" "}
          {doc ? `${doc.site_name} / ${doc.month_key}` : "없음"}
        </div>
      </section>

      {/* 3) 품목 리스트 */}
      <section style={{ marginTop: 16, padding: 12, border: "1px solid #333" }}>
        <h2>3) 품목 리스트 (행 선택)</h2>

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

      {/* 4) 사진 업로드 */}
      <section style={{ marginTop: 16, padding: 12, border: "1px solid #333" }}>
        <h2>4) 사진 업로드</h2>

        {selectedItemId ? (
          <PhotoSection expenseItemId={selectedItemId} />
        ) : (
          <div>먼저 위에서 품목을 선택하세요.</div>
        )}
      </section>
    </main>
  );
}
