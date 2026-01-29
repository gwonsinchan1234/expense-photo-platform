"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabaseClient";

/**
 * [핵심 수정 요약]
 * - 409/23505 원인: evidence_no(=NO)를 빈값일 때도 1로 강제 세팅해서 (doc_id, 1) 중복 Insert 발생
 * - 해결: NO가 비어 있으면 evidence_no 컬럼 자체를 DB로 보내지 않는다(=undefined / omit)
 */

const DOC_TABLE = "expense_docs";
const ITEM_TABLE = "expense_items";

type ExpenseDoc = {
  id: string;
  site_name: string;
  month_key: string;
};

type ExpenseItem = {
  id: string;
  doc_id: string;
  evidence_no: number; // DB가 채우거나, 엑셀에 있을 때만 전달
  item_name: string;
  qty: number;
  unit_price: number | null;
  amount: number | null;
  used_at: string | null;
};

type ImportWarning = {
  rowNumber: number;
  reason: string;
};

type InsertItem = {
  doc_id: string;
  item_name: string;
  qty: number;
  unit_price: number | null;
  amount: number | null;
  used_at: string | null;
  evidence_no?: number;
};

type PreviewRow = InsertItem & {
  rowNumber: number;
  source_item_name: string;
};

type TotalRowInfo = {
  rowNumber: number;
  qty: number | null;
  amount: number | null;
};

type ParseResult = {
  previewRows: PreviewRow[];
  warnings: ImportWarning[];
  totalRows: number;
  duplicateNoMessage: string | null;
  totalRow: TotalRowInfo | null;
};

const normalizeHeader = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()【】[\]{}]/g, "")
    .replace(/[.:·]/g, "");

const toNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = String(value).trim().replace(/,/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const toISODate = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    if (!d) return null;
    const yyyy = String(d.y).padStart(4, "0");
    const mm = String(d.m).padStart(2, "0");
    const dd = String(d.d).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  const s = String(value).trim();
  if (!s) return null;

  const m1 = s.match(/^(\d{2})\.(\d{1,2})\.(\d{1,2})$/);
  if (m1) {
    const yy = Number(m1[1]);
    const yyyy = yy >= 70 ? 1900 + yy : 2000 + yy;
    const mm = String(Number(m1[2])).padStart(2, "0");
    const dd = String(Number(m1[3])).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  const m2 = s.match(/^(\d{4})[-.](\d{1,2})[-.](\d{1,2})$/);
  if (m2) {
    const yyyy = m2[1];
    const mm = String(Number(m2[2])).padStart(2, "0");
    const dd = String(Number(m2[3])).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
};

const parseNumberInput = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
};

const computeDuplicateNoMessage = (rows: PreviewRow[]): string | null => {
  const noMap = new Map<number, number[]>();
  rows.forEach((row) => {
    if (typeof row.evidence_no !== "number") return;
    const list = noMap.get(row.evidence_no) ?? [];
    list.push(row.rowNumber);
    noMap.set(row.evidence_no, list);
  });

  const dupNos = Array.from(noMap.entries()).filter(([, list]) => list.length > 1);
  return dupNos.length > 0
    ? dupNos.map(([no, list]) => `NO ${no}: ${list.join(", ")}행`).join("\n")
    : null;
};

const parseExcelFile = async (file: File, docId: string): Promise<ParseResult> => {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new Error("엑셀 시트를 찾지 못했습니다.");
  }
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];

  const findHeaderRow = (r: unknown[][], scanMax = 40): number => {
    const keys = ["no", "증빙번호", "연번"];
    const itemKeys = ["품명", "품목", "품목명", "내용", "내역", "사용내역"];
    const qtyKeys = ["수량", "수량개", "수량ea"];
    const dateKeys = ["사용일자", "사용일", "일자", "발행일자"];
    const unitKeys = ["단가"];
    const amountKeys = ["금액", "사용금액", "합계"];

    let best = { idx: -1, score: 0 };

    for (let i = 0; i < Math.min(scanMax, r.length); i++) {
      const row = r[i].map(normalizeHeader);
      const hasItem = row.some((c) => itemKeys.includes(c));
      const hasQty = row.some((c) => qtyKeys.includes(c));

      let score = 0;
      if (row.some((c) => keys.includes(c))) score += 1;
      if (hasItem) score += 3;
      if (hasQty) score += 2;
      if (row.some((c) => dateKeys.includes(c))) score += 1;
      if (row.some((c) => unitKeys.includes(c))) score += 1;
      if (row.some((c) => amountKeys.includes(c))) score += 1;

      if (score > best.score) best = { idx: i, score };
    }
    return best.idx;
  };

  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) {
    throw new Error("엑셀 헤더 행을 찾지 못했습니다. (사용내역/수량/단가/금액/증빙번호 확인)");
  }

  const header = rows[headerIdx].map(normalizeHeader);

  const colIndex = (cands: string[]): number => {
    for (let i = 0; i < header.length; i++) {
      if (cands.includes(header[i])) return i;
    }
    return -1;
  };

  const cNo = colIndex(["no", "증빙번호", "연번"]);
  const cName = colIndex(["품명", "품목", "품목명", "내용", "내역", "사용내역"]);
  const cQty = colIndex(["수량", "수량개", "수량ea"]);
  const cUnit = colIndex(["단가"]);
  const cAmt = colIndex(["금액", "사용금액", "합계"]);
  const cDate = colIndex(["사용일자", "사용일", "일자", "발행일자"]);

  if (cName < 0 || cQty < 0) {
    throw new Error("엑셀에서 '사용내역(품목)' 또는 '수량' 컬럼을 찾지 못했습니다.");
  }

  const body = rows.slice(headerIdx + 1);
  const warnings: ImportWarning[] = [];
  const previewRows: PreviewRow[] = [];
  let totalRow: TotalRowInfo | null = null;

  body.forEach((row, idx) => {
    if (!row || row.every((cell) => String(cell ?? "").trim() === "")) return;

    const rowNumber = headerIdx + 2 + idx;
    const item_name = String(row[cName] ?? "").trim();
    if (!item_name) {
      warnings.push({ rowNumber, reason: "사용내역(품목)이 비어 있음" });
      return;
    }
    if (/^(계|합계|총계|소계)$/i.test(item_name)) {
      if (!totalRow) {
        totalRow = {
          rowNumber,
          qty: cQty >= 0 ? toNumberOrNull(row[cQty]) : null,
          amount: cAmt >= 0 ? toNumberOrNull(row[cAmt]) : null,
        };
      }
      return;
    }

    const qty = toNumberOrNull(row[cQty]);
    if (!qty || qty <= 0) {
      warnings.push({ rowNumber, reason: "수량이 비어있거나 0 이하" });
      return;
    }

    const evidenceNo = cNo >= 0 ? toNumberOrNull(row[cNo]) : null;
    const payload: InsertItem = {
      doc_id: docId,
      item_name,
      qty,
      unit_price: cUnit >= 0 ? toNumberOrNull(row[cUnit]) : null,
      amount: cAmt >= 0 ? toNumberOrNull(row[cAmt]) : null,
      used_at: cDate >= 0 ? toISODate(row[cDate]) : null,
    };

    if (evidenceNo) payload.evidence_no = evidenceNo;

    previewRows.push({ rowNumber, source_item_name: item_name, ...payload });
  });

  const duplicateNoMessage = computeDuplicateNoMessage(previewRows);

  return {
    previewRows,
    warnings,
    totalRows: body.length,
    duplicateNoMessage,
    totalRow,
  };
};

