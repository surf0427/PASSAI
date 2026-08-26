// Exam Spine — tutor server loader characterization（Phase 2 の安全網）。
//
// なぜ別 script か:
//   scripts/exam-spine-characterization.ts は「純関数として import 可能な builder」だけを
//   対象にしており、lib/contextBuilders/tutorContext.ts は 'server-only' を transitively
//   import するため対象外だった（同 script の冒頭コメント参照）。
//   つまり **Phase 2 で動かす当のコードは、既存 baseline では守られていない。**
//   本 script はその穴を埋める。'server-only' を no-op へ alias し、Supabase client を
//   stub に差し替えることで、server 読み取り経路を丸ごと固定する。
//
// 何を固定するか（3 点セット）:
//   1. queries … 実際に発行された SELECT の shape（table / columns / filters / order / limit）
//   2. context … loadTutorStudentContext が返す TutorStudentContext
//   3. section … buildTutorSupabaseContextSection が返す **prompt 文字列そのもの**
//   さらに TTL cache の hit/miss セマンティクスを assert する。
//
// 厳守:
//   - **AI API を絶対に呼ばない**。fetch を trap して外部通信ゼロを機械的に担保する。
//   - **実 Supabase へ接続しない**。client は完全 stub。
//   - deterministic。created_at は fixture の固定値。timing / Date.now は snapshot しない。
//   - production runtime を変更しない（読むだけ）。
//   - dependency を追加しない（Node 標準 + 既存 lib のみ）。
//
// 使い方:
//   npm run qa:examSpine:tutorLoader
//   npx tsx scripts/exam-spine-tutor-loader-qa.ts --record
//   npx tsx scripts/exam-spine-tutor-loader-qa.ts --check
//
// 関連:
//   scripts/fixtures/examSpineTutorLoader.ts
//   docs/principles/exam_spine/EXAM_SPINE_ARCHITECTURE.md

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import Module from 'node:module';

// ── 1. 'server-only' を no-op へ alias ─────────────────────────────
//
// 'server-only' は Next.js が bundle 時に解決する marker package で、素の Node には
// 存在しない。Next が同梱する空 module へ差し替えて import を通す。
// ⚠️ これは QA 実行時だけの解決であり、production の server-only 境界は変更しない。

const req = createRequire(__filename);
const SERVER_ONLY_STUB = req.resolve('next/dist/compiled/server-only/empty.js');

type ResolveFn = (
  this: unknown,
  request: string,
  ...rest: unknown[]
) => string;
const moduleInternals = Module as unknown as { _resolveFilename: ResolveFn };
const originalResolve = moduleInternals._resolveFilename;
moduleInternals._resolveFilename = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return SERVER_ONLY_STUB;
  return originalResolve.call(this, request, ...rest);
};

// ── 2. 外部通信 trap（AI calls = 0 / 実 DB 接続 = 0 の機械的証明）──────

let fetchCallCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = ((...args: unknown[]) => {
  fetchCallCount += 1;
  const target = typeof args[0] === 'string' ? args[0] : '(non-string input)';
  throw new Error(
    `[exam-spine-tutor-loader-qa] 外部通信が発生しました（禁止）: ${target}`,
  );
}) as typeof globalThis.fetch;
void originalFetch;

// ── 3. 対象 ───────────────────────────────────────────────────────

// ⚠️ static import にしてはいけない。ESM の import は巻き上げられ、上の
//    'server-only' alias より先に評価されてしまう。必ず main() 内で dynamic import する。
type TutorContextModule = typeof import('@/lib/contextBuilders/tutorContext');
let tutorContext: TutorContextModule;

import {
  TUTOR_LOADER_FIXTURES,
  type StubTableResult,
  type TutorLoaderFixture,
} from './fixtures/examSpineTutorLoader';

// ── 4. stub Supabase client ───────────────────────────────────────
//
// supabase-js の query builder は thenable。実装が使う method だけを生やし、
// 発行された query の shape を記録する。**認可は stub しない**（RLS の代替ではない）。

type QueryTrace = {
  table: string;
  select: string;
  filters: string[];
  order: string;
  limit: number | null;
  terminal: string;
};

function resultFor(fixture: TutorLoaderFixture, table: string): StubTableResult {
  return fixture.tables[table] ?? { kind: 'ok', data: null };
}

class StubQueryBuilder implements PromiseLike<unknown> {
  private trace: QueryTrace;

