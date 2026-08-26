-- ============================================================
-- anonymous mirror の SELECT 露出 — 原因確定チェック（**読み取り専用**）
--
-- 背景:
--   supabase/schema.sql は 4 つの anonymous mirror テーブルについて
--   「No SELECT policy by design」（＝ anon / authenticated から読み戻せない
--   write-only sink）と宣言している。
--   しかし本番（project: oarzldvteiuyuwkdoauq）では anon key で行が読める状態
--   にあることが 2026-08-26 の read-only preflight で観測された。
--
--     student_profile_mirrors : anon から 21 行可読
--     basic_info_mirrors      : anon から 10 行可読
--     activity_mirrors        : anon から  6 行可読
--     diagnosis_mirrors       : anon から  3 行可読
--
--   同じ schema.sql・同じ「anon insert のみ」パターンの mirror_events は
--   service_role で 73 行あるのに anon からは 0 行だった。
--   → RLS の全体無効ではなく、上記 4 テーブル固有の drift。
--
-- 目的:
--   mirror_select_exposure_migration.sql を適用する **前** に、
--   実際の原因を A / B / C / D のどれか確定する。
--
--     A. RLS disabled                       … relrowsecurity = false
--     B. anon/authenticated SELECT policy   … pg_policies に cmd=SELECT/ALL の行
--     C. table-level GRANT のみが原因        … RLS 有効 + SELECT policy 無し + 可読
--     D. view / security definer function 経由
--
-- 使い方:
--   本番 Supabase の SQL Editor に全文を貼って実行する。
--   **何も変更しない（SELECT のみ）。** DDL / DML を一切含まない。
--
-- 出力の読み方:
--   1.rls        relrowsecurity=false があれば **原因 A**
--   2.policy     cmd=SELECT または cmd=ALL の行があれば **原因 B**
--                （cmd=ALL は書き込みも兼ねるため migration は自動削除しない。手動判断）
--   3.grant      anon / authenticated に SELECT があり、かつ 1/2 が正常なら **原因 C**
--   4.view       4 テーブルを参照する view があれば **原因 D**
--   5.expected   schema.sql が期待する policy（insert/update）が実在するか
--                → migration が RLS を有効化する前に補完すべきものを示す
-- ============================================================

WITH targets AS (
  SELECT unnest(ARRAY[
    'student_profile_mirrors',
    'basic_info_mirrors',
    'activity_mirrors',
    'diagnosis_mirrors',
    -- 対照群: 正しく閉じている参照実装
    'mirror_events'
  ]) AS t
)

-- 1. RLS の有効 / FORCE 状態（原因 A の判定）
SELECT
  '1.rls'                                   AS check_group,
  t                                         AS object,
  CASE
    WHEN to_regclass('public.' || t) IS NULL THEN 'MISSING-TABLE'
    WHEN c.relrowsecurity IS NOT TRUE        THEN 'RLS-DISABLED  <== 原因A'
    ELSE 'rls_enabled=true'
  END                                       AS detail,
  COALESCE('force_rls=' || c.relforcerowsecurity::text, '-') AS extra
FROM targets
LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || t)

UNION ALL

-- 2. policy 一覧（原因 B の判定）
--    cmd=SELECT / ALL が 1 件でもあれば anon 読み取りの直接原因になりうる。
SELECT
  '2.policy',
  p.tablename,
  p.policyname || ' | cmd=' || p.cmd || ' | roles=' || array_to_string(p.roles, ',')
    || CASE WHEN p.cmd IN ('SELECT', 'ALL') THEN '   <== 原因B 候補' ELSE '' END,
  'permissive=' || p.permissive
FROM pg_policies p
JOIN targets ON targets.t = p.tablename
WHERE p.schemaname = 'public'

UNION ALL

-- 2b. policy が 1 件も無いテーブルを明示（上の行に現れないため）
SELECT
  '2.policy',
  t,
  '(policy が 1 件も存在しない)',
  '-'
FROM targets
WHERE to_regclass('public.' || t) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = targets.t
  )

UNION ALL

-- 3. table-level GRANT（原因 C の判定）
--    ★ SELECT を anon から REVOKE してはいけない。
--      mirror writer の upsert は ON CONFLICT DO UPDATE で EXCLUDED.* を読むため、
--      PostgreSQL は対象列の SELECT 権限を要求する。REVOKE すると書き込みが壊れる。
SELECT
  '3.grant',
  g.table_name,
  g.grantee || ' : ' || string_agg(g.privilege_type, ',' ORDER BY g.privilege_type),
  '-'
FROM information_schema.role_table_grants g
JOIN targets ON targets.t = g.table_name
WHERE g.table_schema = 'public'
  AND g.grantee IN ('anon', 'authenticated', 'service_role')
GROUP BY g.table_name, g.grantee

UNION ALL

-- 4. view / matview 経由の露出（原因 D の判定）
SELECT
  '4.view',
  v.viewname,
  'view が mirror を参照: ' || targets.t,
  v.schemaname
FROM pg_views v
JOIN targets ON v.definition ILIKE '%' || targets.t || '%'
WHERE v.schemaname NOT IN ('pg_catalog', 'information_schema')

UNION ALL

-- 5. 目標状態の判定
--    書き込みは server (service_role) 経由へ移設したため、4 mirror の anon 向け policy は
--    **0 件が目標**（select_for_upsert / insert / update をすべて削除する）。
--    mirror_events は対象外で、anon insert 1 件のままが正。
SELECT
  '5.target',
  t,
  CASE
    WHEN t = 'mirror_events' THEN
      CASE WHEN (SELECT count(*) FROM pg_policies p
                  WHERE p.schemaname='public' AND p.tablename=t
                    AND (p.roles && ARRAY['anon','public']::name[])) = 1
           THEN 'anon policy=1 : OK（観測 sink。今回は変更しない）'
           ELSE 'anon policy=' || (SELECT count(*) FROM pg_policies p
                                    WHERE p.schemaname='public' AND p.tablename=t
                                      AND (p.roles && ARRAY['anon','public']::name[]))
                || ' : 想定外' END
    ELSE
      CASE WHEN (SELECT count(*) FROM pg_policies p
                  WHERE p.schemaname='public' AND p.tablename=t
                    AND (p.roles && ARRAY['anon','public']::name[])) = 0
           THEN 'anon policy=0 : OK（目標状態）'
           ELSE 'anon policy=' || (SELECT count(*) FROM pg_policies p
                                    WHERE p.schemaname='public' AND p.tablename=t
                                      AND (p.roles && ARRAY['anon','public']::name[]))
                || '  <== 未適用。server write path 稼働後に migration を適用すること' END
  END,
  '-'
FROM targets

ORDER BY 1, 2, 3;