export default function HomePage() {
  const [doc, setDoc] = useState<ExpenseDoc | null>(null);
  const [items, setItems] = useState<ExpenseItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewSummary, setPreviewSummary] = useState<string | null>(null);
  const [previewWarnings, setPreviewWarnings] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [duplicateNoMessage, setDuplicateNoMessage] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [totalRowInfo, setTotalRowInfo] = useState<TotalRowInfo | null>(null);
  const [previewLimit, setPreviewLimit] = useState(10);
  const [previewFilter, setPreviewFilter] = useState("");
  const [itemMasterNames, setItemMasterNames] = useState<string[]>([]);
  const previewRef = useRef<HTMLDivElement | null>(null);

  // 문서 기본값(원하시면 UI로 입력받게 바꾸면 됩니다)
  const defaultSiteName = "현장명";
  const defaultMonthKey = "2026-01";

  const loadItems = async (docId: string) => {
    const { data, error } = await supabase
      .from(ITEM_TABLE)
      .select("id, doc_id, evidence_no, item_name, qty, unit_price, amount, used_at")
      .eq("doc_id", docId)
      .order("evidence_no", { ascending: true });

    if (error) {
      alert(`품목 조회 실패: ${error.message}`);
      return;
    }
    setItems((data ?? []) as ExpenseItem[]);
  };

  const createOrLoadDoc = async () => {
    setLoading(true);
    try {
      // 1) 기존 doc 하나 찾기(없으면 생성)
      const { data: found, error: findErr } = await supabase
        .from(DOC_TABLE)
        .select("id, site_name, month_key")
        .eq("site_name", defaultSiteName)
        .eq("month_key", defaultMonthKey)
        .limit(1);

      if (findErr) throw findErr;

      if (found && found.length > 0) {
        const d = found[0] as ExpenseDoc;
        setDoc(d);
        await loadItems(d.id);
        return;
      }

      const { data: created, error: createErr } = await supabase
        .from(DOC_TABLE)
        .insert([{ site_name: defaultSiteName, month_key: defaultMonthKey }])
        .select("id, site_name, month_key")
        .single();

      if (createErr) throw createErr;
      setDoc(created as ExpenseDoc);
      await loadItems((created as ExpenseDoc).id);
    } catch (e: any) {
      alert(`문서 생성/조회 실패: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    createOrLoadDoc();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const loadItemMaster = async () => {
      const { data, error } = await supabase
        .from("item_master")
        .select("item_name")
        .order("item_name", { ascending: true });

      if (error) {
        console.warn("item_master 로드 실패:", error.message);
        return;
      }

      const names = (data ?? []).map((row) => String(row.item_name ?? "").trim()).filter(Boolean);
      setItemMasterNames(names);
    };

    loadItemMaster();
  }, []);

  /**
   * ✅ 수동 품목 추가
   * - evidence_no는 절대 클라이언트에서 1로 기본값 넣지 않음
   * - DB 자동부여/트리거/서버처리 구조를 그대로 존중
   */
  const addManualItem = async () => {
    if (!doc?.id) return;

    setLoading(true);
    try {
      const payload = {
        doc_id: doc.id,
        item_name: "테스트품목",
        qty: 1,
        unit_price: null,
        amount: null,
        used_at: null,
        // ❌ evidence_no 보내지 않음 (중요)
      };

      const { error } = await supabase.from(ITEM_TABLE).insert([payload]);
      if (error) throw error;

      await loadItems(doc.id);
    } catch (e: any) {
      alert(`품목 추가 실패: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  };

  const uploadPreviewRows = async () => {
    if (!doc?.id) {
      alert("먼저 문서(doc)가 준비되어야 합니다.");
      return;
    }
    if (!pendingFile || previewRows.length === 0) {
      alert("먼저 엑셀 파일을 선택해 미리보기를 생성하세요.");
      return;
    }
    if (duplicateNoMessage) {
      alert(`엑셀 내 NO(증빙번호) 중복이 있습니다:\n${duplicateNoMessage}\n중복 NO를 정리 후 다시 업로드하세요.`);
      return;
    }

    const invalidRow = previewRows.find(
      (row) => !row.item_name.trim() || row.qty <= 0 || !Number.isFinite(row.qty)
    );
    if (invalidRow) {
      alert(`업로드 불가: ${invalidRow.rowNumber}행의 품명/수량을 확인하세요.`);
      return;
    }

    const insertPayload = previewRows.map(({ rowNumber: _rowNumber, ...row }) => row);

    setLoading(true);
    setImportWarnings([]);
    setImportSummary(null);
    try {
      const { error: deleteErr } = await supabase
        .from(ITEM_TABLE)
        .delete()
        .eq("doc_id", doc.id);
      if (deleteErr) throw deleteErr;

      const { error } = await supabase.from(ITEM_TABLE).insert(insertPayload);
      if (error) throw error;

      await loadItems(doc.id);
      const summary = `총 ${previewRows.length}행 저장`;
      setImportSummary(summary);
      setPendingFile(null);
      setPreviewRows([]);
      setPreviewSummary(null);
      setPreviewWarnings([]);
      setDuplicateNoMessage(null);
      setTotalRowInfo(null);
      setPreviewError(null);
      setPreviewFilter("");
      setPreviewLimit(10);
      alert("엑셀 업로드 완료");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "엑셀 업로드 실패";
      alert(message);
    } finally {
      setLoading(false);
    }
  };

  const itemsView = useMemo(() => items, [items]);
  const itemNameSuggestions = useMemo(() => {
    const fromMaster = itemMasterNames;
    const fromItems = items.map((item) => item.item_name);
    const fromPreview = previewRows.map((row) => row.item_name);
    const seen = new Set<string>();
    const merged: string[] = [];

    [...fromMaster, ...fromItems, ...fromPreview].forEach((name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(trimmed);
    });

    return merged;
  }, [itemMasterNames, items, previewRows]);
  const previewRowsFiltered = useMemo(() => {
    const keyword = previewFilter.trim().toLowerCase();
    if (!keyword) return previewRows;
    return previewRows.filter((row) => {
      const current = row.item_name.toLowerCase();
      const original = row.source_item_name.toLowerCase();
      return current.includes(keyword) || original.includes(keyword);
    });
  }, [previewFilter, previewRows]);
  const previewRowsView = useMemo(
    () => previewRowsFiltered.slice(0, previewLimit),
    [previewLimit, previewRowsFiltered]
  );
  const previewTotals = useMemo(() => {
    const totalQty = previewRows.reduce((sum, row) => sum + row.qty, 0);
    const totalAmount = previewRows.reduce((sum, row) => sum + (row.amount ?? 0), 0);
    return { totalQty, totalAmount };
  }, [previewRows]);
  const hasZeroTotals = previewRows.length > 0
    && previewTotals.totalQty === 0
    && previewTotals.totalAmount === 0;
  const totalRowMismatch = useMemo(() => {
    if (!totalRowInfo) return null;
    const qtyDiff = totalRowInfo.qty !== null
      ? Math.abs(totalRowInfo.qty - previewTotals.totalQty)
      : null;
    const amountDiff = totalRowInfo.amount !== null
      ? Math.abs(totalRowInfo.amount - previewTotals.totalAmount)
      : null;
    const qtyMismatch = qtyDiff !== null && qtyDiff > 0.001;
    const amountMismatch = amountDiff !== null && amountDiff > 0.01;
    return { qtyMismatch, amountMismatch };
  }, [totalRowInfo, previewTotals]);
  const duplicateMessageByRows = useMemo(
    () => computeDuplicateNoMessage(previewRows),
    [previewRows]
  );

  useEffect(() => {
    setDuplicateNoMessage(duplicateMessageByRows);
  }, [duplicateMessageByRows]);

  useEffect(() => {
    if (previewRows.length > 0) {
      previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [previewRows.length]);

  const updatePreviewRow = (rowNumber: number, patch: Partial<InsertItem>) => {
    setPreviewRows((prev) =>
      prev.map((row) => (row.rowNumber === rowNumber ? { ...row, ...patch } : row))
    );
  };

  return (
    <main style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
      <h2>안전관리비 품목 관리</h2>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <button onClick={createOrLoadDoc} disabled={loading}>
          문서 불러오기/생성
        </button>

        <button onClick={addManualItem} disabled={loading || !doc?.id}>
          품목 1개(테스트) 추가
        </button>

        <label style={{ border: "1px solid #ccc", padding: "6px 10px", cursor: "pointer" }}>
          엑셀 파일 선택(미리보기)
          <input
            type="file"
            accept=".xlsx,.xls"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f || !doc?.id) return;
              setPendingFile(f);
              setPreviewError(null);
              setPreviewRows([]);
              setPreviewWarnings([]);
              setPreviewSummary(null);
              setDuplicateNoMessage(null);
              setTotalRowInfo(null);
              setImportWarnings([]);
              setImportSummary(null);
              setPreviewFilter("");
              setPreviewLimit(10);
              setLoading(true);
              parseExcelFile(f, doc.id)
                .then((result) => {
                  setPreviewRows(result.previewRows);
                  setPreviewSummary(`총 ${result.totalRows}행 중 ${result.previewRows.length}행 미리보기`);
                  if (result.warnings.length > 0) {
                    setPreviewWarnings(result.warnings.map((w) => `${w.rowNumber}행: ${w.reason}`));
                  }
                  setDuplicateNoMessage(result.duplicateNoMessage);
                  setTotalRowInfo(result.totalRow);
                })
                .catch((err: unknown) => {
                  const message = err instanceof Error ? err.message : "미리보기 실패";
                  setPreviewError(message);
                })
                .finally(() => {
                  setLoading(false);
                });
              e.currentTarget.value = "";
            }}
            disabled={loading || !doc?.id}
          />
        </label>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div>
          <b>doc_id:</b> {doc?.id ?? "-"}
        </div>
        <div>
          <b>현장/월:</b> {doc ? `${doc.site_name} / ${doc.month_key}` : "-"}
        </div>
      </div>

      {(previewSummary || previewWarnings.length > 0 || previewError || duplicateNoMessage) && (
        <div ref={previewRef} style={{ marginBottom: 12, padding: 10, border: "1px solid #ddd", borderRadius: 8 }}>
          {previewSummary && <div><b>미리보기 요약:</b> {previewSummary}</div>}
          {previewRows.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <b>합계:</b> 수량 {previewTotals.totalQty.toLocaleString()} / 금액 {previewTotals.totalAmount.toLocaleString()}
            </div>
          )}
          {totalRowInfo && (
            <div style={{ marginTop: 6 }}>
              <b>엑셀 합계(행 {totalRowInfo.rowNumber}):</b>{" "}
              수량 {totalRowInfo.qty?.toLocaleString() ?? "-"} / 금액 {totalRowInfo.amount?.toLocaleString() ?? "-"}
            </div>
          )}
          {totalRowInfo && totalRowMismatch && (totalRowMismatch.qtyMismatch || totalRowMismatch.amountMismatch) && (
            <div style={{ color: "#a00", marginTop: 6 }}>
              <b>합계 불일치:</b> 미리보기 합계와 엑셀 합계가 다릅니다.
            </div>
          )}
          {hasZeroTotals && (
            <div style={{ color: "#a00", marginTop: 6 }}>
              <b>주의:</b> 수량/금액 합계가 0입니다. 엑셀 데이터가 비어있거나 열 매핑이 다를 수 있습니다.
            </div>
          )}
          {previewError && <div style={{ color: "#a00", marginTop: 6 }}><b>미리보기 오류:</b> {previewError}</div>}
          {duplicateNoMessage && (
            <div style={{ color: "#a00", marginTop: 6, whiteSpace: "pre-line" }}>
              <b>NO 중복:</b> {duplicateNoMessage}
            </div>
          )}
          {previewWarnings.length > 0 && (
            <div style={{ marginTop: 6, color: "#a00" }}>
              <b>건너뛴 행:</b> {previewWarnings.slice(0, 5).join(" / ")}
              {previewWarnings.length > 5 && ` 외 ${previewWarnings.length - 5}건`}
            </div>
          )}
        </div>
      )}

      {pendingFile && (
        <div style={{ marginBottom: 12, padding: 10, border: "1px solid #ddd", borderRadius: 8 }}>
          <div style={{ marginBottom: 8 }}>
            <b>선택된 파일:</b> {pendingFile.name}
          </div>
          <button
            onClick={() => void uploadPreviewRows()}
            disabled={loading || !!duplicateNoMessage || previewRows.length === 0}
            style={{ marginRight: 8 }}
          >
            이 파일 업로드
          </button>
          <button
            onClick={() => {
              setPendingFile(null);
              setPreviewRows([]);
              setPreviewSummary(null);
              setPreviewWarnings([]);
              setDuplicateNoMessage(null);
              setTotalRowInfo(null);
              setPreviewError(null);
              setPreviewFilter("");
              setPreviewLimit(10);
            }}
            disabled={loading}
          >
            미리보기 초기화
          </button>
        </div>
      )}

      {previewRows.length > 0 && (
        <div style={{ marginBottom: 12, padding: 10, border: "1px solid #ddd", borderRadius: 8, overflowX: "auto" }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            미리보기 (표시 {previewRowsView.length} / 전체 {previewRowsFiltered.length}행)
          </div>
          <div style={{ marginBottom: 8 }}>
            <input
              value={previewFilter}
              onChange={(e) => {
                setPreviewFilter(e.target.value);
                setPreviewLimit(10);
              }}
              placeholder="품명으로 필터링"
              style={{ width: "100%", padding: "6px 8px", border: "1px solid #ccc", borderRadius: 6 }}
            />
          </div>
          <datalist id="item-name-suggestions">
            {itemNameSuggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {previewRowsView.length === 0 ? (
            <div style={{ fontSize: 12, color: "#666" }}>필터 결과가 없습니다.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "6px 4px", position: "sticky", top: 0, background: "#fff" }}>행</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "6px 4px", position: "sticky", top: 0, background: "#fff" }}>NO</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "6px 4px", position: "sticky", top: 0, background: "#fff" }}>품명</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid #ddd", padding: "6px 4px", position: "sticky", top: 0, background: "#fff" }}>수량</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid #ddd", padding: "6px 4px", position: "sticky", top: 0, background: "#fff" }}>단가</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid #ddd", padding: "6px 4px", position: "sticky", top: 0, background: "#fff" }}>금액</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "6px 4px", position: "sticky", top: 0, background: "#fff" }}>사용일</th>
                </tr>
              </thead>
              <tbody>
                {previewRowsView.map((row) => (
                  <tr
                    key={row.rowNumber}
                    style={{ background: row.qty <= 0 || !row.item_name.trim() ? "#fff2f2" : "transparent" }}
                  >
                    <td style={{ borderBottom: "1px solid #eee", padding: "6px 4px" }}>{row.rowNumber}</td>
                    <td style={{ borderBottom: "1px solid #eee", padding: "6px 4px" }}>
                      <input
                        value={row.evidence_no ?? ""}
                        onChange={(e) => {
                          const next = parseNumberInput(e.target.value);
                          updatePreviewRow(row.rowNumber, { evidence_no: next ?? undefined });
                        }}
                        style={{ width: 70, padding: "4px 6px" }}
                      />
                    </td>
                    <td style={{ borderBottom: "1px solid #eee", padding: "6px 4px" }}>
                      <input
                        value={row.item_name}
                        onChange={(e) => updatePreviewRow(row.rowNumber, { item_name: e.target.value })}
                        list="item-name-suggestions"
                        style={{ width: "100%", padding: "4px 6px" }}
                      />
                    </td>
                    <td style={{ borderBottom: "1px solid #eee", padding: "6px 4px", textAlign: "right" }}>
                      <input
                        value={String(row.qty)}
                        onChange={(e) => {
                          const next = parseNumberInput(e.target.value);
                          updatePreviewRow(row.rowNumber, { qty: next ?? 0 });
                        }}
                        style={{ width: 70, padding: "4px 6px", textAlign: "right" }}
                      />
                    </td>
                    <td style={{ borderBottom: "1px solid #eee", padding: "6px 4px", textAlign: "right" }}>
                      <input
                        value={row.unit_price ?? ""}
                        onChange={(e) => {
                          const next = parseNumberInput(e.target.value);
                          updatePreviewRow(row.rowNumber, { unit_price: next });
                        }}
                        style={{ width: 90, padding: "4px 6px", textAlign: "right" }}
                      />
                    </td>
                    <td style={{ borderBottom: "1px solid #eee", padding: "6px 4px", textAlign: "right" }}>
                      <input
                        value={row.amount ?? ""}
                        onChange={(e) => {
                          const next = parseNumberInput(e.target.value);
                          updatePreviewRow(row.rowNumber, { amount: next });
                        }}
                        style={{ width: 100, padding: "4px 6px", textAlign: "right" }}
                      />
                    </td>
                    <td style={{ borderBottom: "1px solid #eee", padding: "6px 4px" }}>
                      <input
                        value={row.used_at ?? ""}
                        onChange={(e) => updatePreviewRow(row.rowNumber, { used_at: e.target.value })}
                        style={{ width: 120, padding: "4px 6px" }}
                        placeholder="YYYY-MM-DD"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {previewRowsView.length < previewRowsFiltered.length && (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                onClick={() => setPreviewLimit((prev) => prev + 20)}
                style={{ border: "1px solid #ccc", padding: "6px 10px", cursor: "pointer" }}
              >
                더보기 (+20)
              </button>
              <button
                type="button"
                onClick={() => setPreviewLimit(previewRowsFiltered.length)}
                style={{ border: "1px solid #ccc", padding: "6px 10px", cursor: "pointer", marginLeft: 8 }}
              >
                전체보기
              </button>
            </div>
          )}
          {previewRowsView.length >= previewRowsFiltered.length && previewRowsFiltered.length > 10 && (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                onClick={() => setPreviewLimit(10)}
                style={{ border: "1px solid #ccc", padding: "6px 10px", cursor: "pointer" }}
              >
                접기
              </button>
            </div>
          )}
        </div>
      )}

      <hr />

      <h3>품목 목록</h3>
      <div style={{ display: "grid", gap: 6 }}>
        {itemsView.map((it) => (
          <div key={it.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 10 }}>
            <div>
              <b>NO:</b> {it.evidence_no ?? "-"} / <b>품명:</b> {it.item_name} / <b>수량:</b> {it.qty}
            </div>
          </div>
        ))}
        {itemsView.length === 0 && <div style={{ color: "#666" }}>등록된 품목이 없습니다.</div>}
      </div>
    </main>
  );
}
