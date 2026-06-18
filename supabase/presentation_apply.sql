-- ============================================================
-- Presentation — DDL apply (PR1 + 拡張: material + university + theme-mode)
-- supabase/schema.sql §63-§79 の逐語スライス。正本は schema.sql。
-- Supabase SQL Editor 貼り付け用。前提: pgcrypto / set_updated_at() / auth.users /
-- storage.objects(RLS既定有効) が既存であること。
-- ============================================================

-- ──────────────────────────────────────────────────────────────────────
-- STEP-PRESENTATION-PR1: プレゼン機能（録画 → AI評価 → 発表後AI質問）の DB 基盤
--
-- 目的:
--   docs/presentation/pr0_design.md で確定したプレゼン機能のスキーマを導入する。
--   本 PR は **schema + RLS + Storage bucket/policy のみ**
--   （repository / route / 課金配線 / STT / Storage アップロード UI / AI プロンプトは後続 PR）。
--
-- 面接 AI（interview_ai_* §56-§62）との関係:
--   - 設計思想（1 セッション 1 課金 / usage_recorded compare-and-set / カテゴリ評価 /
--     ターン制 Q&A / owner RLS / set_updated_at 共有）を踏襲する。
--   - 最大の差分は「動画を Supabase Storage に永続保存する」点（面接 AI は音声非保存）。
--     文字起こしテキストのみ DB 保存する点は面接 AI と同じ（attempts.transcript）。
--
-- 課金との関係（pr0_design.md §8）:
--   - quota feature は別キー 'presentation'（lib/billing/quotas.ts。本 PR では未追加 → 別 PR）。
--     basic=0（Basic 利用不可 = Premium 限定）/ premium=20（暫定。動画 Storage 原価込みで要調整）。
--   - recordUsage は「初回 AI 評価成功時」の 1 箇所のみ。アップロード・文字起こしでは消費しない。
--   - 二重課金防止は presentation_sessions.usage_recorded の compare-and-set（§63）:
--       UPDATE presentation_sessions SET usage_recorded = true
--       WHERE id = :id AND usage_recorded = false RETURNING id;
--     行が返ったプロセスだけが recordUsage を呼ぶ。
--   - 録り直しは追加消費しない（usage_recorded を attempt ではなく session に持たせるため）。
--   - 本 PR は schema のみ。compare-and-set / recordUsage / ensurePlanQuota 配線は後続 PR。
--
--   §63 presentation_sessions table
--   §64 presentation_sessions trigger (set_updated_at) + in_progress 部分 unique index
--   §65 presentation_sessions RLS（owner 直接判定 / DELETE policy は付与しない＝server-only）
--   §66 presentation_attempts table
--   §67 presentation_attempts trigger (set_updated_at)
--   §68 presentation_attempts RLS（owner SELECT のみ / 書込は service_role）
--   §69 presentation_results table
--   §70 presentation_results RLS（owner SELECT のみ / 書込は service_role）
--   §71 presentation_qa_turns table
--   §72 presentation_qa_turns RLS（owner SELECT のみ / 書込は service_role）
--   §73 presentation_practice_records table
--   §74 presentation_practice_records trigger (set_updated_at)
--   §75 presentation_practice_records RLS（owner 直接判定 / 全 CRUD）
--   §76 Storage bucket: presentation-recordings（private）
--   §77 Storage RLS — storage.objects（path 第1階層 = auth.uid() の本人 SELECT/INSERT のみ）
--
-- 所有者契約 / RLS 方針（pr0_design.md §9）:
--   - user_id は auth.users(id) を参照する owner key。
--   - 親（sessions / practice_records）: owner 直接判定（auth.uid()=user_id）。
--   - 子（attempts/results/qa_turns）: user_id を非正規化で持ち、SELECT は auth.uid()=user_id で
--     閉じる。INSERT/UPDATE/DELETE policy は **付与しない** ＝ authenticated からの書込を DB
--     レベルで禁じ、サーバルート（service_role / RLS バイパス）に限定する（評価・課金・文字起こし
--     の改ざん防止）。
--   - session / attempt の削除は Storage オブジェクトの明示削除（storage.remove）を伴うため
--     サーバルート専用とし、authenticated の DELETE policy を付与しない（孤児動画防止 / 要対応B）。
--     practice_records は Storage 非関与のため owner DELETE を許可する（interview_practice_records 同方針）。
-- ──────────────────────────────────────────────────────────────────────


