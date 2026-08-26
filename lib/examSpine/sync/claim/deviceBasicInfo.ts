// PASSAI 受験版 Exam Spine — Stage 5.0 pilot の device view（kind: basic_info / 純関数）。
//
// ★ 新しい正規化を作らない ★
//   device 側の token は「server が同じ行から算出する値」と **完全に一致**しなければ
//   意味が無い。したがってここでは device 用の view を書き起こさず、
//   **server が使うのと同じ mapper / view / fingerprint をそのまま通す**:
//
//     device BasicInfo
//       → stripName（writer と同じ PII 契約）
//       → mapBasicInfoRow      … server と同一の row mapper（truncate / null 正規化）
//       → basicInfoSyncView    … server と同一の sync view（name を含まない）
//       → examSyncObservation  … server と同一の envelope + SHA-256
//
//   この構成なら「device 側だけ正規化がずれて永久に mismatch」という
//   silent failure が構造的に起きない。ずれ得るのは入力（payload / schema_version）だけで、
//   そのどちらも writer 契約から決まる。
//
// ★ 空のときは申告しない ★
//   `dualWriteBasicInfoLog` は `isEmptyBasicInfo` の行を書かないため、device が空なら
//   server にも行が無い。server 側が 0 行のときは Stage 4 が Source-Sync より手前で
//   `empty` を確定させる（E-S30）ので、空の申告に意味は無い。null を返して header から外す。
//
// 純関数。localStorage / fetch / Supabase / Date / Math.random を持たない（isomorphic）。
// 呼び出し側（client）が device canonical を読んで渡す。

import type { BasicInfo } from '@/types/basicInfo';
import { BASIC_INFO_SCHEMA_VERSION } from '@/lib/supabase/basicInfoLogs';

import { mapBasicInfoRow } from '../../read/rowMappers';
import { EXAM_READ_FIELD_LIMITS } from '../../read/readSources';
import { basicInfoSyncView } from '../adapters/views';
import { examSyncObservation } from '../adapters/views';
import type { ExamDeviceClaimEntry } from './types';

/**
 * device canonical の `BasicInfo` → claim token。
 * 申告するものが無ければ `null`。
 */
export function deviceBasicInfoToken(basicInfo: BasicInfo | null | undefined): string | null {
  if (!basicInfo) return null;

  // ★ 氏名は claim の材料にしない ★
  //   writer（lib/supabase/basicInfoLogs.ts:stripName）が書き込み前に落とすため
  //   server payload に存在しない。device 側も同じく落とす（入れると永久不一致 / E-P8）。
  const payload: Record<string, unknown> = { ...(basicInfo as unknown as Record<string, unknown>) };
  delete payload.name;

  const row = mapBasicInfoRow(
    { payload, schema_version: BASIC_INFO_SCHEMA_VERSION },
    EXAM_READ_FIELD_LIMITS,
  );
  if (!row) return null;

  // 実質空（grade / track / 志望校 / 受験方式がすべて空）なら申告しない。
  // writer が書かない状態と揃える。
  const empty =
    !row.grade &&
    !row.track &&
    row.preferences.length === 0 &&
    row.examTypes.length === 0;
  if (empty) return null;

  const observation = examSyncObservation({
    kind: 'basic_info',
    source: 'device_canonical',
    view: basicInfoSyncView(row),
  });
  return observation.fingerprint;
}

/**
 * pilot（tutor）の claim entry を組み立てる。
 *
 * ★ pilot は basic_info の 1 kind だけ ★
 *   他 kind の device view は本 Stage の scope 外（Stage 5.1 以降）。
 *   ここに kind を足すのは、その kind の device view が canonical に存在してからにする。
 */
export function buildTutorDeviceClaimEntries(
  basicInfo: BasicInfo | null | undefined,
): readonly ExamDeviceClaimEntry[] {
  const token = deviceBasicInfoToken(basicInfo);
  return token ? [{ kind: 'basic_info', token }] : [];
}
