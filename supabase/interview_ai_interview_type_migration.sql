-- ============================================================
-- Interview AI — interview_type 連動 migration（既存 interview_ai_sessions への列追加）
--
-- 目的: 面接を「どの機能データをもとに練習するか」で分類する（preview 検証用 / feature flag 制御）。
--   - interview_type: 面接タイプ（self_analysis|activity|statement|matching|essay|free）
--   - source_type:    元データ種別（同 enum / null 可）
--   - source_id:      元データの id（localStorage 由来は文字列のため text / null 可）
--
-- 安全性（本 migration が守ること）:
--   - **ADD COLUMN IF NOT EXISTS の加算のみ**。
--   - 既存データ破壊なし / DROP なし / RLS 変更なし / policy 変更なし / CHECK 制約追加なし。
--   - 既存行は interview_type='free'（default）/ source_type=NULL / source_id=NULL になる。
--   - 値の妥当性はアプリ層（lib/interviewAi/interviewTypes.ts の isInterviewType）で担保する。
--   - 再実行しても IF NOT EXISTS により無害（冪等）。
--
-- 適用: Supabase SQL Editor に本ファイル全文を貼って実行。
--   本番では NEXT_PUBLIC_ENABLE_INTERVIEW_SOURCE_TYPES を未設定（=新UI 非表示）のままにする。
--   列だけ先に足しておいても、UI が flag false なら一般ユーザーには一切現れない。
-- ============================================================

ALTER TABLE public.interview_ai_sessions
  ADD COLUMN IF NOT EXISTS interview_type text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS source_type    text,
  ADD COLUMN IF NOT EXISTS source_id      text;

-- 検証（任意）:
--   SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'interview_ai_sessions'
--     AND column_name IN ('interview_type','source_type','source_id');
--   -- 期待: interview_type text NOT NULL default 'free' / source_type text NULL / source_id text NULL
