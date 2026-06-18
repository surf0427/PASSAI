-- ============================================================
-- 本番 deploy 前チェック（読み取り専用）
--   feature/interview-realtime-step1（= supabase-migration 系列全体）を本番に出す前に、
--   本番 Supabase に必要なテーブル / RLS / policy / index / 制約 / 関数 / storage bucket が
--   揃っているかを一括確認する。**何も変更しない**（SELECT のみ）。
--
-- 使い方: 本番プロジェクトの Supabase SQL Editor に全文を貼って実行。
--   status 列に MISSING / DISABLED / NEEDS-MIGRATION / 0(policies) が 1 つでもあれば deploy 不可。
--   不足分の migration（supabase/*.sql / *_apply.sql / 各 *_migration.sql）を先に適用すること。
--
-- 対象: interview_ai 系（ターン制＋realtime source）/ presentation 系 / billing 系 / storage。
-- ============================================================

WITH
tables AS (
  SELECT unnest(ARRAY[
    'profiles','subscriptions','stripe_events','usage_records',
    'interview_ai_sessions','interview_ai_turns','interview_ai_results',
    'presentation_sessions','presentation_attempts','presentation_results',
    'presentation_qa_turns','presentation_qa_reviews','presentation_practice_records'
  ]) AS t
),
indexes AS (
  SELECT unnest(ARRAY[
    'interview_ai_sessions_one_in_progress',
    'interview_ai_turns_session_index_unique',
    'interview_ai_results_session_unique',
    'presentation_sessions_one_in_progress',
    'presentation_attempts_session_index_unique',
    'presentation_results_attempt_unique',
    'presentation_qa_turns_attempt_index_unique',
    'presentation_qa_reviews_attempt_index_unique',
    'presentation_practice_records_local_unique'
  ]) AS i
),
buckets AS (
  SELECT unnest(ARRAY['presentation-recordings','presentation-materials']) AS b
)
-- 1. テーブル存在
SELECT '1.table' AS check_group, t AS object,
  CASE WHEN to_regclass('public.'||t) IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM tables
UNION ALL
-- 2. RLS 有効
SELECT '2.rls', t,
  CASE
    WHEN to_regclass('public.'||t) IS NULL THEN 'TABLE-MISSING'
    WHEN (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.'||t)) THEN 'ENABLED'
    ELSE 'DISABLED'
  END
FROM tables
UNION ALL
-- 3. policy 件数（0 は要確認）
SELECT '3.policies', t,
  COALESCE((SELECT count(*)::text FROM pg_policies p WHERE p.schemaname='public' AND p.tablename = t), '0')
FROM tables
UNION ALL
-- 4. index / unique 制約
SELECT '4.index', i,
  CASE WHEN to_regclass('public.'||i) IS NOT NULL THEN 'OK' ELSE 'MISSING' END
FROM indexes
UNION ALL
-- 5. 共有関数
SELECT '5.function', 'set_updated_at',
  CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN 'OK' ELSE 'MISSING' END
UNION ALL
-- 6. interview_ai_sessions.source CHECK が 'realtime' を含むか（realtime migration 適用済みか）
SELECT '6.check', 'interview_ai_sessions_source_check(realtime)',
  CASE
    WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_ai_sessions_source_check'
                 AND pg_get_constraintdef(oid) LIKE '%realtime%') THEN 'OK(has realtime)'
    WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_ai_sessions_source_check')
      THEN 'NEEDS-MIGRATION(no realtime)'
    ELSE 'MISSING'
  END
UNION ALL
-- 7. storage bucket（presentation 録画 / 教材）
SELECT '7.storage.bucket', b,
  CASE WHEN EXISTS (SELECT 1 FROM storage.buckets WHERE id = b) THEN 'OK' ELSE 'MISSING' END
FROM buckets
ORDER BY check_group, object;

-- 期待結果の目安:
--   1.table          : 全て OK
--   2.rls            : 全て ENABLED
--   3.policies       : 各テーブル >= 1（owner select/insert/update/delete 等）
--   4.index          : 全て OK
--   5.function       : OK
--   6.check          : OK(has realtime)  ← realtime source migration 適用済み
--   7.storage.bucket : 全て OK（presentation を公開する場合）
--
-- いずれかが MISSING / DISABLED / NEEDS-MIGRATION / 0 の場合は、該当 migration を適用してから再実行する。
