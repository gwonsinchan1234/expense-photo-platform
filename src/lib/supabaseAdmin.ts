// lib/supabaseAdmin.ts
// [이유] 서버(API)에서만 Service Role로 Storage/DB를 강제 통제하기 위함

import { createClient } from "@supabase/supabase-js";

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,     // [이유] 프로젝트 URL
  process.env.SUPABASE_SERVICE_ROLE_KEY!,    // [이유] 서버에서만 강한 권한
  { auth: { persistSession: false } }
);