-- 63. presentation_sessions
--     プレゼン練習の 1 セッション。テーマ設定 ＋ 課金冪等フラグ（usage_recorded）を持つ
--     課金単位。1 セッション = presentation quota を正確に 1 回消費する。pr0_design.md §4.2。
CREATE TABLE presentation_sessions (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status          text         NOT NULL DEFAULT 'in_progress',
  university_name text         NOT NULL DEFAULT '',
  faculty_name    text         NOT NULL DEFAULT '',
  -- 大学選択画面（STEP-PRESENTATION-UNIVERSITY）の任意項目。手入力。NULL 許容（後方互換）。
  department_name        text,
  admission_type         text,
  presentation_format    text,
  presentation_limit_sec integer,
  university_notes       text,
  theme           text         NOT NULL DEFAULT '',
  time_limit_sec  integer      NOT NULL DEFAULT 0,
  script          text         NOT NULL DEFAULT '',
  -- テーマ設定モード（STEP-PRESENTATION-THEME-MODE）。'manual' | 'generated'。NULL 許容（既存=manual 相当）。
  theme_mode             text,
  generated_conditions   jsonb,   -- generated 時の発表条件（string[]）
  generated_questions    jsonb,   -- generated 時の想定質問（string[]）
  -- 発表資料（任意 / Premium 限定機能の拡張。STEP-PRESENTATION-MATERIAL）。
  --   1 セッション 1 資料（presentation-materials bucket の userId/sessionId/material.ext を指す）。
  --   未アップロードなら全て NULL（後方互換: 既存セッションは NULL）。
  material_path       text,
  material_mime_type  text,
  material_file_name  text,
  material_size_bytes integer,
  usage_recorded  boolean      NOT NULL DEFAULT false,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  metadata        jsonb        NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT presentation_sessions_status_check
    CHECK (status IN ('in_progress', 'completed', 'abandoned'))
);

COMMENT ON TABLE presentation_sessions IS
  'STEP-PRESENTATION-PR1. プレゼン練習の 1 セッション（auth-scoped）。テーマ設定（志望校 / '
  '学部学科 / テーマ / 制限時間 / 原稿）と課金単位を兼ねる。1 セッション = presentation quota を '
  '正確に 1 回消費。usage_recorded は二重課金防止フラグ（compare-and-set 対象）。pr0_design.md §4.2 / §8。';

COMMENT ON COLUMN presentation_sessions.user_id IS
  'auth.users(id). Owner key. RLS gate uses auth.uid() = user_id.';

COMMENT ON COLUMN presentation_sessions.status IS
  'CHECK in (in_progress, completed, abandoned)。in_progress は user ごと 1 件まで '
  '（§64 の部分 unique index で強制）。pr0_design.md §4.2。';

COMMENT ON COLUMN presentation_sessions.usage_recorded IS
  '二重課金防止フラグ。初回 AI 評価成功時に compare-and-set（UPDATE ... WHERE usage_recorded=false '
  'RETURNING id）で行が返ったプロセスだけが recordUsage を呼ぶ。録り直しは session 単位のため '
  '追加消費しない。pr0_design.md §8。';

COMMENT ON COLUMN presentation_sessions.time_limit_sec IS
  '制限時間（秒）。AI 評価の timeManagement 軸で attempts.duration_sec との差を判定する入力。';

COMMENT ON COLUMN presentation_sessions.admission_type IS
  '大学選択画面の任意項目（学科名 / 入試方式 / プレゼン形式 / 想定制限時間 / 備考）の一つ。'
  '手入力・NULL 許容。AI 評価プロンプトの想定大学・入試方式の文脈に使う。'
  '後追い列追加は supabase/presentation_university_migration.sql。';

