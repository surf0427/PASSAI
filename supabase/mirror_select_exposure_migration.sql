-- ============================================================
-- anonymous mirror の SELECT 露出を閉じる migration（security fix）
--
-- 目的:
--   4 つの anonymous mirror テーブルを、supabase/schema.sql が宣言している
--   「anon / authenticated から読み戻せない write-only sink」の状態へ戻す。
--
--     student_profile_mirrors
--     basic_info_mirrors
--     activity_mirrors
--     diagnosis_mirrors
--
--   2026-08-26 の read-only preflight で、本番（oarzldvteiuyuwkdoauq）では
--   anon key でこれらの行が読める状態にあることを観測した。
--   schema.sql の "No SELECT policy by design" と本番の drift を解消する。
--
-- 前提: 先に supabase/mirror_select_exposure_check.sql を実行し、原因（A/B/C/D）
--   を確認していること。本 migration は A（RLS disabled）と B（SELECT policy 存在）
--   の双方を安全に解消する。C / D が主因だった場合は §5 の注記を参照。
--
-- ── 実行順序（この順序が安全性の本体）────────────────────────────
--   1. 書き込み policy（anon insert / anon update）が無ければ **先に補完**する。
--      ★ RLS が無効の環境では policy が未作成の可能性がある。補完せずに RLS を
--        有効化すると mirror の書き込みが即座に止まる（しかも mirror writer は
--        never-throw のため **無音で失敗する**）。必ず補完を先に行う。
--   2. RLS を有効化する（原因 A の解消）。既に有効なら no-op。
--   3. cmd='SELECT' の policy だけを削除する（原因 B の解消）。
--   4. 検証し、閉じられていなければ例外を投げて中断する。
--
-- ── 安全性 ────────────────────────────────────────────────────
--   - DROP TABLE / DROP COLUMN / TRUNCATE / DELETE を含まない。
--   - payload の shape・内容を変更しない。行を 1 件も読まない / 書き換えない。
--   - 新規テーブル・新規列を作らない。
--   - INSERT / UPDATE policy を削除しない（＝ mirror writer を壊さない）。
--   - **GRANT を REVOKE しない。**
--       理由: mirror writer は `.upsert(..., { onConflict: 'source_hash' })`
--       ＝ `INSERT ... ON CONFLICT DO UPDATE` を発行する。PostgreSQL は
--       ON CONFLICT DO UPDATE において「EXCLUDED 側で読まれる対象列」に対して
--       SELECT 権限を要求するため、anon から SELECT を REVOKE すると
--       書き込みが壊れる。RLS で閉じるのが正しい手段。
--   - FORCE ROW LEVEL SECURITY は付けない（table owner / 管理経路への影響を避ける）。
--   - 冪等。複数回実行しても結果は同じ。
--   - cmd='ALL' の policy は **自動削除しない**（書き込みも兼ねるため）。
--     検出した場合は WARNING を出して手動判断に委ねる。
--
-- ── 適用方法 ──────────────────────────────────────────────────
--   本番 Supabase の SQL Editor に全文を貼って実行する。
--   実行後、NOTICE に before / after の状態が出力される。
--   適用後は supabase/mirror_select_exposure_check.sql を再実行して確認すること。
--
-- 関連:
--   supabase/schema.sql（正本の宣言）
--   supabase/mirror_select_exposure_check.sql（原因確定 / 事後検証）
--   lib/supabase/mirror{StudentProfile,BasicInfo,ActivityData,Diagnosis}.ts（唯一の writer）
--   docs/supabase/schema_phase1_student_profile.md
-- ============================================================

DO $$
DECLARE
  mirror_tables text[] := ARRAY[
    'student_profile_mirrors',
    'basic_info_mirrors',
    'activity_mirrors',
    'diagnosis_mirrors'
  ];
  t              text;
  r              record;
  rls_before     boolean;
  select_policies_dropped int := 0;
  write_policies_created  int := 0;
  all_policy_found        int := 0;