  constructor(
    table: string,
    private readonly fixture: TutorLoaderFixture,
    private readonly traces: QueryTrace[],
  ) {
    this.trace = {
      table,
      select: '',
      filters: [],
      order: '',
      limit: null,
      terminal: '',
    };
    this.traces.push(this.trace);
  }

  select(columns: string): this {
    this.trace.select = columns;
    return this;
  }

  eq(column: string, value: unknown): this {
    // 値は user_id / attempt_id 等。snapshot 安定のため型ではなく値をそのまま記録する。
    this.trace.filters.push(`${column}=${String(value)}`);
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.trace.order = `${column}:${opts?.ascending === false ? 'desc' : 'asc'}`;
    return this;
  }

  limit(n: number): this {
    this.trace.limit = n;
    return this;
  }

  private settle(): Promise<{ data: unknown; error: unknown }> {
    const r = resultFor(this.fixture, this.trace.table);
    if (r.kind === 'throw') {
      return Promise.reject(new Error(`stub: ${this.trace.table} threw`));
    }
    if (r.kind === 'error') {
      return Promise.resolve({ data: null, error: { code: r.code } });
    }
    return Promise.resolve({ data: r.data, error: null });
  }

  maybeSingle<T = unknown>(): Promise<{ data: T; error: unknown }> {
    this.trace.terminal = 'maybeSingle';
    return this.settle() as Promise<{ data: T; error: unknown }>;
  }