COMMENT ON COLUMN presentation_sessions.material_path IS
  '発表資料の Storage オブジェクトキー（presentation-materials）。形式 userId/sessionId/material.ext。'
  'サーバが (userId, sessionId, ext) から正準生成する。未アップロードなら NULL。'
  '後追い列追加は supabase/presentation_materials_migration.sql。';


-- 64. trigger + in_progress 部分 unique index（interview_ai_sessions §57 と同形）
--     部分 unique index: status='in_progress' の行を user_id ごと 1 件に制限する。
--       同時多重セッションを封じ、deferred recordUsage（評価成功までの窓）の quota 回避を防ぐ。
--       completed / abandoned には制約がかからない。pr0_design.md §4.2。
CREATE TRIGGER presentation_sessions_set_updated_at
  BEFORE UPDATE ON presentation_sessions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX presentation_sessions_one_in_progress
  ON presentation_sessions (user_id)
  WHERE status = 'in_progress';

CREATE INDEX presentation_sessions_user_created_idx
  ON presentation_sessions (user_id, created_at DESC);


-- 65. RLS — presentation_sessions
--     owner 直接判定（auth.uid()=user_id）。SELECT/INSERT/UPDATE のみ付与する。
--     DELETE policy は **付与しない**: セッション削除は子 attempt の Storage オブジェクト削除
--     （storage.remove）を伴うため、サーバルート（service_role / RLS バイパス）専用とする
--     （要対応B / 孤児動画防止）。課金計上（usage_recorded の compare-and-set）も service_role。
ALTER TABLE presentation_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "presentation_sessions owner select"
  ON presentation_sessions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "presentation_sessions owner insert"
  ON presentation_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "presentation_sessions owner update"
  ON presentation_sessions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- 66. presentation_attempts
--     1 録画 = 1 動画（Storage）+ 1 文字起こし。録り直しで session ごとに複数行になる。
--     attempt_id は Storage パス確定のためクライアントが crypto.randomUUID() で先に採番し、
--     サーバ route がその id を明示指定して INSERT する想定（DEFAULT は fallback）。
--     storage_path はサーバが (userId, sessionId, attemptId, ext) から **正準生成** する
--     （クライアント送信値を信用しない / 要対応A / pr0_design.md §5.2）。
--     録り直し上限（最大 3）は DB では UNIQUE(session_id, attempt_index) までで、
--     attempt_index>3 の拒否（409）はサーバ route が count して強制する（要対応・pr0_design.md §6）。
CREATE TABLE presentation_attempts (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid         NOT NULL REFERENCES public.presentation_sessions(id) ON DELETE CASCADE,
  user_id        uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attempt_index  integer      NOT NULL DEFAULT 1,
  storage_path   text         NOT NULL DEFAULT '',
  transcript     text         NOT NULL DEFAULT '',
  duration_sec   integer      NOT NULL DEFAULT 0,
  status         text         NOT NULL DEFAULT 'uploaded',
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  metadata       jsonb        NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT presentation_attempts_status_check
    CHECK (status IN ('uploaded', 'transcribed', 'evaluated', 'failed')),
  CONSTRAINT presentation_attempts_session_index_unique UNIQUE (session_id, attempt_index)
);

COMMENT ON TABLE presentation_attempts IS
  'STEP-PRESENTATION-PR1. プレゼンの 1 録画 = 1 動画 + 1 文字起こし（auth-scoped）。'
  '録り直しで session ごとに複数行。動画は Storage（presentation-recordings）に保存し、'
  '本テーブルには storage_path（参照）と transcript（文字起こし）のみ持つ。pr0_design.md §4.3。';

COMMENT ON COLUMN presentation_attempts.user_id IS
  'auth.users(id). owner key を複製（JOIN なし参照用）。RLS（§68）は auth.uid()=user_id の '
  'SELECT のみ。書込は service_role。';

