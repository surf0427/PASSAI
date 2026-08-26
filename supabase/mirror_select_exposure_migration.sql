-- ============================================================
-- anonymous mirror の anon policy を全削除する migration（security fix / 第 2 段）
--
-- ★★ 適用前提（これを満たすまで実行しないこと）★★
--   1. `POST /api/mirrors`（server-only writer）が **本番にデプロイ済み**であること。
--   2. 4 つの client mirror helper が server route 経由へ切替済みであること
--      （lib/supabase/mirror{StudentProfile,BasicInfo,ActivityData,Diagnosis}.ts）。
--   3. 本番で server 経由の mirror write が **成功することを実測済み**であること
--      （mirror_events に mirror_status='success' が新規に積まれる、または
--        service_role で対象 table の updated_at 更新を確認）。
--   これらの前に本 migration を適用すると、mirror の書き込みが停止する。
--   （停止しても canonical UX は無傷だが、mirror が無音で欠落する）
--
-- ── 確定した Root Cause ────────────────────────────────────────
--   本番 (oarzldvteiuyuwkdoauq) の実 policy を取得した結果、原因は
--   **B = anon SELECT policy** で確定した。
--
--     student_profile_mirrors : "student_profile_mirrors anon select_for_upsert"
--     basic_info_mirrors      : "basic_info_mirrors anon select_for_upsert"
--     activity_mirrors        : "activity_mirrors anon select_for_upsert"
--     diagnosis_mirrors       : "diagnosis_mirrors anon select_for_upsert"
--         いずれも FOR SELECT TO anon USING (true)
--
--   4 table とも RLS = enabled、FOR ALL policy は無し。
--   `USING (true)` の SELECT policy が全行露出の直接原因。
--
--   policy 名が示すとおり、これは browser の anon client が
--   `INSERT ... ON CONFLICT DO UPDATE`（upsert）を実行するために追加されたもの。
--   PostgreSQL は ON CONFLICT DO UPDATE に対応する SELECT アクセスを要求するため、
--   anon 直接 upsert を維持したまま SELECT policy だけを落とすことはできない。
--
--   → そこで **書き込みを server へ移設**し（第 1 段・別 commit）、
--     その後に anon policy を全削除する（本ファイル・第 2 段）。
--
-- ── 本ファイルの旧版について ──────────────────────────────────
--   旧版は「SELECT policy だけを落とし、anon insert/update は維持する」内容だった。
--   実 policy が判明した結果、それでは anon 直接 upsert が壊れるため **置換した**。
--   （commit 809141b の内容は history として残す。rewrite はしない）
--
-- ── 目標状態（4 mirror 共通）──────────────────────────────────
--   RLS            = enabled（維持）
--   anon policy    = 0 件（select_for_upsert / insert / update をすべて削除）
--   authenticated  = policy 無し（＝直接アクセス不可）
--   service_role   = RLS を bypass するため policy 不要。server writer のみが書ける
--
--   mirror_events は **対象外**。別目的（観測 sink）であり現状のまま維持する。
--
-- ── 安全性 ────────────────────────────────────────────────────
--   - DROP TABLE / DROP COLUMN / TRUNCATE / DELETE / UPDATE を含まない。
--   - 既存行（21 / 10 / 6 / 3）を 1 件も削除・書き換えしない。
--   - payload / source_hash / schema_version を変更しない。
--   - 新規 table / 新規 column を作らない。
--   - GRANT / REVOKE を変更しない（RLS 有効 + policy 0 件で anon は拒否されるため不要。
--     追加の hardening として REVOKE する場合は §4 の注記を参照）。
--   - 冪等（policy が既に無ければ no-op）。
--   - 検証ブロックが目標状態でなければ RAISE EXCEPTION で中断する。
--
-- ── 適用後の確認 ──────────────────────────────────────────────
--   1. supabase/mirror_select_exposure_check.sql を実行
--   2. anon key で 4 table を SELECT → 0 行
--   3. anon key で 4 table へ INSERT / UPDATE → 拒否
--   4. UI 操作で mirror write → mirror_events に success が積まれる
--
-- 関連:
--   supabase/schema.sql（宣言の正本。SELECT policy は元々存在しない）
--   supabase/mirror_select_exposure_check.sql（原因確定 / 事後検証）
--   app/api/mirrors/route.ts（唯一の書き込み経路）
--   lib/mirrors/mirrorWriteServer.ts（service_role writer / server-only）
-- ============================================================

