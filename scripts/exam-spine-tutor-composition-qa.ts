// Exam Spine Phase 3 — Tutor prompt composition QA。
//
// 目的:
//   canary（TUTOR_SPINE_CONTEXT_ENABLED）の ON / OFF で、
//   **最終 prompt に何が載るか**を機械的に固定する。
//
//   OFF … block1 + block2(body 由来) + block3(Spine 由来)、userPrompt に body 由来の人物情報
//   ON  … block1 + block3 のみ。body 由来の**人物情報**は prompt のどこにも現れない
//
// 中心の assert（Phase 3 の存在理由）:
//   ON の最終 prompt で
//     CLIENT_ONLY_* の出現数 = 0
//     SPINE_ONLY_*  の出現数 = 1（重複投入が解消されている）
//     WORK_ONLY_*   の出現数 = 1（作業材料は過剰除去していない）
//
// 厳守:
//   - **AI API を絶対に呼ばない**。fetch を trap して外部通信ゼロを機械的に担保する。
//   - **実 Supabase へ接続しない**。Spine context は fixture の literal を渡す。
//   - deterministic。Date / Math.random / 環境依存値に依存しない。
//   - 実ユーザーデータを扱わない（synthetic fixture のみ）。
//
// 使い方:
//   npm run qa:examSpine:tutorComposition
//   npx tsx scripts/exam-spine-tutor-composition-qa.ts --record
//   npx tsx scripts/exam-spine-tutor-composition-qa.ts --check
//
// 関連:
//   lib/tutor/composeTutorPrompt.ts
//   lib/tutor/spineContextFlag.ts
//   scripts/fixtures/examSpineTutorComposition.ts

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import Module from 'node:module';

// ── 1. 'server-only' を no-op へ alias（scripts/exam-spine-tutor-loader-qa.ts と同形）──

const req = createRequire(__filename);
const SERVER_ONLY_STUB = req.resolve('next/dist/compiled/server-only/empty.js');

type ResolveFn = (this: unknown, request: string, ...rest: unknown[]) => string;
const moduleInternals = Module as unknown as { _resolveFilename: ResolveFn };
const originalResolve = moduleInternals._resolveFilename;
moduleInternals._resolveFilename = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return SERVER_ONLY_STUB;
  return originalResolve.call(this, request, ...rest);
};

// ── 2. 外部通信 trap ──────────────────────────────────────────────

let fetchCallCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = ((...args: unknown[]) => {
  fetchCallCount += 1;
  const target = typeof args[0] === 'string' ? args[0] : '(non-string input)';
  throw new Error(
    `[exam-spine-tutor-composition-qa] 外部通信が発生しました（禁止）: ${target}`,
  );
}) as typeof globalThis.fetch;
void originalFetch;

// ── 3. 対象（dynamic import: server-only alias の後に読む）─────────

type ComposeModule = typeof import('@/lib/tutor/composeTutorPrompt');
type PromptModule = typeof import('@/lib/tutor/tutorPrompt');
let composeMod: ComposeModule;
let promptMod: PromptModule;

import {
  COMPOSITION_FIXTURES,
  CLIENT_ONLY_UNIV,
  CLIENT_ONLY_STRENGTH,
  CLIENT_ONLY_TRACK,
  CLIENT_ONLY_STATEMENT,
  CLIENT_ONLY_ESSAY,
  CLIENT_ONLY_PRACTICE,
  SPINE_ONLY_UNIV,
  SPINE_ONLY_STRENGTH,
  SPINE_ONLY_TRACK,
  SPINE_ONLY_STATEMENT,
  SPINE_ONLY_ESSAY,
  SPINE_ONLY_PRACTICE,
  WORK_ONLY_DRAFT,
  type CompositionFixture,
} from './fixtures/examSpineTutorComposition';

const CLIENT_SENTINELS = [
  CLIENT_ONLY_UNIV,
  CLIENT_ONLY_STRENGTH,
  CLIENT_ONLY_TRACK,
  CLIENT_ONLY_STATEMENT,
  CLIENT_ONLY_ESSAY,
  CLIENT_ONLY_PRACTICE,
];