COMMENT ON COLUMN presentation_attempts.attempt_index IS
  '同一 session 内の録り直し番号（1 始まり）。最大 3。DB は UNIQUE(session_id, attempt_index) '
  'までを保証し、4 本目以降（attempt_index>3）の 409 拒否はサーバ route が count で強制する。';

COMMENT ON COLUMN presentation_attempts.storage_path IS
  'Storage オブジェクトキー。形式 user_id/session_id/attempt_id.ext。サーバが (userId, '
  'sessionId, attemptId, ext) から正準生成して保存する。クライアント送信値はそのまま保存しない '
  '（要対応A / pr0_design.md §5.2）。';

COMMENT ON COLUMN presentation_attempts.transcript IS
  '文字起こしテキストのみ。音声ファイルは保存しない（音声は録画直後にクライアントが '
  'multipart で transcribe に送り、Whisper で文字起こし。サーバ ffmpeg 不採用 / pr0_design.md §11）。';

COMMENT ON COLUMN presentation_attempts.duration_sec IS
  '実測発表時間（秒）。AI 評価の timeManagement 軸で session.time_limit_sec との差を判定する入力。';

COMMENT ON COLUMN presentation_attempts.status IS
  'CHECK in (uploaded, transcribed, evaluated, failed)。uploaded(動画保存済) → transcribed(STT済) '
  '→ evaluated(評価済) / failed。pr0_design.md §4.3。';

COMMENT ON COLUMN presentation_attempts.metadata IS
  '動画ファイルの付帯情報（video_mime_type / video_size_bytes 等）を attempt route が記録する。'
  'DB は shape を強制しない（sessions / practice_records の metadata と同方針）。'
  '本番への後追いは supabase/presentation_attempts_metadata_migration.sql（ADD COLUMN IF NOT EXISTS）。';


-- 67. trigger（set_updated_at / §3 共有）
CREATE TRIGGER presentation_attempts_set_updated_at
  BEFORE UPDATE ON presentation_attempts
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- 68. RLS — presentation_attempts（owner SELECT のみ / 書込は service_role）
--     user_id を非正規化で持つため SELECT は auth.uid()=user_id で直接判定する
--     （履歴のクライアント直読み経路）。INSERT/UPDATE/DELETE policy は付与しない＝
--     authenticated からの書込を DB レベルで禁じ、サーバルート（service_role）に限定する。
ALTER TABLE presentation_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "presentation_attempts owner select"
  ON presentation_attempts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);


-- 69. presentation_results
--     attempt への AI カテゴリ評価（1:1）。feedback は PresentationFeedback を jsonb 丸ごと、
--     categories は {composition:'strong',...} の投影（履歴一覧の高速表示用）。
--     1 attempt 1 結果（UNIQUE(attempt_id)）で評価の二重 INSERT を弾く。再評価は新 attempt。
--     セッション代表 result は「attempt_index 最大の evaluated attempt」とする（pr0_design.md §4.4）。
CREATE TABLE presentation_results (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id  uuid         NOT NULL REFERENCES public.presentation_attempts(id) ON DELETE CASCADE,
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feedback    jsonb        NOT NULL,
  categories  jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT presentation_results_attempt_unique UNIQUE (attempt_id)
);

COMMENT ON TABLE presentation_results IS
  'STEP-PRESENTATION-PR1. プレゼン attempt の AI カテゴリ評価（auth-scoped / 1:1）。'
  'feedback = PresentationFeedback（jsonb / categories は weak|normal|strong の 6 軸）。'
  '数値評価はしない。1 attempt 1 結果（UNIQUE(attempt_id)）。pr0_design.md §4.4 / §10.2。';

COMMENT ON COLUMN presentation_results.user_id IS
  'auth.users(id). owner key を複製。RLS（§70）は auth.uid()=user_id の SELECT のみ。書込は service_role。';

COMMENT ON COLUMN presentation_results.categories IS
  'feedback.categories の投影（{composition, persuasion, concreteness, clarity, timeManagement, '
  'completeness} ∈ weak|normal|strong）。履歴一覧で feedback 全文を読まずに表示するための非正規化。';


