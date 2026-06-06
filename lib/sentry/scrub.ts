// Sentry PII / 自由記述スクラバ。
//
// 目的:
//   本番の client/server/edge エラーを Sentry に送るにあたり、個人情報・自由記述
//   本文・AI 会話全文を「絶対に」外部送信しないための最終防衛線。Sentry の
//   `beforeSend` / `beforeBreadcrumb` フックから呼ばれ、送信直前の payload を
//   in-place ではなく走査して機密値を `[Filtered]` / `[Redacted]` に置換する。
//
// 設計方針:
//   - 既存の業務ロジック・ログ方針（error.name のみ / 本文非出力）と整合する。
//   - 2 段構えで防御する:
//       (A) key ベース: key 名が機密フィールドに該当する値を丸ごと `[Filtered]`。
//       (B) value ベース: あらゆる leaf string / 例外メッセージ中の token・email
//           等のパターンを `[Redacted]` に置換（key で拾えない場所への保険）。
//   - 走査対象: event.request / event.user / event.extra / event.contexts /
//     event.breadcrumbs / event.exception.values[].value / event.message。
//   - 循環参照・過大ネストに対しては WeakSet + 深さ上限で防御し、決して throw しない
//     （スクラバ自身が原因でエラー送信を落とさない）。
//
// 注意:
//   - 本モジュールは「除去漏れ」より「過剰マスク」を許容する側に倒す。デバッグ用の
//     route/feature/status 等の最小メタデータは captureRouteException 側で明示的に
//     詰めており、自由記述キーには該当しないため保持される。

import type { Breadcrumb, Event } from '@sentry/nextjs';

const FILTERED = '[Filtered]';
const REDACTED = '[Redacted]';

// 循環/巨大ツリー保護。
const MAX_DEPTH = 8;

// key 名の正規化: 小文字化 + 英数字以外を除去。
//   "Access-Token" / "access_token" / "accessToken" → "accesstoken"
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// (A-1) 正規化後 key が「これらの部分文字列」を含めば値を丸ごと filter する。
//   自由記述本文 / 認証情報 / AI 会話を広めに捕捉する（過剰マスク許容）。
const DENY_SUBSTRINGS: readonly string[] = [
  // --- 認証・資格情報 ---
  'email',
  'token', // access_token / refresh_token / accesstoken / idtoken ...
  'authorization',
  'bearer',
  'cookie',
  'password',
  'passwd',
  'secret',
  'apikey',
  'session',
  'credential',
  // --- PASSAI 自由記述・AI 会話本文 ---
  'essay',
  'statement',
  'selfpr',
  'message', // tutor message / usermessage
  'freetext',
  'content',
  'prompt',
  'answer',
  'draft',
  'studentprofile',
  'basicinfo',
  'interviewrecord',
  'interviewfeedback',
  'wallhitting',
  'activitydata',
  'reply',
  'userprompt',
  'contextstring',
];

// (A-2) 正規化後 key が「これらと完全一致」したら値を丸ごと filter する。
//   部分一致にすると誤爆が大きいもの（body / text / key / name 等）を限定する。
const DENY_EXACT: ReadonlySet<string> = new Set([
  'body',
  'text',
  'key',
  'name',
  'fullname',
  'username',
  'phone',
  'tel',
  'address',
  'accesstoken',
  'refreshtoken',
  'idtoken',
]);

function isDeniedKey(key: string): boolean {
  const k = normalizeKey(key);
  if (k === '') return false;
  if (DENY_EXACT.has(k)) return true;
  return DENY_SUBSTRINGS.some((sub) => k.includes(sub));
}

// (B) value ベースの redaction パターン。
//   leaf string / 例外メッセージ中に紛れ込んだ機密値を置換する。
type Redaction = { pattern: RegExp; replace: string | ((match: string) => string) };

