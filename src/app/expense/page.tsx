"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import PhotoSection from "@/components/PhotoSection";

/**
 * [기능]
 * - 품목 리스트 로딩
 * - 타이핑으로 검색(자동완성)
 * - 클릭 또는 Enter로 품목 선택
 * - 선택된 itemId로 doc_id 단건 조회
 * - docId + itemId로 PhotoSection 렌더링
 *
 * [주의]
 * - CSS는 나중에. 지금은 기능만 안정화
 */

const ITEM_TABLE = "expense_items";

type ExpenseItemLite = {
  id: string;
  item_name: string;
};

export default function ExpensePage() {
  const [items, setItems] = useState<ExpenseItemLite[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  const [query, setQuery] = useState(""); // 타이핑 입력값
  const [open, setOpen] = useState(false); // 자동완성 목록 열림/닫힘
  const [activeIndex, setActiveIndex] = useState(0); // 키보드 선택 인덱스

  const [selectedItem, setSelectedItem] = useState<ExpenseItemLite | null>(null);

  const [docId, setDocId] = useState<string>("");
  const [loadingDoc, setLoadingDoc] = useState<boolean>(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 1) 품목 로딩
  useEffect(() => {
    const load = async () => {
      setLoadingItems(true);

      const { data, error } = await supabase
        .from(ITEM_TABLE)
        .select("id, item_name")
        .order("created_at", { ascending: true })
        .limit(500);

      setLoadingItems(false);

      if (error) {
        console.error("품목 목록 조회 실패:", error.message);
        return;
      }

      setItems((data as ExpenseItemLite[]) ?? []);
    };

    load();
  }, []);

  // 2) 검색 결과(타이핑 필터)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 20);

    // 포함 검색(초기 버전). 나중에 초성검색 등 고도화 가능
    const list = items.filter((it) => it.item_name.toLowerCase().includes(q));
    return list.slice(0, 20);
  }, [items, query]);

  // 3) 선택 -> doc_id 단건 조회
  useEffect(() => {
    const run = async () => {
      if (!selectedItem?.id) {
        setDocId("");
        return;
      }

      setLoadingDoc(true);
      setDocId("");

      const { data, error } = await supabase
        .from(ITEM_TABLE)
        .select("doc_id")
        .eq("id", selectedItem.id)
        .maybeSingle();

      setLoadingDoc(false);

      if (error) {
        console.error("doc_id 조회 실패:", error.message);
        return;
      }

      setDocId((data as any)?.doc_id ?? "");
    };

    run();
  }, [selectedItem?.id]);

  const pick = (it: ExpenseItemLite) => {
    setSelectedItem(it);
    setQuery(it.item_name); // 입력칸에 선택값 반영
    setOpen(false);
  };

  // 바깥 클릭하면 닫기
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = wrapRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  // 키보드 조작
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === "ArrowDown") setOpen(true);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((v) => Math.min(v + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((v) => Math.max(v - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = filtered[activeIndex];
      if (target) pick(target);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <main style={{ padding: 16, display: "grid", gap: 16 }}>
      <h2>안전관리비 사진 업로드</h2>

      <div ref={wrapRef} style={{ display: "grid", gap: 8, position: "relative" }}>
        <label style={{ fontWeight: 700 }}>품목 선택(타이핑 가능)</label>

        <input
          ref={inputRef}
          value={query}
          placeholder={loadingItems ? "불러오는 중..." : "예: 안전화, 위험테이프 ..."}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(0);
            // 입력을 바꾸면 기존 선택 해제(혼동 방지)
            setSelectedItem(null);
            setDocId("");
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          style={{ padding: 10, borderRadius: 8, border: "1px solid #444", background: "transparent", color: "#fff" }}
        />

        {/* 자동완성 목록 */}
        {open && (
          <div
            style={{
              position: "absolute",
              top: 72,
              left: 0,
              right: 0,
              border: "1px solid #444",
              borderRadius: 8,
              background: "#111",
              maxHeight: 260,
              overflow: "auto",
              zIndex: 50,
            }}
          >
            {filtered.length === 0 ? (
              <div style={{ padding: 10, fontSize: 13, opacity: 0.8, color: "#fff" }}>검색 결과 없음</div>
            ) : (
              filtered.map((it, idx) => (
                <div
                  key={it.id}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onMouseDown={(e) => {
                    // blur로 닫히기 전에 선택되도록 mousedown 사용
                    e.preventDefault();
                    pick(it);
                  }}
                  style={{
                    padding: 10,
                    cursor: "pointer",
                    color: "#fff",
                    background: idx === activeIndex ? "#222" : "transparent",
                    borderBottom: "1px solid #222",
                  }}
                >
                  {it.item_name}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* 상태 표시 */}
      <div style={{ padding: 12, border: "1px solid #444", borderRadius: 8, color: "#fff" }}>
        <div style={{ fontSize: 12, opacity: 0.85 }}>
          itemId: {selectedItem?.id ?? "(미선택)"} / item: {selectedItem?.item_name ?? "(미선택)"}
        </div>
        <div style={{ fontSize: 12, opacity: 0.85 }}>
          docId: {loadingDoc ? "조회중..." : docId ? docId : "(비어있음)"}
        </div>
      </div>

      {/* 사진 업로드 */}
      {selectedItem?.id && docId && <PhotoSection docId={docId} itemId={selectedItem.id} />}

      {/* docId 없음 경고 */}
      {selectedItem?.id && !loadingDoc && !docId && (
        <div style={{ padding: 12, border: "1px solid #f00", borderRadius: 8, color: "#fff" }}>
          docId가 비어있습니다. 해당 item 행의 doc_id가 NULL이거나 조회가 막혔습니다.
        </div>
      )}
    </main>
  );
}