// Spine sentinel → 「その sentinel が ON の prompt に出る条件」。
// sourceSummary から期待出現数を導き、`絶対 1 回`を assert する（重複投入の再発防止）。
const SPINE_SENTINEL_GATES: ReadonlyArray<{
  value: string;
  gate: (s: CompositionFixture['spineContext']['sourceSummary']) => boolean;
}> = [
  { value: SPINE_ONLY_UNIV, gate: (s) => s.hasBasicInfo },
  { value: SPINE_ONLY_TRACK, gate: (s) => s.hasBasicInfo },
  { value: SPINE_ONLY_STRENGTH, gate: (s) => s.hasSelfAnalysis },
  { value: SPINE_ONLY_STATEMENT, gate: (s) => s.hasStatementReview },
  { value: SPINE_ONLY_ESSAY, gate: (s) => s.hasEssay },
  { value: SPINE_ONLY_PRACTICE, gate: (s) => s.hasInterviewPractice },
];

// ── 4. helper ─────────────────────────────────────────────────────

function occurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    count += 1;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return count;
}

type Composed = ReturnType<ComposeModule['composeTutorPrompt']>;

/** system blocks + user prompt を 1 本の「最終 prompt」文字列にする。 */
function finalPrompt(c: Composed): string {
  return [...c.systemBlocks.map((b) => b.text), c.userPrompt].join('\n\n');
}

function compose(fixture: CompositionFixture, spineOnlyContext: boolean): Composed {
  return composeMod.composeTutorPrompt({
    spineOnlyContext,
    body: fixture.body,
    intent: fixture.intent,
    spineContext: fixture.spineContext,
    userMessage: fixture.userMessage,
    // builder は throw しない想定。throw したら QA を失敗させたいので記録する。
    onBuildError: (stage, error) => {
      throw new Error(
        `composeTutorPrompt threw at stage=${stage}: ${
          error instanceof Error ? error.name : String(error)
        }`,
      );
    },
  });
}

// ── 5. 不変条件 assert ────────────────────────────────────────────

function assertInvariants(
  fixture: CompositionFixture,
  off: Composed,
  on: Composed,
): string[] {
  const f: string[] = [];
  const tag = fixture.id;
  const offText = finalPrompt(off);
  const onText = finalPrompt(on);

  // ① block 1 は静的 prompt そのもの。1 byte も変わらない。
  for (const [mode, c] of [
    ['OFF', off],
    ['ON', on],
  ] as const) {
    const b0 = c.systemBlocks[0];
    if (!b0 || b0.text !== promptMod.TUTOR_SYSTEM_PROMPT) {
      f.push(`${tag}/${mode}: systemBlocks[0] が TUTOR_SYSTEM_PROMPT と一致しない`);
    }
    if (b0?.cache_control?.type !== 'ephemeral') {
      f.push(`${tag}/${mode}: systemBlocks[0] の cache_control が ephemeral でない`);
    }
    // ② cache breakpoint は block 1 のみ。後段に cache_control を付けない。
    for (let i = 1; i < c.systemBlocks.length; i += 1) {
      if (c.systemBlocks[i].cache_control !== undefined) {
        f.push(`${tag}/${mode}: systemBlocks[${i}] に cache_control が付いている`);
      }
    }
    // ③ Spine 由来 context を block 1 へ混ぜていない。
    for (const { value } of SPINE_SENTINEL_GATES) {
      if (b0 && occurrences(b0.text, value) !== 0) {
        f.push(`${tag}/${mode}: block1 に Spine context (${value}) が混入している`);
      }
    }
  }

  // ④ ON では body 由来の人物情報が最終 prompt のどこにも無い（★Phase 3 の中心）。
  for (const s of CLIENT_SENTINELS) {
    const n = occurrences(onText, s);
    if (n !== 0) f.push(`${tag}/ON: client-only sentinel ${s} が ${n} 回残っている`);
  }

  // ⑤ ON でも Spine 由来は残る。かつ重複しない（必ず 1 回 = 1 系統のみ）。
  const summary = fixture.spineContext.sourceSummary;
  for (const { value, gate } of SPINE_SENTINEL_GATES) {
    // fixture がその sentinel を持っていない場合は対象外。
    if (!JSON.stringify(fixture.spineContext).includes(value)) continue;
    const expected = gate(summary) ? 1 : 0;
    const n = occurrences(onText, value);
    if (n !== expected) {
      f.push(`${tag}/ON: spine sentinel ${value} の出現数が ${n}（期待 ${expected}）`);
    }
  }

  // ⑥ OFF は従来どおり両方載る（rollback path が生きている）。
  for (const s of CLIENT_SENTINELS) {
    const inBody = JSON.stringify(fixture.body).includes(s);
    if (inBody && occurrences(offText, s) === 0) {
      f.push(`${tag}/OFF: client sentinel ${s} が消えている（rollback path が壊れている）`);
    }
  }

  // ⑦ block 順序: block1 → (block2) → block3。ON では block2 が存在しない。
  if (on.studentContextSection !== '') {
    f.push(`${tag}/ON: block2（body 由来）が組み立てられている`);
  }
  if (on.systemBlocks.length > 2) {
    f.push(`${tag}/ON: systemBlocks が 3 つ以上ある（block2 が残っている疑い）`);
  }
  if (
    off.supabaseStudentContextSection !== '' &&
    off.systemBlocks[off.systemBlocks.length - 1].text !==
      off.supabaseStudentContextSection
  ) {
    f.push(`${tag}/OFF: block3 が最後に来ていない`);
  }

  // ⑧ 作業材料は ON でも残る（過剰除去の検出）。
  //    OFF 側にも出ていることを先に確かめる。OFF で 0 なら fixture の shape が壊れており、
  //    ON の 0 を「正しく残っている」と誤読してしまうため。
  if (JSON.stringify(fixture.body).includes(WORK_ONLY_DRAFT)) {
    if (occurrences(offText, WORK_ONLY_DRAFT) < 1) {
      f.push(
        `${tag}/OFF: 作業材料 ${WORK_ONLY_DRAFT} が prompt に出ていない（fixture の shape 不備）`,
      );
    } else if (occurrences(onText, WORK_ONLY_DRAFT) < 1) {
      f.push(`${tag}/ON: 作業材料 ${WORK_ONLY_DRAFT} まで除去されている（過剰除去）`);
    }
  }

  // ⑨ ON の prompt は OFF 以下（重複除去の結果として増えない）。
  if (onText.length > offText.length) {
    f.push(
      `${tag}: ON の prompt が OFF より長い（ON=${onText.length} / OFF=${offText.length}）`,
    );
  }

  // ⑩ 新規 / partial user でも Tutor は成立する（block1 は必ずある）。
  if (on.systemBlocks.length < 1 || on.userPrompt === '') {
    f.push(`${tag}/ON: prompt が成立していない（新規/partial で壊れている）`);
  }

  return f;
}