-- 70. RLS — presentation_results（owner SELECT のみ / 書込は service_role）
ALTER TABLE presentation_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "presentation_results owner select"
  ON presentation_results
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);


-- 71. presentation_qa_turns（interview_ai_turns §61 と同型）
--     発表後 AI 質問の 1 ターン（質問 or 回答）の transcript。音声は保存しない。
--     代表 attempt（評価済み）に紐づく。turn_index は attempt 内 0 始まり連番
--     （0=AI 質問, 1=回答, 2=深掘り, ...）。pr0_design.md §4.5。
CREATE TABLE presentation_qa_turns (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id  uuid         NOT NULL REFERENCES public.presentation_attempts(id) ON DELETE CASCADE,
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  turn_index  integer      NOT NULL,
  role        text         NOT NULL,
  source      text         NOT NULL,
  content     text         NOT NULL,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT presentation_qa_turns_role_check
    CHECK (role IN ('question', 'answer')),
  CONSTRAINT presentation_qa_turns_source_check
    CHECK (source IN ('voice', 'text')),
  CONSTRAINT presentation_qa_turns_attempt_index_unique UNIQUE (attempt_id, turn_index)
);

COMMENT ON TABLE presentation_qa_turns IS
  'STEP-PRESENTATION-PR1. 発表後 AI 質問の 1 ターンの transcript（auth-scoped）。音声は保存しない '
  '（content は transcript のみ）。role=question/answer。turn_index は attempt 内 0 始まり連番。'
  '面接 AI の interview_ai_turns と同型・ターン制 Q&A ロジックを流用。pr0_design.md §4.5 / §10。';

COMMENT ON COLUMN presentation_qa_turns.user_id IS
  'auth.users(id). owner key を複製。RLS（§72）は auth.uid()=user_id の SELECT のみ。書込は service_role。';

COMMENT ON COLUMN presentation_qa_turns.role IS
  'CHECK in (question, answer)。question=AI 生成の深掘り質問 / answer=受験生の回答。';

COMMENT ON COLUMN presentation_qa_turns.source IS
  'CHECK in (voice, text)。content の入力モダリティ。question は常に text、answer は voice(STT)/text(直接)。';


-- 72. RLS — presentation_qa_turns（owner SELECT のみ / 書込は service_role）
ALTER TABLE presentation_qa_turns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "presentation_qa_turns owner select"
  ON presentation_qa_turns
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);


-- 73. presentation_practice_records（対人プレゼン記録 / interview_practice_records §53 と同思想）
--     友達・先生・親との対人プレゼンを手動記録する。AI 不使用・課金なし・録画なし。
--     localStorage canonical の auth-scoped durable mirror。natural key = (user_id, local_record_id)。
--     local_record_id はクライアント側 id（crypto.randomUUID() 由来）をそのまま使う。
--     評価項目は全て自由記述（数値化しない）。pr0_design.md §4.6。
CREATE TABLE presentation_practice_records (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  local_record_id text         NOT NULL,
  practice_date   text         NOT NULL DEFAULT '',
  university_name text         NOT NULL DEFAULT '',
  faculty_name    text         NOT NULL DEFAULT '',
  theme           text         NOT NULL DEFAULT '',
  time_limit_sec  integer      NOT NULL DEFAULT 0,
  partner         text         NOT NULL DEFAULT '',
  composition     text         NOT NULL DEFAULT '',
  persuasion      text         NOT NULL DEFAULT '',
  concreteness    text         NOT NULL DEFAULT '',
  delivery        text         NOT NULL DEFAULT '',
  qa_note         text         NOT NULL DEFAULT '',
  good_points     text         NOT NULL DEFAULT '',
  improvements    text         NOT NULL DEFAULT '',
  next_task       text         NOT NULL DEFAULT '',
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  metadata        jsonb        NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT presentation_practice_records_local_unique UNIQUE (user_id, local_record_id)
);

