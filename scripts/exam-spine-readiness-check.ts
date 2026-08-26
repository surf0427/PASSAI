// Exam Spine — Wave 2 収束 / Stage 4 readiness の機械チェック。
//
// 目的:
//   「Stage 4 を開始してよいか」を人間の感覚ではなく PASS / FAIL で判定できるようにする。
//   本 script が検証するのは **収束状態**であって Stage 4 の実装ではない。
//
// 検証軸:
//   R1  Decision Register が 1 本で、ID が一意・連番であること
//   R2  canonical lineage が単一（lib/examSpine/** に旧 lineage の contract が同居しない）
//   R3  purpose gate が全 purpose に宣言され、default deny が成立すること
//   R4  essay projection が bounded（本文が server projection に載らない）
//   R7  canonical namespace の path 衝突が無いこと
//   R8  Stage 2 contract が凍結され production runtime から import 0 本であること
//   R9  Stage 3 reader の mutation 不可能性 / service_role 不在 / import graph
//
//   R5（live schema）は scripts/exam-spine-live-schema-check.ts、
//   R6（authenticated SELECT policy）は supabase/exam_spine_rls_verification.sql が担当する。
//   いずれも外部依存があるため本 script では判定せず、判定手段だけを示す。
//
// 厳守: 外部通信ゼロ / DB アクセスゼロ / AI 呼び出しゼロ。static 検査と純関数のみ。
//
// 使い方: npm run qa:examSpine:readiness

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { EXAM_CONTEXT_PURPOSES } from '@/lib/examSpine/types';
import {
  EXAM_CONTEXT_REGISTRY,
  gateExamSourceKinds,
  sourcesForPurpose,
} from '@/lib/examSpine/purpose';
import { EXAM_SOURCE_KINDS, EXAM_SOURCE_TABLES } from '@/lib/examSpine/sourceData/types';
import * as Q from '@/lib/examSpine/read/queries';

const ROOT = process.cwd();
let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

// ── R1. Decision Register ─────────────────────────────────────────────
function r1Register(): void {
  console.log('\nR1. Decision Register');
  const path = join(ROOT, 'docs/principles/exam_spine/EXAM_SPINE_DECISIONS.md');
  const text = readFileSync(path, 'utf8');
  const ids = [...text.matchAll(/^## (E-[LSPH])(\d+)/gm)].map((m) => ({
    prefix: m[1],
    n: Number(m[2]),
    id: `${m[1]}${m[2]}`,
  }));

  const seen = new Set<string>();
  const dup: string[] = [];
  for (const { id } of ids) {
    if (seen.has(id)) dup.push(id);
    seen.add(id);
  }
  check('R1 Decision ID に重複が無い', dup.length === 0, dup.join(', '));

  for (const prefix of ['E-L', 'E-S', 'E-P', 'E-H']) {
    const ns = ids.filter((x) => x.prefix === prefix).map((x) => x.n);
    const sorted = [...ns].sort((a, b) => a - b);
    const contiguous = sorted.every((n, i) => n === i + 1);
    check(`R1 ${prefix} が 1..${sorted.length} の連番`, contiguous, sorted.join(','));
    const declaredOrder = ns.join(',') === sorted.join(',');
    check(`R1 ${prefix} が昇順で並んでいる`, declaredOrder, ns.join(','));
  }

  // 本文で参照されている ID がすべて定義済みであること（幽霊参照の検出）。
  const referenced = new Set([...text.matchAll(/\bE-[LSPH]\d+\b/g)].map((m) => m[0]));
  const undefinedRefs = [...referenced].filter((r) => !seen.has(r));
  check('R1 未定義 Decision への参照が無い', undefinedRefs.length === 0, undefinedRefs.join(', '));

  // Wave 2 で登録した decision が実在すること。
  for (const id of ['E-S23', 'E-S24', 'E-S25', 'E-S26', 'E-S27', 'E-S28', 'E-P9']) {
    check(`R1 ${id} が登録済み`, seen.has(id));
  }
  // E-H2 は canonical Register 上で RESOLVED であること（shipping からの統合）。
  const eh2 = text.slice(text.indexOf('## E-H2'), text.indexOf('## E-H3'));
  check('R1 E-H2 が canonical Register 上で RESOLVED', eh2.includes('`RESOLVED`'));

  // ── R6: authenticated SELECT policy の production evidence ─────────
  //
  // ★ 4 kind（self_prs / statement_review_history / essay_workspaces /
  //   interview_practice_records）は policy が無くても 200 + 0 行になり、
  //   runtime では検出できない。したがって Register 上に evidence が
  //   記録されていること自体を gate にする。
  const eh1 = text.slice(text.indexOf('## E-H1'), text.indexOf('## E-H2'));
  check('R6 E-H1 が RESOLVED', eh1.includes('`RESOLVED`'));
  for (const table of [
    'self_prs',
    'statement_review_history',
    'essay_workspaces',
    'interview_practice_records',
  ]) {
    check(`R6 ${table} の owner SELECT policy evidence が記録されている`,
      eh1.includes(`${table} owner select`), 'E-H1 に policy 名が無い');
  }
  check('R6 policy の qual が owner 条件として記録されている',
    (eh1.match(/\(auth\.uid\(\) = user_id\)/g) ?? []).length >= 4);
  check('R6 再検証手段（SQL）が保持されている',
    existsSync(join(ROOT, 'supabase/exam_spine_rls_verification.sql')));
}

