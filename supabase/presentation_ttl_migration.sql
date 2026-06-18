-- ============================================================
-- Presentation — 録画動画 / 発表資料の TTL 自動削除 migration（既存環境への追加）
--
-- 目的: Storage コストと法務リスクを抑えるため、一定期間（90 日）経過した
--   録画動画（presentation-recordings）・発表資料（presentation-materials）を
--   cron で自動削除する。削除済みであることを DB に記録する列を追加する。
--
--   - presentation_attempts.video_deleted_at    : 録画動画を削除した時刻（NULL=未削除）。
--   - presentation_sessions.material_deleted_at : 発表資料を削除した時刻（NULL=未削除）。
--
-- 非削除（重要）:
--   - transcript（presentation_attempts.transcript）/ AI 評価（presentation_results）は
--     削除しない。結果・履歴・成長可視化は引き続き閲覧できる。
--   - 行（attempts / sessions / results）自体は DELETE しない。Storage 上のファイルのみ消し、
--     deleted_at を立てて「保存期限切れ」として扱う。
--
-- 安全性:
--   - ADD COLUMN IF NOT EXISTS で冪等。既存データ破壊なし・DROP なし。
--   - 既存行は video_deleted_at / material_deleted_at = NULL のまま（未削除扱い）。
--
-- 削除処理本体: app/api/cron/presentation-cleanup/route.ts（service_role / CRON_SECRET 保護）。
-- ============================================================

-- 1. presentation_attempts に録画動画の削除時刻を追加（NULL 許容 / 既定 NULL）。
ALTER TABLE public.presentation_attempts
  ADD COLUMN IF NOT EXISTS video_deleted_at timestamptz;

COMMENT ON COLUMN public.presentation_attempts.video_deleted_at IS
  '録画動画（presentation-recordings の storage_path）を TTL で削除した時刻。NULL=未削除。'
  '非 NULL の場合、result 画面は「録画動画の保存期間が終了しました」を表示し、signed URL を発行しない。'
  'transcript / AI 評価は削除しないため、結果・履歴は引き続き閲覧できる。'
  '削除処理は app/api/cron/presentation-cleanup（service_role / CRON_SECRET）。';

-- 2. presentation_sessions に発表資料の削除時刻を追加（NULL 許容 / 既定 NULL）。
ALTER TABLE public.presentation_sessions
  ADD COLUMN IF NOT EXISTS material_deleted_at timestamptz;

COMMENT ON COLUMN public.presentation_sessions.material_deleted_at IS
  '発表資料（presentation-materials の material_path）を TTL で削除した時刻。NULL=未削除。'
  '非 NULL の場合、履歴の資料バッジは「資料保存期限切れ」を表示する。material_path 自体は残す。'
  '削除処理は app/api/cron/presentation-cleanup（service_role / CRON_SECRET）。';

-- 3. cleanup の走査用 index（created_at で TTL 判定し未削除のみ拾うため）。任意・冪等。
CREATE INDEX IF NOT EXISTS presentation_attempts_video_cleanup_idx
  ON public.presentation_attempts (created_at)
  WHERE video_deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS presentation_sessions_material_cleanup_idx
  ON public.presentation_sessions (created_at)
  WHERE material_deleted_at IS NULL;

-- 検証（任意）:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name='presentation_attempts' AND column_name='video_deleted_at';
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name='presentation_sessions' AND column_name='material_deleted_at';
