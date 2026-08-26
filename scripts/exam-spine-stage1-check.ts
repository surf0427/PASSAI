// Exam Spine — Stage 1 contract checks。
//
// 目的:
//   Stage 1 の成果物（lib/examSpine/**）が「静的宣言だけである」ことと、
//   宣言が Decision / architecture と一致していることを機械的に検証する。
//
// 厳守（Stage 1 の制約）:
//   - AI API を絶対に呼ばない。script 冒頭で globalThis.fetch を trap する。
//   - production runtime を一切変更しない（本 script は読むだけ）。
//   - deterministic。Date.now / Math.random / 環境変数に依存しない。
//   - dependency を追加しない（Node 標準 + 既存 lib のみ / E-S14）。
//
// 使い方:
//   npm run qa:examSpine:stage1
//
// 関連:
//   docs/principles/exam_spine/EXAM_SPINE_ARCHITECTURE.md
//   docs/principles/exam_spine/EXAM_SPINE_DECISIONS.md
//   lib/examSpine/README.md
// Upstream architecture reference: PASSAI-CAREER/scripts/（QA script 方式）

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// ── 外部通信 trap（AI calls = 0 の機械的証明）──────────────────────
let fetchCallCount = 0;
globalThis.fetch = ((...args: unknown[]) => {
  fetchCallCount += 1;
  const target = typeof args[0] === 'string' ? args[0] : '(non-string input)';
  throw new Error(`[exam-spine-stage1] 外部通信が発生しました（Stage 1 では禁止）: ${target}`);
}) as typeof globalThis.fetch;

import {
  EXAM_CONTEXT_PURPOSES,
  isExamContextPurpose,
  type ExamContextOrigin,
  type ExamContextPurpose,
} from '@/lib/examSpine/types';
import {
  EXAM_SOURCE_AUTHORITY,
  EXAM_SOURCE_KINDS,
  EXAM_SOURCE_TABLES,
  isExamSourceKind,
  type ExamSourceAuthorityClass,
  type ExamSourceKind,
  type ExamSourceReadStatus,
} from '@/lib/examSpine/sourceData/types';
import { EXAM_CONTEXT_BUDGETS } from '@/lib/examSpine/budget';
import { EXAM_CONTEXT_REGISTRY } from '@/lib/examSpine/purpose';

const REPO_ROOT = process.cwd();
const SPINE_DIR = join(REPO_ROOT, 'lib', 'examSpine');

// EXAM_SPINE_ARCHITECTURE.md §3 の想定 mapping（class 1 = 8 / class 2 = 2）。
const EXPECTED_CLASS_1: readonly ExamSourceKind[] = [
  'basic_info',
  'activity',
  'diagnosis',
  'self_analysis',
  'statement_review',
  'self_pr',
  'essay',
  'interview_record',
];
const EXPECTED_CLASS_2: readonly ExamSourceKind[] = ['interview_ai', 'presentation'];

// E-L6 / 設計監査 §18。lib/examSpine/** の runtime に現れてはいけない語。
// CAREER の**ファイルパス**をコメントに書くことだけは許可されているため、
// `/Users/yk/PASSAI-CAREER/...` 形式の参照は除外してから走査する。
const FORBIDDEN_CAREER_TOKENS: readonly string[] = [
  'NEXT_PUBLIC_CAREER_',
  'CAREER_SUPABASE',
  'CAREER_SUPABASE_SERVICE_ROLE_KEY',
  'career_profiles',
  'career_activities',
  'career_values',
  'career_personal_memory',
  'bhhmvupzcxoaonrowikg',
];