const VALUE_PATTERNS: readonly Redaction[] = [
  // email
  { pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replace: REDACTED },
  // JWT (eyJ... .eyJ... .sig) — Supabase access/refresh token 等
  {
    pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    replace: REDACTED,
  },
  // Bearer ヘッダ
  { pattern: /[Bb]earer\s+[A-Za-z0-9._~+/=-]+/g, replace: `Bearer ${REDACTED}` },
  // Stripe 等の secret/restricted key
  { pattern: /\b(sk|rk)_(live|test)_[A-Za-z0-9]+/g, replace: REDACTED },
  // クエリ/フォーム中の機密パラメータ: token=... / access_token=... / code=... など
  {
    pattern:
      /\b(access_token|refresh_token|token|code|secret|password|authorization|api_key|apikey)=[^&\s"']+/gi,
    replace: (match: string) => `${match.split('=')[0]}=${REDACTED}`,
  },
];

function redactString(value: string): string {
  let out = value;
  for (const { pattern, replace } of VALUE_PATTERNS) {
    out =
      typeof replace === 'string'
        ? out.replace(pattern, replace)
        : out.replace(pattern, replace);
  }
  return out;
}

// 値を再帰的に走査し、機密 key の値を filter / leaf string を redact する。
//   - object/array は in-place 書き換え（Sentry は走査後の event をそのまま使う）。
//   - WeakSet で循環参照を遮断。深さ上限超過は `[Filtered]` に倒す。
function scrubValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (typeof value !== 'object') return value;

  if (depth > MAX_DEPTH) return FILTERED;
  if (seen.has(value as object)) return FILTERED;
  seen.add(value as object);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = scrubValue(value[i], depth + 1, seen);
    }
    return value;
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (isDeniedKey(key)) {
      record[key] = FILTERED;
      continue;
    }
    record[key] = scrubValue(record[key], depth + 1, seen);
  }
  return record;
}

// ── Sentry beforeSend ─────────────────────────────────────────────
//   送信直前の Event を走査して機密値を除去する。決して null を返さない
//   （エラーを握りつぶさない）。スクラバ内部例外も握って event をそのまま通す。
//   ジェネリックにして ErrorEvent / TransactionEvent どちらの beforeSend にも使える。
export function scrubEvent<E extends Event>(input: E): E {
  // 同一オブジェクトを mutate して返す。プロパティ単位のジェネリック不一致を避けるため
  // 走査中は広い Event 型のエイリアス経由で扱う。
  const event = input as Event;
  try {
    const seen = new WeakSet<object>();

    // request: cookies / headers(authorization,cookie) / query_string / data。
    if (event.request) {
      // cookie は丸ごと落とす（sendDefaultPii:false でも保険）。
      delete event.request.cookies;
      if (event.request.headers) {
        for (const key of Object.keys(event.request.headers)) {
          if (isDeniedKey(key)) {
            event.request.headers[key] = FILTERED;
          }
        }
      }
      if (typeof event.request.query_string === 'string') {
        event.request.query_string = redactString(event.request.query_string);
      }
      if (event.request.data !== undefined) {
        event.request.data = scrubValue(event.request.data, 0, seen);
      }
    }

    // user: PII を落とす（id 末尾断片など我々が明示設定したものは別途許容しない方針）。
    if (event.user) {
      delete event.user.email;
      delete event.user.username;
      delete event.user.ip_address;
    }

    if (event.extra) {
      event.extra = scrubValue(event.extra, 0, seen) as Event['extra'];
    }
    if (event.contexts) {
      event.contexts = scrubValue(event.contexts, 0, seen) as Event['contexts'];
    }
    if (event.tags) {
      // tags は我々が詰める最小メタのみ想定だが、value も string redaction にかける。
      for (const key of Object.keys(event.tags)) {
        const v = event.tags[key];
        if (typeof v === 'string') event.tags[key] = redactString(v);
      }
    }

    // 例外メッセージ / トップレベル message の本文 redaction。
    if (event.message && typeof event.message === 'string') {
      event.message = redactString(event.message);
    }
    if (event.exception?.values) {
      for (const ex of event.exception.values) {
        if (typeof ex.value === 'string') ex.value = redactString(ex.value);
      }
    }

    // breadcrumbs: message / data を走査。
    if (event.breadcrumbs) {
      for (const crumb of event.breadcrumbs) {
        scrubBreadcrumbInPlace(crumb, seen);
      }
    }

    return input;
  } catch {
    // スクラバが落ちても送信は止めない。ただし機密が残り得るため最小化して返す。
    // request/cookies/extra は安全側で破棄する。
    try {
      delete event.request;
      delete event.extra;
      delete event.contexts;
    } catch {
      /* noop */
    }
    return input;
  }
}

function scrubBreadcrumbInPlace(crumb: Breadcrumb, seen: WeakSet<object>): void {
  if (typeof crumb.message === 'string') {
    crumb.message = redactString(crumb.message);
  }
  if (crumb.data) {
    crumb.data = scrubValue(crumb.data, 0, seen) as Breadcrumb['data'];
  }
}

// ── Sentry beforeBreadcrumb ───────────────────────────────────────
//   console / fetch / navigation breadcrumb の本文を捕捉時点で redaction する。
//   null を返すと breadcrumb 破棄になるが、ここでは握って常に残す（情報は redaction 済）。
export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  try {
    scrubBreadcrumbInPlace(crumb, new WeakSet<object>());
    return crumb;
  } catch {
    // 失敗時は本文を含み得るため breadcrumb 自体を破棄する（送信は別途継続）。
    return null;
  }
}
