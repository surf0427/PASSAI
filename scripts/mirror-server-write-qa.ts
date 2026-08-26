// mirror server write path — 静的 / 合成 QA（Stage: security fix）。
//
// 目的:
//   anon 直接 upsert を廃止し POST /api/mirrors へ集約した経路について、
//   **AI API / Supabase / network を一切呼ばずに**検証できる範囲を機械的に固定する。
//
// 検証する内容:
//   1. kind allowlist と kind→table map の健全性（table 名が client 入力から来ないこと）
//   2. validateMirrorRequest の allowlist / size guard / unknown field 除去
//   3. 4 writer が anon 直接書き込みを持たないこと（静的 grep）
//   4. service_role が client bundle 経路へ露出しないこと（静的 grep）
//   5. route が payload をレスポンスへ返さないこと（静的 grep）
//   6. supabase/schema.sql の RLS 宣言が production security model と一致すること
//      （4 mirror table に browser-role policy 0 件 / mirror_events は INSERT のみ）
//
// 厳守:
//   - network / Supabase / AI 呼び出しゼロ（fetch を trap して機械的に担保）。
//   - 実ユーザー payload を扱わない。fixture はすべて合成。
//   - production コードを変更しない（読むだけ）。
//
// 使い方:
//   npm run qa:mirrors
//
// 関連:
//   lib/mirrors/mirrorKinds.ts / validateMirrorRequest.ts / mirrorWriteServer.ts
//   app/api/mirrors/route.ts / lib/supabase/mirrorTransport.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── network trap（AI / 外部通信ゼロの機械的証明）────────────────────
let fetchCalls = 0;
globalThis.fetch = ((...args: unknown[]) => {
  fetchCalls += 1;
  const target = typeof args[0] === 'string' ? args[0] : '(non-string)';
  throw new Error(`[mirror-qa] 外部通信は禁止です: ${target}`);
}) as typeof globalThis.fetch;

import {
  MIRROR_KINDS,
  MIRROR_KIND_TABLE,
  MIRROR_PAYLOAD_MAX_BYTES,
  isMirrorKind,
} from '@/lib/mirrors/mirrorKinds';
import { validateMirrorRequest } from '@/lib/mirrors/validateMirrorRequest';