let failures = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  PASS  ${label}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? `\n          ${detail}` : ''}`);
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dup.add(v);
    seen.add(v);
  }
  return [...dup];
}

/** lib/examSpine/** の .ts を再帰列挙する（README.md は対象外）。 */
function listSpineSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listSpineSources(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out.sort();
}

/** app/** と lib/**（examSpine 自身を除く）から examSpine を import している箇所。 */
function findRuntimeImporters(): string[] {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (full === SPINE_DIR) continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|mts|js|jsx)$/.test(entry)) continue;
      const text = readFileSync(full, 'utf8');
      if (/examSpine/.test(text)) hits.push(relative(REPO_ROOT, full));
    }
  };
  for (const root of ['app', 'lib']) walk(join(REPO_ROOT, root));
  return hits;
}

function main(): void {
  console.log('[exam-spine-stage1] Stage 1 contract checks\n');

  // ── 1. Source kind ──────────────────────────────────────────────
  console.log('1. ExamSourceKind');
  const kindDup = duplicates(EXAM_SOURCE_KINDS);
  check('ExamSourceKind duplicate = 0', kindDup.length === 0, `duplicates: ${kindDup.join(', ')}`);
  check('ExamSourceKind = 10 種', EXAM_SOURCE_KINDS.length === 10, `actual: ${EXAM_SOURCE_KINDS.length}`);
  check('isExamSourceKind が全 kind を受理し未知値を拒否する',
    EXAM_SOURCE_KINDS.every((k) => isExamSourceKind(k)) &&
      !isExamSourceKind('career_profile') &&
      !isExamSourceKind(42));

  // ── 2. Authority mapping ────────────────────────────────────────
  console.log('\n2. EXAM_SOURCE_AUTHORITY');
  const authKeys = Object.keys(EXAM_SOURCE_AUTHORITY);
  check('全 ExamSourceKind を exactly once カバー',
    authKeys.length === EXAM_SOURCE_KINDS.length &&
      EXAM_SOURCE_KINDS.every((k) => Object.prototype.hasOwnProperty.call(EXAM_SOURCE_AUTHORITY, k)),
    `keys: ${authKeys.length} / kinds: ${EXAM_SOURCE_KINDS.length}`);

  const byClass = (cls: ExamSourceAuthorityClass): ExamSourceKind[] =>
    EXAM_SOURCE_KINDS.filter((k) => EXAM_SOURCE_AUTHORITY[k] === cls);
  const class1 = byClass('device_canonical_mirrored');
  const class2 = byClass('server_authoritative');
  check('class 1 = ARCHITECTURE.md §3 の 8 kind',
    class1.join(',') === EXPECTED_CLASS_1.join(','),
    `actual: ${class1.join(', ')}`);
  check('class 2 = ARCHITECTURE.md §3 の 2 kind',
    class2.join(',') === EXPECTED_CLASS_2.join(','),
    `actual: ${class2.join(', ')}`);

  // ── 3. Source table ─────────────────────────────────────────────
  console.log('\n3. EXAM_SOURCE_TABLES');
  check('全 ExamSourceKind を exactly once カバー',
    Object.keys(EXAM_SOURCE_TABLES).length === EXAM_SOURCE_KINDS.length &&
      EXAM_SOURCE_KINDS.every((k) => Object.prototype.hasOwnProperty.call(EXAM_SOURCE_TABLES, k)));
  const emptyTables = EXAM_SOURCE_KINDS.filter((k) => EXAM_SOURCE_TABLES[k].length === 0);
  check('各 kind が 1 つ以上の table 名を持つ', emptyTables.length === 0, `empty: ${emptyTables.join(', ')}`);

  // schema.sql に実在する table 名であること（Stage 1 は read しないが、名前の drift は検出する）。
  const schemaSql = readFileSync(join(REPO_ROOT, 'supabase', 'schema.sql'), 'utf8');
  const missingTables = EXAM_SOURCE_KINDS.flatMap((k) =>
    EXAM_SOURCE_TABLES[k].filter((t) => !new RegExp(`CREATE TABLE\\s+${t}\\b`, 'i').test(schemaSql)),
  );
  check('全 table 名が supabase/schema.sql に実在する',
    missingTables.length === 0, `missing: ${missingTables.join(', ')}`);

  // 同じ table を 2 kind が主張していないこと（authority の所在が曖昧になるため）。
  const allTables = EXAM_SOURCE_KINDS.flatMap((k) => [...EXAM_SOURCE_TABLES[k]]);
  const tableDup = duplicates(allTables);
  check('同じ table を複数 kind が主張していない', tableDup.length === 0,
    `duplicated: ${tableDup.join(', ')}`);

  // Human Decision B9: presentation は results / attempts / sessions の 3 table。
  // enrichment が実際に presentation_sessions を読むため、registry に無い table を
  // reader から黙って読む状態を作らない。
  check('presentation の table authority = results / attempts / sessions（B9）',
    EXAM_SOURCE_TABLES.presentation.join(',') ===
      'presentation_results,presentation_attempts,presentation_sessions',
    `actual: ${EXAM_SOURCE_TABLES.presentation.join(', ')}`);

  // presentation_practice_records は dormant_no_author。registry に入れない。
  check('presentation_practice_records が table registry に入っていない（dormant_no_author）',
    !allTables.includes('presentation_practice_records'));

  // ── 4. Purpose ──────────────────────────────────────────────────
  console.log('\n4. ExamContextPurpose');
  const purposeDup = duplicates(EXAM_CONTEXT_PURPOSES);
  check('ExamContextPurpose duplicate = 0', purposeDup.length === 0, `duplicates: ${purposeDup.join(', ')}`);
  check('isExamContextPurpose が全 purpose を受理し未知値を拒否する',
    EXAM_CONTEXT_PURPOSES.every((p) => isExamContextPurpose(p)) &&
      !isExamContextPurpose('consultation') &&
      !isExamContextPurpose(null));

  // ── 5. Registry ─────────────────────────────────────────────────
  console.log('\n5. EXAM_CONTEXT_REGISTRY');
  check('全 ExamContextPurpose を exactly once カバー',
    Object.keys(EXAM_CONTEXT_REGISTRY).length === EXAM_CONTEXT_PURPOSES.length &&
      EXAM_CONTEXT_PURPOSES.every((p) => Object.prototype.hasOwnProperty.call(EXAM_CONTEXT_REGISTRY, p)),
    `keys: ${Object.keys(EXAM_CONTEXT_REGISTRY).length} / purposes: ${EXAM_CONTEXT_PURPOSES.length}`);

  // E-P4: profileTarget は「現在 氏名が乗っている purpose」の target 表明にだけ付く。
  const badTarget = EXAM_CONTEXT_PURPOSES.filter((p) => {
    const policy = EXAM_CONTEXT_REGISTRY[p];
    if (policy.profileTarget === undefined) return false;
    return policy.profile !== 'include' || policy.profileTarget !== 'minimal';
  });
  check('profileTarget が付くのは profile:include の purpose だけ（E-P4）',
    badTarget.length === 0, `violating: ${badTarget.join(', ')}`);

  const missingTarget = EXAM_CONTEXT_PURPOSES.filter(
    (p) => EXAM_CONTEXT_REGISTRY[p].profile === 'include' && EXAM_CONTEXT_REGISTRY[p].profileTarget === undefined,
  );
  check('profile:include の purpose は必ず profileTarget を持つ（E-P4）',
    missingTarget.length === 0, `missing: ${missingTarget.join(', ')}`);

  const noNotes = EXAM_CONTEXT_PURPOSES.filter((p) => !EXAM_CONTEXT_REGISTRY[p].notes?.trim());
  check('全 purpose が現行挙動の根拠 notes を持つ', noNotes.length === 0, `missing: ${noNotes.join(', ')}`);

  // ── 6. Budget ───────────────────────────────────────────────────
  console.log('\n6. EXAM_CONTEXT_BUDGETS');
  check('全 ExamContextPurpose を exactly once カバー',
    Object.keys(EXAM_CONTEXT_BUDGETS).length === EXAM_CONTEXT_PURPOSES.length &&
      EXAM_CONTEXT_PURPOSES.every((p) => Object.prototype.hasOwnProperty.call(EXAM_CONTEXT_BUDGETS, p)));

  const badChars = EXAM_CONTEXT_PURPOSES.filter((p) => {
    const n = EXAM_CONTEXT_BUDGETS[p].maxContextChars;
    return !Number.isFinite(n) || !Number.isInteger(n) || n <= 0;
  });
  check('maxContextChars が finite / integer / > 0', badChars.length === 0, `violating: ${badChars.join(', ')}`);

  const mismatched = EXAM_CONTEXT_PURPOSES.filter(
    (p) => EXAM_CONTEXT_REGISTRY[p].maxContextChars !== EXAM_CONTEXT_BUDGETS[p].maxContextChars,
  );
  check('registry の maxContextChars が budget.ts と一致（値の正本は budget.ts）',
    mismatched.length === 0, `mismatched: ${mismatched.join(', ')}`);

  const noDerivation = EXAM_CONTEXT_PURPOSES.filter((p) => !EXAM_CONTEXT_BUDGETS[p].derivation.trim());
  check('全 budget が derivation（導出根拠）を持つ', noDerivation.length === 0, `missing: ${noDerivation.join(', ')}`);

  // ── 7. Product boundary（E-L6）──────────────────────────────────
  console.log('\n7. Product boundary — CAREER runtime dependency');
  const spineFiles = listSpineSources(SPINE_DIR);
  const boundaryHits: string[] = [];
  for (const file of spineFiles) {
    // upstream reference として許可されている CAREER の**ファイルパス**は除外する。
    const scanned = readFileSync(file, 'utf8').replace(/\/Users\/yk\/PASSAI-CAREER\S*/g, '');
    for (const token of FORBIDDEN_CAREER_TOKENS) {
      if (scanned.includes(token)) boundaryHits.push(`${relative(REPO_ROOT, file)}: ${token}`);
    }
  }
  check(`CAREER runtime dependency = 0（走査 ${spineFiles.length} file）`,
    boundaryHits.length === 0, boundaryHits.join('\n          '));

  // Stage 1 の宣言層は **完全に自己完結**でなければならない。ここに外部 import が生えると
  // 「現行挙動の宣言」がいつの間にか実装依存になる。
  //
  // ★ この assertion は **Stage 1 canonical files だけ**を対象にする（Stage-scoped）。
  //   以前は lib/examSpine/** 全体へ適用していたが、それだと Stage 2 の block 層や
  //   Stage 3 の read 層が持つ **正当な** import まで「Stage 1 architecture violation」として
  //   落ちてしまう。目的（Stage 1 の宣言が実装に依存しないこと）は変えず、対象だけを絞る。
  //   allowlist は狭いままにする — 足すときは「本当に Stage 1 canonical か」を先に判断すること。
  const STAGE1_CANONICAL_FILES: readonly string[] = [
    join('lib', 'examSpine', 'types.ts'),
    join('lib', 'examSpine', 'sourceData', 'types.ts'),
    join('lib', 'examSpine', 'budget.ts'),
    join('lib', 'examSpine', 'purpose.ts'),
  ];
  const declarationFiles = spineFiles.filter((f) =>
    STAGE1_CANONICAL_FILES.includes(relative(REPO_ROOT, f)),
  );
  check('Stage 1 canonical file が 4 本すべて実在する',
    declarationFiles.length === STAGE1_CANONICAL_FILES.length,
    `found: ${declarationFiles.map((f) => relative(REPO_ROOT, f)).join(', ')}`);
  const declarationImportHits: string[] = [];
  for (const file of declarationFiles) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)) {
      const spec = m[1];
      const local = spec.startsWith('.') || spec.startsWith('@/lib/examSpine');
      if (!local) declarationImportHits.push(`${relative(REPO_ROOT, file)}: ${spec}`);
    }
  }
  check('Stage 1 宣言層の import は Spine 内部のみ（外部 runtime 依存ゼロ）',
    declarationImportHits.length === 0, declarationImportHits.join('\n          '));

  // Stage 2 の block / orchestrator 層は、**現行の共有 formatter を呼ぶ**ことが仕事なので
  // 外部 import を持つ（同じ section を Spine 側で二重実装しないため）。
  // ただし「何を import してよいか」は無制限にしない:
  //   - server / DB / AI / storage 系を引き込んだ瞬間に Stage 2 が pure でなくなる
  //   - Stage 2 は shadow implementation であり、production が Spine を import しないことは
  //     直後の「8. Runtime wiring」で別途担保される
  const FORBIDDEN_IMPORT_PATTERNS = [
    'server-only',
    '@supabase',
    '@/lib/supabase',
    '@anthropic-ai',
    'openai',
    '@/lib/billing',
    'Storage',
    'next/',
  ];
  // Stage 3 の read 層（lib/examSpine/read/**）は server / Supabase を **正当に** import する。
  // その import 境界は Stage 3 の QA（scripts/exam-spine-stage3-check.ts）が
  // service_role / mutation / mirror table まで含めて厳密に検査するので、ここでは扱わない。
  const stage2Files = spineFiles.filter((f) => {
    const rel = relative(REPO_ROOT, f);
    return rel.includes(`${sep}blocks${sep}`) || rel.includes(`${sep}orchestrator${sep}`);
  });
  const impureImportHits: string[] = [];
  for (const file of stage2Files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)) {
      const spec = m[1];
      // type-only import は runtime dependency を作らないため対象外。
      if (/^\s*import\s+type\s/.test(m[0])) continue;
      for (const bad of FORBIDDEN_IMPORT_PATTERNS) {
        if (spec.includes(bad)) impureImportHits.push(`${relative(REPO_ROOT, file)}: ${spec}`);
      }
    }
  }
  check('Stage 2 実装層（blocks / orchestrator）は server / DB / AI / storage を import しない',
    impureImportHits.length === 0, impureImportHits.join('\n          '));

  // ── 8. Stage 1 は dead module である ────────────────────────────
  console.log('\n8. Runtime wiring');
  const importers = findRuntimeImporters();
  check('production runtime import = 0（Stage 1 は誰からも呼ばれない）',
    importers.length === 0, `importers: ${importers.join(', ')}`);

  // ── 9. 型が実際に使えること（tsc だけでなく実行時にも確認）──────
  console.log('\n9. Type surface');
  const origins: readonly ExamContextOrigin[] = ['server', 'bridge', 'not_server_capable'];
  const statuses: readonly ExamSourceReadStatus[] = ['ok', 'truncated', 'error', 'skipped'];
  const somePurpose: ExamContextPurpose = 'tutor';
  check('ExamContextOrigin / ExamSourceReadStatus / purpose が参照可能',
    origins.length === 3 && statuses.length === 4 && EXAM_CONTEXT_REGISTRY[somePurpose] !== undefined);

  // ── 結果 ────────────────────────────────────────────────────────
  console.log(`\n[exam-spine-stage1] network calls = ${fetchCallCount}（AI API 呼び出しゼロ）`);
  if (fetchCallCount !== 0 || failures > 0) {
    console.error(`\n[exam-spine-stage1] FAIL: ${failures} check が不合格`);
    process.exitCode = 1;
    return;
  }
  console.log('[exam-spine-stage1] CHECK PASS');
}

main();
