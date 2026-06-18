-- ============================================================
-- Presentation — 大学選択（university）拡張 migration（既存環境への追加）
--
-- 目的: プレゼン練習を志望大学・学部・入試方式に合わせて最適化するための任意項目を
--   presentation_sessions に追加する。すべて NULL 許容・後方互換。
--   （university_name / faculty_name / time_limit_sec は既存列を再利用するため追加しない。）
--
-- 安全性:
--   - ADD COLUMN IF NOT EXISTS のみ。既存データ破壊なし・DROP なし。
--   - 既存セッションは新列 = NULL のまま。再実行しても冪等。
--
-- 適用: presentation_apply.sql を **まだ適用していない**なら本ファイルは不要（最新 apply に含まれる）。
--   既に presentation_sessions を作成済みの環境にだけ本ファイルを実行する。
-- ============================================================

ALTER TABLE public.presentation_sessions
  ADD COLUMN IF NOT EXISTS department_name        text,
  ADD COLUMN IF NOT EXISTS admission_type         text,
  ADD COLUMN IF NOT EXISTS presentation_format    text,
  ADD COLUMN IF NOT EXISTS presentation_limit_sec integer,
  ADD COLUMN IF NOT EXISTS university_notes       text;

-- 検証（任意）:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name='presentation_sessions'
--     AND column_name IN ('department_name','admission_type','presentation_format',
--                         'presentation_limit_sec','university_notes');