const ROOT = join(__dirname, '..');
let failures = 0;

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${name}${detail ? '  — ' + detail : ''}`);
  }
}

function read(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

/** コメント行を除いた実コード（静的 grep の誤検出を避ける）。 */
function codeOnly(src: string): string {
  return src
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
}

// ── 1. kind allowlist / table map ─────────────────────────────────
console.log('\n[1] kind allowlist と table map');
check('kind は 4 種', MIRROR_KINDS.length === 4);
check(
  '全 kind に table が対応',
  MIRROR_KINDS.every((k) => typeof MIRROR_KIND_TABLE[k] === 'string' && MIRROR_KIND_TABLE[k].length > 0),
);
check(
  'table 名は重複しない',
  new Set(Object.values(MIRROR_KIND_TABLE)).size === MIRROR_KINDS.length,
);
check(
  '全 kind に payload 上限がある',
  MIRROR_KINDS.every((k) => MIRROR_PAYLOAD_MAX_BYTES[k] > 0),
);
check('未知 kind を拒否', !isMirrorKind('mirror_events') && !isMirrorKind('__proto__') && !isMirrorKind(''));

// ── 2. validateMirrorRequest ──────────────────────────────────────
console.log('\n[2] validateMirrorRequest');
const validBody = {
  kind: 'basicInfo',
  sourceHash: 'a'.repeat(64),
  schemaVersion: '1',
  payload: { grade: '高校3年', track: '文系' },
};

check('正常系は ok', validateMirrorRequest(validBody).ok);

const cases: Array<[string, unknown, string]> = [
  ['body が object でない', 'not-an-object', 'invalid_body'],
  ['body が null', null, 'invalid_body'],
  ['kind 未指定', { ...validBody, kind: undefined }, 'invalid_kind'],
  ['kind が未知', { ...validBody, kind: 'mirror_events' }, 'invalid_kind'],
  ['kind が table 名', { ...validBody, kind: 'basic_info_mirrors' }, 'invalid_kind'],
  ['schemaVersion が未許可', { ...validBody, schemaVersion: '99' }, 'invalid_schema_version'],
  ['schemaVersion が数値', { ...validBody, schemaVersion: 1 }, 'invalid_schema_version'],
  ['sourceHash が非 hex', { ...validBody, sourceHash: 'ZZZZ' }, 'invalid_source_hash'],
  ['sourceHash が短すぎ', { ...validBody, sourceHash: 'abc' }, 'invalid_source_hash'],
  ['sourceHash が長すぎ', { ...validBody, sourceHash: 'a'.repeat(200) }, 'invalid_source_hash'],
  ['payload が配列', { ...validBody, payload: [1, 2] }, 'invalid_payload'],
  ['payload が null', { ...validBody, payload: null }, 'invalid_payload'],
  ['payload が文字列', { ...validBody, payload: 'x' }, 'invalid_payload'],
];
for (const [name, body, expected] of cases) {
  const r = validateMirrorRequest(body);
  check(name, !r.ok && r.error === expected, !r.ok ? `got ${r.error}` : 'got ok');
}

// size guard（kind 別上限）
const oversized = {
  ...validBody,
  payload: { blob: 'x'.repeat(MIRROR_PAYLOAD_MAX_BYTES.basicInfo + 1024) },
};
const oversizedResult = validateMirrorRequest(oversized);
check(
  'payload 上限超過を拒否',
  !oversizedResult.ok && oversizedResult.error === 'payload_too_large',
);

// activity は上限が大きい（basicInfo で超過するサイズが activity では通る）
const activityBody = {
  kind: 'activity',
  sourceHash: 'b'.repeat(64),
  schemaVersion: '1',
  payload: { blob: 'x'.repeat(MIRROR_PAYLOAD_MAX_BYTES.basicInfo + 1024) },
};
check('kind 別上限が効いている（activity は通る）', validateMirrorRequest(activityBody).ok);

// unknown field は保存対象へ伝播しない
const withUnknown = {
  ...validBody,
  user_id: 'attacker-supplied',
  table: 'profiles',
  extra: 'x',
};
const uv = validateMirrorRequest(withUnknown);
check(
  'unknown field を保存対象へ伝播しない',
  uv.ok &&
    !('user_id' in uv) &&
    !('table' in uv) &&
    !('extra' in uv) &&
    Object.keys(uv.payload).length === Object.keys(validBody.payload).length,
);

// 循環参照 payload は invalid_payload（throw しない）
const circular: Record<string, unknown> = { a: 1 };
circular.self = circular;
const cr = validateMirrorRequest({ ...validBody, payload: circular });
check('循環参照 payload を throw せず拒否', !cr.ok && cr.error === 'invalid_payload');

// ── 3. writer に anon 直接書き込みが残っていない ──────────────────
console.log('\n[3] client writer の anon 直接書き込み撤去');
const writers = [
  'lib/supabase/mirrorStudentProfile.ts',
  'lib/supabase/mirrorBasicInfo.ts',
  'lib/supabase/mirrorActivityData.ts',
  'lib/supabase/mirrorDiagnosis.ts',
];
for (const w of writers) {
  const code = codeOnly(read(w));
  check(`${w}: getBrowserSupabaseClient を使わない`, !code.includes('getBrowserSupabaseClient'));
  check(`${w}: .from(...) を呼ばない`, !code.includes('.from('));
  check(`${w}: postMirror 経由`, code.includes('postMirror('));
}

// ── 4. service_role の境界 ────────────────────────────────────────
console.log('\n[4] service_role 境界');
const serverWriter = read('lib/mirrors/mirrorWriteServer.ts');
check('server writer は server-only 宣言', serverWriter.includes("import 'server-only'"));
check(
  'server writer は service_role を境界経由で取得',
  serverWriter.includes('getServiceRoleSupabaseClient'),
);
const transport = codeOnly(read('lib/supabase/mirrorTransport.ts'));
check('client transport は service_role を参照しない', !transport.includes('SERVICE_ROLE'));
check('client transport は supabase client を import しない', !transport.includes('supabase'));
const kinds = codeOnly(read('lib/mirrors/mirrorKinds.ts'));
check('kind module は env / secret を参照しない', !kinds.includes('process.env'));
check(
  'service_role key に NEXT_PUBLIC prefix が付いていない',
  !read('lib/supabase/env.ts').includes('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY'),
);

// ── 5. route が payload を返さない / log に出さない ────────────────
console.log('\n[5] route のレスポンス / log 契約');
const route = codeOnly(read('app/api/mirrors/route.ts'));
check('成功応答は { ok: true } のみ', route.includes('{ ok: true }'));
check(
  'レスポンスに payload / validated.payload を含めない',
  !/NextResponse\.json\([^)]*payload\s*[,:}]/.test(route.replace(/payloadBytes/g, '')),
);
check(
  'log に payload 本文を出さない（byte 数のみ）',
  !/console\.\w+\([^)]*validated\.payload\b/.test(route),
);
check('rate limit を通す', route.includes('checkServerRateLimit'));
check('table 名を body から受け取らない', !route.includes('body.table') && !route.includes('.table'));

// ── 6. schema.sql の policy 宣言が production security model と一致 ──
//    drift 再発防止: schema.sql を fresh project / DR / test bootstrap へ
//    適用したときに、production で削除済みの browser-role policy が
//    再生成されないことを機械検証する。
console.log('\n[6] schema.sql の RLS 宣言（drift ガード）');

/** schema.sql から CREATE POLICY 宣言を抽出する（SQL コメント行は除去済み）。 */
function parsePolicies(sql: string): Array<{ name: string; table: string; cmd: string; roles: string[] }> {
  const body = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  const re =
    /CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+([A-Za-z0-9_.]+)\s+FOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\s+TO\s+([A-Za-z0-9_,\s]+?)\s+(?:USING|WITH\s+CHECK)\b/gi;
  const out: Array<{ name: string; table: string; cmd: string; roles: string[] }> = [];
  for (const m of body.matchAll(re)) {
    out.push({
      name: m[1],
      table: m[2].replace(/^public\./, ''),
      cmd: m[3].toUpperCase(),
      roles: m[4].split(',').map((r) => r.trim()).filter(Boolean),
    });
  }
  return out;
}

const schemaSql = read('supabase/schema.sql');
const policies = parsePolicies(schemaSql);
// 少なくとも他 table の policy は拾えているはず（parser が壊れたら drift を
// 見逃すため、負のコントロールとして下限を置く）。
check('policy parser が宣言を抽出できている', policies.length >= 10, `parsed=${policies.length}`);

const MIRROR_TABLES = MIRROR_KINDS.map((k) => MIRROR_KIND_TABLE[k]);
for (const table of MIRROR_TABLES) {
  const own = policies.filter((p) => p.table === table);
  check(
    `${table}: CREATE POLICY が 0 件（browser direct write なし）`,
    own.length === 0,
    own.map((p) => `"${p.name}" ${p.cmd} TO ${p.roles.join('/')}`).join(' | '),
  );
  check(
    `${table}: RLS が有効化されている`,
    new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`).test(schemaSql),
  );
}

