// PASSAI 受験版 Exam Spine — Stage 4 sync core / verification primitive。
//
// Canon §11–§15 の状態語彙（verified / mismatch / unclaimed / unreadable）を、
// **Authority 判断を一切含まずに** 表現するための純関数。
//
// ★★ この file が決めてはいけないこと ★★
//   - どちらが canonical か（Canon §32「Sync の目的は Authority を決めることではない」）
//   - 新しい方を採用する（Canon §31 で明示的に禁止。ordering API をここへ持ち込まない）
//   - mismatch のときに context へ入れるかどうか（= veto policy。kind ごとに固定する
//     契約であり Wave 2 以降。Canon §41）
//
//   本 file の関数は「2 つの representation の **関係**」だけを返す。採用側 / 復元元 /
//   fallback を返す API は存在しない。呼び出し側が `canonical` / `mirror` という label を
//   付けて渡すが、その label を作るのは Authority Contract であって本 file ではない。
//
// ★ 意図的に `compareRevision` を import しない ★
//   verification が順序を見られる状態にしておくと、いつか「新しい方を verified にする」
//   実装が生える。等値（revisionEquality）だけを使う構造にしてある。
//
// 非依存: I/O / clock / random / logging。

import type { ExamFingerprint, ExamFingerprintEquality } from './fingerprint';
import { fingerprintEquality } from './fingerprint';
import type { ExamRevisionValue, ExamRevisionEquality } from './revision';
import { ABSENT_REVISION, revisionEquality } from './revision';

// ── 候補 ──────────────────────────────────────────────────────────────
//
// 「読めなかった」「Authority 不明」「読めたが空」「読めて中身がある」を、
// 型の上で **同時に成立し得ない** 形にしてある。boolean を並べると
// `unreadable かつ empty` のような無意味な組み合わせが表現できてしまう（Canon §40）。
export type ExamSyncCandidate =
  /** Canon §15 — 読むべき source だが権限 / RLS / network / schema / parse で読めなかった。 */
  | { readonly state: 'unreadable' }
  /** Canon §14 — データは存在するが、どの Authority 契約に属するか確定できない。 */
  | { readonly state: 'unclaimed' }
  /** 正しく読めて、データが存在しない（Canon §40 の EMPTY。unreadable と別物）。 */
  | { readonly state: 'empty' }
  /** 正しく読めて、データが存在する。 */
  | {
      readonly state: 'present';
      /** 内容比較用。取れないときは null（null を「一致」に倒さない）。 */
      readonly fingerprint: ExamFingerprint | null;
      /** 論理状態。kind 固有の抽出規則は Wave 2 以降で、ここへは正規化済みの値が渡る。 */
      readonly revision: ExamRevisionValue;
    };

export const UNREADABLE_CANDIDATE: ExamSyncCandidate = { state: 'unreadable' };
export const UNCLAIMED_CANDIDATE: ExamSyncCandidate = { state: 'unclaimed' };
export const EMPTY_CANDIDATE: ExamSyncCandidate = { state: 'empty' };

export function presentCandidate(input: {
  fingerprint?: ExamFingerprint | null;
  revision?: ExamRevisionValue;
}): ExamSyncCandidate {
  return {
    state: 'present',
    fingerprint: input.fingerprint ?? null,
    revision: input.revision ?? ABSENT_REVISION,
  };
}

// ── 結果 ──────────────────────────────────────────────────────────────

export type ExamSyncStatus =
  | 'verified'
  | 'mismatch'
  | 'unclaimed'
  | 'unreadable'
  /**
   * 判定材料が足りない。verified でも mismatch でもない第 5 の状態。
   * これを mismatch へ寄せると「一致していないという証拠」が無いのに不一致を主張することになり、
   * verified へ寄せると未検証を検証済みと呼ぶことになる。どちらも contract 違反なので分ける。
   */
  | 'incomparable';

export const EXAM_SYNC_STATUSES = [
  'verified',
  'mismatch',
  'unclaimed',
  'unreadable',
  'incomparable',
] as const satisfies readonly ExamSyncStatus[];

export type ExamSyncSide = 'canonical' | 'mirror' | 'both';

export type ExamSyncPresenceSignal = 'both_present' | 'both_empty' | 'diverged' | 'unknown';

/** 判定の根拠を潰さずに残す。呼び出し側が「なぜその status か」を再説明できるようにする。 */
export type ExamSyncSignals = {
  readonly content: ExamFingerprintEquality;
  readonly revision: ExamRevisionEquality;
  readonly presence: ExamSyncPresenceSignal;
};

export type ExamSyncMismatchEvidence =
  /** 片方にデータがあり、もう片方に無い。 */
  | 'presence'
  /** fingerprint が異なる（= 内容が違う）。 */
  | 'fingerprint'
  /** 論理状態（revision）が異なる。内容一致でも Canon §13 により不一致として扱う。 */
  | 'revision';

