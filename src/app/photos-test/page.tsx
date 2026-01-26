"use client";

import { useState } from "react";

export default function PhotosTestPage() {
  // ✅ 방금 확인된 expense_items.id (uuid)
  const expenseItemId = "a7b3d9ca-2d5d-4112-ba4c-536b480143e2";

  const [msg, setMsg] = useState("");

  async function upload(kind: "inbound" | "issue_install", slot: number, file: File) {
    setMsg("업로드 중...");

    const formData = new FormData();
    formData.append("expenseItemId", expenseItemId);
    formData.append("kind", kind);
    formData.append("slot", String(slot));
    formData.append("file", file);

    const res = await fetch("/api/photos/upload", { method: "POST", body: formData });
    const json = await res.json();

    if (!res.ok || !json.ok) {
      setMsg(`실패: ${json.error ?? "알 수 없음"}`);
      return;
    }

    setMsg("성공: 업로드 완료");
  }

  return (
    <div style={{ padding: 16 }}>
      <h2>사진 업로드 테스트</h2>
      <div style={{ marginBottom: 12 }}>expenseItemId: {expenseItemId}</div>

      <div style={{ marginBottom: 16, padding: 12, border: "1px solid #333" }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>반입 사진 (inbound, slot=0)</div>
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

      <div style={{ padding: 12, border: "1px solid #333" }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>지급·설치 (issue_install, slot 0~3)</div>

        {[0, 1, 2, 3].map((slot) => (
          <div key={slot} style={{ marginBottom: 10 }}>
            <div style={{ marginBottom: 4 }}>slot={slot}</div>
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

      {msg ? <div style={{ marginTop: 12 }}>{msg}</div> : null}
    </div>
  );
}