// mirror_events は write-only telemetry sink。INSERT 2 件のみ。
const events = policies.filter((p) => p.table === 'mirror_events');
check(
  'mirror_events: anon INSERT policy が 1 件',
  events.filter((p) => p.cmd === 'INSERT' && p.roles.includes('anon')).length === 1,
);
check(
  'mirror_events: authenticated INSERT policy が 1 件',
  events.filter((p) => p.cmd === 'INSERT' && p.roles.includes('authenticated')).length === 1,
);
check(
  'mirror_events: INSERT 以外の policy が 0 件（SELECT/UPDATE/DELETE/ALL なし）',
  events.filter((p) => p.cmd !== 'INSERT').length === 0,
  events.filter((p) => p.cmd !== 'INSERT').map((p) => `"${p.name}" ${p.cmd}`).join(' | '),
);
check(
  'mirror_events: RLS が有効化されている',
  /ALTER TABLE mirror_events ENABLE ROW LEVEL SECURITY/.test(schemaSql),
);

// 旧 drift の固有名。production から削除済みなので宣言側にも残らないこと。
check(
  'schema.sql に select_for_upsert が残っていない',
  !schemaSql.includes('select_for_upsert') ||
    // 履歴コメントとしての言及は許容（宣言でなければよい）
    !/CREATE\s+POLICY\s+"[^"]*select_for_upsert/i.test(schemaSql),
);

// mirror 系 table への GRANT / REVOKE は本 QA の責務外だが、
// 宣言が増えていたら気付けるようにしておく（現状 0 件）。
check(
  'schema.sql は mirror table へ GRANT / REVOKE を宣言していない',
  !new RegExp(`(GRANT|REVOKE)[^;]*(${[...MIRROR_TABLES, 'mirror_events'].join('|')})`, 'i').test(
    schemaSql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n'),
  ),
);

// ── 結果 ──────────────────────────────────────────────────────────
console.log(`\n[network] fetch calls = ${fetchCalls}（外部通信ゼロ）`);
if (fetchCalls !== 0) failures += 1;

if (failures > 0) {
  console.error(`\n[mirror-server-write-qa] FAIL: ${failures} 件`);
  process.exitCode = 1;
} else {
  console.log('\n[mirror-server-write-qa] PASS');
}