// ── 6. snapshot ───────────────────────────────────────────────────

function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSort);
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = stableSort(src[k]);
    return out;
  }
  if (value === undefined) return '__undefined__';
  return value;
}

function serialize(value: unknown): string {
  return `${JSON.stringify(stableSort(value), null, 2)}\n`;
}

const SNAPSHOT_DIR = join(__dirname, 'fixtures', 'exam-spine-tutor-composition');

/**
 * snapshot には block1（巨大な静的 prompt）を丸ごと入れず、長さと一致フラグだけ持つ。
 * 動的部分（block2 / block3 / userPrompt）は全文を固定する。
 */
function summarize(c: Composed): Record<string, unknown> {
  return {
    systemBlockCount: c.systemBlocks.length,
    block1IsStaticPrompt: c.systemBlocks[0]?.text === promptMod.TUTOR_SYSTEM_PROMPT,
    block1CacheControl: c.systemBlocks[0]?.cache_control?.type ?? null,
    laterBlocksHaveCacheControl: c.systemBlocks
      .slice(1)
      .some((b) => b.cache_control !== undefined),
    studentContextSection: c.studentContextSection,
    supabaseStudentContextSection: c.supabaseStudentContextSection,
    contextString: c.contextString,
    userPrompt: c.userPrompt,
    finalPromptLength: finalPrompt(c).length,
  };
}