DO $$
DECLARE
  mirror_tables text[] := ARRAY[
    'student_profile_mirrors',
    'basic_info_mirrors',
    'activity_mirrors',
    'diagnosis_mirrors'
  ];
  t         text;
  r         record;
  dropped   int := 0;
  kept_all  int := 0;
BEGIN
  FOREACH t IN ARRAY mirror_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE '[skip] % : テーブルが存在しません', t;
      CONTINUE;
    END IF;

    -- before 状態を記録（適用ログを証跡として残す）
    FOR r IN
      SELECT policyname, cmd, array_to_string(roles, ',') AS roles
      FROM pg_policies WHERE schemaname = 'public' AND tablename = t
      ORDER BY policyname
    LOOP
      RAISE NOTICE '[before] % : % | cmd=% | roles=%', t, r.policyname, r.cmd, r.roles;
    END LOOP;

    -- RLS は有効のまま維持する（無効化は禁止）。既に有効なら no-op。
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- anon / public を対象に含む policy をすべて削除する。
    --   ★ 書き込みは server (service_role) が RLS を bypass して行うため、
    --     anon 向け policy は 1 件も必要ない。
    --   ★ roles に anon / public を含むものだけを対象にする。将来
    --     authenticated 向けや service_role 向けの policy が追加されていても壊さない。
    FOR r IN
      SELECT policyname, cmd, roles
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = t
        AND (roles && ARRAY['anon', 'public']::name[])
    LOOP
      IF r.cmd = 'ALL' THEN
        -- 想定外（実測では存在しない）。書き込みも兼ねるため自動削除しない。
        kept_all := kept_all + 1;
        RAISE WARNING '[manual] % : FOR ALL policy "%" は自動削除しません。手動で確認してください', t, r.policyname;
        CONTINUE;
      END IF;
      EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, t);
      dropped := dropped + 1;
      RAISE NOTICE '[drop] % : "%" (cmd=%) を削除', t, r.policyname, r.cmd;
    END LOOP;
  END LOOP;

  RAISE NOTICE '---- summary: 削除した anon policy=% / 要手動確認(FOR ALL)=% ----', dropped, kept_all;
END $$;


-- ============================================================
-- 検証: 目標状態でなければ中断する
--   - RLS が有効であること
--   - anon / public を対象にする policy が 0 件であること
--   - 行が削除されていないこと（件数 > 0 の table は件数を維持）
-- ============================================================

DO $$
DECLARE
  mirror_tables text[] := ARRAY[
    'student_profile_mirrors',
    'basic_info_mirrors',
    'activity_mirrors',
    'diagnosis_mirrors'
  ];
  t        text;
  rls_on   boolean;
  n_anon   int;
  n_rows   bigint;
BEGIN
  FOREACH t IN ARRAY mirror_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;

    SELECT c.relrowsecurity INTO rls_on
    FROM pg_class c WHERE c.oid = to_regclass('public.' || t);

    SELECT count(*) INTO n_anon
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = t
      AND (roles && ARRAY['anon', 'public']::name[]);

    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n_rows;

    IF rls_on IS NOT TRUE THEN
      RAISE EXCEPTION '[verify] % : RLS が有効ではありません', t;
    END IF;
    IF n_anon > 0 THEN
      RAISE EXCEPTION '[verify] % : anon/public 向け policy が % 件残っています', t, n_anon;
    END IF;

    RAISE NOTICE '[verify] % : OK  rls=true / anon_policies=0 / rows=%', t, n_rows;
  END LOOP;

  RAISE NOTICE '---- verify PASS: 4 mirror は anon から読み書きできない状態です ----';
  RAISE NOTICE '---- 次: anon key で SELECT / INSERT / UPDATE を実測し、UI 操作で mirror write を確認すること ----';
END $$;


-- ============================================================
-- §4 注記 — 追加 hardening としての REVOKE について
--
--   RLS 有効 + anon policy 0 件で anon の SELECT / INSERT / UPDATE は拒否される。
--   したがって REVOKE は **必須ではない**。
--
--   将来の事故（誰かが Studio から "Enable read access" を押す等）に対する
--   多層防御として GRANT を絞る選択肢はある:
--
--     REVOKE SELECT, INSERT, UPDATE, DELETE ON public.student_profile_mirrors FROM anon, authenticated;
--     -- 他 3 table も同様
--
--   ただし Data API の schema cache 表現が変わるため、適用する場合は
--   server writer（service_role）の書き込みを再検証してから行うこと。
--   本 migration には含めない（範囲を「anon policy 削除」に限定するため）。
-- ============================================================
