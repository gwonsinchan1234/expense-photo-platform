import { createClient } from "@supabase/supabase-js";

/**
 * [이유]
 * - 브라우저에서 Supabase를 호출하는 기본 클라이언트입니다.
 * - Publishable key(=예전 anon key)만 사용합니다.
 */
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
