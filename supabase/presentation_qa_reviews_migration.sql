-- ============================================================
-- Presentation — 発表後 Q&A（stateless generate/review）の永続化 migration（既存環境への追加）
--
-- 目的: result 画面の「発表後Q&A練習」を学習資産として蓄積する。
--   1 回の Q&A 交換（質問 → 回答 → AI レビュー）を 1 行として保存する。
--
-- なぜ presentation_qa_turns を再利用しないか:
--   既存 presentation_qa_turns は「ターン制 Q&A（kickoff/answer/finish）」用の
--   transcript テーブルで、role/source/content（いずれも NOT NULL）と
--   UNIQUE(attempt_id, turn_index) を持つ "1 行 = 1 ターン" 形。
--   本機能が必要とする "1 行 = 1 交換（question + answer_text + review(jsonb)）" とは
--   行モデルが異なり、NOT NULL/UNIQUE 制約の変更（=大規模改修）を伴う。
--   そのため、衝突を避け既存フローを壊さない専用テーブルを新設する。
--
-- 安全性:
--   - CREATE TABLE IF NOT EXISTS / DROP POLICY IF EXISTS → CREATE で冪等。
--   - 既存テーブル（attempts/results/sessions/qa_turns）には一切変更を加えない。
--
-- 課金: なし（Q&A は無料 / usage 非消費 / presentation quota 非影響）。
-- ============================================================

-- 1. presentation_qa_reviews（1 行 = 1 Q&A 交換）。
CREATE TABLE IF NOT EXISTS public.presentation_qa_reviews (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id  uuid         NOT NULL REFERENCES public.presentation_attempts(id) ON DELETE CASCADE,
  -- owner key を非正規化で複製（RLS の owner 直接判定用。attempts/qa_turns と同方針）。
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- attempt 内 0 始まり連番（交換の保存順）。
  turn_index  integer      NOT NULL,
  question    text         NOT NULL,
  answer_text text         NOT NULL,
  -- AI レビュー（goodPoints / improvements / modelAnswerDirection）の jsonb スナップショット。
  review      jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT presentation_qa_reviews_attempt_index_unique UNIQUE (attempt_id, turn_index)
);

COMMENT ON TABLE public.presentation_qa_reviews IS
  '発表後 Q&A（result 画面の stateless generate/review）の永続化。1 行 = 1 交換（質問 + 回答 + '
  'AI レビュー review(jsonb)）。学習資産化が目的。書込は service_role（/api/presentation/qa の '
  'review 成功時）。閲覧は RLS owner SELECT。usage/quota 非影響。';

COMMENT ON COLUMN public.presentation_qa_reviews.user_id IS
  'auth.users(id). owner key を複製（RLS は auth.uid()=user_id の SELECT のみ。書込は service_role）。';

COMMENT ON COLUMN public.presentation_qa_reviews.review IS
  'AI レビューの jsonb スナップショット（goodPoints: string[] / improvements: string[] / '
  'modelAnswerDirection: string）。AI 評価ロジックは変更しない（保存のみ追加）。';

-- 2. 走査用 index。
--    - マイページ「累計Q&A回答数」: user_id で count。
--    - result/history: attempt_id ＋ created_at で取得（UNIQUE(attempt_id, turn_index) もあるが
--      created_at 並びの取得を効かせるため複合 index を張る）。
CREATE INDEX IF NOT EXISTS presentation_qa_reviews_user_idx
  ON public.presentation_qa_reviews (user_id);

CREATE INDEX IF NOT EXISTS presentation_qa_reviews_attempt_created_idx
  ON public.presentation_qa_reviews (attempt_id, created_at DESC);

-- 3. RLS（owner SELECT のみ / 書込は service_role）。
ALTER TABLE public.presentation_qa_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "presentation_qa_reviews owner select" ON public.presentation_qa_reviews;
CREATE POLICY "presentation_qa_reviews owner select"
  ON public.presentation_qa_reviews
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 検証（任意）:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name='presentation_qa_reviews' ORDER BY ordinal_position;