// ── R2 / R7. canonical lineage / namespace ────────────────────────────
function r2Namespace(): void {
  console.log('\nR2 / R7. canonical lineage と namespace');
  const spineDir = join(ROOT, 'lib/examSpine');
  const files = walk(spineDir).map((f) => relative(ROOT, f));

  // 旧 lineage の contract が同居していないこと。
  const rejected = [
    'lib/examSpine/read/reader.server.ts',
    'lib/examSpine/read/snapshot.server.ts',
  ];
  const collided = rejected.filter((r) => files.includes(r));
  check('R2 旧 lineage の read 実装が canonical namespace に無い', collided.length === 0,
    collided.join(', '));

  // canonical 側の contract が揃っていること。
  const required = [
    'lib/examSpine/types.ts',
    'lib/examSpine/purpose.ts',
    'lib/examSpine/budget.ts',
    'lib/examSpine/sourceData/types.ts',
    'lib/examSpine/read/types.ts',
    'lib/examSpine/read/queries.ts',
    'lib/examSpine/read/readSources.ts',
    'lib/examSpine/read/requestSnapshot.server.ts',
    'lib/examSpine/read/supabaseExecutor.server.ts',
  ];
  const missing = required.filter((r) => !files.includes(r));
  check('R2 canonical contract が揃っている', missing.length === 0, missing.join(', '));

  // SourceState（旧 lineage の状態型）が canonical に混入していないこと。
  const withSourceState = files.filter((f) =>
    /export (type|const|function) (SourceState|SOURCE_ABSENT|SOURCE_UNAVAILABLE|sourceValueOrNull)/.test(
      readFileSync(join(ROOT, f), 'utf8'),
    ),
  );
  check('R7 旧 lineage の SourceState 契約が混入していない', withSourceState.length === 0,
    withSourceState.join(', '));
}

// ── R3. purpose gate ──────────────────────────────────────────────────
function r3PurposeGate(): void {
  console.log('\nR3. purpose gate');
  const kinds = new Set<string>(EXAM_SOURCE_KINDS);

  const noSources = EXAM_CONTEXT_PURPOSES.filter(
    (p) => !Array.isArray(EXAM_CONTEXT_REGISTRY[p].sources),
  );
  check('R3 全 purpose が sources を宣言', noSources.length === 0, noSources.join(', '));

  const badKinds: string[] = [];
  const badEvidence: string[] = [];
  for (const p of EXAM_CONTEXT_PURPOSES) {
    const policy = EXAM_CONTEXT_REGISTRY[p];
    for (const k of policy.sources) if (!kinds.has(k)) badKinds.push(`${p}:${k}`);
    const ev = Object.keys(policy.sourceEvidence).sort().join('|');
    const src = [...policy.sources].sort().join('|');
    if (ev !== src) badEvidence.push(p);
  }
  check('R3 sources が 10 kind の語彙のみ', badKinds.length === 0, badKinds.join(', '));
  check('R3 sourceEvidence が sources と 1:1', badEvidence.length === 0, badEvidence.join(', '));

  // default deny
  check('R3 未知 purpose は空（default deny）', sourcesForPurpose('nope').length === 0);
  check('R3 非文字列 purpose は空', sourcesForPurpose(null).length === 0);
  const g = gateExamSourceKinds('nope', ['basic_info']);
  check('R3 未知 purpose では全 kind が denied',
    g.allowed.length === 0 && g.denied.length === 1);

  // gate は拡張しない
  const g2 = gateExamSourceKinds('tutor', ['basic_info']);
  check('R3 gate は許可 kind を勝手に足さない', g2.allowed.length === 1);

  // 全 purpose の sources の和集合が 10 kind を超えない
  const union = new Set(EXAM_CONTEXT_PURPOSES.flatMap((p) => [...EXAM_CONTEXT_REGISTRY[p].sources]));
  check('R3 sources の和集合が 10 kind 以内', union.size <= EXAM_SOURCE_KINDS.length,
    `${union.size}`);
}

