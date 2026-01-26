import { createClient } from "@supabase/supabase-js";

/**
 * 구현 이유:
 * - Storage 업로드/삭제는 서버에서 Service Role로 처리(권한 이슈 최소화)
 * - Service Role 키는 절대 브라우저로 내려가면 안 됨
 */
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}