  then<R1 = unknown, R2 = never>(
    onfulfilled?: ((v: unknown) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((r: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    if (this.trace.terminal === '') this.trace.terminal = 'await';
    return this.settle().then(onfulfilled, onrejected);
  }
}

function makeStubClient(fixture: TutorLoaderFixture): {
  client: unknown;
  traces: QueryTrace[];
} {
  const traces: QueryTrace[] = [];
  const client = {
    from(table: string) {
      return new StubQueryBuilder(table, fixture, traces);
    },
  };
  return { client, traces };
}

// ── 5. deterministic serialization ────────────────────────────────

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

// query の発行「順序」は microtask scheduling に依存しうるため、snapshot は
// 安定 key でソートする。固定したいのは「どの query が発行されたか」であって
// interleaving ではない。
function sortTraces(traces: readonly QueryTrace[]): QueryTrace[] {
  return [...traces].sort((a, b) => {
    const ka = `${a.table}|${a.select}|${a.filters.join(',')}`;
    const kb = `${b.table}|${b.select}|${b.filters.join(',')}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

// ── 6. console 抑制 ────────────────────────────────────────────────
//
// loader は console.warn / console.info を出す（timing 等）。QA 出力を汚さず、
// かつ timing を snapshot へ混入させないため、実行中だけ捨てる。

async function silenced<T>(fn: () => Promise<T>): Promise<T> {
  const w = console.warn;
  const i = console.info;
  console.warn = () => {};
  console.info = () => {};
  try {
    return await fn();
  } finally {
    console.warn = w;
    console.info = i;
  }
}

// ── 7. snapshot I/O ───────────────────────────────────────────────

const SNAPSHOT_DIR = join(__dirname, 'fixtures', 'exam-spine-tutor-loader');
const USER_ID = 'fixture-user-0000';

function snapshotPath(id: string): string {
  return join(SNAPSHOT_DIR, `${id}.json`);
}

async function buildSnapshot(
  fixture: TutorLoaderFixture,
): Promise<Record<string, unknown>> {
  const { client, traces } = makeStubClient(fixture);

  const parity = fixture.parity === true;
  const context = await silenced(() =>
    tutorContext.loadTutorStudentContext(USER_ID, client as never, {
      includeParitySources: parity,
    }),
  );
  // section は canary と同じ条件で描画する（parity fixture は ON 相当）。
  const section = tutorContext.buildTutorSupabaseContextSection(context, {
    includeParity: parity,
  });

  return {
    fixtureId: fixture.id,
    description: fixture.description,
    parity,
    // 1. 発行された SELECT の shape。query が増減したら差分になる。
    queries: sortTraces(traces),
    // 2. loader の戻り値。
    context,
    // 3. prompt へ入る文字列そのもの。**ここが変わったら prompt が変わっている。**
    section,
    sectionLength: section.length,
  };
}

// ── 8. TTL cache セマンティクスの assert ───────────────────────────
//
// snapshot ではなく不変条件として検査する（Date.now に依存するため）。
//   - データのあるユーザー: 1 回目 miss → 2 回目 hit
//   - 全 source 空のユーザー: 常に miss（空を 60 秒固定して生徒情報を隠さない）
//   - userId 空: 常に miss で空 context

async function checkCacheSemantics(): Promise<string[]> {
  const failures: string[] = [];

  const withData = TUTOR_LOADER_FIXTURES.find((f) => f.id === 'T1-all-sources');
  const empty = TUTOR_LOADER_FIXTURES.find((f) => f.id === 'T2-new-user-empty');
  if (!withData || !empty) return ['cache: 必要な fixture が見つからない'];

  // 同一 userId で 2 回。1 回目 miss / 2 回目 hit。
  const uid = 'fixture-cache-user-A';
  const a1 = await silenced(() =>
    tutorContext.loadTutorStudentContextCached(uid, makeStubClient(withData).client as never),
  );
  const a2 = await silenced(() =>
    tutorContext.loadTutorStudentContextCached(uid, makeStubClient(withData).client as never),
  );
  if (a1.cacheHit !== false) failures.push('cache: 1 回目が hit になっている');
  if (a2.cacheHit !== true) failures.push('cache: 2 回目が miss になっている');
  if (serialize(a1.context) !== serialize(a2.context)) {
    failures.push('cache: hit 時の context が miss 時と一致しない');
  }

  // 全 source 空はキャッシュしない（常に miss）。
  const uidEmpty = 'fixture-cache-user-B';
  const b1 = await silenced(() =>
    tutorContext.loadTutorStudentContextCached(uidEmpty, makeStubClient(empty).client as never),
  );
  const b2 = await silenced(() =>
    tutorContext.loadTutorStudentContextCached(uidEmpty, makeStubClient(empty).client as never),
  );
  if (b1.cacheHit !== false || b2.cacheHit !== false) {
    failures.push('cache: 全 source 空がキャッシュされている（空を固定してはいけない）');
  }

  // userId 空 → 空 context / 常に miss / query を 1 本も発行しない。
  const { client: c, traces } = makeStubClient(withData);
  const z = await silenced(() => tutorContext.loadTutorStudentContextCached('', c as never));
  if (z.cacheHit !== false) failures.push('cache: userId 空が hit になっている');
  if (traces.length !== 0) {
    failures.push(`cache: userId 空で query が発行された（${traces.length} 本）`);
  }
  const s = z.context.sourceSummary;
  if (s.hasSelfAnalysis || s.hasBasicInfo || s.hasDiagnosis || s.hasActivity || s.hasInterviewAi || s.hasPresentation) {
    failures.push('cache: userId 空で sourceSummary が真になっている');
  }

  return failures;
}

// ── 9. run ────────────────────────────────────────────────────────

type Mode = 'record' | 'check';

function parseMode(argv: readonly string[]): Mode {
  if (argv.includes('--record')) return 'record';
  return 'check';
}

async function main(): Promise<void> {
  // 'server-only' alias を仕掛けた **後** に読み込む。
  tutorContext = await import('@/lib/contextBuilders/tutorContext');

  const mode = parseMode(process.argv.slice(2));
  console.log(`[exam-spine-tutor-loader-qa] mode=${mode}`);
  console.log(
    `[exam-spine-tutor-loader-qa] fixtures=${TUTOR_LOADER_FIXTURES.length}`,
  );

  if (!existsSync(SNAPSHOT_DIR)) mkdirSync(SNAPSHOT_DIR, { recursive: true });

  let failures = 0;

  for (const fixture of TUTOR_LOADER_FIXTURES) {
    const path = snapshotPath(fixture.id);
    const actual = serialize(await buildSnapshot(fixture));

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
      console.log(`  OK        ${fixture.id}  (${actual.length} bytes)`);
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

  const cacheFailures = await checkCacheSemantics();
  if (cacheFailures.length === 0) {
    console.log('  OK        cache-semantics（TTL hit/miss・空非キャッシュ・userId 空）');
  } else {
    for (const f of cacheFailures) console.error(`  FAIL      ${f}`);
    failures += cacheFailures.length;
  }

  console.log('');
  console.log(`[exam-spine-tutor-loader-qa] network calls = ${fetchCallCount}（外部通信ゼロ）`);
  if (fetchCallCount > 0) failures += 1;

  if (mode === 'record') {
    console.log('[exam-spine-tutor-loader-qa] RECORD DONE');
    return;
  }
  if (failures > 0) {
    console.error(`[exam-spine-tutor-loader-qa] CHECK FAIL（${failures} 件）`);
    process.exitCode = 1;
    return;
  }
  console.log('[exam-spine-tutor-loader-qa] CHECK PASS');
}

void main();
