"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type ExpenseItem = {
  id: string;
  doc_id: string;
  evidence_no: number;
  item_name: string;
  qty: number;
  unit_price: number | null;
  amount: number | null;
  used_at: string | null;
};

type Props = {
  items: ExpenseItem[];
  value: string | null;
  onChange: (nextItemId: string | null) => void;
  dedupeBy?: "item_name" | "evidence_no" | "id";
  placeholder?: string;
};

/**
 * [핵심]
 * - "item_name" 기준 dedupe를 가장 강하게 적용
 *   (공백/대소문자/제로폭/유니코드 정규화 차이까지 제거)
 * - 드롭다운 상단에 상태줄을 "강제로" 표시해서
 *   지금 화면이 이 컴포넌트인지 즉시 판별 가능하게 함
 */
export default function ItemCombobox({
  items,
  value,
  onChange,
  dedupeBy = "item_name",
  placeholder = "품목 선택(타이핑 가능)",
}: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const uniqueItems = useMemo(() => {
    if (!items || items.length === 0) return [];

    // 1) id
    if (dedupeBy === "id") {
      return Array.from(new Map(items.map((it) => [it.id, it])).values());
    }

    // 2) evidence_no
    if (dedupeBy === "evidence_no") {
      const map = new Map<string, ExpenseItem>();
      for (const it of items) {
        const key =
          Number.isFinite(it.evidence_no) && it.evidence_no > 0
            ? `no:${it.evidence_no}`
            : `id:${it.id}`;
        if (!map.has(key)) map.set(key, it);
      }
      return Array.from(map.values());
    }

    // 3) item_name (제로폭/정규화/공백 제거까지)
    const map = new Map<string, ExpenseItem>();
    for (const it of items) {
      const key = `name:${normalizeKey(it.item_name)}`;
      if (!map.has(key)) map.set(key, it);
    }
    return Array.from(map.values());
  }, [items, dedupeBy]);

  const filtered = useMemo(() => {
    const query = normalizeKey(q);
    if (!query) return uniqueItems;
    return uniqueItems.filter((it) => normalizeKey(renderLabel(it)).includes(query));
  }, [uniqueItems, q]);

  const selectedItem = useMemo(() => {
    if (!value) return null;
    return uniqueItems.find((it) => it.id === value) ?? null;
  }, [uniqueItems, value]);

  return (
    <div ref={wrapperRef} style={{ position: "relative", width: "100%" }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{placeholder}</div>

      <input
        value={open ? q : selectedItem ? renderLabel(selectedItem) : ""}
        placeholder={selectedItem ? renderLabel(selectedItem) : "검색어 입력 후 선택"}
        onFocus={() => {
          setOpen(true);
          setQ("");
        }}
        onChange={(e) => {
          setOpen(true);
          setQ(e.target.value);
        }}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 10,
          border: "2px solid #f59e0b", // ✅ 눈에 띄게: 지금 컴포넌트 맞는지 확인용
          outline: "none",
        }}
      />

      {open && (
        <div
          style={{
            position: "absolute",
            zIndex: 9999,
            left: 0,
            right: 0,
            marginTop: 8,
            border: "2px solid #f59e0b", // ✅ 눈에 띄게
            borderRadius: 12,
            background: "#111",
            color: "#fff",
            overflow: "hidden",
            maxHeight: 320,
          }}
        >
          {/* ✅ 상단 상태줄(이게 스샷에 안 보이면, 다른 컴포넌트입니다) */}
          <div
            style={{
              padding: "10px 12px",
              fontSize: 12,
              background: "#000",
              borderBottom: "1px solid #222",
            }}
          >
            [ItemCombobox ACTIVE] dedupeBy={dedupeBy} / options={uniqueItems.length} / raw={items.length}
          </div>

          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 12, fontSize: 13, opacity: 0.8 }}>검색 결과 없음</div>
            ) : (
              filtered.map((it) => {
                const isSelected = it.id === value;
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => {
                      onChange(it.id);
                      setOpen(false);
                      setQ("");
                    }}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "12px 12px",
                      background: isSelected ? "#222" : "transparent",
                      color: "#fff",
                      border: "none",
                      borderBottom: "1px solid #1f1f1f",
                      cursor: "pointer",
                      fontSize: 14,
                    }}
                  >
                    {/* 품명만 표시 */}
                    {renderLabel(it)}
                  </button>
                );
              })
            )}
          </div>

          <div style={{ display: "flex", gap: 8, padding: 10, borderTop: "1px solid #222" }}>
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
                setQ("");
              }}
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #333",
                background: "#0b0b0b",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              선택 해제
            </button>

            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #333",
                background: "#0b0b0b",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function renderLabel(it: ExpenseItem) {
  return it.item_name;
}

/**
 * ✅ “겉보기 같은데 다른 문자열”까지 하나로 묶기 위한 강력 정규화
 * - 유니코드 정규화(NFKC)
 * - 모든 공백 제거(스페이스/탭/개행 등)
 * - 제로폭 문자 제거(U+200B~U+200D, U+FEFF)
 * - 소문자화
 */
function normalizeKey(s: string) {
  return (s ?? "")
    .toString()
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // zero-width
    .replace(/\s+/g, "") // 모든 공백 제거
    .trim()
    .toLowerCase();
}
