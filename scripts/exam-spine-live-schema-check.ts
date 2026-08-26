// Exam Spine — Stage 3 query の live schema 検証（read-only / Wave 2 W2-4）。
//
// 目的:
//   lib/examSpine/read/queries.ts が宣言する **10 kind 分の SELECT を、実際の
//   production PostgREST に当てて**、table / column / order 列 / embed relation が
//   本番 schema と互換であることを機械的に確かめる。
//
//   scripts/exam-spine-stage3-check.ts は fake executor 相手なので、
//   「column 名を間違えている」「PostgREST が受け付けない embed を書いている」
//   といった **本番でしか出ない不整合**を検出できない。本 script がその穴を埋める。
//
// なぜ query builder を import するのか:
//   select 文字列を script 側で書き直すと、検証したものと production が発行するものが
//   ずれる。`formatSelect()` は executor と本 script が共有する唯一の実装であり、
//   ここを通すことで「QA が通した select == reader が発行する select」を保証する。
//
// 厳守:
//   - **read-only**。GET のみ。INSERT / UPDATE / UPSERT / DELETE / DDL を行わない。
//   - **anon key のみ**。SUPABASE_SERVICE_ROLE_KEY は読まないし使わない。
//   - **limit=0 を強制する**。行データを 1 件も取得しない（PII を取得し得ない）。
//   - 値を出力しない。HTTP status と PostgREST error code だけを出す。
//   - userId には実在しない UUID を使う（実ユーザーを指名しない）。
//
// 判定:
//   200 … その select / filter / order / embed は本番 schema と互換
//   400 (42703 等) … column 名の不整合          → FAIL
//   404 (PGRST205)  … table 不在                → FAIL
//   その他          … 判定不能                  → FAIL（推測で PASS にしない / Canon §80）
//
//   ⚠️ 本 check が証明しないもの:
//     - authenticated role の SELECT policy の実在（anon では区別できない。E-H1 / W2-5）
//     - UNIQUE / CHECK constraint / index / trigger（pg_catalog に到達できない）
//     - 行の中身・件数
//
// 使い方: npm run qa:examSpine:liveSchema
//
// 関連: lib/examSpine/read/queries.ts / lib/examSpine/read/types.ts
//       docs/principles/exam_spine/EXAM_SPINE_WAVE2_CONVERGENCE.md §W2-4

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { formatSelect } from '@/lib/examSpine/read/types';
import type { ExamReadQuery } from '@/lib/examSpine/read/types';
import * as Q from '@/lib/examSpine/read/queries';

// 実在しない UUID。owner filter の構文検証だけに使い、実ユーザーを指名しない。
const PROBE_USER = '00000000-0000-4000-8000-000000000000';
const PROBE_ID_A = '00000000-0000-4000-8000-0000000000a1';
const PROBE_ID_B = '00000000-0000-4000-8000-0000000000b2';

type Env = { url: string; anonKey: string };

function loadEnv(): Env | null {
  const fromProcess = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  };
  if (fromProcess.url && fromProcess.anonKey) return fromProcess;

  const path = join(process.cwd(), '.env.local');
  if (!existsSync(path)) return null;
  const parsed: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t.includes('=') || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    parsed[t.slice(0, i).trim()] = t
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  const url = parsed.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anonKey = parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  return url && anonKey ? { url, anonKey } : null;
}

type Probe = { status: number; code: string | null };

async function probe(env: Env, path: string): Promise<Probe> {
  const res = await fetch(`${env.url.replace(/\/$/, '')}${path}`, {
    method: 'GET', // ★ GET 以外を発行しない
    headers: { apikey: env.anonKey, Authorization: `Bearer ${env.anonKey}` },
  });
  let code: string | null = null;
  try {
    const body = (await res.json()) as { code?: unknown };
    if (typeof body?.code === 'string') code = body.code;
  } catch {
    /* 200 は本文が [] なので code なし */
  }
  return { status: res.status, code };
}

/**
 * ExamReadQuery を PostgREST の query string へ落とす。
 * supabaseExecutor.server.ts と同じ順序（select → filters → order → limit）で組む。
 * ★ limit は常に 0 で上書きする（行を取得しないため）。
 */
function toPath(query: ExamReadQuery): string {
  const params: string[] = [`select=${encodeURIComponent(formatSelect(query))}`];
  for (const f of query.filters) {
    params.push(
      f.op === 'eq'
        ? `${encodeURIComponent(f.column)}=eq.${encodeURIComponent(f.value)}`
        : `${encodeURIComponent(f.column)}=in.(${f.values.map((v) => encodeURIComponent(v)).join(',')})`,
    );
  }
  if (query.order.length > 0) {
    const spec = query.order
      .map((o) => `${o.column}.${o.ascending ? 'asc' : 'desc'}`)
      .join(',');
    params.push(`order=${encodeURIComponent(spec)}`);
  }
  params.push('limit=0'); // ★ 常に 0 行
  return `/rest/v1/${query.table}?${params.join('&')}`;
}