COMMENT ON TABLE presentation_practice_records IS
  'STEP-PRESENTATION-PR1. 対人プレゼン記録（友達・先生・親）の auth-scoped durable mirror。'
  'AI 不使用・課金なし・録画なし。natural key = (user_id, local_record_id)。'
  'interview_practice_records §53 と同思想（localStorage canonical + upsert mirror）。pr0_design.md §4.6。';

COMMENT ON COLUMN presentation_practice_records.local_record_id IS
  'クライアント側 id（crypto.randomUUID() 由来）をそのまま入れる。natural key の一部で '
  'onConflict 指定 upsert の対象。';

COMMENT ON COLUMN presentation_practice_records.partner IS
  '対人相手（友達 / 先生 / 親 など）。自由記述。';

COMMENT ON CONSTRAINT presentation_practice_records_local_unique ON presentation_practice_records IS
  'UNIQUE(user_id, local_record_id)。upsert を冪等化するための制約。';


-- 74. trigger（set_updated_at / §3 共有）
CREATE TRIGGER presentation_practice_records_set_updated_at
  BEFORE UPDATE ON presentation_practice_records
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- 75. RLS — presentation_practice_records（owner 直接判定 / 全 CRUD）
--     Storage 非関与のため、interview_practice_records §55 と同形で owner に全 CRUD を許可する
--     （upsert の DO UPDATE 経路のため UPDATE policy も必要 / delete を伴う feature）。
ALTER TABLE presentation_practice_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "presentation_practice_records owner select"
  ON presentation_practice_records
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "presentation_practice_records owner insert"
  ON presentation_practice_records
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "presentation_practice_records owner update"
  ON presentation_practice_records
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "presentation_practice_records owner delete"
  ON presentation_practice_records
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- 76. Storage bucket: presentation-recordings（private）
--     プロジェクト初の Storage 利用。public=false（signed URL のみで再生 / pr0_design.md §5）。
--     オブジェクトキー形式: user_id/session_id/attempt_id.ext（第1階層 user_id が RLS の所有判定キー）。
--     冪等のため ON CONFLICT DO NOTHING（既存環境への再適用を許容）。
INSERT INTO storage.buckets (id, name, public)
VALUES ('presentation-recordings', 'presentation-recordings', false)
ON CONFLICT (id) DO NOTHING;


-- 77. Storage RLS — storage.objects（presentation-recordings 本人のみ）
--     storage.objects は Supabase が既定で RLS 有効。本 bucket に対する policy のみ追加する。
--     path 第1階層（storage.foldername(name)[1]）が auth.uid() と一致する本人だけが対象。
--     SELECT（signed URL 発行に必要）と INSERT（クライアント直 upload）のみ authenticated に許可。
--     UPDATE/DELETE policy は付与しない: 動画削除は DB 行削除と整合させるためサーバルート
--     （service_role / RLS バイパス）で storage.remove する（要対応B / 孤児動画防止 / pr0_design.md §5.4）。
--     録り直しは新 attempt_id = 新パス（upsert:false）のため、クライアントの UPDATE は不要。
CREATE POLICY "presentation-recordings owner select"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'presentation-recordings'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "presentation-recordings owner insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'presentation-recordings'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );


-- 78. Storage bucket: presentation-materials（private）
--     発表資料（PDF / PNG / JPG / JPEG）の保存先。public=false（signed URL のみで閲覧）。
--     オブジェクトキー: user_id/session_id/material.ext（1 セッション 1 資料 / upsert で上書き）。
INSERT INTO storage.buckets (id, name, public)
VALUES ('presentation-materials', 'presentation-materials', false)
ON CONFLICT (id) DO NOTHING;


-- 79. Storage RLS — storage.objects（presentation-materials 本人のみ）
--     path 第1階層が auth.uid() の本人だけが対象。SELECT（signed URL 発行 / 表示）・
--     INSERT・UPDATE（upsert:true の上書き）を authenticated に許可。DELETE policy は付与せず、
--     資料削除はサーバルート（service_role）で DB と整合させて行う（孤児ファイル防止）。
CREATE POLICY "presentation-materials owner select"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'presentation-materials'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "presentation-materials owner insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'presentation-materials'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

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
