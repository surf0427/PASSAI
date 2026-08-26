// PASSAI 受験版 Exam Spine — device revision claim の parser（server 側 / 純関数）。
//
// ★ claim を一切 trust しない ★
//   header は client が自由に書ける。したがって parser は
//   「読めたら使う」ではなく「**契約に完全に一致したものだけ通す**」形にする。
//
// ★ fail-safe（Canon §5 / E-S1）★
//   missing / malformed / unknown version / unknown kind / duplicate / oversize /
//   invalid token のいずれでも **throw しない**し request を 500 にしない。
//   その kind の申告が無かったこと（= unclaimed）にして続行する。
//   結果として Source-Sync は verified にならず、server 値は採用されない。
//   「壊れた claim で request が落ちる」ことも「壊れた claim で verified になる」ことも無い。
//
// ★ claim は policy input ではない ★
//   parser は kind と token しか取り出さない。purpose / authority / table / userId は
//   claim から読まない（型として存在しない）。したがって claim で
//   purpose gate を広げる・authority を指定する・別 user を名乗ることができない。
//
// 純関数。I/O / env / Supabase / Date / Math.random 非依存。

import { isExamSourceKind } from '../../sourceData/types';
import type { ExamSourceKind } from '../../sourceData/types';
import { isExamSyncSupportedKind } from '../adapters/registry';
import {
  EMPTY_DEVICE_CLAIM_PARSE,
  EXAM_DEVICE_CLAIM_HEADER,
  EXAM_DEVICE_CLAIM_MAX_BYTES,
  EXAM_DEVICE_CLAIM_MAX_ENTRIES,
  EXAM_DEVICE_CLAIM_TOKEN_PATTERN,
  EXAM_DEVICE_CLAIM_VERSION,
  type ExamDeviceClaimParse,
  type ExamDeviceClaimRejection,
} from './types';

/** `Headers` から claim を取り出して検証する。**never throw**。 */
export function parseDeviceClaimHeader(headers: Headers): ExamDeviceClaimParse {
  return parseDeviceClaimValue(headers.get(EXAM_DEVICE_CLAIM_HEADER));
}

/** header 値（生文字列）を検証する。**never throw**。 */
export function parseDeviceClaimValue(raw: string | null | undefined): ExamDeviceClaimParse {
  if (raw === null || raw === undefined || raw === '') {
    // 「申告しない」は異常ではない。正常な既定状態（→ unclaimed）。
    return { claims: {}, rejected: [{ kind: null, reason: 'absent' }] };
  }
  if (raw.length > EXAM_DEVICE_CLAIM_MAX_BYTES) {
    // 長さで先に切る。巨大 header を JSON.parse に渡さない。
    return { claims: {}, rejected: [{ kind: null, reason: 'oversize' }] };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    return { claims: {}, rejected: [{ kind: null, reason: 'malformed' }] };
  }

  const envelope = asRecord(decoded);
  if (!envelope) return { claims: {}, rejected: [{ kind: null, reason: 'malformed' }] };
  if (envelope.v !== EXAM_DEVICE_CLAIM_VERSION) {
    // 未知の版は黙って無視する（将来の版を古い server が誤解釈しない）。
    return { claims: {}, rejected: [{ kind: null, reason: 'unknown_version' }] };
  }
  if (!Array.isArray(envelope.c)) {
    return { claims: {}, rejected: [{ kind: null, reason: 'malformed' }] };
  }
  if (envelope.c.length > EXAM_DEVICE_CLAIM_MAX_ENTRIES) {
    return { claims: {}, rejected: [{ kind: null, reason: 'too_many_entries' }] };
  }

  const claims: Partial<Record<ExamSourceKind, string>> = {};
  const rejected: ExamDeviceClaimRejection[] = [];

  for (const item of envelope.c) {
    const entry = asRecord(item);
    if (!entry) {
      rejected.push({ kind: null, reason: 'malformed' });
      continue;
    }
    const kind = entry.kind;
    if (typeof kind !== 'string' || !isExamSourceKind(kind)) {
      rejected.push({ kind: null, reason: 'unknown_kind' });
      continue;
    }
    // class 2（E-S3）や adapter 未実装 kind の申告は受け取らない。
    // 受け取ると「server 著作データを client の申告で検証する」逆向きの誤りになる。
    if (!isExamSyncSupportedKind(kind)) {
      rejected.push({ kind, reason: 'not_syncable' });
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(claims, kind)) {
      // 重複は後勝ちにしない。先に通ったものを残し、後続を捨てる。
      rejected.push({ kind, reason: 'duplicate_kind' });
      continue;
    }
    const token = entry.token;
    if (typeof token !== 'string' || !EXAM_DEVICE_CLAIM_TOKEN_PATTERN.test(token)) {
      rejected.push({ kind, reason: 'invalid_token' });
      continue;
    }
    claims[kind] = token;
  }

  return { claims, rejected };
}

/**
 * parse 結果 → assembler の `deviceClaims` 入力。
 *
 * ★ auth binding ★
 *   claim は **認可済み subject の request に付いていた**という事実だけで結び付ける。
 *   claim 自身に userId は入っておらず（型に無い）、server auth の userId が唯一の authority
 *   である（E-L3）。したがって `authenticatedUserId` が無い場合は claim を一切採用しない
 *   ＝ 未認証 request の申告が後段へ流れない。
 *
 * ★ purpose gate を広げない（E-S28）★
 *   `allowedSources` に無い kind の申告は捨てる。claim があるからといって
 *   その kind を読むようにはならない。gate は purpose registry だけが決める。
 */
export function toDeviceClaims(
  parsed: ExamDeviceClaimParse,
  args: {
    readonly authenticatedUserId: string | null;
    readonly allowedSources: readonly ExamSourceKind[];
  },
): Readonly<Partial<Record<ExamSourceKind, { presented: boolean; fingerprint: string | null }>>> {
  if (!args.authenticatedUserId) return {};
  const allowed = new Set(args.allowedSources);
  const out: Partial<Record<ExamSourceKind, { presented: boolean; fingerprint: string | null }>> = {};
  for (const [kind, token] of Object.entries(parsed.claims)) {
    const k = kind as ExamSourceKind;
    if (!allowed.has(k)) continue;
    out[k] = { presented: true, fingerprint: token };
  }
  return out;
}

/** 観測用の要約。**token も header 本文も含めない**（E-S12 / E-S13）。 */
export function summarizeDeviceClaim(parsed: ExamDeviceClaimParse): {
  readonly claimedKinds: readonly ExamSourceKind[];
  readonly rejectedReasons: readonly string[];
} {
  return {
    claimedKinds: Object.keys(parsed.claims) as ExamSourceKind[],
    rejectedReasons: [...new Set(parsed.rejected.map((r) => r.reason))],
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export { EMPTY_DEVICE_CLAIM_PARSE };
