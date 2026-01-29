"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Kind = "inbound" | "install";
type SlotKey = "inbound" | "install0" | "install1" | "install2" | "install3";

type SlotState = {
  file: File | null;
  url: string | null; // blob 또는 signedUrl
  name: string | null;
  uploading: boolean;
};

type ApiRow = {
  id: string;
  kind: Kind;
  slot_index: number;
  storage_path: string;
  signedUrl: string;
};

const empty = (): Record<SlotKey, SlotState> => ({
  inbound: { file: null, url: null, name: null, uploading: false },
  install0: { file: null, url: null, name: null, uploading: false },
  install1: { file: null, url: null, name: null, uploading: false },
  install2: { file: null, url: null, name: null, uploading: false },
  install3: { file: null, url: null, name: null, uploading: false },
});

function mapKey(k: SlotKey): { kind: Kind; slotIndex: number } {
  if (k === "inbound") return { kind: "inbound", slotIndex: 0 };
  return { kind: "install", slotIndex: Number(k.replace("install", "")) };
}

function keyFromRow(kind: Kind, slotIndex: number): SlotKey | null {
  if (kind === "inbound") return slotIndex === 0 ? "inbound" : null;
  if (kind === "install") {
    if (slotIndex < 0 || slotIndex > 3) return null;
    return `install${slotIndex}` as SlotKey;
  }
  return null;
}

function isBlobUrl(url: string | null) {
  return !!url && url.startsWith("blob:");
}

