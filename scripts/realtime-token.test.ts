/* eslint-disable @typescript-eslint/no-explicit-any -- mock harness（Supabase admin / fetch のモック）で any を許容する */
/*
 * scripts/realtime-token.test.ts
 *
 * STEP-INTERVIEW-AI-REALTIME-PR1: token route の分岐テスト（実 OpenAI / 実 Supabase を叩かない）。
 *
 * 方針:
 *   - OpenAI client_secrets への呼び出しは global.fetch を mock（実 API は絶対に叩かない）。
 *   - Supabase admin / ensurePlanQuota / updateSessionStatus / logAiUsage は依存注入で mock。
 *   - production code（route 本体 handleRealtimeToken）をそのまま実行し、分岐のみ検証する。
 *   - 既存ターン制（/interview/ai, session/turn/complete/abandon）は import も実行もしない。
 *
 * 実行:
 *   npx tsx --tsconfig tsconfig.realtime-test.json scripts/realtime-token.test.ts
 *   （= npm run test:realtimeToken）
 *
 * server-only 解決:
 *   route とその依存は `import 'server-only'` を含むため、test 用 tsconfig で server-only を
 *   空 stub（scripts/_stubs/server-only.ts）に解決する。root tsconfig は無改変（本番 build 不変）。
 */

import { createHash } from 'node:crypto';

import {
  handleRealtimeToken,
  type RealtimeTokenDeps,
} from '@/app/api/interview-ai/realtime/token/route';
import {
  OPENAI_CLIENT_SECRETS_URL,
  OPENAI_REALTIME_CALLS_URL,
  REALTIME_MAX_DURATION_MS,
} from '@/lib/interviewAi/realtime/constants';

// ─── 極小 assert / runner ───────────────────────────────────────
let failures = 0;
let passes = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) {
    passes += 1;
  } else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}
