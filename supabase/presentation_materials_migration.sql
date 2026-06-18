-- ============================================================
-- Presentation — 発表資料（material）拡張 migration（既存環境への追加）
--
-- 目的: プレゼンに「発表資料（PDF / PNG / JPG / JPEG）」を任意添付できるようにする。
--   - presentation_sessions に material_* 列を追加（すべて NULL 許容・後方互換）。
--   - private bucket 'presentation-materials' と storage.objects RLS を追加。
--
-- 安全性:
--   - ADD COLUMN IF NOT EXISTS / ON CONFLICT DO NOTHING / DROP POLICY IF EXISTS → CREATE で冪等。
--   - 既存データ破壊なし・DROP TABLE なし。既存セッションは material_* = NULL のまま。
--
-- 適用: presentation_apply.sql を **まだ適用していない**なら本ファイルは不要（最新 apply に含まれる）。
--   既に presentation_sessions / recordings bucket を作成済みの環境にだけ本ファイルを実行する。
-- ============================================================

-- 1. presentation_sessions に material_* 列を追加（NULL 許容）。
ALTER TABLE public.presentation_sessions
  ADD COLUMN IF NOT EXISTS material_path       text,
  ADD COLUMN IF NOT EXISTS material_mime_type  text,
  ADD COLUMN IF NOT EXISTS material_file_name  text,
  ADD COLUMN IF NOT EXISTS material_size_bytes integer;

-- 2. private bucket 'presentation-materials'。
INSERT INTO storage.buckets (id, name, public)
VALUES ('presentation-materials', 'presentation-materials', false)
ON CONFLICT (id) DO NOTHING;

-- 3. storage.objects RLS（本人のみ。SELECT / INSERT / UPDATE。DELETE は service_role）。
DROP POLICY IF EXISTS "presentation-materials owner select" ON storage.objects;
CREATE POLICY "presentation-materials owner select"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'presentation-materials'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "presentation-materials owner insert" ON storage.objects;
CREATE POLICY "presentation-materials owner insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'presentation-materials'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "presentation-materials owner update" ON storage.objects;
CREATE POLICY "presentation-materials owner update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'presentation-materials'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'presentation-materials'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 検証（任意）:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name='presentation_sessions' AND column_name LIKE 'material_%';
--   -- 期待: material_path / material_mime_type / material_file_name / material_size_bytes
