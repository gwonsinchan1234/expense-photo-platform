import { createClient } from "@supabase/supabase-js";

/**
 * [진단 포인트]
 * - supabaseUrl is required 는 여기서 URL이 undefined/null일 때 발생
 * - 개발 중 원인 확정을 위해 console에 값을 찍습니다(값 자체는 URL만, 키는 일부 마스킹 가능)
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

console.log("[ENV] NEXT_PUBLIC_SUPABASE_URL =", supabaseUrl);
console.log("[ENV] NEXT_PUBLIC_SUPABASE_ANON_KEY exists =", !!supabaseAnonKey);

if (!supabaseUrl) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL이 비어있습니다. (.env.local 위치/재시작/키명 확인)");
}
if (!supabaseAnonKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY가 비어있습니다. (.env.local 위치/재시작/키명 확인)");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
