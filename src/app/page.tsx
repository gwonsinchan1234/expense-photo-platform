"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import PhotoSection from "@/components/PhotoSection";

const ITEM_TABLE = "expense_items";

type ExpenseItemLite = {
  id: string;
  item_name: string;
};

export default function ExpensePage() {
  const [items, setItems] = useState<ExpenseItemLite[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string>("");

  const [docId, setDocId] = useState<string>("");
  const [loadingDoc, setLoadingDoc] = useState<boolean>(false);

  // 1) 목록 로드 + "첫 번째 id" 확인용
  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from(ITEM_TABLE)
        .select("id, item_name")
        .order("created_at", { ascending: true })
        .limit(50);

      console.log("[LIST] error:", error?.message ?? null);
      console.log("[LIST] count:", (data as any[])?.length ?? 0);
      console.log("[LIST] first row:", (data as any[])?.[0] ?? null);

      if (error) return;
      setItems((data as ExpenseItemLite[]) ?? []);
    };

    load();
  }, []);

  // 2) 선택된 ID로 실제 row가 있는지 2단계 확인(진단)
  useEffect(() => {
    const run = async () => {
      if (!selectedItemId) {
        setDocId("");
        return;
      }

      setLoadingDoc(true);
      setDocId("");

      console.log("[PICK] selectedItemId:", selectedItemId);

      // (A) id 존재 여부(최소 조회)
      const exist = await supabase
        .from(ITEM_TABLE)
        .select("id")
        .eq("id", selectedItemId)
        .maybeSingle();

      console.log("[EXIST] error:", exist.error?.message ?? null);
      console.log("[EXIST] data:", exist.data ?? null);

      // (B) doc_id 조회
      const q = await supabase
        .from(ITEM_TABLE)
        .select("doc_id")
        .eq("id", selectedItemId)
        .maybeSingle();

      setLoadingDoc(false);

      console.log("[DOC] error:", q.error?.message ?? null);
      console.log("[DOC] data:", q.data ?? null);

      if (q.error) return;

      // doc_id가 null이면 그대로 null -> docId 없음이 정상
      setDocId((q.data as any)?.doc_id ?? "");
    };

    run();
  }, [selectedItemId]);

  return (
    <main style={{ padding: 16, display: "grid", gap: 16 }}>
      <h2>안전관리비 사진 업로드</h2>

      <div style={{ display: "grid", gap: 8 }}>
        <label style={{ fontWeight: 600 }}>품목 선택</label>

        <select
          value={selectedItemId}
          onChange={(e) => setSelectedItemId(e.target.value)}
          style={{ padding: 10, borderRadius: 8 }}
        >
          <option value="">-- 품목을 선택하세요 --</option>
          {items.map((it) => (
            <option key={it.id} value={it.id}>
              {it.item_name}
            </option>
          ))}
        </select>
      </div>

      {selectedItemId && (
        <div style={{ padding: 12, border: "1px solid #444", borderRadius: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.85 }}>itemId: {selectedItemId}</div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>
            docId: {loadingDoc ? "조회중..." : docId ? docId : "(비어있음)"}
          </div>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
            콘솔(F12)에서 [EXIST]/[DOC] 로그를 확인하세요.
          </div>
        </div>
      )}

      {selectedItemId && docId && <PhotoSection docId={docId} itemId={selectedItemId} />}

      {selectedItemId && !loadingDoc && !docId && (
        <div style={{ padding: 12, border: "1px solid #f00", borderRadius: 8 }}>
          docId가 비어있습니다. 아래 원인 중 하나입니다.
          <br />
          1) 선택된 ID가 expense_items.id가 아님(다른 테이블의 id를 넘김)
          <br />
          2) expense_items의 doc_id 값이 실제로 NULL
          <br />
          3) RLS/권한으로 select가 막힘(콘솔에 error 메시지 표시됨)
        </div>
      )}
    </main>
  );
}