async function testCase(name: string, fn: () => Promise<void>): Promise<void> {
  const before = failures;
  try {
    await fn();
  } catch (err) {
    failures += 1;
    console.error(`  ✗ threw: ${(err as Error).message}`);
  }
  const ok = failures === before;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

// ─── env helpers ────────────────────────────────────────────────
const REALTIME_ENV_KEYS = [
  'REALTIME_INTERVIEW_ENABLED',
  'REALTIME_DEV_USER_IDS',
  'OPENAI_API_KEY',
  'REALTIME_SAFETY_ID_SALT',
  'INTERVIEW_AI_REALTIME_MODEL',
  'INTERVIEW_AI_REALTIME_VOICE',
];
function resetEnv(): void {
  for (const k of REALTIME_ENV_KEYS) delete process.env[k];
}

// ─── mocks ──────────────────────────────────────────────────────
type QueryResult = { data: unknown; error: unknown };

function makeAdmin(opts: {
  insertResult?: QueryResult;
  existingResult?: QueryResult;
}): { admin: any; fromTables: string[]; insertedPayloads: any[] } {
  const fromTables: string[] = [];
  const insertedPayloads: any[] = [];
  const builder: any = {
    insert(payload: any) {
      insertedPayloads.push(payload);
      return builder;
    },
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    single() {
      return Promise.resolve(opts.insertResult ?? { data: null, error: null });
    },
    maybeSingle() {
      return Promise.resolve(opts.existingResult ?? { data: null, error: null });
    },
  };
  const admin: any = {
    from(table: string) {
      fromTables.push(table);
      return builder;
    },
  };
  return { admin, fromTables, insertedPayloads };
}

function makeFetch(result: {
  ok: boolean;
  status?: number;
  json?: unknown;
}): { fn: typeof fetch; calls: Array<{ url: any; init: any }> } {
  const calls: Array<{ url: any; init: any }> = [];
  const bodyText =
    typeof result.json === 'string'
      ? result.json
      : JSON.stringify(result.json ?? {});
  const fn = (async (url: any, init: any) => {
    calls.push({ url, init });
    return {
      ok: result.ok,
      status: result.status ?? (result.ok ? 200 : 500),
      // route は body を text() で 1 度読む（診断のため）。json() も互換で残す。
      text: async () => bodyText,
      json: async () => result.json ?? {},
    };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const OK_GATE = {
  kind: 'ok' as const,
  userId: 'user-1',
  plan: 'premium' as const,
  feature: 'interview-ai-realtime' as const,
  used: 0,
  limit: 5,
};

function makeDeps(over: {
  admin: any;
  ensurePlanQuota?: RealtimeTokenDeps['ensurePlanQuota'];
}): {
  deps: RealtimeTokenDeps;
  gateCalls: number;
  updateCalls: Array<{ sessionId: string; status: string }>;
  logCalls: Array<{ route: string; model: string; status: string }>;
} {
  let gateCalls = 0;
  const updateCalls: Array<{ sessionId: string; status: string }> = [];
  const logCalls: Array<{ route: string; model: string; status: string }> = [];
  const deps: RealtimeTokenDeps = {
    ensurePlanQuota:
      over.ensurePlanQuota ??
      (async () => {
        gateCalls += 1;
        return OK_GATE;
      }),
    getAdmin: () => over.admin,
    updateSessionStatus: async (_admin: any, args: any) => {
      updateCalls.push(args);
      return { error: null, updatedCount: 1 };
    },
    logAiUsage: (opts: any) => {
      logCalls.push(opts);
    },
  };
  // gateCalls はクロージャ参照のため getter で返す。
  return {
    deps,
    get gateCalls() {
      return gateCalls;
    },
    updateCalls,
    logCalls,
  } as any;
}

function makeReq(body: unknown = { interviewType: 'free' }): Request {
  return new Request('http://test/api/interview-ai/realtime/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function withFetch<T>(fn: typeof fetch, run: () => Promise<T>): Promise<T> {
  const orig = global.fetch;
  global.fetch = fn;
  return run().finally(() => {
    global.fetch = orig;
  });
}

const SESSION_ROW = {
  id: 'sess-1',
  source: 'realtime',
  status: 'in_progress',
  target_ref: {},
  interview_type: 'free',
  source_type: null,
  source_id: null,
  created_at: '2026-06-18T00:00:00.000Z',
};

// ─── tests ──────────────────────────────────────────────────────
async function main(): Promise<void> {
  // A. flag OFF → 403 realtime-disabled。gate は呼ばれない。
  await testCase('flag OFF → 403 realtime-disabled', async () => {
    resetEnv(); // REALTIME_INTERVIEW_ENABLED 未設定
    const { admin, fromTables } = makeAdmin({});
    const m = makeDeps({ admin });
    const res = await handleRealtimeToken(makeReq(), m.deps);
    const body = await res.json();
    assert(res.status === 403, `status=${res.status} expected 403`);
    assert(body.error === 'realtime-disabled', `error=${body.error}`);
    assert(m.gateCalls === 0, 'ensurePlanQuota must NOT be called when flag off');
    assert(fromTables.length === 0, 'no DB access when flag off');
  });

  // B. allowlist 外 → 403 not-allowlisted。session 作成も mint もしない。
  await testCase('allowlist外 → 403 not-allowlisted', async () => {
    resetEnv();
    process.env.REALTIME_INTERVIEW_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.REALTIME_DEV_USER_IDS = 'someone-else, another';
    const { admin, fromTables } = makeAdmin({});
    const m = makeDeps({ admin });
    const fetchMock = makeFetch({ ok: true, json: { value: 'ek_x' } });
    const res = await withFetch(fetchMock.fn, () =>
      handleRealtimeToken(makeReq(), m.deps),
    );
    const body = await res.json();
    assert(res.status === 403, `status=${res.status} expected 403`);
    assert(body.error === 'not-allowlisted', `error=${body.error}`);
    assert(fromTables.length === 0, 'no session insert when not allowlisted');
    assert(fetchMock.calls.length === 0, 'no OpenAI mint when not allowlisted');
  });

  // C. OPENAI_API_KEY 不足 → 502 token-mint-failed。orphan session を作らない。
  await testCase('OPENAI_API_KEY不足 → 502 token-mint-failed', async () => {
    resetEnv();
    process.env.REALTIME_INTERVIEW_ENABLED = 'true';
    // OPENAI_API_KEY を設定しない
    const { admin, fromTables } = makeAdmin({});
    const m = makeDeps({ admin });
    const fetchMock = makeFetch({ ok: true, json: { value: 'ek_x' } });
    const res = await withFetch(fetchMock.fn, () =>
      handleRealtimeToken(makeReq(), m.deps),
    );
    const body = await res.json();
    assert(res.status === 502, `status=${res.status} expected 502`);
    assert(body.error === 'token-mint-failed', `error=${body.error}`);
    assert(fromTables.length === 0, 'no orphan session created when key missing');
    assert(m.updateCalls.length === 0, 'no abandon needed (no session)');
    assert(fetchMock.calls.length === 0, 'no real OpenAI call');
  });

  // D. in_progress 衝突（23505）→ 200 in-progress-exists。mint しない。
  await testCase('in_progress衝突 → 200 in-progress-exists', async () => {
    resetEnv();
    process.env.REALTIME_INTERVIEW_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'sk-test';
    const { admin, fromTables } = makeAdmin({
      insertResult: { data: null, error: { code: '23505', message: 'dup' } },
      existingResult: { data: { ...SESSION_ROW, id: 'existing-1' }, error: null },
    });
    const m = makeDeps({ admin });
    const fetchMock = makeFetch({ ok: true, json: { value: 'ek_x' } });
    const res = await withFetch(fetchMock.fn, () =>
      handleRealtimeToken(makeReq(), m.deps),
    );
    const body = await res.json();
    assert(res.status === 200, `status=${res.status} expected 200`);
    assert(body.error === 'in-progress-exists', `error=${body.error}`);
    assert(body.session?.id === 'existing-1', `session.id=${body.session?.id}`);
    assert(fetchMock.calls.length === 0, 'no mint on in-progress conflict');
    assert(
      !fromTables.includes('usage_records'),
      'usage_records must never be touched',
    );
  });

  // E. mint 失敗 → 502 + 作成済み session を abandoned に戻す。
  await testCase('mint失敗 → 502 + session abandoned', async () => {
    resetEnv();
    process.env.REALTIME_INTERVIEW_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'sk-test';
    const { admin } = makeAdmin({
      insertResult: { data: { ...SESSION_ROW, id: 'sess-e' }, error: null },
    });
    const m = makeDeps({ admin });
    const fetchMock = makeFetch({ ok: false, status: 500 });
    const res = await withFetch(fetchMock.fn, () =>
      handleRealtimeToken(makeReq(), m.deps),
    );
    const body = await res.json();
    assert(res.status === 502, `status=${res.status} expected 502`);
    assert(body.error === 'token-mint-failed', `error=${body.error}`);
    assert(
      m.updateCalls.some(
        (c) => c.sessionId === 'sess-e' && c.status === 'abandoned',
      ),
      'session must be set to abandoned after mint failure',
    );
    assert(
      m.logCalls.some((c) => c.status === 'failed'),
      'logAiUsage(failed) emitted',
    );
    assert(fetchMock.calls.length === 1, 'mint attempted exactly once');
    assert(
      fetchMock.calls[0].url === OPENAI_CLIENT_SECRETS_URL,
      'mint hits client_secrets endpoint',
    );
  });

  // F. 成功 → 201 + clientSecret/expiresAt/model/maxDurationMs/callUrl。
  await testCase('成功 → 201 with ek_test_ clientSecret', async () => {
    resetEnv();
    process.env.REALTIME_INTERVIEW_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.REALTIME_SAFETY_ID_SALT = 'salt-123';
    const { admin, fromTables } = makeAdmin({
      insertResult: { data: { ...SESSION_ROW, id: 'sess-f' }, error: null },
    });
    const m = makeDeps({ admin });
    const fetchMock = makeFetch({
      ok: true,
      json: { value: 'ek_test_abc123', expires_at: 1750000000 },
    });
    const res = await withFetch(fetchMock.fn, () =>
      handleRealtimeToken(makeReq(), m.deps),
    );
    const body = await res.json();
    assert(res.status === 201, `status=${res.status} expected 201`);
    assert(body.sessionId === 'sess-f', `sessionId=${body.sessionId}`);
    assert(body.clientSecret === 'ek_test_abc123', `clientSecret=${body.clientSecret}`);
    assert(body.expiresAt === 1750000000, `expiresAt=${body.expiresAt}`);
    assert(body.model === 'gpt-realtime-mini', `model=${body.model}`);
    assert(
      body.maxDurationMs === REALTIME_MAX_DURATION_MS,
      `maxDurationMs=${body.maxDurationMs}`,
    );
    assert(body.callUrl === OPENAI_REALTIME_CALLS_URL, `callUrl=${body.callUrl}`);
    assert(
      m.logCalls.some((c) => c.status === 'success'),
      'logAiUsage(success) emitted',
    );
    assert(m.updateCalls.length === 0, 'no abandon on success');
    // 課金経路に一切触れない（recordUsage は STEP7）: usage_records へ書かない。
    assert(
      fromTables.every((t) => t === 'interview_ai_sessions'),
      `only interview_ai_sessions touched, got: ${fromTables.join(',')}`,
    );
    // OpenAI-Safety-Identifier は sha256(userId + salt)。
    const expectedSafetyId = createHash('sha256')
      .update('user-1salt-123')
      .digest('hex');
    const sentSafetyId = (fetchMock.calls[0].init?.headers ?? {})[
      'OpenAI-Safety-Identifier'
    ];
    assert(
      sentSafetyId === expectedSafetyId,
      'OpenAI-Safety-Identifier = sha256(userId+salt)',
    );
    const auth = (fetchMock.calls[0].init?.headers ?? {})['Authorization'];
    assert(auth === 'Bearer sk-test', 'Authorization carries server key only');
  });

  // ─── summary ───
  resetEnv();
  console.log(`\n${passes} assertions passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
