-- ============================================================
-- Presentation — 最終評価レポート final_report 列追加 migration（既存環境への追加）
--
-- 目的: プレゼン評価 + Q&A を合わせた「締めの最終評価レポート」を保存する。
--   大学・企業の面接官が返す評価レポート相当（総合スコア/ランク/各項目スコア/良かった点/改善点/
--   プレゼンレビュー/Q&Aレビュー/最終総評/改善プラン/合格可能性）を 1 件として保持する。
--
-- なぜ新規テーブルを作らないか:
--   最終レポートは「1 attempt につき 1 件」で、presentation_results（attempt と 1:1 / UNIQUE(attempt_id)）
--   と完全に同粒度。qa_summary と同様、nullable jsonb 列を 1 本足すのが最も自然（不要なテーブル追加を避ける）。
--   - presentation_qa_reviews … 1 行 = 1 交換（質問+回答+個別レビュー）。
--   - presentation_results.qa_summary … Q&A 5問の総合評価。
--   - presentation_results.final_report … プレゼン+Q&A を合わせた最終評価レポート（本 migration）。
--
-- 安全性:
--   - ADD COLUMN IF NOT EXISTS（nullable / default なし）で冪等。既存行・既存制約に影響なし。
--   - 書込は service_role（/api/presentation/qa の final-report action のみ）。閲覧は既存 RLS owner SELECT。
--
-- 課金: なし（Q&A 系は usage 非消費 / presentation quota 非影響。logAiUsage のみ）。
-- ============================================================

ALTER TABLE public.presentation_results
  ADD COLUMN IF NOT EXISTS final_report jsonb;

COMMENT ON COLUMN public.presentation_results.final_report IS
  'プレゼン + Q&A を合わせた最終評価レポート（jsonb / nullable）。{totalScore(0-100), rank(S|A|B|C|D), '
  'categoryScores{8軸 0-100}, goodPoints[], improvements[{point,reason}], presentationReview, qaReview, '
  'finalComment(長文), improvementPlan[{priority,title,today,tomorrow}], passProbabilityStars(1-5), '
  'passProbabilityNote}。5 問完了時に 1 度だけ生成（qa route の final-report action）。再生成しない＝再課金しない。';

-- 検証（任意）:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name='presentation_results' AND column_name='final_report';
