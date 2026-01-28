import { NextResponse } from "next/server";
import { createWorker } from "tesseract.js";
import { supabase } from "@/lib/supabaseClient";

/**
 * [역할]
 * - Supabase Storage 이미지 URL(또는 file_path)을 받아 OCR 수행
 * - 품목마스터(1순위) → OCR키워드(2순위) → 이력(추가 예정) 기반으로 분류 추천
 * - 신뢰도 점수 계산 (>=90 자동확정)
 * - 결과를 expense_photos(ocr_text...)와 expense_items(category...)에 저장
 *
 * [주의]
 * - 오픈소스 OCR은 사진 품질에 따라 오차가 필수로 존재합니다.
 * - 그래서 "90점 자동확정 / 그 미만은 확인 필요"가 핵심입니다.
 */

type ReqBody = {
  itemId: string;
  photoId: string;
  photoPublicUrl: string; // 업로드 후 public URL
  itemName: string;
};

function normalizeText(t: string) {
  return t
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .toLowerCase();
}

// 아주 단순한 키워드 룰(초기 MVP)
function keywordScore(text: string) {
  const rules: { key: string; category: string; score: number }[] = [
    // PPE
    { key: "안전화", category: "PPE", score: 60 },
    { key: "안전모", category: "PPE", score: 60 },
    { key: "안전벨트", category: "PPE", score: 70 },
    { key: "장갑", category: "PPE", score: 50 },

    // 시설물
    { key: "생명줄", category: "SAFETY_FACILITY", score: 75 },
    { key: "난간", category: "SAFETY_FACILITY", score: 60 },
    { key: "방호", category: "SAFETY_FACILITY", score: 55 },

    // 추락방지
    { key: "그물", category: "FALL_PROTECTION", score: 60 },
    { key: "망", category: "FALL_PROTECTION", score: 50 },
  ];

  const detected: string[] = [];
  const scores: Record<string, number> = {};

  for (const r of rules) {
    if (text.includes(r.key)) {
      detected.push(r.key);
      scores[r.category] = Math.max(scores[r.category] ?? 0, r.score);
    }
  }

  // 최고 점수 카테고리
  let bestCat: string | null = null;
  let bestScore = 0;
  for (const [cat, sc] of Object.entries(scores)) {
    if (sc > bestScore) {
      bestScore = sc;
      bestCat = cat;
    }
  }

  return { bestCat, bestScore, detected };
}

async function isForbidden(itemName: string, categoryKey: string) {
  const { data, error } = await supabase
    .from("forbidden_rules")
    .select("id")
    .eq("item_name", itemName)
    .eq("forbidden_category_key", categoryKey)
    .eq("active", true)
    .limit(1);

  if (error) return false; // 보수적으로: 룰 조회 실패 시 금칙으로 막지 않음(운영에선 반대로 가능)
  return (data?.length ?? 0) > 0;
}

export async function POST(req: Request) {
  const body = (await req.json()) as ReqBody;
  const { itemId, photoId, photoPublicUrl, itemName } = body;

  // 1) 1순위: 품목마스터 매핑 확인
  const masterRes = await supabase
    .from("item_master")
    .select("category_key")
    .eq("item_name", itemName)
    .single();

  if (!masterRes.error && masterRes.data?.category_key) {
    const categoryKey = masterRes.data.category_key;

    // 금칙 룰 확인
    if (await isForbidden(itemName, categoryKey)) {
      return NextResponse.json(
        { ok: false, reason: "금칙 룰 위반(마스터 분류)" },
        { status: 400 }
      );
    }

    // item에 확정 저장
    await supabase
      .from("expense_items")
      .update({
        category_key: categoryKey,
        category_confidence: 100,
        category_source: "master",
      })
      .eq("id", itemId);

    return NextResponse.json({
      ok: true,
      categoryKey,
      confidence: 100,
      source: "master",
      detectedKeywords: [],
      ocrText: null,
    });
  }

  // 2) OCR 실행 (오픈소스 tesseract.js)
  const worker = await createWorker("kor+eng", 1, {
    langPath: "/tessdata", // public/tessdata
  });

  try {
    const result = await worker.recognize(photoPublicUrl);
    const rawText = result.data.text || "";
    const conf = result.data.confidence ?? 0;
    const text = normalizeText(rawText);

    // 3) OCR 텍스트 기반 키워드 스코어
    const { bestCat, bestScore, detected } = keywordScore(text);

    // 신뢰도 계산(초기 MVP)
    // - OCR 자신감(conf) 반영 + 키워드 점수 반영
    // conf는 0~100 근사, bestScore는 0~75 정도
    const finalConfidence = Math.min(
      100,
      Math.round(bestScore + Math.max(0, (conf - 40) * 0.5))
    );

    // photo에 OCR 로그 저장
    await supabase
      .from("expense_photos")
      .update({
        ocr_text: rawText,
        ocr_confidence: conf,
        detected_keywords: detected,
      })
      .eq("id", photoId);

    // 4) 분류 확정/보류(게이팅)
    if (!bestCat) {
      return NextResponse.json({
        ok: true,
        categoryKey: null,
        confidence: finalConfidence,
        source: "ocr",
        detectedKeywords: detected,
        ocrText: rawText,
        needConfirm: true,
      });
    }

    // 금칙 룰 확인
    if (await isForbidden(itemName, bestCat)) {
      return NextResponse.json({
        ok: true,
        categoryKey: bestCat,
        confidence: finalConfidence,
        source: "ocr",
        detectedKeywords: detected,
        ocrText: rawText,
        needConfirm: true,
        warning: "금칙 룰 후보(확정 금지)",
      });
    }

    // 90점 이상이면 자동 확정, 아니면 확인 필요
    if (finalConfidence >= 90) {
      await supabase
        .from("expense_items")
        .update({
          category_key: bestCat,
          category_confidence: finalConfidence,
          category_source: "ocr",
        })
        .eq("id", itemId);

      return NextResponse.json({
        ok: true,
        categoryKey: bestCat,
        confidence: finalConfidence,
        source: "ocr",
        detectedKeywords: detected,
        ocrText: rawText,
        needConfirm: false,
      });
    }

    return NextResponse.json({
      ok: true,
      categoryKey: bestCat,
      confidence: finalConfidence,
      source: "ocr",
      detectedKeywords: detected,
      ocrText: rawText,
      needConfirm: true,
    });
  } finally {
    await worker.terminate();
  }
}
