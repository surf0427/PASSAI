-- ============================================================
-- Interview AI — DDL apply (interview-ai PR1/PR3/PR6)
-- supabase/schema.sql §53-§62 (lines 1666-2123) の逐語スライス。
-- 正本は schema.sql。本ファイルは Supabase SQL Editor 貼り付け用の apply ヘルパ。
-- 依存順は schema.sql の並び順そのまま:
--   §53-55 interview_practice_records (独立)
--   §56-58 interview_ai_sessions (先) → §59-60 interview_ai_results → §61-62 interview_ai_turns
-- 前提: pgcrypto / set_updated_at() / auth.users が既存であること。
-- ============================================================

-- 53. interview_practice_records
--     STEP-INTERVIEW-AI-PR1. localStorage key='interview_records'
--     （面接練習記録 / lib/interviewRecordStorage.ts の StoredInterviewRecord[]）の
--     auth-scoped Supabase durable mirror。localStorage canonical は維持し、本 table は
--     同期先（best-effort durable mirror）。self_prs §35 / statement_review_history §38 /
--     self_analysis_logs §32 / tutor_chat_* §19 と同じ auth-scoped 永続層であり、
--     mirror_events 系統ではない。
--
--     natural key は (user_id, local_record_id)。local_record_id = StoredInterviewRecord.id
--     （crypto.randomUUID() 由来の UUID 文字列）をそのまま使う。contentHash では dedup
--     しない（同一大学・同一日付の別練習も別個の正当な記録であり、id を identity とする）。
--
--     StoredInterviewRecord はアプリ上 in-place 編集経路を持たず、作成（addInterviewRecord）と
--     削除（deleteInterviewRecord）のみ。よって upsert は冪等で、UPDATE 経路は同一内容の
--     再書込（または将来の metadata 拡張）に使われる。
--
--     delete を伴う feature である点に注意。localStorage 側の id 指定削除は本 STEP では
--     DB に伝播しない（上り mirror は upsert-only / propagateDelete=false）。down-sync /
--     restore は delete resurrection リスクのため tombstone 設計後の別 STEP に分離する。
--
--     feedback_json は AI 面接フィードバック（InterviewFeedback）の構造化データ。
--     localStorage では JSON 文字列（StoredInterviewRecord.feedbackJson）で保持されるが、
--     本 table では jsonb として保存する（statement_review_history.result と同方針）。
--     旧記録は feedbackJson 欠落のため NULL になりうる。read 側の正規化（feedbackToText /
--     isInterviewFeedback）は restore STEP が担保し、本 mirror は raw を忠実保存する。
CREATE TABLE interview_practice_records (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  local_record_id     text         NOT NULL,
  practice_date       text         NOT NULL DEFAULT '',
  university_name     text         NOT NULL DEFAULT '',
  faculty_name        text         NOT NULL DEFAULT '',
  exam_type           text         NOT NULL DEFAULT '',
  partner             text         NOT NULL DEFAULT '',
  main_question       text         NOT NULL DEFAULT '',
  improvement_summary text         NOT NULL DEFAULT '',
  questions_asked     text         NOT NULL DEFAULT '',
  my_answers          text         NOT NULL DEFAULT '',
  what_went_wrong     text         NOT NULL DEFAULT '',
  feedback_received   text         NOT NULL DEFAULT '',
  self_noted          text         NOT NULL DEFAULT '',
  feedback_json       jsonb,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  metadata            jsonb        NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT interview_practice_records_local_unique UNIQUE (user_id, local_record_id)
);

COMMENT ON TABLE interview_practice_records IS
  'STEP-INTERVIEW-AI-PR1. localStorage interview_records（面接練習記録）の auth-scoped '
  'Supabase durable mirror。localStorage canonical は維持し、本 table は同期先。'
  'natural key = (user_id, local_record_id)。local_record_id = StoredInterviewRecord.id。'
  'feedback_json = InterviewFeedback（jsonb）。記録は作成 + 削除のみで in-place 編集なし。'
  'delete を伴う feature であり、restore は tombstone 設計後の別 STEP に分離する。';