// ── R4. essay projection ──────────────────────────────────────────────
function r4EssayProjection(): void {
  console.log('\nR4. essay projection');
  const q = Q.essayQuery('00000000-0000-4000-8000-000000000000');
  check('R4 essay が bare workspace 列を SELECT しない', !q.columns.includes('workspace'),
    q.columns.join(', '));
  check('R4 essay が workspace->reviews へ絞っている',
    q.columns.some((c) => c === 'reviews:workspace->reviews'), q.columns.join(', '));

  const mapper = readFileSync(join(ROOT, 'lib/examSpine/read/rowMappers.ts'), 'utf8');
  check('R4 ExamEssayServerRow が bodyOnServer marker を持つ',
    /ExamEssayServerRow = \{\s*[\s\S]*?readonly bodyOnServer: false;/.test(mapper));
  check('R4 mapper が essayBodySnapshot を projection に載せない',
    !/essayBodySnapshot:/.test(mapper));
}

// ── R8 / R9. Stage 2 / Stage 3 の凍結条件 ─────────────────────────────
function r89Frozen(): void {
  console.log('\nR8 / R9. Stage 2 / Stage 3 の凍結条件');
  const spineFiles = walk(join(ROOT, 'lib/examSpine')).map((f) => relative(ROOT, f));

  // production runtime からの import が 0 本
  const appLib = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'lib'))]
    .map((f) => relative(ROOT, f))
    .filter((f) => !f.startsWith('lib/examSpine/'));
  const importers = appLib.filter((f) =>
    /from\s+['"]@\/lib\/examSpine|import\(\s*['"]@\/lib\/examSpine/.test(
      readFileSync(join(ROOT, f), 'utf8'),
    ),
  );
  check('R8 production runtime からの examSpine import が 0 本', importers.length === 0,
    importers.join(', '));

  // ── mutation 不可能性 ───────────────────────────────────────────
  //
  // ★ `.delete(` を機械的に grep すると `WeakMap.delete()` / `Map.delete()` を
  //   DB mutation と誤検出する（requestSnapshot.server.ts / 旧 lineage の TTL cache）。
  //   検出したいのは「in-memory の delete があるか」ではなく
  //   「**DB へ到達しうる mutation があるか**」なので、構造で判定する:
  //
  //     1. Supabase client に触れられるのは .from( を持つ file だけ
  //     2. その file は supabaseExecutor.server.ts 1 本だけ
  //     3. その 1 本に mutation 動詞が無い
  //     4. 全 file で insert / upsert / rpc は 0（in-memory の同名 API が無いため誤検出しない）
  //
  //   これで「DB mutation は書く場所が構造的に無い」ことを示せる（E-S22）。
  const stripComments = (src: string): string =>
    src
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');

  // ★ `.from(` の素朴な grep は組み込み（Uint8Array.from / Array.from / Object.fromEntries）
  //   を Supabase の table 参照と誤検出する。sync/hash.ts が実例。
  //   検出したいのは「Supabase client の .from(table)」だけなので、組み込みを先に除去する。
  const stripBuiltinFrom = (src: string): string =>
    src.replace(/\b(?:[A-Za-z0-9_$]*Array|Object|String|Map|Set|Promise)\.from(?:Entries)?\s*\(/g, 'BUILTIN(');

  const withFrom = spineFiles.filter((f) =>
    /\.from\(/.test(stripBuiltinFrom(stripComments(readFileSync(join(ROOT, f), 'utf8')))),
  );
  check('R9 PostgREST を叩くのは supabaseExecutor.server.ts のみ',
    withFrom.length === 1 && withFrom[0].endsWith('read/supabaseExecutor.server.ts'),
    withFrom.join(', '));

  const executorSrc = withFrom.length === 1 ? stripComments(readFileSync(join(ROOT, withFrom[0]), 'utf8')) : '';
  check('R9 I/O 境界 file に mutation 動詞が無い',
    executorSrc.length > 0 && !/\.(insert|update|upsert|delete|rpc)\s*\(/.test(executorSrc));
  check('R9 I/O 境界 file は select から始まる query しか作らない',
    /\.from\([^)]*\)\.select\(/.test(executorSrc));

  const hardMutations: string[] = [];
  const serviceRole: string[] = [];
  const clientImports: string[] = [];
  for (const f of spineFiles) {
    if (!/\.ts$/.test(f)) continue;
    const code = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    // in-memory の同名 API が存在しない動詞だけを hard flag にする。
    if (/\.(insert|upsert|rpc)\s*\(/.test(code)) hardMutations.push(f);
    if (/service_role|SERVICE_ROLE|serviceRoleClient/.test(code)) serviceRole.push(f);
    // 値としての supabase client import（type-only は除く）。
    if (/^import\s+(?!type\b)[^;]*@supabase\/supabase-js/m.test(code)) clientImports.push(f);
  }
  check('R9 Spine に insert / upsert / rpc が 0 本', hardMutations.length === 0, hardMutations.join(', '));
  check('R9 Spine に service_role 参照が 0 本', serviceRole.length === 0, serviceRole.join(', '));
  check('R9 Spine が supabase client を値として import しない（type-only のみ）',
    clientImports.length === 0, clientImports.join(', '));

  // ExamReadQuery が SELECT 以外を表現できないこと（型で mutation を書けない）。
  const readTypes = stripComments(readFileSync(join(ROOT, 'lib/examSpine/read/types.ts'), 'utf8'));
  check('R9 ExamReadQuery の mode に mutation が無い',
    /mode:\s*'many'\s*\|\s*'maybeSingle'/.test(readTypes));

  // registry と query の table 整合
  const registered = new Set(Object.values(EXAM_SOURCE_TABLES).flat());
  const u = '00000000-0000-4000-8000-000000000000';
  const queries = [
    Q.basicInfoQuery(u), Q.activityQuery(u), Q.diagnosisQuery(u), Q.selfAnalysisQuery(u),
    Q.statementReviewQuery(u), Q.selfPrQuery(u), Q.essayQuery(u), Q.interviewRecordQuery(u),
    Q.interviewAiQuery(u), Q.presentationCoreQuery(u),
    Q.presentationAttemptsQuery(u, [u]), Q.presentationSessionsQuery(u, [u]),
  ];
  const unregistered = queries
    .flatMap((q) => [q.table, ...(q.embed ? [q.embed.table] : [])])
    .filter((t) => !registered.has(t));
  check('R9 query の table がすべて registry 内', unregistered.length === 0,
    [...new Set(unregistered)].join(', '));

  const noOwner = queries.filter(
    (q) => !q.filters.some((f) => f.op === 'eq' && f.column.endsWith('user_id')),
  );
  check('R9 全 query が owner filter を持つ', noOwner.length === 0,
    noOwner.map((q) => q.table).join(', '));
}

// ── coverage 情報（判定ではなく事実の提示）─────────────────────────────
function coverageInfo(): void {
  console.log('\nInfo. Stage 2 block の kind 被覆（判定ではない）');
  const registrySrc = readFileSync(join(ROOT, 'lib/examSpine/blocks/registry.ts'), 'utf8');
  const covered = EXAM_SOURCE_KINDS.filter((k) => registrySrc.includes(`sourceKind: '${k}'`));
  const uncovered = EXAM_SOURCE_KINDS.filter((k) => !covered.includes(k));
  console.log(`  info  block を持つ kind (${covered.length}): ${covered.join(', ')}`);
  console.log(`  info  block を持たない kind (${uncovered.length}): ${uncovered.join(', ')}`);
  console.log('  info  → consumer 移行（Stage 5/6）の前に対象 purpose の block を足すこと（E-S25）');
}

function main(): void {
  console.log('[exam-spine-readiness] Wave 2 収束 / Stage 4 readiness check');
  r1Register();
  r2Namespace();
  r3PurposeGate();
  r4EssayProjection();
  r89Frozen();
  coverageInfo();

  console.log(`\n[exam-spine-readiness] checks passed = ${passed}`);
  if (failures.length > 0) {
    console.error(`[exam-spine-readiness] FAIL: ${failures.length} 件`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log('[exam-spine-readiness] PASS');
}

main();
