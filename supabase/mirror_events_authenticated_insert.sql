-- ============================================================
-- mirror_events: authenticated role の INSERT を許可する migration
-- （security fix / 第 3 段 — telemetry sink の 403 修正）
--
-- ── 確定した Root Cause ────────────────────────────────────────
--   本番 (oarzldvteiuyuwkdoauq) で mirror_events への browser INSERT が
--     42501 "new row violates row-level security policy for table mirror_events"
--   になっていた。実測で確定した原因は次のとおり。
--
--   1. mirror_events の policy は `"mirror_events anon insert"`
--      （FOR INSERT TO anon WITH CHECK (true)）の 1 件のみ。
--      authenticated 向けの INSERT policy は存在しない。
--
--   2. 一方 PASSAI の browser client（lib/supabase/browserClient.ts →
--      @supabase/ssr createBrowserClient）は、STEP-AUTH-01 以降ほぼ常に
--      session JWT を持つ。`lib/supabase/auth.ts:ensureAnonymousUser()` が
--      未ログイン訪問者に対しても `signInAnonymously()` を実行するため、
--      **「匿名ユーザー」であっても Postgres role は anon ではなく
--      authenticated になる**（実測: JWT role=authenticated /
--      is_anonymous=true）。
--
--   3. 結果として mirror_events への INSERT は常に authenticated role で
--      到達し、対応する policy が無いため RLS に落ちる。
--      → sink は never-throw 契約でエラーを飲み込むため UX は無傷だが、
--        観測 row が一切積まれない状態だった。
--
--   つまり anon policy は「実際には誰も使っていない role」に対する許可であり、
--   実トラフィックの role である authenticated が抜けていたのが原因。
--
-- ── mirror_events の設計（変更しない前提）────────────────────────
--   - write-only telemetry sink。runtime からの SELECT / UPDATE / DELETE は
--     コード上ゼロ（唯一の書き込み口は lib/supabase/mirrorEventSink.ts の
--     `client.from("mirror_events").insert(...)` 1 箇所）。
--   - owner 概念が無い（schema.sql §5 が user_id / PII 列を明示的に排除）。
--     したがって owner validation（auth.uid() = user_id）は書けないし、
--     今回新設もしない。
--   - payload / source_hash を持たない。列は enum 相当の短い text と
--     duration_ms / created_at のみ。
--   - browser からのみ書かれる（emitMirrorEvent は
--     `typeof window === "undefined"` で即 return するため server からは書かない）。
--     client 側の skip / pre-flight failure も記録するため、
--     /api/mirrors 経由の server 記録では代替できない。
--
-- ── 本 migration の内容 ────────────────────────────────────────
--   authenticated role に対する **INSERT のみ** の policy を 1 件追加する。
--   anon の既存 INSERT policy はそのまま残す（未ログイン到達経路の保険）。
--
--   read exposure は広がらない:
--     - SELECT policy を作らない → anon / authenticated とも 0 行のまま。
--     - UPDATE / DELETE policy を作らない → 既存行は書き換え・削除不可。
--     - anon に既に与えている権限（INSERT WITH CHECK (true)）と
--       同一範囲を authenticated へ与えるだけで、新しい種類の権限ではない。
--
--   WITH CHECK (true) を採用する理由:
--     owner 列が存在しないため owner 条件は書けない。列値の CHECK も、
--     schema.sql §5 が「enum 値は application 層が正本。DB 側 CHECK は
--     置かない（doc-first 進化）」と明記しているため置かない。
--     anon policy と条件を揃え、role 間で挙動が割れないようにする。
--
-- ── 安全性 ────────────────────────────────────────────────────
--   - CREATE POLICY 以外を実行しない。
--   - DROP / TRUNCATE / DELETE / UPDATE / ALTER TABLE(RLS 無効化) を含まない。
--   - schema 変更なし（table / column を作らない・変えない）。
--   - GRANT / REVOKE を変更しない。
--   - 既存行を 1 件も変更しない。
--   - 4 つの mirror 本体 table（student_profile_mirrors / basic_info_mirrors /
--     activity_mirrors / diagnosis_mirrors）には一切触れない。
--   - 冪等（policy が既にあれば no-op）。
--   - 検証ブロックが目標状態でなければ RAISE EXCEPTION で中断する。
--
-- ── 目標状態（mirror_events）────────────────────────────────────
--   RLS            = enabled（維持）
--   anon           INSERT 可 / SELECT 不可 / UPDATE 不可 / DELETE 不可
--   authenticated  INSERT 可 / SELECT 不可 / UPDATE 不可 / DELETE 不可
--   service_role   RLS bypass（SQL editor からの運用 read はこちら）
--
-- ── 適用後の確認 ──────────────────────────────────────────────
--   1. 本ファイル末尾の検証ブロックが PASS すること
--   2. ログイン済みユーザーで基本情報保存 → POST /api/mirrors が 200
--   3. mirror_events に今回時刻の mirror_status='success' /
--      environment='production' の row が積まれること
--   4. anon key / authenticated JWT の両方で mirror_events を SELECT → 0 行
--
-- 関連:
--   supabase/schema.sql §5–§6（mirror_events の宣言）
--   supabase/mirror_select_exposure_migration.sql（第 2 段 / 4 mirror の anon policy 削除）
--   lib/supabase/mirrorEventSink.ts（唯一の書き込み口 / never-throw）
--   lib/supabase/mirrorFinalize.ts（4 mirror 共通の exit point）
--   lib/supabase/auth.ts（signInAnonymously → role=authenticated の出所）
-- ============================================================