export type ExamSyncIncomparableReason =
  /** どちらか（または両方）の fingerprint が無く、内容の同一性を主張できない。 */
  'fingerprint_missing';

export type ExamSyncVerification =
  | {
      readonly status: 'unreadable';
      readonly side: ExamSyncSide;
      readonly signals: ExamSyncSignals;
    }
  | {
      readonly status: 'unclaimed';
      readonly side: ExamSyncSide;
      readonly signals: ExamSyncSignals;
    }
  | {
      readonly status: 'mismatch';
      readonly evidence: ExamSyncMismatchEvidence;
      readonly signals: ExamSyncSignals;
    }
  | {
      readonly status: 'verified';
      /** `fingerprint` = 内容一致 / `both_empty` = 両方とも「空である」ことで一致。 */
      readonly agreement: 'fingerprint' | 'both_empty';
      readonly fingerprint: ExamFingerprint | null;
      readonly signals: ExamSyncSignals;
    }
  | {
      readonly status: 'incomparable';
      readonly reason: ExamSyncIncomparableReason;
      readonly signals: ExamSyncSignals;
    };

const NO_SIGNALS: ExamSyncSignals = {
  content: 'unknown',
  revision: 'unknown',
  presence: 'unknown',
};

function sideOf(canonicalHit: boolean, mirrorHit: boolean): ExamSyncSide {
  if (canonicalHit && mirrorHit) return 'both';
  return canonicalHit ? 'canonical' : 'mirror';
}

/**
 * 2 つの representation の関係を分類する純関数。
 *
 * 判定順（先に来るものが強い）:
 *   1. どちらかが unreadable → `unreadable`（Canon §15。空データとして扱わない）
 *   2. どちらかが unclaimed  → `unclaimed`（Canon §14。暗黙に AI へ渡さない）
 *   3. 両方 empty            → `verified` / both_empty
 *   4. 片方だけ empty        → `mismatch` / presence
 *   5. 両方 present:
 *        内容が違う                        → `mismatch` / fingerprint
 *        内容一致だが revision が違う       → `mismatch` / revision（Canon §13 をそのまま適用）
 *        内容一致で revision が矛盾しない   → `verified` / fingerprint（Canon §12）
 *        内容が比較不能で revision が違う   → `mismatch` / revision
 *        内容が比較不能                     → `incomparable` / fingerprint_missing
 *
 * ★ 返り値に「採用する側」は含まれない。verified 以外を context へ入れるかは別 layer の判断。
 */
export function verifyExamSourcePair(input: {
  /** Authority Contract が canonical と決めた側（本関数はその決定に関与しない）。 */
  readonly canonical: ExamSyncCandidate;
  /** Authority Contract が mirror と決めた側。 */
  readonly mirror: ExamSyncCandidate;
}): ExamSyncVerification {
  const { canonical, mirror } = input;

  if (canonical.state === 'unreadable' || mirror.state === 'unreadable') {
    return {
      status: 'unreadable',
      side: sideOf(canonical.state === 'unreadable', mirror.state === 'unreadable'),
      signals: NO_SIGNALS,
    };
  }

  if (canonical.state === 'unclaimed' || mirror.state === 'unclaimed') {
    return {
      status: 'unclaimed',
      side: sideOf(canonical.state === 'unclaimed', mirror.state === 'unclaimed'),
      signals: NO_SIGNALS,
    };
  }

  if (canonical.state === 'empty' && mirror.state === 'empty') {
    return {
      status: 'verified',
      agreement: 'both_empty',
      fingerprint: null,
      signals: { content: 'unknown', revision: 'unknown', presence: 'both_empty' },
    };
  }

  if (canonical.state === 'empty' || mirror.state === 'empty') {
    return {
      status: 'mismatch',
      evidence: 'presence',
      signals: { content: 'unknown', revision: 'unknown', presence: 'diverged' },
    };
  }

  const content = fingerprintEquality(canonical.fingerprint, mirror.fingerprint);
  const revision = revisionEquality(canonical.revision, mirror.revision);
  const signals: ExamSyncSignals = { content, revision, presence: 'both_present' };

  if (content === 'different') {
    return { status: 'mismatch', evidence: 'fingerprint', signals };
  }
  if (revision === 'different') {
    // 内容が同じでも「同じ論理状態」とは限らない。Canon §13 は revision の相違を
    // mismatch と定義しており、ここで verified を名乗ると検証の意味が薄くなる。
    return { status: 'mismatch', evidence: 'revision', signals };
  }
  if (content === 'equal') {
    return {
      status: 'verified',
      agreement: 'fingerprint',
      fingerprint: canonical.fingerprint,
      signals,
    };
  }
  return { status: 'incomparable', reason: 'fingerprint_missing', signals };
}
