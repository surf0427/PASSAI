// PASSAI 受験版 Exam Spine — Stage 4 sync core / revision primitive。
//
// Canon §16: revision =「Source がいつの論理状態かを識別するための情報」。
//
// ★★ この file が決めてはいけないこと ★★
//   - どの kind が `updated_at` を revision にするか / `created_at` にするか
//     （self_pr / statement_review などの **kind 固有規則は Wave 2 以降**。
//       Authority Freeze 前に固定すると contract をコードが先取りすることになる。Canon §76）
//   - canonical / mirror のどちらを採用するか（Canon §31「新しい方を採用」は **禁止**）
//
// ★★ compareRevision は「観測」であって「権威」ではない ★★
//   順序が付くことと、意味的に正しいことは別である（Canon §31）。本 file は
//   「どちらが新しいか」を **返すだけ**で、「どちらを使うか」を返す API を持たない。
//   採用判断は Authority Contract の仕事であり、sync primitive の仕事ではない。
//
// 非依存: I/O / clock（Date / Date.now / Date.parse を使わない）/ random / logging。
//   ISO 8601 の解釈まで自前で持つのは、`Date.parse` が非 ISO 入力で実装依存だからである。

// ── 値 ────────────────────────────────────────────────────────────────
//
// `absent`（そもそも revision が無い）と `uninterpretable`（値はあるが generic 層では
// 解釈できない）を必ず分ける。Canon §40 の EMPTY / UNREADABLE と同じ区別であり、
// ここを潰すと「revision が無い」と「revision が読めない」が同じ扱いになる。
export type ExamRevisionValue =
  | { readonly form: 'absent' }
  | { readonly form: 'uninterpretable'; readonly valueType: string }
  | {
      readonly form: 'timestamp';
      /** UTC epoch 秒（整数・負値あり）。 */
      readonly epochSeconds: number;
      /** 秒未満（0〜999,999,999）。Postgres の microsecond を落とさないために持つ。 */
      readonly nanos: number;
      /**
       * 入力に UTC offset が書かれていたか。
       * `timestamp without time zone` 由来の値は offset 不明であり、offset 付きの値と
       * 同じ数直線に載せてはいけない（勝手に UTC とみなすのは silent fallback）。
       */
      readonly offsetKnown: boolean;
    }
  | { readonly form: 'counter'; readonly value: number }
  | { readonly form: 'opaque'; readonly token: string };

export type ExamRevisionForm = ExamRevisionValue['form'];

export const EXAM_REVISION_FORMS = [
  'absent',
  'uninterpretable',
  'timestamp',
  'counter',
  'opaque',
] as const satisfies readonly ExamRevisionForm[];

/** 大小比較が定義される form。opaque（uuid / etag 等）は等値のみで、順序を持たない。 */
export const EXAM_REVISION_ORDERABLE_FORMS = ['timestamp', 'counter'] as const;

export const ABSENT_REVISION: ExamRevisionValue = { form: 'absent' };

// ── ISO 8601 timestamp の純粋 parser ──────────────────────────────────

const ISO_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?(Z|z|[+-]\d{2}(?::?\d{2})?)?$/;

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

const MONTH_DAYS: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function daysInMonth(y: number, m: number): number {
  return m === 2 && isLeapYear(y) ? 29 : MONTH_DAYS[m - 1];
}

/**
 * 1970-01-01 からの日数（Howard Hinnant の days_from_civil）。
 * Date を使わずに epoch を出すために持つ。proleptic Gregorian・純粋・整数演算のみ。
 */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400; // 0..399
  const mp = month + (month > 2 ? -3 : 9); // 0..11
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1; // 0..365
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // 0..146096
  return era * 146097 + doe - 719468;
}

function parseOffsetSeconds(raw: string): number {
  if (raw === 'Z' || raw === 'z') return 0;
  const sign = raw[0] === '-' ? -1 : 1;
  const body = raw.slice(1).replace(':', '');
  const hh = Number(body.slice(0, 2));
  const mm = body.length >= 4 ? Number(body.slice(2, 4)) : 0;
  return sign * (hh * 3600 + mm * 60);
}

