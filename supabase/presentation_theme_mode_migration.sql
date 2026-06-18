-- ============================================================
-- Presentation — テーマ設定 2 モード化 migration（既存環境への追加）
--
-- 目的: テーマ設定を「自分で設定（manual）」「AI 即興テーマ（generated）」の 2 モード化する。
--   - theme_mode: 'manual' | 'generated'（NULL は既存=manual 相当として扱う）。
--   - generated_conditions: generated 時の発表条件（string[] を jsonb 保存）。
--   - generated_questions: generated 時の想定質問（string[] を jsonb 保存）。
--
-- 安全性:
--   - ADD COLUMN IF NOT EXISTS のみ。既存データ破壊なし・DROP なし。NULL 許容で後方互換。
--   - 再実行しても冪等。
--
-- 適用: presentation_apply.sql を **まだ適用していない**なら本ファイルは不要（最新 apply に含まれる）。
--   既に presentation_sessions を作成済みの環境にだけ実行する。
-- ============================================================

ALTER TABLE public.presentation_sessions
  ADD COLUMN IF NOT EXISTS theme_mode           text,
  ADD COLUMN IF NOT EXISTS generated_conditions jsonb,
  ADD COLUMN IF NOT EXISTS generated_questions  jsonb;

-- 検証（任意）:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name='presentation_sessions'
--     AND column_name IN ('theme_mode','generated_conditions','generated_questions');