function buildSnapshot(fixture: CompositionFixture): Record<string, unknown> {
  const off = compose(fixture, false);
  const on = compose(fixture, true);
  const offText = finalPrompt(off);
  const onText = finalPrompt(on);

  const sentinelCounts = (text: string) => ({
    CLIENT_ONLY_UNIV: occurrences(text, CLIENT_ONLY_UNIV),
    CLIENT_ONLY_STRENGTH: occurrences(text, CLIENT_ONLY_STRENGTH),
    CLIENT_ONLY_TRACK: occurrences(text, CLIENT_ONLY_TRACK),
    CLIENT_ONLY_STATEMENT: occurrences(text, CLIENT_ONLY_STATEMENT),
    CLIENT_ONLY_ESSAY: occurrences(text, CLIENT_ONLY_ESSAY),
    CLIENT_ONLY_PRACTICE: occurrences(text, CLIENT_ONLY_PRACTICE),
    SPINE_ONLY_UNIV: occurrences(text, SPINE_ONLY_UNIV),
    SPINE_ONLY_STRENGTH: occurrences(text, SPINE_ONLY_STRENGTH),
    SPINE_ONLY_TRACK: occurrences(text, SPINE_ONLY_TRACK),
    SPINE_ONLY_STATEMENT: occurrences(text, SPINE_ONLY_STATEMENT),
    SPINE_ONLY_ESSAY: occurrences(text, SPINE_ONLY_ESSAY),
    SPINE_ONLY_PRACTICE: occurrences(text, SPINE_ONLY_PRACTICE),
    WORK_ONLY_DRAFT: occurrences(text, WORK_ONLY_DRAFT),
  });

  return {
    fixtureId: fixture.id,
    description: fixture.description,
    intent: fixture.intent,
    canaryOff: summarize(off),
    canaryOn: summarize(on),
    sentinels: {
      off: sentinelCounts(offText),
      on: sentinelCounts(onText),
    },
    promptLength: { off: offText.length, on: onText.length },
  };
}

// ── 7. run ────────────────────────────────────────────────────────

type Mode = 'record' | 'check';

function parseMode(argv: readonly string[]): Mode {
  return argv.includes('--record') ? 'record' : 'check';
}

async function main(): Promise<void> {
  composeMod = await import('@/lib/tutor/composeTutorPrompt');
  promptMod = await import('@/lib/tutor/tutorPrompt');

  const mode = parseMode(process.argv.slice(2));
  console.log(`[exam-spine-tutor-composition-qa] mode=${mode}`);
  console.log(
    `[exam-spine-tutor-composition-qa] fixtures=${COMPOSITION_FIXTURES.length}`,
  );

  if (!existsSync(SNAPSHOT_DIR)) mkdirSync(SNAPSHOT_DIR, { recursive: true });

  let failures = 0;

  for (const fixture of COMPOSITION_FIXTURES) {
    // ① 不変条件（snapshot とは独立に、常に真であるべき性質）
    const off = compose(fixture, false);
    const on = compose(fixture, true);
    const invariantFailures = assertInvariants(fixture, off, on);
    for (const msg of invariantFailures) console.error(`  FAIL      ${msg}`);
    failures += invariantFailures.length;

    // ② snapshot（意図しない prompt 変化の検出）
    const path = join(SNAPSHOT_DIR, `${fixture.id}.json`);
    const actual = serialize(buildSnapshot(fixture));

    if (mode === 'record') {
      writeFileSync(path, actual, 'utf8');
      console.log(`  RECORDED  ${fixture.id}  (${actual.length} bytes)`);
      continue;
    }
    if (!existsSync(path)) {
      console.error(`  MISSING   ${fixture.id}  → --record が未実行です`);
      failures += 1;
      continue;
    }
    const expected = readFileSync(path, 'utf8');
    if (expected === actual) {
      if (invariantFailures.length === 0) {
        console.log(`  OK        ${fixture.id}  (${actual.length} bytes)`);
      }
    } else {
      console.error(`  DIFF      ${fixture.id}`);
      const e = expected.split('\n');
      const a = actual.split('\n');
      for (let i = 0; i < Math.max(e.length, a.length); i += 1) {
        if (e[i] !== a[i]) {
          console.error(`    line ${i + 1}`);
          console.error(`      expected: ${e[i] ?? '(なし)'}`);
          console.error(`      actual  : ${a[i] ?? '(なし)'}`);
        }
      }
      failures += 1;
    }
  }

  console.log('');
  console.log(
    `[exam-spine-tutor-composition-qa] network calls = ${fetchCallCount}（外部通信ゼロ）`,
  );
  if (fetchCallCount > 0) failures += 1;

  if (mode === 'record') {
    console.log('[exam-spine-tutor-composition-qa] RECORD DONE');
    return;
  }
  if (failures > 0) {
    console.error(`[exam-spine-tutor-composition-qa] CHECK FAIL（${failures} 件）`);
    process.exitCode = 1;
    return;
  }
  console.log('[exam-spine-tutor-composition-qa] CHECK PASS');
}

void main();
