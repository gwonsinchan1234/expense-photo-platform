"use client";

/**
 * 사진 업로드 UI 컴포넌트
 * - 반입 사진: 1장 (slot=0)
 * - 지급·설치 사진: 최대 4장 (slot 0~3)
 * - 서버 API: /api/photos/upload
 */

import { useState } from "react";

type Props = {
  expenseItemId: string; // expense_items.id (uuid)
};

export default function PhotoUploader({ expenseItemId }: Props) {
  const [message, setMessage] = useState("");

  async function upload(
    kind: "inbound" | "issue_install",
    slot: number,
    file: File
  ) {
    setMessage("업로드 중...");

    const formData = new FormData();
    formData.append("expenseItemId", expenseItemId); // ★ 여기 UUID
    formData.append("kind", kind);
    formData.append("slot", String(slot));
    formData.append("file", file);

    const res = await fetch("/api/photos/upload", {
      method: "POST",
      body: formData,
    });

    const json = await res.json();

    if (!res.ok || !json.ok) {
      setMessage(`실패: ${json.error ?? "알 수 없음"}`);
      return;
    }

    setMessage("업로드 완료");
  }

  return (
    <div style={{ border: "1px solid #ccc", padding: 12, marginTop: 16 }}>
      <div style={{ marginBottom: 8 }}>
        <strong>사진 업로드</strong>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div>expenseItemId</div>
        <div style={{ fontSize: 12, color: "#666" }}>{expenseItemId}</div>
      </div>

      {/* 반입 사진 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          반입 사진 (slot = 0)
        </div>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            upload("inbound", 0, file);
            e.currentTarget.value = "";
          }}
        />
      </div>

      {/* 지급·설치 사진 */}
      <div>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>
          지급·설치 사진 (slot 0 ~ 3)
        </div>

        {[0, 1, 2, 3].map((slot) => (
          <div key={slot} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12 }}>slot = {slot}</div>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                upload("issue_install", slot, file);
                e.currentTarget.value = "";
              }}
            />
          </div>
        ))}
      </div>

      {message && (
        <div style={{ marginTop: 12, fontSize: 14 }}>{message}</div>
      )}
    </div>
  );
}