BEGIN
  FOREACH t IN ARRAY mirror_tables LOOP

    -- テーブルが存在しない環境では黙ってスキップする（冪等性）。
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE '[skip] % : テーブルが存在しません', t;
      CONTINUE;
    END IF;

    -- ── before の状態を記録（適用ログが原因の証跡になる）──
    SELECT c.relrowsecurity INTO rls_before
    FROM pg_class c WHERE c.oid = to_regclass('public.' || t);

    RAISE NOTICE '[before] % : rls_enabled=%', t, rls_before;
    FOR r IN
      SELECT policyname, cmd, array_to_string(roles, ',') AS roles
      FROM pg_policies WHERE schemaname = 'public' AND tablename = t
      ORDER BY policyname
    LOOP
      RAISE NOTICE '[before] %   policy: % | cmd=% | roles=%', t, r.policyname, r.cmd, r.roles;
    END LOOP;

    -- ── 1. 書き込み policy の補完（RLS 有効化より必ず先）──
    --    schema.sql の宣言と同一の名前・条件で作る。既存なら触らない。
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = t || ' anon insert'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT TO anon WITH CHECK (true)',
        t || ' anon insert', t
      );
      write_policies_created := write_policies_created + 1;
      RAISE NOTICE '[fix] % : INSERT policy を補完しました（RLS 有効化前）', t;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = t || ' anon update'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE TO anon USING (true) WITH CHECK (true)',
        t || ' anon update', t
      );
      write_policies_created := write_policies_created + 1;
      RAISE NOTICE '[fix] % : UPDATE policy を補完しました（RLS 有効化前）', t;
    END IF;

    -- ── 2. RLS を有効化（原因 A の解消。既に有効なら no-op）──
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF rls_before IS NOT TRUE THEN
      RAISE NOTICE '[fix] % : ROW LEVEL SECURITY を有効化しました（原因A）', t;
    END IF;

    -- ── 3. SELECT policy だけを削除（原因 B の解消）──
    --      INSERT / UPDATE / DELETE policy には触れない。
    FOR r IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND cmd = 'SELECT'
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, t);
      select_policies_dropped := select_policies_dropped + 1;
      RAISE NOTICE '[fix] % : SELECT policy "%" を削除しました（原因B）', t, r.policyname;
    END LOOP;

    -- ── 3b. cmd='ALL' は自動削除しない（書き込みも兼ねるため）──
    FOR r IN
      SELECT policyname, array_to_string(roles, ',') AS roles FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND cmd = 'ALL'
    LOOP
      all_policy_found := all_policy_found + 1;
      RAISE WARNING '[manual] % : FOR ALL policy "%" (roles=%) が存在します。読み取りも許可しますが、削除すると書き込みも失われるため自動削除しません。手動で INSERT/UPDATE 専用へ分割してください。',
        t, r.policyname, r.roles;
    END LOOP;

  END LOOP;

  RAISE NOTICE '---- summary: SELECT policy 削除=% / 書き込み policy 補完=% / 要手動対応(FOR ALL)=% ----',
    select_policies_dropped, write_policies_created, all_policy_found;
END $$;


-- ============================================================
-- 4. 事後検証（閉じられていなければ例外で中断する）
--    - RLS が有効であること
--    - SELECT policy / ALL policy が 1 件も残っていないこと
--    - 書き込み policy（insert / update）が揃っていること
-- ============================================================

DO $$
DECLARE
  mirror_tables text[] := ARRAY[
    'student_profile_mirrors',
    'basic_info_mirrors',
    'activity_mirrors',
    'diagnosis_mirrors'
  ];
  t          text;
  rls_on     boolean;
  n_select   int;
  n_all      int;
  n_insert   int;
  n_update   int;
BEGIN
  FOREACH t IN ARRAY mirror_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;

    SELECT c.relrowsecurity INTO rls_on
    FROM pg_class c WHERE c.oid = to_regclass('public.' || t);

    SELECT
      count(*) FILTER (WHERE cmd = 'SELECT'),
      count(*) FILTER (WHERE cmd = 'ALL'),
      count(*) FILTER (WHERE cmd = 'INSERT'),
      count(*) FILTER (WHERE cmd = 'UPDATE')
    INTO n_select, n_all, n_insert, n_update
    FROM pg_policies WHERE schemaname = 'public' AND tablename = t;

    IF rls_on IS NOT TRUE THEN
      RAISE EXCEPTION '[verify] % : RLS が有効になっていません', t;
    END IF;
    IF n_select > 0 THEN
      RAISE EXCEPTION '[verify] % : SELECT policy が % 件残っています', t, n_select;
    END IF;
    IF n_all > 0 THEN
      RAISE EXCEPTION '[verify] % : FOR ALL policy が % 件残っています（手動対応が必要）', t, n_all;
    END IF;
    IF n_insert = 0 OR n_update = 0 THEN
      RAISE EXCEPTION '[verify] % : 書き込み policy が不足しています（insert=% / update=%）。mirror の書き込みが壊れます',
        t, n_insert, n_update;
    END IF;

    RAISE NOTICE '[verify] % : OK  rls=true / select=0 / all=0 / insert=% / update=%',
      t, n_insert, n_update;
  END LOOP;

  RAISE NOTICE '---- verify PASS: 4 mirror すべてが write-only sink の状態です ----';
END $$;


-- ============================================================
-- 5. 注記
--
-- 原因 C（table-level GRANT のみが原因）だった場合:
--   上記 1〜3 を適用しても anon が読めるなら、RLS が効いていない経路
--   （例: policy 無しで RLS 無効、または view 経由）が残っている。
--   その場合でも **SELECT を REVOKE してはいけない**（§安全性を参照）。
--   mirror_select_exposure_check.sql の 3.grant / 4.view を再確認し、
--   view 経由なら該当 view を落とす（本 migration の範囲外・別途判断）。
--
-- 原因 D（view / security definer function 経由）だった場合:
--   本 migration は view を作成も削除もしない。
--   check.sql の 4.view に出た object を個別に確認すること。
--
-- 適用後の確認手順:
--   1. supabase/mirror_select_exposure_check.sql を再実行
--      → 1.rls が全て rls_enabled=true / 2.policy に cmd=SELECT が無いこと
--   2. anon key で 4 テーブルを SELECT
--      → 行が返らないこと（0 行）
--   3. mirror 書き込みの非回帰確認
--      → 基本情報 / 活動 / 診断 / 自己分析のいずれかを保存し、
--        service_role で該当テーブルの updated_at が更新されることを確認
-- ============================================================
