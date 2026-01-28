"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import ItemCombobox, { ExpenseItem } from "@/components/ItemCombobox";
import PhotoSection from "@/components/PhotoSection";

/**
 * [목표]
 * - 문서(doc) 선택
 * - 품목(item) 로드
 * - 품목 선택(타이핑 가능)에서 "품명 중복 제거" 확정
 * - 선택 후 PhotoSection(docId,itemId)로 사진 슬롯 불러오기
 *
 * [핵심]
 * - 지금 화면이 /photos-test 라우트라면 이 파일이 진짜 렌더 소스입니다.
 * - 여기서 ItemCombobox dedupeBy="item_name"로 고정합니다.
 */

type ExpenseDoc = {
  id: string;
  site_name: string;
  month_key: string;
};

export default function PhotosTestPage() {
  const [docs, setDocs] = useState<ExpenseDoc[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  const [items, setItems] = useState<ExpenseItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const [loadingDocs, setLoadingDocs] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // StrictMode 2회 방지
  const lastLoadedDocIdRef = useRef<string | null>(null);

  async function loadDocs() {
    setLoadingDocs(true);
    setErrorMsg(null);
    try {
      const { data, error } = await supabase
        .from("expense_docs")
        .select("id, site_name, month_key")
        .order("month_key", { ascending: false });

      if (error) throw error;

      const nextDocs = (data ?? []) as ExpenseDoc[];
      setDocs(nextDocs);

      if (!selectedDocId && nextDocs.length > 0) {
        setSelectedDocId(nextDocs[0].id);
      }
    } catch (e: any) {
      setErrorMsg(e?.message ?? "문서 로드 실패");
    } finally {
      setLoadingDocs(false);
    }
  }

  async function loadItems(docId: string) {
    setLoadingItems(true);
    setErrorMsg(null);
    try {
      const { data, error } = await supabase
        .from("expense_items")
        .select("id, doc_id, evidence_no, item_name, qty, unit_price, amount, used_at")
        .eq("doc_id", docId)
        .order("evidence_no", { ascending: true });

      if (error) throw error;

      // ✅ 치환 (누적 금지)
      const nextItems = (data ?? []) as ExpenseItem[];
      setItems(nextItems);

      // 문서 바뀌면 선택 초기화
      setSelectedItemId(null);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "품목 로드 실패");
      setItems([]);
      setSelectedItemId(null);
    } finally {
      setLoadingItems(false);
    }
  }

  useEffect(() => {
    void loadDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedDocId) return;

    if (lastLoadedDocIdRef.current === selectedDocId) return;
    lastLoadedDocIdRef.current = selectedDocId;

    void loadItems(selectedDocId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDocId]);

  return (
    <main style={{ padding: 16, maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 12 }}>
        안전관리비 사진 업로드 (photos-test)
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

      {/* 품목 선택 */}
      <section style={{ marginBottom: 16 }}>
        <div
          style={{
            padding: 8,
            border: "2px solid red",
            borderRadius: 8,
            marginBottom: 8,
            fontSize: 13,
          }}
        >
          ✅ DEBUG: 이 페이지는 <b>/photos-test</b> 라우트입니다. (이 박스가 보이면 이 파일이 렌더링 중)
        </div>

        {!selectedDocId ? (
          <div style={{ fontSize: 13, opacity: 0.8 }}>문서를 먼저 선택하시면 품목 선택이 활성화됩니다.</div>
        ) : loadingItems ? (
          <div style={{ fontSize: 13, opacity: 0.8 }}>품목 불러오는 중...</div>
        ) : (
          <ItemCombobox
            items={items}
            value={selectedItemId}
            onChange={setSelectedItemId}
            dedupeBy="item_name" // ✅ 품명 기준 중복 제거
            placeholder="품목 선택(타이핑 가능)"
          />
        )}
      </section>

      {/* 사진 섹션 */}
      {selectedDocId && selectedItemId ? (
        <section style={{ marginTop: 16 }}>
          <PhotoSection docId={selectedDocId} itemId={selectedItemId} />
        </section>
      ) : (
        <div style={{ fontSize: 13, opacity: 0.8 }}>
          품목을 선택하면 아래에 반입/지급·설치 사진 슬롯이 표시됩니다.
        </div>
      )}
    </main>
  );
}