/**
 * ISO 8601 の解析結果。
 * `not_iso`（そもそも日時ではない）と `invalid`（日時の形だが実在しない値）を分ける。
 * 2026-02-30 のような値を「ただの文字列」として opaque に落とすと、壊れた日時が
 * 「等値だけ言える token」として生き延びてしまうため、ここで区別する。
 */
type IsoParse =
  | { kind: 'timestamp'; epochSeconds: number; nanos: number; offsetKnown: boolean }
  | { kind: 'not_iso' }
  | { kind: 'invalid' };

function parseIso(trimmed: string): IsoParse {
  const m = ISO_PATTERN.exec(trimmed);
  if (!m) return { kind: 'not_iso' };

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  const fraction = m[7];
  const offsetRaw = m[8];

  if (month < 1 || month > 12) return { kind: 'invalid' };
  if (day < 1 || day > daysInMonth(year, month)) return { kind: 'invalid' };
  if (hour > 23 || minute > 59 || second > 59) return { kind: 'invalid' };

  const nanos = fraction === undefined ? 0 : Number(fraction.padEnd(9, '0'));
  const offsetSeconds = offsetRaw === undefined ? 0 : parseOffsetSeconds(offsetRaw);
  const epochSeconds =
    daysFromCivil(year, month, day) * 86400 + hour * 3600 + minute * 60 + second - offsetSeconds;

  return { kind: 'timestamp', epochSeconds, nanos, offsetKnown: offsetRaw !== undefined };
}

/**
 * ISO 8601 の date-time 文字列を revision へ。
 * 解釈できない文字列は **opaque にも counter にも落とさず** `uninterpretable` を返す。
 */
export function revisionFromTimestampText(text: string): ExamRevisionValue {
  const trimmed = text.trim();
  if (trimmed === '') return ABSENT_REVISION;

  const parsed = parseIso(trimmed);
  if (parsed.kind !== 'timestamp') return { form: 'uninterpretable', valueType: 'string' };
  return {
    form: 'timestamp',
    epochSeconds: parsed.epochSeconds,
    nanos: parsed.nanos,
    offsetKnown: parsed.offsetKnown,
  };
}

/** 単調増加する整数列（version 列など）。 */
export function revisionFromCounter(value: number): ExamRevisionValue {
  if (!Number.isSafeInteger(value)) return { form: 'uninterpretable', valueType: 'number' };
  return { form: 'counter', value };
}

/** uuid / etag のように「等値だけが意味を持つ」token。 */
export function revisionFromOpaque(token: string): ExamRevisionValue {
  const trimmed = token.trim();
  if (trimmed === '') return ABSENT_REVISION;
  return { form: 'opaque', token: trimmed };
}

// ── 汎用 normalize ────────────────────────────────────────────────────

/**
 * 契約非依存の正規化。**どの列が revision なのかは決めない**（それは kind 固有規則）。
 *
 * 規則（型で決め、内容で推測しない）:
 *   undefined / null / 空白のみの文字列 → absent
 *   string  → ISO 8601 なら timestamp / 日時の形だが実在しない値なら uninterpretable /
 *             それ以外は opaque（数字だけの文字列を counter に昇格させない。id と区別できない）
 *   number  → safe integer なら counter、そうでなければ uninterpretable
 *   bigint  → safe integer 範囲なら counter、そうでなければ uninterpretable
 *   その他  → uninterpretable（boolean / object / array / function / symbol）
 */