DO $$
DECLARE
  policy_name constant text := 'mirror_events authenticated insert';
  r record;
BEGIN
  IF to_regclass('public.mirror_events') IS NULL THEN
    RAISE EXCEPTION '[abort] public.mirror_events が存在しません。適用先の project を確認してください';
  END IF;

  -- before 状態を証跡として残す
  FOR r IN
    SELECT policyname, cmd, array_to_string(roles, ',') AS roles
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mirror_events'
    ORDER BY policyname
  LOOP
    RAISE NOTICE '[before] mirror_events : % | cmd=% | roles=%', r.policyname, r.cmd, r.roles;
  END LOOP;

  -- RLS は有効のまま維持する（無効化は禁止）。既に有効なら no-op。
  EXECUTE 'ALTER TABLE public.mirror_events ENABLE ROW LEVEL SECURITY';

  -- 冪等: 同名 policy が既にあれば作らない。
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mirror_events' AND policyname = policy_name
  ) THEN
    RAISE NOTICE '[skip] policy "%" は既に存在します（no-op）', policy_name;
  ELSE
    EXECUTE format(
      'CREATE POLICY %I ON public.mirror_events FOR INSERT TO authenticated WITH CHECK (true)',
      policy_name
    );
    RAISE NOTICE '[create] policy "%" を追加しました（FOR INSERT TO authenticated）', policy_name;
  END IF;
END $$;


-- ============================================================
-- 検証: 目標状態でなければ中断する
--   - RLS が有効であること
--   - authenticated 向け INSERT policy が 1 件存在すること
--   - mirror_events に SELECT / UPDATE / DELETE / ALL policy が 1 件も無いこと
--   - 既存行が削除されていないこと（件数を NOTICE で表示するのみ）
-- ============================================================

DO $$
DECLARE
  rls_on     boolean;
  n_auth_ins int;
  n_read     int;
  n_rows     bigint;
  r          record;
BEGIN
  SELECT c.relrowsecurity INTO rls_on
  FROM pg_class c WHERE c.oid = to_regclass('public.mirror_events');

  SELECT count(*) INTO n_auth_ins
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'mirror_events'
    AND cmd = 'INSERT' AND (roles && ARRAY['authenticated']::name[]);

  -- INSERT 以外（SELECT / UPDATE / DELETE / ALL）は 1 件もあってはならない。
  SELECT count(*) INTO n_read
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'mirror_events'
    AND cmd <> 'INSERT';

  SELECT count(*) INTO n_rows FROM public.mirror_events;

  IF rls_on IS NOT TRUE THEN
    RAISE EXCEPTION '[verify] mirror_events : RLS が有効ではありません';
  END IF;
  IF n_auth_ins <> 1 THEN
    RAISE EXCEPTION '[verify] mirror_events : authenticated INSERT policy が % 件です（期待 1）', n_auth_ins;
  END IF;
  IF n_read > 0 THEN
    RAISE EXCEPTION '[verify] mirror_events : INSERT 以外の policy が % 件存在します（write-only sink 違反）', n_read;
  END IF;

  FOR r IN
    SELECT policyname, cmd, array_to_string(roles, ',') AS roles
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mirror_events'
    ORDER BY policyname
  LOOP
    RAISE NOTICE '[after] mirror_events : % | cmd=% | roles=%', r.policyname, r.cmd, r.roles;
  END LOOP;

  RAISE NOTICE '---- verify PASS: mirror_events は INSERT 専用（rls=true / read policy=0 / rows=%）----', n_rows;
  RAISE NOTICE '---- 次: ログイン済みで基本情報保存 → mirror_events に success 行が積まれることを確認 ----';
END $$;
