"use client";

import { useMemo, useState } from "react";

/**
 * [1단계 목표]
 * - 사진 선택 즉시 화면에 썸네일 미리보기
 * - 지급/설치 사진: 최대 4장 제한
 * - "초과 업로드"는 프론트에서 즉시 차단
 *
 * [주의]
 * - 아직 Supabase 업로드/DB 저장은 하지 않습니다.
 * - 다음 단계에서 반입사진 1장(교체만) / 지급·설치 4분할(최대4장)로 나눕니다.
 */

export default function Page() {
  const MAX = 4;

  const [files, setFiles] = useState<File[]>([]);

  // 브라우저 메모리 누수 방지: URL은 useMemo로 만들고, 파일 변경 시 재생성
  const previews = useMemo(() => {
    return files.map((f) => ({
      name: f.name,
      url: URL.createObjectURL(f),
    }));
  }, [files]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list) return;

    const selected = Array.from(list);

    // 남은 슬롯 계산
    const remain = MAX - files.length;

    if (selected.length > remain) {
      alert(`지급/설치 사진은 최대 ${MAX}장입니다. (현재 ${files.length}장, 추가 가능 ${remain}장)`);
      e.target.value = ""; // 같은 파일 다시 선택 가능하게 초기화
      return;
    }

    setFiles((prev) => [...prev, ...selected]);
    e.target.value = "";
  };

  const onClearAll = () => {
    setFiles([]);
  };

  return (
    <main style={{ padding: 16, maxWidth: 480, margin: "0 auto" }}>
      <div style={{ color: "yellow", fontWeight: 800 }}>PHOTOSECTION TEST 123</div>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
        1단계: 사진 썸네일 미리보기 (최대 4장)
      </h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <label
          style={{
            display: "inline-block",
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #444",
            cursor: "pointer",
          }}
        >
          사진 선택
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={onPick}
            style={{ display: "none" }}
          />
        </label>

        <button
          onClick={onClearAll}
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #444",
            cursor: "pointer",
            background: "transparent",
          }}
        >
          전체 삭제
        </button>
      </div>

      <div style={{ marginBottom: 10, fontSize: 13 }}>
        현재 {files.length} / {MAX}장
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
        }}
      >
        {previews.map((p, idx) => (
          <div
            key={idx}
            style={{
              border: "1px solid #333",
              borderRadius: 10,
              overflow: "hidden",
              background: "#111",
            }}
          >
            <img
              src={p.url}
              alt={p.name}
              style={{ width: "100%", height: 160, objectFit: "cover" }}
            />
            <div style={{ fontSize: 11, padding: 6, opacity: 0.8 }}>
              {p.name}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
