-- ============================================================
-- Presentation — presentation_attempts.metadata 追加 migration（既存テーブルへの列追加）
--
-- 目的: attempt 登録 route（/api/presentation/attempt）が動画の付帯情報
--   （video_mime_type / video_size_bytes 等）を保存できるようにする。
--   storage_path は ext を含むため mime の大分類は復元可能だが、原 mime / サイズは
--   ストレージ会計・監視のため metadata に保持する。
--
-- 安全性（本 migration が守ること）:
--   - **ADD COLUMN IF NOT EXISTS の加算のみ**。
--   - 既存データ破壊なし / DROP なし / RLS 変更なし / policy 変更なし / CHECK 制約追加なし。
--   - 既存行は metadata='{}'（default）になる。
--   - 再実行しても IF NOT EXISTS により無害（冪等）。
--
-- 適用: presentation_apply.sql を **まだ適用していない**なら本ファイルは不要
--   （新しい CREATE TABLE に metadata 列が含まれる / supabase/schema.sql §66）。
--   既に presentation_attempts を作成済みの環境にだけ、本ファイル全文を Supabase SQL Editor で実行する。
-- ============================================================

ALTER TABLE public.presentation_attempts
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 検証（任意）:
--   SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'presentation_attempts' AND column_name = 'metadata';
--   -- 期待: metadata jsonb NOT NULL default '{}'::jsonb