COMMENT ON COLUMN interview_practice_records.user_id IS
  'auth.users(id). Owner key. RLS gate uses auth.uid() = user_id.';

COMMENT ON COLUMN interview_practice_records.local_record_id IS
  'localStorage の StoredInterviewRecord.id（crypto.randomUUID() 由来の UUID 文字列）を '
  'そのまま入れる。natural key の一部で upsert の onConflict 対象。contentHash ではなく '
  'id を identity とする。';

COMMENT ON COLUMN interview_practice_records.feedback_json IS
  'StoredInterviewRecord.feedbackJson（AI 面接フィードバックの構造化データ）を jsonb 化して '
  '保存。LS では JSON 文字列で持つ。旧記録は欠落のため NULL になりうる。表示時の正規化は '
  'read 側（feedbackToText / isInterviewFeedback）が担保し、本 mirror は raw を忠実保存する。';

COMMENT ON COLUMN interview_practice_records.created_at IS
  'StoredInterviewRecord.createdAt を backfill 時に原値保持する（LS の作成時刻）。';

COMMENT ON CONSTRAINT interview_practice_records_local_unique ON interview_practice_records IS
  'UNIQUE(user_id, local_record_id)。StoredInterviewRecord.id を natural key とし、'
  'onConflict 指定の upsert を冪等化するための制約。contentHash は使わない。';


-- 54. trigger: keep updated_at fresh (re-uses set_updated_at() from §3)
--     StoredInterviewRecord は in-place 編集を持たないためアプリ起点の UPDATE は基本
--     起きないが、upsert の ON CONFLICT DO UPDATE 経路（同一内容の再書込）や将来の拡張に
--     備えて自動更新を付与する（statement_review_history §39 と同形）。
CREATE TRIGGER interview_practice_records_set_updated_at
  BEFORE UPDATE ON interview_practice_records
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- 55. RLS — interview_practice_records
--     Anonymous Auth 経由でも role=authenticated として届くので policy 対象は
--     authenticated。すべての行操作は auth.uid() = user_id で閉じる
--     （self_prs §37 / statement_review_history §40 と同形）。
--
--     UPDATE policy について: 記録は in-place 編集されないが、Supabase の
--     .upsert(..., {onConflict}) は INSERT ... ON CONFLICT DO UPDATE を発行する。
--     UPDATE policy が無いと、冪等な再 upsert（backfill 再実行など）が DO UPDATE 経路で
--     RLS に弾かれ、mirror helper の devWarn に黙って失敗が出続ける。これを避けるため
--     owner update policy を置く。アプリが content を能動更新することはない。
ALTER TABLE interview_practice_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "interview_practice_records owner select"
  ON interview_practice_records
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "interview_practice_records owner insert"
  ON interview_practice_records
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "interview_practice_records owner update"
  ON interview_practice_records
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "interview_practice_records owner delete"
  ON interview_practice_records
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- ──────────────────────────────────────────────────────────────────────
-- STEP-INTERVIEW-AI-PR3: Interview AI（リアルタイム面接セッション）の DB 基盤
--
-- 目的:
--   docs/interview_ai/pr0_design.md で確定した Interview AI 機能のスキーマを導入する。
--   本 PR は **schema + RLS のみ**（repository / route / 課金配線 / STT は後続 PR）。
--
-- 既存 interview_practice_records（§53）との区別:
--   §53 は既存の面接練習「記録」（手入力 + 一括 AI フィードバック）の localStorage mirror。
--   本系統（interview_ai_*）は対話型・逐次ターンの「リアルタイム面接 AI セッション」であり、
--   別 feature・別課金単位（1 セッション 1 quota）・別冪等化（usage_recorded）を持つ。
--
-- 課金との関係（pr0_design.md §2–§5）:
--   - quota feature は別キー 'interview-ai'（lib/billing/quotas.ts。本 PR では未追加 → 別 PR）。
--   - recordUsage は「voice の最初の STT 成功」「text の最初の回答保存」の 2 箇所のみ。
--   - 二重課金防止は interview_ai_sessions.usage_recorded の compare-and-set:
--       UPDATE interview_ai_sessions SET usage_recorded = true
--       WHERE id = :id AND usage_recorded = false RETURNING id;
--     行が返ったプロセスだけが recordUsage を呼ぶ。
--   - 本 PR は schema のみ。compare-and-set / recordUsage の実装は後続 PR。
--
--   §56  interview_ai_sessions table
--   §57  interview_ai_sessions trigger (set_updated_at) + in_progress 部分 unique index
--   §58  interview_ai_sessions RLS（owner 直接判定）
--   §59  interview_ai_results table
--   §60  interview_ai_results RLS（EXISTS 方式 — 親セッション所有を構造的に保証）
--
-- 所有者契約:
--   user_id は auth.users(id) を参照する owner key。RLS gate は auth.uid()=user_id
--   （results は親 interview_ai_sessions の所有を EXISTS で判定）。
--   課金計上（usage_recorded の compare-and-set / final feedback 保存）は service_role
--   （server-only）から行う想定で、RLS をバイパスする。owner policy は client 読み取り /
--   セッション状態遷移のための経路。
-- ──────────────────────────────────────────────────────────────────────


