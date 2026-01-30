"use client";

/**
 * ExpensePage - 품목 리스트 + 사진 업로드
 * - 최근 문서 자동 로드
 * - 품목 선택 → PhotoSection
 */

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import PhotoSection from "@/components/PhotoSection";
import Link from "next/link";

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
};

export default function ExpensePage() {
  const [doc, setDoc] = useState<ExpenseDoc | null>(null);
  const [items, setItems] = useState<ExpenseItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>문서/사진 관리</h1>
        <Link href="/" style={{ fontSize: 14, color: "#06c" }}>← 품목 관리(메인)</Link>
      </div>

      {doc && (
        <p style={{ marginBottom: 16, color: "inherit", opacity: 0.85 }}>
          현재 문서: <b>{doc.site_name}</b> / {doc.month_key}
        </p>
      )}

      {/* 품목 리스트 */}
      <section style={{ marginBottom: 16, padding: 12, border: "1px solid #333" }}>
        <h2 style={{ margin: "0 0 12px 0" }}>품목 리스트 (행 선택)</h2>

        {!doc?.id ? (
          <div>문서가 없습니다. 메인 페이지에서 문서를 생성하고 엑셀을 업로드하세요.</div>
        ) : (
          <>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {items.map((it) => (
                <li key={it.id}>
                  <label
                    style={{
                      display: "block",
                      padding: "8px 12px",
                      cursor: "pointer",
                      border: selectedItemId === it.id ? "2px solid #06c" : "1px solid #ddd",
                      borderRadius: 8,
                      marginBottom: 6,
                    }}
                  >
                    <input
                      type="radio"
                      checked={selectedItemId === it.id}
                      onChange={() => setSelectedItemId(it.id)}
                      style={{ marginRight: 8 }}
                    />
                    <b>NO.{it.evidence_no}</b> / {it.item_name} / 수량 {it.qty}
                  </label>
                </li>
              ))}
            </ul>
            {items.length === 0 && <div style={{ padding: 12, color: "#666" }}>품목이 없습니다.</div>}
          </>
        )}
      </section>

      {/* 사진 업로드 */}
      <section style={{ padding: 12, border: "1px solid #333" }}>
        <h2 style={{ margin: "0 0 12px 0" }}>사진 업로드</h2>

        {!doc?.id ? (
          <div>문서를 먼저 불러오세요.</div>
        ) : !selectedItemId ? (
          <div>위에서 품목을 선택하세요.</div>
        ) : (
          <PhotoSection docId={doc.id} itemId={selectedItemId} />
        )}
      </section>
    </main>
  );
}
