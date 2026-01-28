import { createClient } from "@supabase/supabase-js";

/**
 * [목표]
 * - Next.js 서버(route.ts) 전용 Admin 클라이언트
 * - 서비스 롤 키 사용(프론트 노출 금지)
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL 누락(.env.local 확인)");
if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY 누락(.env.local 확인)");

export const supabaseAdmin = createClient(url, serviceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