-- 56. interview_ai_sessions
--     リアルタイム面接 AI の 1 セッション。状態・課金冪等フラグ・対象参照を持つ。
--     pr0_design.md §6.1。
CREATE TABLE interview_ai_sessions (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source          text         NOT NULL,
  status          text         NOT NULL DEFAULT 'in_progress',
  usage_recorded  boolean      NOT NULL DEFAULT false,
  target_ref      jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  metadata        jsonb        NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT interview_ai_sessions_source_check
    CHECK (source IN ('voice', 'text')),
  CONSTRAINT interview_ai_sessions_status_check
    CHECK (status IN ('in_progress', 'completed', 'abandoned'))
);

COMMENT ON TABLE interview_ai_sessions IS
  'STEP-INTERVIEW-AI-PR3. リアルタイム面接 AI の 1 セッション（auth-scoped）。'
  '1 セッション = interview-ai quota を正確に 1 回消費する課金単位。usage_recorded は '
  'voice/text 共通の二重課金防止フラグ（compare-and-set 対象）。pr0_design.md §6.1。';

COMMENT ON COLUMN interview_ai_sessions.user_id IS
  'auth.users(id). Owner key. RLS gate uses auth.uid() = user_id.';

COMMENT ON COLUMN interview_ai_sessions.source IS
  'CHECK in (voice, text)。課金トリガが分岐する: voice=最初の STT 成功 / '
  'text=最初の回答保存（pr0_design.md §2）。';

COMMENT ON COLUMN interview_ai_sessions.status IS
  'CHECK in (in_progress, completed, abandoned)。in_progress は user ごと 1 件まで '
  '（§57 の部分 unique index で強制）。pr0_design.md §7.3。';

COMMENT ON COLUMN interview_ai_sessions.usage_recorded IS
  '二重課金防止フラグ。compare-and-set（UPDATE ... WHERE usage_recorded=false '
  'RETURNING id）で行が返ったプロセスだけが recordUsage を呼ぶ。pr0_design.md §3。';

COMMENT ON COLUMN interview_ai_sessions.target_ref IS
  '面接対象（大学 / 学部 / 想定質問セット等）の参照。アプリ契約として version キーを '
  '含める（pr0_design.md §6.3）。DB は jsonb の shape を強制しない（既存 durable table と同方針）。';


-- 57. trigger + in_progress 部分 unique index
--     trigger: set_updated_at()（§3 共有）でセッション状態遷移時の updated_at を維持。
--     部分 unique index: status='in_progress' の行を user_id ごと 1 件に制限する。
--       これが deferred recordUsage（gate 通過後〜計上までの窓）の quota 回避を封じる要
--       （pr0_design.md §3.3 / §7.3）。completed / abandoned には制約がかからない。
CREATE TRIGGER interview_ai_sessions_set_updated_at
  BEFORE UPDATE ON interview_ai_sessions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX interview_ai_sessions_one_in_progress
  ON interview_ai_sessions (user_id)
  WHERE status = 'in_progress';


