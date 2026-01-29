import { createClient } from "@supabase/supabase-js";

/**
 * [목표]
 * - Next.js 서버(route.ts) 전용 Admin 클라이언트
 * - 서비스 롤 키 사용(프론트 노출 금지)
 *
 * [이유]
 * - 서버 전용 env(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)를 사용해야
 *   build/runtime 환경에서 안정적으로 주입되고, 클라이언트 공개 env 의존을 제거함.
 */

const url = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url) throw new Error("SUPABASE_URL 누락(.env.local 또는 배포 환경변수 확인)");
if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY 누락(.env.local 또는 배포 환경변수 확인)");

export const supabaseAdmin = createClient(url, serviceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
