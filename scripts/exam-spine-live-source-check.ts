// Exam Spine — live source compatibility check（read-only）。
//
// 目的:
//   lib/contextBuilders/tutor/serverRead/reader.server.ts の **実装そのもの**を、実 Supabase /
//   PostgREST に対して実行し、「reader が発行する SELECT が本番 schema と
//   合致しているか」を機械的に確かめる。
//
//   snapshot QA（exam-spine-tutor-loader-qa.ts）は stub client 相手なので
//   「column 名を間違えている」「PostgREST が受け付けない projection を書いている」
//   といった **本番でしか出ない不整合**を検出できない。本 script がその穴を埋める。
//
// 判定の仕組み:
//   reader は fail-open なので、どんな失敗も SourceState へ畳まれる。
//     absent      … 200 が返り、可視行が無い（未認証 anon では RLS によりこれが正常）
//     unavailable … PostgREST がエラーを返した = **schema / 構文の不一致**
//   したがって「全 reader が absent（unavailable が 0 件）」であれば、
//   select list は本番 schema と互換であると言える。
//
//   ⚠️ それだけでは "200 が返るだけで実は何も検証していない" 可能性が残るため、
//      **negative control** を必ず同時に実行する。存在しない column を指定した
//      query が 400 になることを確認して、本 check に判別力があることを示す。
//
// 厳守:
//   - **read-only**。INSERT / UPDATE / UPSERT / DELETE / DDL を一切行わない。
//   - **anon key のみ**。SUPABASE_SERVICE_ROLE_KEY は読まないし使わない。
//   - **値を出力しない**。行数と status だけを出す（PII / 本文を絶対に出さない）。
//   - 未認証で実行するため、可視行は 0 件が正常。行が見えたら RLS の異常。
//
// 使い方:
//   npm run qa:examSpine:liveSources
//
// 関連: lib/contextBuilders/tutor/serverRead/reader.server.ts

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import Module from 'node:module';

// 'server-only' を no-op へ alias（reader.server.ts を素の Node から読むため）。
const req = createRequire(__filename);
const SERVER_ONLY_STUB = req.resolve('next/dist/compiled/server-only/empty.js');
type ResolveFn = (this: unknown, request: string, ...rest: unknown[]) => string;
const mod = Module as unknown as { _resolveFilename: ResolveFn };
const originalResolve = mod._resolveFilename;
mod._resolveFilename = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return SERVER_ONLY_STUB;
  return originalResolve.call(this, request, ...rest);
};

// ── env（.env.local を読む。service-role は意図的に読まない）──────────
function loadEnv(): { url: string; anonKey: string } | null {
  const fromProcess = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  };
  if (fromProcess.url && fromProcess.anonKey) return fromProcess;

  const path = join(process.cwd(), '.env.local');
  if (!existsSync(path)) return null;
  const parsed: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    parsed[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  const url = parsed.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anonKey = parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  return url && anonKey ? { url, anonKey } : null;
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env) {
    console.error(
      '[exam-spine-live-sources] NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY が取得できません',
    );
    process.exitCode = 1;
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const reader = await import('@/lib/contextBuilders/tutor/serverRead/reader.server');

  const client = createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`[exam-spine-live-sources] host=${new URL(env.url).host}`);
  console.log('[exam-spine-live-sources] key=anon（service_role は使用しない）');
  console.log('[exam-spine-live-sources] mode=read-only / 未認証（RLS により 0 行が正常）');
  console.log('');

  // reader の warn は「失敗した事実」だけ拾えればよい。文言は捨てる。
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(String(args[0] ?? ''));
  };

  const opts = { logLabel: 'live source check' };
  // 未認証なので userId は「誰にも一致しない」固定値でよい。実 userId は使わない。
  const PROBE_USER = '00000000-0000-0000-0000-000000000000';

  const cases: Array<{ kind: string; run: () => Promise<{ status: string }> }> = [
    { kind: 'basic_info', run: () => reader.readBasicInfoSnapshot(client, PROBE_USER, opts) },
    { kind: 'activity', run: () => reader.readActivitySnapshot(client, PROBE_USER, opts) },
    { kind: 'diagnosis', run: () => reader.readDiagnosisSnapshot(client, PROBE_USER, opts) },
    { kind: 'self_analysis', run: () => reader.readLatestSelfAnalysisRow(client, PROBE_USER, opts) },
    { kind: 'interview_ai', run: () => reader.readLatestInterviewAiRow(client, PROBE_USER, opts) },
    { kind: 'presentation', run: () => reader.readLatestPresentationResultRow(client, PROBE_USER, opts) },
    // Phase 3.5 parity source。
    { kind: 'statement_review', run: () => reader.readLatestStatementReviewRow(client, PROBE_USER, opts) },
    { kind: 'essay ★', run: () => reader.readLatestEssayReviewsRow(client, PROBE_USER, opts) },
    { kind: 'interview_record', run: () => reader.readLatestInterviewPracticeRow(client, PROBE_USER, opts) },
  ];

  let unavailable = 0;
  let visibleRows = 0;
  const results: Array<[string, string]> = [];
  for (const c of cases) {
    const state = await c.run();
    results.push([c.kind, state.status]);
    if (state.status === 'unavailable') unavailable += 1;
    if (state.status === 'ready') visibleRows += 1;
  }

  // ── negative control ──
  // 存在しない column を指定した query が本当に落ちることを確認する。
  // これが落ちなければ、上の「全部 absent」は無意味（判別力ゼロ）である。
  const control = await client
    .from('essay_workspaces')
    .select('updated_at, definitely_not_a_real_column')
    .limit(1);
  const controlFailed = control.error != null;

  console.warn = realWarn;

  for (const [kind, status] of results) {
    const mark = status === 'unavailable' ? 'FAIL' : 'OK  ';
    console.log(`  ${mark}  ${kind.padEnd(20)} -> ${status}`);
  }
  console.log('');
  console.log(
    `  ${controlFailed ? 'OK  ' : 'FAIL'}  negative control     -> ${
      controlFailed ? `rejected (${control.error?.code ?? 'error'})` : 'ACCEPTED（判別力なし）'
    }`,
  );
  console.log('');

  let failures = 0;
  if (unavailable > 0) {
    console.error(
      `[exam-spine-live-sources] ${unavailable} 件の reader が unavailable = 本番 schema と不一致`,
    );
    failures += unavailable;
  }
  if (!controlFailed) {
    console.error(
      '[exam-spine-live-sources] negative control が通ってしまった。本 check は判別力を持たない',
    );
    failures += 1;
  }
  if (visibleRows > 0) {
    console.error(
      `[exam-spine-live-sources] 未認証で ${visibleRows} 件の source が可視。RLS の異常`,
    );
    failures += visibleRows;
  }

  if (failures > 0) {
    console.error('[exam-spine-live-sources] CHECK FAIL');
    process.exitCode = 1;
    return;
  }
  console.log(
    '[exam-spine-live-sources] CHECK PASS（select list は本番 schema と互換 / RLS は未認証に対して閉じている）',
  );
}

void main();
