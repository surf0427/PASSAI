// PASSAI 受験版 Exam Spine — Stage 4 sync core / fingerprint primitive。
//
// Canon §16:
//   normalized source → stable serialization → fingerprint
//   「内容が同一であるかを比較するための安定した識別値」
//
// この file が **持たない**もの（Wave 1 の scope 外）:
//   - kind 固有の normalize 規則（どの field を fingerprint に含めるか）
//   - canonical / mirror のどちらを採用するかの判断（Canon §31 / §32）
//   - set semantics な field の canonical sort（下記「配列順序」を参照）
//   - I/O / clock / random / logging
//
// ★ 配列順序は既定で **semantic** として保持する ★
//   interview history / activity history / answer sequence / ranking / priority のように、
//   順序そのものが意味を持つ source が実在する。generic primitive が配列を勝手に sort すると
//   「順序が壊れた mirror」と「正しい mirror」が同じ fingerprint になり、mismatch を
//   構造的に検出できなくなる。したがって:
//
//     object key order = non-semantic（sort する）
//     array order      = semantic（sort しない）
//
//   set semantics と **契約で明示された** field だけを、将来 Wave 2 以降の adapter が
//   fingerprint へ渡す前に正規化する。generic 層はその判断を持たない。
//
// ★ 逆算できない形式にする ★
//   fingerprint は SHA-256 hex であり、本文の serialization をそのまま返さない。
//   canonical encoding 関数は **export しない**（export すると fingerprint 経路が
//   そのまま本文取り出し API になる）。

import { sha256Hex } from './hash';

/** encoding / hash を変えたときに上げる。異なる version の値を比較してはいけない。 */
export const EXAM_FINGERPRINT_VERSION = 'efp1';

/** 再帰の上限。超えたら黙って打ち切らずに throw する（打ち切りは差分の握り潰しになる）。 */
export const EXAM_FINGERPRINT_MAX_DEPTH = 64;

/**
 * 本 primitive が固定している意味論。QA がこの宣言と実挙動の一致を検査する。
 * 宣言だけ変えて挙動が変わらない / 挙動だけ変えて宣言が残る、を起こさないための anchor。
 */
export const EXAM_FINGERPRINT_SEMANTICS = {
  /** object の key 順は情報ではない → code unit 昇順へ正規化する。 */
  objectKeyOrder: 'non_semantic',
  /** 配列順は情報である → 保持する。generic 層では絶対に sort しない。 */
  arrayOrder: 'semantic',
  /** null と undefined を別物として符号化する。 */
  undefinedDistinctFromNull: true,
  /** `{ a: undefined }` と `{}` を別物として符号化する。 */
  absentPropertyDistinctFromUndefinedProperty: true,
  /** -0 は 0 と同じ（JSON round-trip で保てないため、差として扱わない）。 */
  minusZeroNormalizedToZero: true,
} as const;

/** `efp1:<sha256 hex 64>` 形式。 */
export type ExamFingerprint = string;

const FINGERPRINT_PATTERN = /^efp1:[0-9a-f]{64}$/;

export function isExamFingerprint(value: unknown): value is ExamFingerprint {
  return typeof value === 'string' && FINGERPRINT_PATTERN.test(value);
}

// ── Error ─────────────────────────────────────────────────────────────
//
// ★ error message に入力本文・key 名・path を **入れない** ★
//   fingerprint の入力は自己PR / 志望理由書 / 面接記録などの本文そのものである。
//   path には key が含まれ、key が利用者由来（大学名など）である source も有り得るため、
//   診断情報は「型名」と「深さ」だけに限定する（E-S13 と同じ姿勢）。

export type ExamFingerprintErrorCode =
  | 'unsupported_value' // function / symbol など、source data に存在し得ない値
  | 'unsupported_object' // Date / Map / Set / RegExp / class instance など
  | 'symbol_key' // symbol key は JSON 経路に存在せず、黙って落とすと差分が消える
  | 'circular_reference'
  | 'max_depth_exceeded';

export class ExamFingerprintError extends Error {
  readonly code: ExamFingerprintErrorCode;
  /** 値の型名のみ（内容は含まない）。 */
  readonly valueType: string;
  readonly depth: number;

  constructor(code: ExamFingerprintErrorCode, valueType: string, depth: number) {
    super(`[examSpine/sync] fingerprint ${code} (valueType=${valueType}, depth=${depth})`);
    this.name = 'ExamFingerprintError';
    this.code = code;
    this.valueType = valueType;
    this.depth = depth;
  }
}

/** 内容を漏らさない型名。constructor 名までで止める。 */
function typeNameOf(value: unknown): string {
  if (value === null) return 'null';
  const t = typeof value;
  if (t !== 'object') return t;
  if (Array.isArray(value)) return 'array';
  const proto = Object.getPrototypeOf(value) as object | null;
  if (proto === null) return 'null_prototype_object';
  const ctor = (proto as { constructor?: { name?: unknown } }).constructor;
  const name = ctor && typeof ctor.name === 'string' ? ctor.name : 'unknown';
  return name;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === null || proto === Object.prototype;
}