export default function PhotoSection({ docId, itemId }: { docId: string; itemId: string }) {
  const [slots, setSlots] = useState<Record<SlotKey, SlotState>>(empty());
  const allKeys: SlotKey[] = useMemo(() => ["inbound", "install0", "install1", "install2", "install3"], []);

  // 언마운트 정리(1회)
  const slotsRef = useRef(slots);
  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);

  useEffect(() => {
    return () => {
      const cur = slotsRef.current;
      Object.values(cur).forEach((s) => {
        if (isBlobUrl(s.url)) URL.revokeObjectURL(s.url!);
      });
    };
  }, []);

  // doc/item 바뀌면 초기화 + blob 정리
  useEffect(() => {
    setSlots((prev) => {
      Object.values(prev).forEach((s) => {
        if (isBlobUrl(s.url)) URL.revokeObjectURL(s.url!);
      });
      return empty();
    });
  }, [docId, itemId]);

  // ✅ 기존 사진 로드: GET /api/photos/upload?docId&itemId => signedUrl 사용
  useEffect(() => {
    const load = async () => {
      if (!docId || !itemId) return;

      try {
        const res = await fetch(`/api/photos?docId=${docId}&itemId=${itemId}`);
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) throw new Error(json?.message || "기존 사진 조회 실패");

        const rows: ApiRow[] = json.rows ?? [];

        setSlots((prev) => {
          const next = { ...prev };

          for (const r of rows) {
            const k = keyFromRow(r.kind, r.slot_index);
            if (!k) continue;

            const cur = next[k];

            // 사용자가 로컬 선택(=blob) 중이면 덮어쓰지 않음
            if (isBlobUrl(cur.url)) continue;

            next[k] = { ...cur, url: r.signedUrl, name: cur.name ?? "uploaded", file: null, uploading: false };
          }

          return next;
        });
      } catch (e: any) {
        console.error(e?.message ?? e);
      }
    };

    load();
  }, [docId, itemId]);

  const setFile = (key: SlotKey, file: File | null) => {
    setSlots((prev) => {
      const old = prev[key];
      if (isBlobUrl(old.url)) URL.revokeObjectURL(old.url!); // 교체/삭제 시만 정리

      if (!file) return { ...prev, [key]: { file: null, url: null, name: null, uploading: false } };

      const url = URL.createObjectURL(file);
      return { ...prev, [key]: { file, url, name: file.name, uploading: false } };
    });
  };

  const onPick = (key: SlotKey) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("이미지 파일만 선택 가능합니다.");
      e.currentTarget.value = "";
      return;
    }

    setFile(key, file);
    e.currentTarget.value = "";
  };

  const uploadOne = async (key: SlotKey) => {
    const s = slots[key];
    if (!s.file) return alert("먼저 이미지를 선택하세요.");
    if (!docId) return alert("docId가 없습니다.");
    if (!itemId) return alert("itemId가 없습니다. (행 선택 후 진행)");

    const { kind, slotIndex } = mapKey(key);

    setSlots((prev) => ({ ...prev, [key]: { ...prev[key], uploading: true } }));

    try {
      const fd = new FormData();
      fd.append("docId", docId);
      fd.append("itemId", itemId);
      fd.append("kind", kind);
      fd.append("slotIndex", String(slotIndex));
      fd.append("file", s.file);

      const res = await fetch("/api/photos/upload", { method: "POST", body: fd });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) throw new Error(json?.message || `업로드 실패(HTTP ${res.status})`);

      const signedUrl: string | undefined = json?.signedUrl;

      setSlots((prev) => {
        const cur = prev[key];
        if (signedUrl && isBlobUrl(cur.url)) URL.revokeObjectURL(cur.url!); // blob -> signed
        return { ...prev, [key]: { ...cur, uploading: false, url: signedUrl ?? cur.url, file: null, name: cur.name ?? "uploaded" } };
      });
    } catch (e: any) {
      setSlots((prev) => ({ ...prev, [key]: { ...prev[key], uploading: false } }));
      alert(e?.message ?? "서버 오류");
    }
  };

  const uploadAllSelected = async () => {
    for (const k of allKeys) {
      if (slots[k].file) {
 
        await uploadOne(k);
      }
    }
  };

  const Slot = ({ title, k }: { title: string; k: SlotKey }) => {
    const s = slots[k];
    const hasFile = !!s.file;

    return (
      <div style={{ border: "1px solid #333", borderRadius: 14, overflow: "hidden", background: "#111", color: "#fff" }}>
        <div style={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <b style={{ fontSize: 13 }}>{title}</b>
          <span style={{ fontSize: 12, opacity: 0.75 }}>
            {s.uploading ? "업로드중..." : hasFile ? "선택됨" : s.url ? "등록됨" : "미선택"}
          </span>
        </div>

        <div style={{ width: "100%", height: 160, background: "#0d0d0d", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {s.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.url} alt={s.name ?? "preview"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <span style={{ fontSize: 12, opacity: 0.6 }}>미리보기 없음</span>
          )}
        </div>

        <div style={{ padding: 10, fontSize: 12, opacity: 0.8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {s.name ?? (s.url ? "uploaded" : "파일 없음")}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: 10 }}>
          <label style={{ border: "1px solid #444", borderRadius: 12, padding: 10, textAlign: "center", cursor: "pointer" }}>
            {hasFile ? "교체" : "선택"}
            <input type="file" accept="image/*" onChange={onPick(k)} style={{ display: "none" }} />
          </label>

          <button
            type="button"
            onClick={() => uploadOne(k)}
            disabled={!hasFile || s.uploading}
            style={{
              border: "1px solid #444",
              borderRadius: 12,
              padding: 10,
              opacity: !hasFile || s.uploading ? 0.4 : 1,
              cursor: !hasFile || s.uploading ? "not-allowed" : "pointer",
              background: "transparent",
              color: "#fff",
            }}
          >
            업로드
          </button>
        </div>
      </div>
    );
  };

  return (
    <section style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <div style={{ fontWeight: 800, color: "#fff" }}>사진 업로드</div>
        <div style={{ fontSize: 12, opacity: 0.75, wordBreak: "break-all", color: "#fff" }}>
          docId: {docId} / itemId: {itemId}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={uploadAllSelected}
          style={{ border: "1px solid #444", borderRadius: 12, padding: "10px 12px", background: "transparent", color: "#fff", cursor: "pointer" }}
        >
          선택된 사진 전체 업로드
        </button>
      </div>

      <div style={{ marginTop: 6, marginBottom: 2, fontWeight: 800, fontSize: 13, color: "#fff" }}>반입 사진 (1장)</div>
      <Slot title="반입 (slotIndex=0 고정)" k="inbound" />

      <div style={{ marginTop: 10, marginBottom: 2, fontWeight: 800, fontSize: 13, color: "#fff" }}>지급·설치 사진 (최대 4장)</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Slot title="지급·설치 slot 0" k="install0" />
        <Slot title="지급·설치 slot 1" k="install1" />
        <Slot title="지급·설치 slot 2" k="install2" />
        <Slot title="지급·설치 slot 3" k="install3" />
      </div>
    </section>
  );
}
