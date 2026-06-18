-- ============================================================
-- Interview AI — realtime source migration（既存 interview_ai_sessions.source CHECK 拡張）
--
-- 目的: WebRTC リアルタイム音声面接モードのセッションを source='realtime' で表す。
--   既存のターン制（voice/text）は無改変。realtime は別モードとして共存する。
--   token route（/api/interview-ai/realtime/token）が source='realtime' の session を作るため、
--   ルート投入前に本 migration を先に適用する必要がある。
--
-- 安全性（本 migration が守ること）:
--   - CHECK 制約に 'realtime' を **追加するだけ**（許可値の拡大 = 既存行はすべて合法のまま）。
--   - 既存データ破壊なし / 列追加なし / DROP COLUMN なし / RLS 変更なし / policy 変更なし。
--   - DROP CONSTRAINT → ADD CONSTRAINT の 2 段で置換する（Postgres は CHECK の in-place 変更不可）。
--   - 再実行時は IF EXISTS により無害（冪等）。
--
-- 適用: Supabase SQL Editor に本ファイル全文を貼って実行。
--   本番では REALTIME_INTERVIEW_ENABLED を未設定（=token 発行不可）のままにする。
--   許可値だけ先に広げても、サーバゲートが無効なら realtime session は一切作られない。
-- ============================================================

ALTER TABLE public.interview_ai_sessions
  DROP CONSTRAINT IF EXISTS interview_ai_sessions_source_check;

ALTER TABLE public.interview_ai_sessions
  ADD CONSTRAINT interview_ai_sessions_source_check
    CHECK (source IN ('voice', 'text', 'realtime'));

-- 検証（任意）:
--   SELECT pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conname = 'interview_ai_sessions_source_check';
--   -- 期待: CHECK ((source = ANY (ARRAY['voice'::text, 'text'::text, 'realtime'::text])))
