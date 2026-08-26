// PASSAI 受験版 Exam Spine — Stage 5.0 pilot の claim transport adapter（純関数）。
//
// ★ 責務は transport だけ ★
//   device canonical → 正規化 view → fingerprint の **projection は本 file が持たない**。
//   それは canonical device projection authority である
//   `lib/examSpine/sync/adapters/deviceViews.ts` / `deviceSources.ts` の責務である。
//   ここがやるのは「その結果を claim entry（kind + token）へ載せ替える」ことだけ。
//
// ★ なぜ分けるか（Stage 5.1 の収束）★
//   Stage 5.0 時点では本 file が stripName → mapBasicInfoRow → basicInfoSyncView →
//   examSyncObservation という pipeline を自前で持っていた。その後 B 側の
//   `deviceViews.ts` が同じ pipeline を 8 kind ぶん実装したため、basic_info について
//   **同一変換が 2 箇所に存在する dual authority** になっていた。
//   projection の正本を deviceViews.ts に一本化し、本 file は delegate に縮退させた。
//   これにより「片方だけ直して fingerprint が永久不一致になる」経路が消える。
//
// 純関数。localStorage / fetch / Supabase / Date / Math.random を持たない（isomorphic）。

import type { BasicInfo } from '@/types/basicInfo';
import type { DiagnosisResult } from '@/lib/diagnosisStorage';
import type { ActivityData } from '@/types/activity';
import type { SelfAnalysisLog } from '@/types/selfAnalysisLog';
import type { ReviewHistoryItem } from '@/lib/statement/review/statementStorage';

import { buildDeviceClaim } from '../adapters/deviceSources';
import type { ExamDeviceClaim } from '../adapters/deviceSources';
import type { ExamDeviceClaimEntry } from './types';

/**
 * device canonical の `BasicInfo` → claim（canonical projection へ委譲）。
 *
 * `null` / `undefined` は「device に無い」として `absent` を渡す。
 * 判定（claimed / empty / unclaimed）は `buildDeviceClaim` が行う。
 */
export function deviceBasicInfoClaim(
  basicInfo: BasicInfo | null | undefined,
): ExamDeviceClaim {
  return buildDeviceClaim(
    'basic_info',
    basicInfo ? { state: 'present', value: basicInfo } : { state: 'absent' },
  );
}

/**
 * claim token（`efp1:<hex64>`）。申告できないときは `null`。
 *
 * ★ `empty` と `unclaimed` の両方が null になる ★
 *   transport 上はどちらも「header に載せない」であり、区別は不要である。
 *   意味の区別は server 側で付く:
 *     device が空  → server も 0 行 → Stage 4 が Source-Sync の手前で `empty` を確定（E-S30）
 *     申告できない → server 側は `unclaimed` → `unverified`（E-S2）
 *   したがってここで無理に別扱いにすると、かえって二重管理になる。
 */
export function deviceBasicInfoToken(
  basicInfo: BasicInfo | null | undefined,
): string | null {
  const claim = deviceBasicInfoClaim(basicInfo);
  return claim.state === 'claimed' ? claim.observation.fingerprint : null;
}

/**
 * device canonical の `DiagnosisResult` → claim token（canonical projection へ委譲）。
 *
 * ★ Stage 5.2 で追加（G1）★
 *   `diagnosis` は class 1（device_canonical_mirrored）なので、
 *   claim が無いと Source-Sync が verified にならず canonical block が生成されない。
 *   block を作っただけでは migration できないため、transport にも載せる。
 *
 * ⚠️ 既知の制約: `diagnosisSyncView` は `schemaVersion` を含む。writer は現在 `"3"` を
 *   書くが、DDL default は `'1'` であり **bump 前に書かれた行は `'1'` のまま**である
 *   （`EXAM_SPINE_STAGE3_READINESS_AUDIT.md` §6.3）。その行を持つ user は
 *   device 側 `'3'` と一致せず永久に `mismatch` になる。
 *   これは transport の問題ではなく mirror の schema_version semantics の問題なので、
 *   ここでは回避策を入れない（入れると 2 つ目の正規化規則になる）。
 */
export function deviceDiagnosisToken(
  diagnosis: DiagnosisResult | null | undefined,
): string | null {
  const claim = buildDeviceClaim(
    'diagnosis',
    diagnosis ? { state: 'present', value: diagnosis } : { state: 'absent' },
  );
  return claim.state === 'claimed' ? claim.observation.fingerprint : null;
}

/**
 * device canonical の `ActivityData` → claim token（canonical projection へ委譲）。
 *
 * ★ Stage 5.3 で追加（G6）★
 *   `activity` は class 1（device_canonical_mirrored）なので、claim が無いと
 *   Source-Sync が verified にならず canonical block が生成されない。
 *
 * ⚠️ mirror gap（既知 / 今回は直さない）:
 *   `dualWriteActivityLog` は **submit 時にしか発火しない**（autosave は mirror されない /
 *   `EXAM_SPINE_STAGE3_READINESS_AUDIT.md` §10.1 G1）。したがって入力途中の端末では
 *   device と server が正当に食い違い、claim は mismatch になる。
 *   これは Source-Sync が **stale な server 値を使わせない**という設計どおりの挙動であり、
 *   欠陥ではない。transport 側で握り潰さない。
 */