-- 58. RLS — interview_ai_sessions
--     Anonymous Auth 経由でも role=authenticated として届くので policy 対象は
--     authenticated。すべての行操作は auth.uid() = user_id で閉じる。
--     課金計上（usage_recorded の compare-and-set）は service_role（server-only）が
--     RLS をバイパスして行う想定。owner policy は client 読み取り / 状態遷移の経路。
ALTER TABLE interview_ai_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "interview_ai_sessions owner select"
  ON interview_ai_sessions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "interview_ai_sessions owner insert"
  ON interview_ai_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "interview_ai_sessions owner update"
  ON interview_ai_sessions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "interview_ai_sessions owner delete"
  ON interview_ai_sessions
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- 59. interview_ai_results
--     セッション完了時の最終フィードバック（音声は保存しない / pr0_design.md §7.1）。
--     feedback は既存 InterviewFeedback（types/interview.ts）を jsonb 丸ごと保存し、
--     strengths / improvements / next_practice は結果サマリの正規化カラム
--     （履歴一覧 / 成長メモから JOIN なしで読めるようにする。pr0_design.md §6.2）。
--     1 セッション 1 結果（UNIQUE(session_id)）。完了時の upsert を冪等化する。
CREATE TABLE interview_ai_results (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid         NOT NULL REFERENCES public.interview_ai_sessions(id) ON DELETE CASCADE,
  user_id        uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feedback       jsonb        NOT NULL,
  strengths      text[]       NOT NULL DEFAULT '{}',
  improvements   text[]       NOT NULL DEFAULT '{}',
  next_practice  text[]       NOT NULL DEFAULT '{}',
  created_at     timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT interview_ai_results_session_unique UNIQUE (session_id)
);

COMMENT ON TABLE interview_ai_results IS
  'STEP-INTERVIEW-AI-PR3. 面接 AI セッションの最終フィードバック（auth-scoped）。'
  'feedback = InterviewFeedback（jsonb）。strengths/improvements/next_practice は正規化カラム。'
  '音声は保存しない。1 セッション 1 結果（UNIQUE(session_id)）。pr0_design.md §6.2 / §7.1。';

COMMENT ON COLUMN interview_ai_results.session_id IS
  'interview_ai_sessions(id) を参照。ON DELETE CASCADE。UNIQUE で 1 セッション 1 結果。';

COMMENT ON COLUMN interview_ai_results.user_id IS
  'auth.users(id). owner key を複製（JOIN なしの直接参照用）。RLS は §60 の EXISTS 方式で '
  '親セッション所有を判定する（user_id 単独ではなく親 row の所有を構造的に保証）。';

COMMENT ON COLUMN interview_ai_results.feedback IS
  'InterviewFeedback（types/interview.ts）を jsonb 丸ごと保存。既存 feedbackToText / '
  'isInterviewFeedback を read 側で再利用する。pr0_design.md §8。';


-- 60. RLS — interview_ai_results（EXISTS 方式）
--     results の所有は「親 interview_ai_sessions が自分のものか」を EXISTS で判定する
--     （pr0_design.md §6.4）。user_id を複製しているため auth.uid()=user_id でも閉じるが、
--     親セッションの所有と結果の所有が必ず一致することを RLS で保証するため EXISTS を採る
--     （孤児・付け替えを構造的に排除）。final feedback の書き込みは service_role（server-only）が
--     RLS をバイパスして行う想定。owner policy は client 読み取り経路。
ALTER TABLE interview_ai_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "interview_ai_results owner select"
  ON interview_ai_results
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM interview_ai_sessions s
      WHERE s.id = interview_ai_results.session_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "interview_ai_results owner insert"
  ON interview_ai_results
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM interview_ai_sessions s
      WHERE s.id = interview_ai_results.session_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "interview_ai_results owner update"
  ON interview_ai_results
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM interview_ai_sessions s
      WHERE s.id = interview_ai_results.session_id
        AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM interview_ai_sessions s
      WHERE s.id = interview_ai_results.session_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "interview_ai_results owner delete"
  ON interview_ai_results
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM interview_ai_sessions s
      WHERE s.id = interview_ai_results.session_id
        AND s.user_id = auth.uid()
    )
  );