/** key を code unit 昇順で並べる（locale 非依存）。localeCompare は環境依存なので使わない。 */
function sortKeys(keys: readonly string[]): string[] {
  return [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// ── Canonical encoding（非公開）────────────────────────────────────────
//
// 文法（長さ前置で prefix-free にしてある。'ab','c' と 'a','bc' が衝突しない）:
//   undefined      → u
//   null           → z
//   true / false   → t / f
//   number         → d:<String(n)>;      （NaN / Infinity も決定論的に符号化）
//   bigint         → i:<digits>;
//   string         → s<code unit 長>:<本文>
//   array          → a<要素数>[ e0 e1 … ]   ← **順序を保持する**
//   plain object   → o<key 数>{ k<len>:<key>= v … }  ← key を昇順へ正規化する
function encode(value: unknown, out: string[], depth: number, ancestors: object[]): void {
  if (depth > EXAM_FINGERPRINT_MAX_DEPTH) {
    throw new ExamFingerprintError('max_depth_exceeded', typeNameOf(value), depth);
  }

  if (value === undefined) {
    out.push('u');
    return;
  }
  if (value === null) {
    out.push('z');
    return;
  }

  const t = typeof value;

  if (t === 'boolean') {
    out.push(value === true ? 't' : 'f');
    return;
  }
  if (t === 'number') {
    // String(-0) === '0' なので -0 と 0 は同じ表現になる（宣言どおり）。
    out.push(`d:${String(value)};`);
    return;
  }
  if (t === 'bigint') {
    out.push(`i:${String(value)};`);
    return;
  }
  if (t === 'string') {
    const s = value as string;
    out.push(`s${s.length}:${s}`);
    return;
  }
  if (t === 'function' || t === 'symbol') {
    throw new ExamFingerprintError('unsupported_value', t, depth);
  }

  const obj = value as object;
  if (ancestors.includes(obj)) {
    throw new ExamFingerprintError('circular_reference', typeNameOf(obj), depth);
  }
  ancestors.push(obj);

  if (Array.isArray(obj)) {
    const arr = obj as readonly unknown[];
    out.push(`a${arr.length}[`);
    // ★ ここで sort しない。配列順は semantic（本 file 冒頭の契約）。
    for (let i = 0; i < arr.length; i += 1) {
      encode(arr[i], out, depth + 1, ancestors);
    }
    out.push(']');
    ancestors.pop();
    return;
  }

  if (!isPlainObject(obj)) {
    throw new ExamFingerprintError('unsupported_object', typeNameOf(obj), depth);
  }
  if (Object.getOwnPropertySymbols(obj).length > 0) {
    throw new ExamFingerprintError('symbol_key', typeNameOf(obj), depth);
  }

  const keys = sortKeys(Object.keys(obj as Record<string, unknown>));
  out.push(`o${keys.length}{`);
  const record = obj as Record<string, unknown>;
  for (const key of keys) {
    out.push(`k${key.length}:${key}=`);
    encode(record[key], out, depth + 1, ancestors);
  }
  out.push('}');
  ancestors.pop();
}

// ── 公開 API ──────────────────────────────────────────────────────────

/**
 * 値の内容 fingerprint。純関数・決定論・no I/O。
 *
 * 同値性の定義:
 *   - object の key 順が違うだけなら **同じ**
 *   - 配列の順が違えば **別物**
 *   - null / undefined / 空文字 / 0 / false / key 欠落は互いに **別物**
 *
 * @throws {ExamFingerprintError} source data として表現できない値を含むとき。
 *   黙って落とす（= 差分を消す）より throw する方が安全側であるため fail-closed にしてある。
 */
export function examFingerprint(value: unknown): ExamFingerprint {
  const out: string[] = [];
  encode(value, out, 0, []);
  return `${EXAM_FINGERPRINT_VERSION}:${sha256Hex(out.join(''))}`;
}

export type ExamFingerprintResult =
  | { readonly ok: true; readonly fingerprint: ExamFingerprint }
  | { readonly ok: false; readonly code: ExamFingerprintErrorCode; readonly valueType: string };

/**
 * throw しない版。caller が try/catch で握り潰して「fingerprint 無し = 一致」に倒すのを防ぐため、
 * 失敗を **値** として返す。失敗も内容を含まない（code と型名のみ）。
 */
export function tryExamFingerprint(value: unknown): ExamFingerprintResult {
  try {
    return { ok: true, fingerprint: examFingerprint(value) };
  } catch (error) {
    if (error instanceof ExamFingerprintError) {
      return { ok: false, code: error.code, valueType: error.valueType };
    }
    throw error;
  }
}

/** fingerprint 同士の 3 値比較。片方でも欠けていれば `unknown`（= 一致とみなさない）。 */
export type ExamFingerprintEquality = 'equal' | 'different' | 'unknown';

export function fingerprintEquality(
  a: ExamFingerprint | null | undefined,
  b: ExamFingerprint | null | undefined,
): ExamFingerprintEquality {
  if (!isExamFingerprint(a) || !isExamFingerprint(b)) return 'unknown';
  return a === b ? 'equal' : 'different';
}
