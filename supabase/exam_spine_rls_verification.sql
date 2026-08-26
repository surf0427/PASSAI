-- ============================================================
-- Exam Spine — Stage 3 reader が依存する RLS / policy / constraint の検証
-- （**読み取り専用**。DDL / DML / GRANT / policy 変更を一切含まない）
--
-- 背景（E-H1 の残余 / EXAM_SPINE_WAVE2_CONVERGENCE.md §W2-5）:
--   Stage 3 の canonical reader は 10 kind すべてを
--     anon key + cookie session（＝ Postgres role `authenticated`）
--   で読む設計であり、service_role を使わない（E-L4 / Canon §20）。
--   したがって各 table に **`authenticated` 向けの SELECT policy** が
--   実在しなければ Spine からは 1 行も読めない。
--
--   ★ 危険なのは「読めない」ことが error にならない点である ★
--     policy が無い場合、PostgREST は 403 ではなく **200 + 0 行**を返す。
--     Stage 3 reader はこれを status='ok' / rows=[] として扱い、
--     「ユーザーにデータが無い」と区別できない（Canon §40 EMPTY ≠ UNREADABLE）。
--     つまり **runtime では検出できない**。だから out-of-band の本 SQL が要る。
--
--   2026-08-26 時点で anon key による read-only 検証で確定しているのは
--     - 17 table すべての存在
--     - Stage 3 の全 SELECT 列の存在（scripts/exam-spine-live-schema-check.ts）
--     - anon から 0 行（RLS が anon に対しては効いている）
--   であり、`authenticated` role の policy 実在は **未検証**である。
--   なお E-H2 の実例（schema.sql に無い anon SELECT policy が本番に存在した）が
--   示すとおり、schema.sql の宣言は本番の証拠にならない。
--
-- 使い方:
--   本番 Supabase の SQL Editor に全文を貼って実行する。
--   すべて SELECT。書き込みは 1 文も無い。
--
-- 判定:
--   §1 は 17 table すべて rls_enabled = true であること
--   §2 は 10 kind の主 table すべてに cmd='SELECT' かつ roles に authenticated を
--      含む policy が 1 行以上あり、qual が owner 条件であること
--   §3 の 4 table（Spine から一度も SELECT されたことがない）が §2 に現れることが
--      E-H1 残余のクローズ条件
-- ============================================================

-- ── §1. RLS が有効か ────────────────────────────────────────
select
  c.relname                      as table_name,
  c.relrowsecurity               as rls_enabled,
  c.relforcerowsecurity          as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'basic_info_logs','activity_logs','diagnosis_logs','self_analysis_logs',
    'statement_review_history','self_prs','essay_workspaces',
    'interview_practice_records',
    'interview_ai_sessions','interview_ai_results','interview_ai_turns',
    'presentation_sessions','presentation_attempts','presentation_results',
    'presentation_qa_turns','presentation_qa_reviews',
    'presentation_practice_records'
  )
order by c.relname;

-- ── §2. SELECT policy の実在と条件 ──────────────────────────
--   Spine が読むのは SELECT だけ。INSERT/UPDATE/DELETE policy はここでは判定材料にしない。
select
  p.tablename,
  p.policyname,
  p.permissive,
  p.roles,
  p.cmd,
  p.qual
from pg_policies p
where p.schemaname = 'public'
  and p.cmd in ('SELECT','ALL')
  and p.tablename in (
    'basic_info_logs','activity_logs','diagnosis_logs','self_analysis_logs',
    'statement_review_history','self_prs','essay_workspaces',
    'interview_practice_records',
    'interview_ai_sessions','interview_ai_results',
    'presentation_sessions','presentation_attempts','presentation_results'
  )
order by p.tablename, p.policyname;