-- 61. interview_ai_turns
--     STEP-INTERVIEW-AI-PR6. 面接 AI セッションの 1 ターン（質問 or 回答）の transcript。
--     音声は保存しない（content は transcript テキストのみ。pr0_design.md §7.1 / PR6 必須条件 §6）。
--     role='question'（AI 生成の質問）/ 'answer'（候補者の回答）。source は当該 content の入力
--     モダリティ（question は常に text、answer は voice=STT / text=直接入力）。
--     turn_index は session 内の 0 始まり連番（0=seed question, 1=answer, 2=followup, ...）。
--     ターン上限（MVP 3〜5）は role='answer' の件数で route 側が強制する（PR6 必須条件 §7）。
CREATE TABLE interview_ai_turns (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid         NOT NULL REFERENCES public.interview_ai_sessions(id) ON DELETE CASCADE,
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  turn_index  integer      NOT NULL,
  role        text         NOT NULL,
  source      text         NOT NULL,
  content     text         NOT NULL,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT interview_ai_turns_role_check
    CHECK (role IN ('question', 'answer')),
  CONSTRAINT interview_ai_turns_source_check
    CHECK (source IN ('voice', 'text')),
  CONSTRAINT interview_ai_turns_session_index_unique UNIQUE (session_id, turn_index)
);

COMMENT ON TABLE interview_ai_turns IS
  'STEP-INTERVIEW-AI-PR6. 面接 AI セッションの 1 ターンの transcript（auth-scoped）。'
  '音声は保存しない（content は transcript のみ）。role=question/answer。turn_index は '
  'session 内 0 始まり連番。ターン上限は role=answer 件数で route 側が強制。';

COMMENT ON COLUMN interview_ai_turns.user_id IS
  'auth.users(id). owner key を複製（JOIN なし参照用）。RLS は §62 の EXISTS 方式で '
  '親 interview_ai_sessions 所有を判定する。';

COMMENT ON COLUMN interview_ai_turns.role IS
  'CHECK in (question, answer)。question=AI 生成の質問 / answer=候補者の回答。';

COMMENT ON COLUMN interview_ai_turns.source IS
  'CHECK in (voice, text)。content の入力モダリティ。question は常に text、'
  'answer は voice(STT) / text(直接)。';

COMMENT ON COLUMN interview_ai_turns.content IS
  'transcript テキスト。音声ファイルは一切保存しない（PR6 必須条件 §6）。';

COMMENT ON CONSTRAINT interview_ai_turns_session_index_unique ON interview_ai_turns IS
  'UNIQUE(session_id, turn_index)。同一セッション内のターン順序を一意化し、'
  '二重 insert（リトライ）を弾く。';


-- 62. RLS — interview_ai_turns（EXISTS 方式 / interview_ai_results §60 と同形）
--     親 interview_ai_sessions が自分のものかを EXISTS で判定する。turn の書き込みは
--     service_role（server-only / turn route）が RLS をバイパスして行う想定。owner policy は
--     client 読み取り経路。
ALTER TABLE interview_ai_turns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "interview_ai_turns owner select"
  ON interview_ai_turns
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM interview_ai_sessions s
      WHERE s.id = interview_ai_turns.session_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "interview_ai_turns owner insert"
  ON interview_ai_turns
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM interview_ai_sessions s
      WHERE s.id = interview_ai_turns.session_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "interview_ai_turns owner update"
  ON interview_ai_turns
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM interview_ai_sessions s
      WHERE s.id = interview_ai_turns.session_id
        AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM interview_ai_sessions s
      WHERE s.id = interview_ai_turns.session_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "interview_ai_turns owner delete"
  ON interview_ai_turns
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM interview_ai_sessions s
      WHERE s.id = interview_ai_turns.session_id
        AND s.user_id = auth.uid()
    )
  );