export function normalizeRevisionInput(input: unknown): ExamRevisionValue {
  if (input === undefined || input === null) return ABSENT_REVISION;

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed === '') return ABSENT_REVISION;
    const parsed = parseIso(trimmed);
    if (parsed.kind === 'timestamp') {
      return {
        form: 'timestamp',
        epochSeconds: parsed.epochSeconds,
        nanos: parsed.nanos,
        offsetKnown: parsed.offsetKnown,
      };
    }
    // 日時の形をしているのに実在しない値（2026-02-30 など）は opaque へ落とさない。
    if (parsed.kind === 'invalid') return { form: 'uninterpretable', valueType: 'string' };
    return { form: 'opaque', token: trimmed };
  }

  if (typeof input === 'number') return revisionFromCounter(input);

  if (typeof input === 'bigint') {
    if (input > BigInt(Number.MAX_SAFE_INTEGER) || input < BigInt(Number.MIN_SAFE_INTEGER)) {
      return { form: 'uninterpretable', valueType: 'bigint' };
    }
    return { form: 'counter', value: Number(input) };
  }

  if (typeof input === 'boolean') return { form: 'uninterpretable', valueType: 'boolean' };
  if (typeof input === 'function') return { form: 'uninterpretable', valueType: 'function' };
  if (typeof input === 'symbol') return { form: 'uninterpretable', valueType: 'symbol' };
  return { form: 'uninterpretable', valueType: Array.isArray(input) ? 'array' : 'object' };
}

// ── 比較 ──────────────────────────────────────────────────────────────

export type ExamRevisionEquality = 'equal' | 'different' | 'unknown';

export type ExamRevisionIncomparableReason =
  | 'absent' // 片方または両方に revision が無い
  | 'uninterpretable' // 値はあるが generic 層で解釈できない
  | 'form_mismatch' // timestamp と counter など、別の数直線
  | 'zone_unknown' // 片方だけ UTC offset を持つ timestamp
  | 'not_ordered'; // opaque 同士（等値は言えるが順序は言えない）

export type ExamRevisionComparison =
  | { readonly comparable: true; readonly order: -1 | 0 | 1 }
  | { readonly comparable: false; readonly reason: ExamRevisionIncomparableReason };

function incomparableReason(
  a: ExamRevisionValue,
  b: ExamRevisionValue,
): ExamRevisionIncomparableReason | null {
  if (a.form === 'absent' || b.form === 'absent') return 'absent';
  if (a.form === 'uninterpretable' || b.form === 'uninterpretable') return 'uninterpretable';
  if (a.form !== b.form) return 'form_mismatch';
  if (a.form === 'timestamp' && b.form === 'timestamp' && a.offsetKnown !== b.offsetKnown) {
    return 'zone_unknown';
  }
  return null;
}

/**
 * 論理状態の等値。**3 値**であることが重要で、`unknown` を `equal` に倒してはいけない。
 * 両方 absent は「一致」ではなく「情報が無い」＝ unknown。
 */
export function revisionEquality(a: ExamRevisionValue, b: ExamRevisionValue): ExamRevisionEquality {
  if (incomparableReason(a, b) !== null) return 'unknown';
  if (a.form === 'timestamp' && b.form === 'timestamp') {
    return a.epochSeconds === b.epochSeconds && a.nanos === b.nanos ? 'equal' : 'different';
  }
  if (a.form === 'counter' && b.form === 'counter') {
    return a.value === b.value ? 'equal' : 'different';
  }
  if (a.form === 'opaque' && b.form === 'opaque') {
    return a.token === b.token ? 'equal' : 'different';
  }
  return 'unknown';
}

/**
 * 順序の **観測**。返すのは -1 / 0 / 1 だけで、「採用すべき側」は返さない（Canon §31）。
 * opaque は等値しか言えないため、順序としては `not_ordered`（比較不能）を返す。
 */
export function compareRevision(a: ExamRevisionValue, b: ExamRevisionValue): ExamRevisionComparison {
  const reason = incomparableReason(a, b);
  if (reason !== null) return { comparable: false, reason };

  if (a.form === 'timestamp' && b.form === 'timestamp') {
    if (a.epochSeconds !== b.epochSeconds) {
      return { comparable: true, order: a.epochSeconds < b.epochSeconds ? -1 : 1 };
    }
    if (a.nanos !== b.nanos) return { comparable: true, order: a.nanos < b.nanos ? -1 : 1 };
    return { comparable: true, order: 0 };
  }

  if (a.form === 'counter' && b.form === 'counter') {
    if (a.value === b.value) return { comparable: true, order: 0 };
    return { comparable: true, order: a.value < b.value ? -1 : 1 };
  }

  // opaque 同士。等値は revisionEquality で言えるが、順序は定義できない。
  return { comparable: false, reason: 'not_ordered' };
}
