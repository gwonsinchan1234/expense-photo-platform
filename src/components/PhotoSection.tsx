"use client";

import { useEffect, useState } from "react";

type SlotKey =
  | "inbound"
  | "install0"
  | "install1"
  | "install2"
  | "install3";

type SlotState = {
  file: File | null;
  previewUrl: string | null;
};

const emptySlots: Record<SlotKey, SlotState> = {
  inbound: { file: null, previewUrl: null },
  install0: { file: null, previewUrl: null },
  install1: { file: null, previewUrl: null },
  install2: { file: null, previewUrl: null },
  install3: { file: null, previewUrl: null },
};

export default function PhotoSection({
  expenseItemId,
}: {
  expenseItemId: string;
}) {
  const [slots, setSlots] = useState<Record<SlotKey, SlotState>>(emptySlots);

  /** 메모리 누수 방지 */
  useEffect(() => {
    return () => {
      Object.values(slots).forEach((s) => {
        if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
      });
    };
  }, [slots]);

  const setFile = (key: SlotKey, file: File | null) => {
    setSlots((prev) => {
      const old = prev[key];
      if (old.previewUrl) URL.revokeObjectURL(old.previewUrl);

      if (!file) {
        return { ...prev, [key]: { file: null, previewUrl: null } };
      }

      return {
        ...prev,
        [key]: { file, previewUrl: URL.createObjectURL(file) },
      };
    });
  };

  const onPick =
    (key: SlotKey) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      setFile(key, file);
      e.target.value = "";
    };

  return (
    <section style={{ border: "1px solid #333", padding: 12, borderRadius: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>
        사진 업로드 (item.id 기준)
      </div>

      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 12 }}>
        expenseItemId: {expenseItemId}
      </div>

      {/* 반입 사진 */}
      <h4>반입 사진 (1장)</h4>
      <Slot
        title="반입"
        slot={slots.inbound}
        onPick={onPick("inbound")}
        onDelete={() => setFile("inbound", null)}
      />

      <div style={{ height: 12 }} />

      {/* 지급/설치 사진 */}
      <h4>지급·설치 사진 (최대 4장)</h4>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {(["install0", "install1", "install2", "install3"] as SlotKey[]).map(
          (key, i) => (
            <Slot
              key={key}
              title={`slot ${i}`}
              slot={slots[key]}
              onPick={onPick(key)}
              onDelete={() => setFile(key, null)}
            />
          )
        )}
      </div>
    </section>
  );
}

function Slot({
  title,
  slot,
  onPick,
  onDelete,
}: {
  title: string;
  slot: SlotState;
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDelete: () => void;
}) {
  return (
    <div style={{ border: "1px solid #444", padding: 10, borderRadius: 10 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{title}</div>

      <div
        style={{
          width: "100%",
          height: 120,
          border: "1px solid #333",
          borderRadius: 8,
          marginBottom: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#111",
        }}
      >
        {slot.previewUrl ? (
          <img
            src={slot.previewUrl}
            alt="preview"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <span style={{ fontSize: 12, opacity: 0.6 }}>미리보기 없음</span>
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <label style={btnStyle}>
          {slot.file ? "교체" : "선택"}
          <input
            type="file"
            accept="image/*"
            onChange={onPick}
            style={{ display: "none" }}
          />
        </label>

        <button
          type="button"
          onClick={onDelete}
          disabled={!slot.file}
          style={{ ...btnStyle, opacity: slot.file ? 1 : 0.4 }}
        >
          삭제
        </button>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid #444",
  background: "transparent",
  cursor: "pointer",
  fontSize: 12,
};