const QUERIES: ReadonlyArray<{ label: string; query: ExamReadQuery }> = [
  { label: 'basic_info', query: Q.basicInfoQuery(PROBE_USER) },
  { label: 'activity', query: Q.activityQuery(PROBE_USER) },
  { label: 'diagnosis', query: Q.diagnosisQuery(PROBE_USER) },
  { label: 'self_analysis', query: Q.selfAnalysisQuery(PROBE_USER) },
  { label: 'statement_review', query: Q.statementReviewQuery(PROBE_USER) },
  { label: 'self_pr', query: Q.selfPrQuery(PROBE_USER) },
  { label: 'essay', query: Q.essayQuery(PROBE_USER) },
  { label: 'interview_record', query: Q.interviewRecordQuery(PROBE_USER) },
  { label: 'interview_ai (embed !inner)', query: Q.interviewAiQuery(PROBE_USER) },
  { label: 'presentation core', query: Q.presentationCoreQuery(PROBE_USER) },
  {
    label: 'presentation attempts (enrichment)',
    query: Q.presentationAttemptsQuery(PROBE_USER, [PROBE_ID_A, PROBE_ID_B]),
  },
  {
    label: 'presentation sessions (enrichment)',
    query: Q.presentationSessionsQuery(PROBE_USER, [PROBE_ID_A, PROBE_ID_B]),
  },
];

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env) {
    console.error('[exam-spine-live-schema] BLOCKED_BY_ENV: NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY が取得できません');
    process.exitCode = 2; // 2 = BLOCKED_BY_ENV（FAIL の 1 と区別する）
    return;
  }

  console.log('[exam-spine-live-schema] Stage 3 query × live PostgREST（read-only / limit=0）\n');

  let failed = 0;

  // ── 0. negative control（本 check に判別力があることを先に立証する）──
  console.log('0. Negative control');
  const negTable = await probe(env, '/rest/v1/zzz_not_a_table?select=id&limit=0');
  const negColumn = await probe(env, '/rest/v1/basic_info_logs?select=zzz_not_a_col&limit=0');
  const negOrder = await probe(env, '/rest/v1/basic_info_logs?select=payload&order=zzz_not_a_col.desc&limit=0');
  const controls: Array<[string, Probe, number]> = [
    ['存在しない table は 404', negTable, 404],
    ['存在しない column は 400', negColumn, 400],
    ['存在しない order 列は 400', negOrder, 400],
  ];
  for (const [name, got, want] of controls) {
    const ok = got.status === want;
    if (!ok) failed++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}（got ${got.status}${got.code ? ` / ${got.code}` : ''}）`);
  }
  if (failed > 0) {
    console.error('\n[exam-spine-live-schema] negative control が成立しないため、以降の 200 は無意味です。中止します。');
    process.exitCode = 1;
    return;
  }

  // ── 1. Stage 3 の全 query ──────────────────────────────────────
  console.log('\n1. Stage 3 queries');
  for (const { label, query } of QUERIES) {
    const got = await probe(env, toPath(query));
    const ok = got.status === 200;
    if (!ok) failed++;
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(36)} ${query.table.padEnd(26)} cols=${String(query.columns.length).padStart(2)}${query.embed ? `+embed(${query.embed.table})` : ''}  -> ${got.status}${got.code ? ` / ${got.code}` : ''}`,
    );
  }

  // ── 2. 読まないことを宣言している列 / table の非参照確認 ────────
  //
  // 「逐語を SELECT していない」は queries.ts の列配列で構造保証されているが、
  // 該当列が **本番に実在する**ことも確かめておく（存在しない列を「読んでいない」と
  // 主張しても意味がないため）。ここは列の実在確認であって読み取りではない（limit=0）。
  console.log('\n2. 非読取列が本番に実在すること（limit=0。読み取りではない）');
  const forbidden: Array<[string, string]> = [
    ['statement_review_history', 'essay'],
    ['interview_practice_records', 'questions_asked'],
    ['interview_practice_records', 'my_answers'],
    ['presentation_attempts', 'transcript'],
    ['presentation_attempts', 'storage_path'],
    ['presentation_sessions', 'script'],
  ];
  for (const [table, column] of forbidden) {
    const got = await probe(env, `/rest/v1/${table}?select=${column}&limit=0`);
    const ok = got.status === 200;
    if (!ok) failed++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${table}.${column} が実在（Spine は読まない）  -> ${got.status}${got.code ? ` / ${got.code}` : ''}`);
  }

  // ── 3. interview_ai_turns を SELECT していないこと（構造確認）──
  console.log('\n3. 構造確認');
  const turnsReferenced = QUERIES.some(
    ({ query }) => query.table === 'interview_ai_turns' || query.embed?.table === 'interview_ai_turns',
  );
  if (turnsReferenced) failed++;
  console.log(`  ${turnsReferenced ? 'FAIL' : 'PASS'}  interview_ai_turns（逐語）を SELECT しない`);

  const dormantReferenced = QUERIES.some(({ query }) => query.table === 'presentation_practice_records');
  if (dormantReferenced) failed++;
  console.log(`  ${dormantReferenced ? 'FAIL' : 'PASS'}  presentation_practice_records（dormant_no_author）を SELECT しない`);

  const missingOwner = QUERIES.filter(
    ({ query }) => !query.filters.some((f) => f.op === 'eq' && f.column.endsWith('user_id')),
  );
  if (missingOwner.length > 0) failed++;
  console.log(`  ${missingOwner.length === 0 ? 'PASS' : 'FAIL'}  全 query が owner filter を持つ（${QUERIES.length} 本）`);

  console.log(
    `\n[exam-spine-live-schema] HTTP method = GET only / limit=0（行取得 0）/ service_role 未使用`,
  );
  if (failed === 0) {
    console.log('[exam-spine-live-schema] PASS');
  } else {
    console.error(`[exam-spine-live-schema] FAIL（${failed} 件）`);
    process.exitCode = 1;
  }
}

void main();