export function deviceActivityToken(
  activity: ActivityData | null | undefined,
): string | null {
  const claim = buildDeviceClaim(
    'activity',
    activity ? { state: 'present', value: activity } : { state: 'absent' },
  );
  return claim.state === 'claimed' ? claim.observation.fingerprint : null;
}

/**
 * device canonical の自己分析ログ → claim token（canonical projection へ委譲）。
 *
 * ★ Stage 5.4 で追加（G7）★
 *   `self_analysis` は class 1 かつ **履歴 list** なので、
 *   snapshot kind と違って「どの N 件を見るか」が device / server で揃っている必要がある。
 *   その window 選択も canonical projection（`deviceSelfAnalysisView`）が持つ。
 *
 * ⚠️ mirror gap（既知 / 今回は直さない）:
 *   `dualWriteSelfAnalysisLog` は log 確定時に発火するが、削除は伝播しない
 *   （`EXAM_SPINE_STAGE3_READINESS_AUDIT.md` §10.1 G9）。
 *   端末で log を消しても server に残るため、その端末では正当に mismatch になる。
 *   Source-Sync が stale な server 値を使わせない設計どおりの挙動であり、握り潰さない。
 */
export function deviceSelfAnalysisToken(
  logs: readonly SelfAnalysisLog[] | null | undefined,
): string | null {
  const claim = buildDeviceClaim(
    'self_analysis',
    logs && logs.length > 0 ? { state: 'present', value: logs } : { state: 'absent' },
  );
  return claim.state === 'claimed' ? claim.observation.fingerprint : null;
}

/**
 * device canonical の志望理由書レビュー履歴 → claim token（canonical projection へ委譲）。
 *
 * ★ Stage 5.6 で追加（G8）★
 *   history kind なので window 選択（server の read cap と同じ上位 N 件）も
 *   canonical view（`deviceStatementReviewView`）が持つ。
 *
 * ⚠️ mirror gap（既知 / 今回は直さない）:
 *   削除と 10 件 cap の eviction が server へ伝播しない
 *   （`EXAM_SPINE_STAGE3_READINESS_AUDIT.md` §10.1 G3 / G4）。
 *   device が消した添削も server に残るため、その端末では正当に mismatch になる。
 */
export function deviceStatementReviewToken(
  items: readonly ReviewHistoryItem[] | null | undefined,
): string | null {
  const claim = buildDeviceClaim(
    'statement_review',
    items && items.length > 0 ? { state: 'present', value: items } : { state: 'absent' },
  );
  return claim.state === 'claimed' ? claim.observation.fingerprint : null;
}

/**
 * pilot（tutor）の claim entry を組み立てる。
 *
 * ★ 載せる kind は purpose の移行状況で決める ★
 *   `deviceViews.ts` は 8 kind ぶんの projection を持つが、transport に載せるのは
 *   「その kind の canonical block が存在し、移行対象になっている」ものだけ。
 *   現在は basic_info（Stage 5.0）と diagnosis（Stage 5.2 / G1）の 2 kind。
 *   activity / self_analysis / statement_review は block も claim も未着手（G6-G8）。
 */
export function buildTutorDeviceClaimEntries(
  basicInfo: BasicInfo | null | undefined,
  diagnosis?: DiagnosisResult | null,
  activity?: ActivityData | null,
  selfAnalysisLogs?: readonly SelfAnalysisLog[] | null,
  statementReviews?: readonly ReviewHistoryItem[] | null,
): readonly ExamDeviceClaimEntry[] {
  // ★ 宣言順を固定する ★
  //   偶然の object 順序に依存させない。kind ごとに独立した token なので
  //   順序は wire 上の見た目だけに効くが、決定的にしておく（QA が固定する）。
  const entries: ExamDeviceClaimEntry[] = [];
  const basicToken = deviceBasicInfoToken(basicInfo);
  if (basicToken) entries.push({ kind: 'basic_info', token: basicToken });
  const diagnosisToken = deviceDiagnosisToken(diagnosis);
  if (diagnosisToken) entries.push({ kind: 'diagnosis', token: diagnosisToken });
  const activityToken = deviceActivityToken(activity);
  if (activityToken) entries.push({ kind: 'activity', token: activityToken });
  const selfAnalysisToken = deviceSelfAnalysisToken(selfAnalysisLogs);
  if (selfAnalysisToken) entries.push({ kind: 'self_analysis', token: selfAnalysisToken });
  const statementReviewToken = deviceStatementReviewToken(statementReviews);
  if (statementReviewToken) entries.push({ kind: 'statement_review', token: statementReviewToken });
  return entries;
}