-- ── §3. E-H1 残余の 4 table（本番で一度も SELECT されたことがない）─────
--   これらは browser の list*FromSupabase が未使用で、shipping tutor の
--   parity reader も canary OFF では実行されない。したがって
--   「INSERT/UPDATE が動いている ＝ policy がある」という間接証拠が SELECT には無い。
select
  t.tablename,
  count(*) filter (where p.cmd in ('SELECT','ALL') and p.roles::text like '%authenticated%')
    as authenticated_select_policies
from (values
  ('self_prs'), ('statement_review_history'),
  ('essay_workspaces'), ('interview_practice_records')
) as t(tablename)
left join pg_policies p
  on p.schemaname = 'public' and p.tablename = t.tablename
group by t.tablename
order by t.tablename;

-- ── §4. maybeSingle() の前提となる UNIQUE constraint ────────
--   basic_info / activity / diagnosis は mode='maybeSingle' で読む。
--   UNIQUE(user_id) が無いと 2 行目が入った瞬間 PostgREST が 406 を返し、
--   その kind は status='error' に倒れる（fail-open で他 kind は生きる）。
select
  rel.relname          as table_name,
  con.conname          as constraint_name,
  con.contype          as constraint_type,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace n on n.oid = rel.relnamespace
where n.nspname = 'public'
  and con.contype in ('u','c')
  and rel.relname in (
    'basic_info_logs','activity_logs','diagnosis_logs','self_analysis_logs',
    'statement_review_history','self_prs','essay_workspaces',
    'interview_practice_records','interview_ai_results','presentation_results'
  )
order by rel.relname, con.conname;

-- ── §5. ordering に使う列の index（性能のみ。correctness 非影響）──
select
  i.tablename,
  i.indexname,
  i.indexdef
from pg_indexes i
where i.schemaname = 'public'
  and i.tablename in (
    'self_analysis_logs','statement_review_history','self_prs',
    'essay_workspaces','interview_practice_records',
    'interview_ai_results','presentation_results'
  )
order by i.tablename, i.indexname;

-- ── §6. PostgREST role への GRANT ───────────────────────────
select
  g.table_name,
  g.grantee,
  g.privilege_type
from information_schema.role_table_grants g
where g.table_schema = 'public'
  and g.grantee in ('anon','authenticated','service_role')
  and g.privilege_type = 'SELECT'
  and g.table_name in (
    'self_prs','statement_review_history','essay_workspaces',
    'interview_practice_records'
  )
order by g.table_name, g.grantee;

-- ── §7. R5 — essay の `workspace->reviews` が配列であること（件数のみ）──
--   E-H1 の「残る検証の限界」のうち、essay projection（E-S27）に関する 1 点を閉じるための query。
--
--   ★ なぜ PostgREST の 200 では足りないか ★
--     PostgREST は jsonb の sub-path を検証しない（存在しない `workspace->zzz` も 200）。
--     したがって live schema check の 200 は R5 の証拠にならない。必要なのは
--       (a) `workspace->'reviews'` が実データ上で解決すること
--       (b) その型が **array** であること（object / scalar だと mapEssayRow が [] に倒れ、
--           device 側に reviews があると **恒久的な false mismatch** になる。
--           しかも fail-open が吸収するため runtime では検出できない）
--       (c) 存在しない path が 1 件も一致しないこと（negative control）
--
--   ★ 返すのは count だけ。essay 本文 / レビュー本文 / user_id を 1 つも返さない。★
--
--   判定: total_rows > 0 かつ rows_reviews_is_array = total_rows
--         かつ rows_reviews_wrong_type = 0 かつ rows_bogus_path = 0
select
  count(*)                                                             as total_rows,
  count(*) filter (where jsonb_exists(workspace, 'reviews'))           as rows_having_reviews_key,
  count(*) filter (where jsonb_typeof(workspace->'reviews') = 'array') as rows_reviews_is_array,
  count(*) filter (where jsonb_typeof(workspace->'reviews') is not null
                     and jsonb_typeof(workspace->'reviews') <> 'array') as rows_reviews_wrong_type,
  count(*) filter (where jsonb_exists(workspace, 'zzz_not_a_field'))   as rows_bogus_path
from essay_workspaces;
