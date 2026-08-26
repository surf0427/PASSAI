// PASSAI 受験版 Exam Spine — Stage 4 Wave 3 / device source の注入境界（純関数・型のみ）。
//
// ★★ この file は I/O を **実装しない** ★★
//   localStorage / window / document / fetch / Supabase を 1 度も呼ばない。
//   実際に端末から読むのは runtime 側（Wave 4 以降）であり、その結果を
//   `ExamDeviceSourceState` として注入してもらう。adapter 層は runtime 非依存のまま保つ
//   （Canon §48 / §52 / E-S22 と同じ「I/O は 1 箇所に閉じる」姿勢）。
//
// ★ read の失敗を「データ無し」に潰さない（Canon §40）★
//   `absent`（正しく読めて空）と `unreadable`（読めなかった）を型で分ける。
//   unreadable を empty として claim すると、mirror も空のときに
//   「両方空 → verified」が成立してしまう。これは検証していないものを検証済みと呼ぶことになる。
//
// 非依存: I/O / clock / random / logging / network / DB / AI。

import type { BasicInfo } from '@/types/basicInfo';
import type { ActivityData } from '@/types/activity';
import type { DiagnosisResult } from '@/lib/diagnosisStorage';
import type { SelfAnalysisLog } from '@/types/selfAnalysisLog';
import type { ReviewHistoryItem } from '@/lib/statement/review/statementStorage';
import type { SelfPR } from '@/types/selfPR';
import type { StoredInterviewRecord } from '@/lib/interviewRecordStorage';
import type { EssayWorkspace } from '@/types/essay';

import type { ExamSyncSupportedKind } from './registry';
import type { ExamSyncCandidate } from '../verification';
import type { ExamSyncObservation } from './types';
import { deviceCanonicalCandidate } from './types';
import { examSyncObservation } from './views';
import type { ExamDeviceUnclaimableReason, ExamDeviceViewResult } from './deviceViews';
import {
  deviceActivityView,
  deviceBasicInfoView,
  deviceDiagnosisView,
  deviceEssayView,
  deviceInterviewRecordView,
  deviceSelfAnalysisView,
  deviceSelfPrView,
  deviceStatementReviewView,
} from './deviceViews';

// ── kind → device domain 型 ───────────────────────────────────────────
//
// 実 storage module の domain 型をそのまま使う（Spine 側で別 shape を発明しない）:
//   basic_info       lib/basicInfoStorage.ts        BasicInfo
//   activity         lib/activityStorage.ts         ActivityData
//   diagnosis        lib/diagnosisStorage.ts        DiagnosisResult
//   self_analysis    lib/selfAnalysisLogStorage.ts  SelfAnalysisLog[]
//   statement_review lib/statement/review/statementStorage.ts  ReviewHistoryItem[]
//   self_pr          lib/selfPRStorage.ts           SelfPR[]
//   interview_record lib/interviewRecordStorage.ts  StoredInterviewRecord[]
//   essay            lib/essayWorkspaceStorage.ts   EssayWorkspace[]
export type ExamDeviceDomainByKind = {
  basic_info: BasicInfo;
  activity: ActivityData;
  diagnosis: DiagnosisResult;
  self_analysis: readonly SelfAnalysisLog[];
  statement_review: readonly ReviewHistoryItem[];
  self_pr: readonly SelfPR[];
  interview_record: readonly StoredInterviewRecord[];
  essay: readonly EssayWorkspace[];
};

/** 端末側 read が失敗する理由（closed enum / PII を持てない）。 */
export type ExamDeviceReadFailure =
  | 'storage_unavailable'
  | 'parse_failed'
  | 'schema_unrecognized';

export type ExamDeviceSourceState<T> =
  | { readonly state: 'present'; readonly value: T }
  | { readonly state: 'absent' }
  | { readonly state: 'unreadable'; readonly reason: ExamDeviceReadFailure };

/** runtime 側が実装する読み出し 1 本。adapter はこれを **呼ぶだけ**。 */
export type ExamDeviceSourceReader<T> = () => ExamDeviceSourceState<T>;

export type ExamDeviceSourceReaders = {
  readonly [K in ExamSyncSupportedKind]: ExamDeviceSourceReader<ExamDeviceDomainByKind[K]>;
};

/** kind → view builder。device path の唯一の分岐点。 */
export const EXAM_DEVICE_VIEW_BUILDERS: {
  readonly [K in ExamSyncSupportedKind]: (
    value: ExamDeviceDomainByKind[K],
  ) => ExamDeviceViewResult;
} = {
  basic_info: deviceBasicInfoView,
  activity: deviceActivityView,
  diagnosis: deviceDiagnosisView,
  self_analysis: deviceSelfAnalysisView,
  statement_review: deviceStatementReviewView,
  self_pr: deviceSelfPrView,
  interview_record: deviceInterviewRecordView,
  essay: deviceEssayView,
};

// ── claim ─────────────────────────────────────────────────────────────

export type ExamDeviceClaim =
  /** device の内容を fingerprint として申告できる。 */
  | { readonly state: 'claimed'; readonly observation: ExamSyncObservation }
  /** 正しく読めて、内容が無い。 */
  | { readonly state: 'empty' }
  /** 申告できない（読めない / 意味を確定できない）。E-S2 の unclaimed。 */
  | {
      readonly state: 'unclaimed';
      readonly reason: ExamDeviceReadFailure | ExamDeviceUnclaimableReason;
    };

/**
 * device source の read 結果 → claim（純関数）。
 *
 * ★ 返すのは claim だけで、採用側も「どちらが新しいか」も返さない ★
 */
export function buildDeviceClaim<K extends ExamSyncSupportedKind>(
  kind: K,
  read: ExamDeviceSourceState<ExamDeviceDomainByKind[K]>,
): ExamDeviceClaim {
  if (read.state === 'unreadable') return { state: 'unclaimed', reason: read.reason };
  if (read.state === 'absent') return { state: 'empty' };

  const build = EXAM_DEVICE_VIEW_BUILDERS[kind] as (
    value: ExamDeviceDomainByKind[K],
  ) => ExamDeviceViewResult;
  const result = build(read.value);
  if (!result.ok) return { state: 'unclaimed', reason: result.reason };

  return {
    state: 'claimed',
    observation: examSyncObservation({ kind, source: 'device_canonical', view: result.view }),
  };
}

/**
 * claim → Wave 2 の candidate。
 * 新しい候補型を作らず、既存 `deviceCanonicalCandidate` の contract に載せる。
 */
export function deviceClaimToCandidate(claim: ExamDeviceClaim): ExamSyncCandidate {
  if (claim.state === 'unclaimed') {
    return deviceCanonicalCandidate({ claimPresented: false, observation: null });
  }
  if (claim.state === 'empty') {
    return deviceCanonicalCandidate({ claimPresented: true, observation: null });
  }
  return deviceCanonicalCandidate({ claimPresented: true, observation: claim.observation });
}

/**
 * 注入された reader 群から 1 kind の candidate を作る（純関数）。
 * reader が I/O を持つかどうかは呼び出し側の責務で、本 file は関知しない。
 */
export function readDeviceCandidate<K extends ExamSyncSupportedKind>(
  kind: K,
  readers: ExamDeviceSourceReaders,
): ExamSyncCandidate {
  return deviceClaimToCandidate(buildDeviceClaim(kind, readers[kind]()));
}
