-- ============================================================
-- Presentation — 発表後 Q&A（5問）全体の総合評価 qa_summary 列追加 migration（既存環境への追加）
--
-- 目的: 1 問ごとの review（presentation_qa_reviews）とは別に、質疑応答 5 問全体を通した
--   「受け答え」の総合評価を保存する。result 画面の Q&A 終了後に表示し、履歴・リロードで再表示する。
--
-- なぜ新規テーブルを作らないか:
--   総合評価は「1 attempt につき 1 件」で、presentation_results（attempt と 1:1 / UNIQUE(attempt_id)）
--   と完全に同じ粒度。新規テーブルは attempt_id への 1:1 を再実装するだけで責務が重複する。
--   そのため presentation_results に nullable jsonb 列を 1 本足すのが最も自然（不要なテーブル追加を避ける）。
--   - presentation_qa_reviews … 1 行 = 1 交換（質問+回答+個別レビュー）。交換ログ。
--   - presentation_results.qa_summary … 5 問全体の総合評価。1 attempt 1 件。
--
-- 安全性:
--   - ADD COLUMN IF NOT EXISTS（nullable / default なし）で冪等。既存行・既存制約に影響なし。
--   - 書込は service_role（/api/presentation/qa の summary action のみ）。閲覧は既存 RLS owner SELECT。
--
-- 課金: なし（Q&A 系は usage 非消費 / presentation quota 非影響。logAiUsage のみ）。
-- ============================================================

ALTER TABLE public.presentation_results
  ADD COLUMN IF NOT EXISTS qa_summary jsonb;

COMMENT ON COLUMN public.presentation_results.qa_summary IS
  '発表後 Q&A（5問）全体の総合評価（jsonb / nullable）。{categories:{understanding,logic,depth,'
  'responsiveness,persuasion ∈ weak|normal|strong}, goodPoints[], improvements[], overallComment}。'
  '5 問完了時に 1 度だけ生成（qa route の summary action）。再生成しない＝再課金しない。'
  '1問ごとの presentation_qa_reviews とは責務が異なる（あちらは交換ログ、ここは全体総括）。';

-- 検証（任意）:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name='presentation_results' AND column_name='qa_summary';
