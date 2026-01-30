-- expense_items에 공종(work_type), 시트양식(sheet_template) 컬럼 추가
-- Supabase SQL Editor에서 실행하세요.
ALTER TABLE expense_items ADD COLUMN IF NOT EXISTS work_type text;
ALTER TABLE expense_items ADD COLUMN IF NOT EXISTS sheet_template text;
