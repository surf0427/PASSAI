// PASSAI 受験版 Exam Spine — Stage 4 Canonical Exam Context の contract（型のみ）。
//
// Stage 3 の出力は「未 verify な server candidate」であって canonical context ではない（E-S17）。
// canonical になるには最低でも次を通す必要がある:
//
//   purpose gate → source read → block assembly → provenance/origin → status
//   → revision → fingerprint → veto
//
// 本 file は型と定数だけを持つ。I/O / env / Supabase / AI / Date / Math.random 非依存。
//
// 関連 Decision: E-S17 / E-S26（origin は kind 単位）/ E-S28（purpose gate）/
//               E-S1・E-S8（fail-open）/ E-S2・E-S3（Source-Sync の適用範囲）/
//               E-S12・E-S13（観測は enum のみ / PII を出さない）。

import type { ExamContextPurpose, ExamContextOrigin } from '../types';
import type { ExamSourceKind, ExamSourceReadStatus } from '../sourceData/types';
import type { ExamContextBlock, ExamContextBlockId } from '../blocks/types';
import type { ExamContextInput } from '../orchestrator/input';
import type { ExamFingerprint } from '../sync/fingerprint';
import type { ExamRevisionValue } from '../sync/revision';
import type { ExamSyncStatus } from '../sync/verification';

/** context contract の版。shape / 意味論を変えたら上げる。fingerprint 入力にも入る。 */
export const EXAM_CONTEXT_VERSION = 'ecx1';

// ── Source state ──────────────────────────────────────────────────────
//
// ★ read status（取得できたか）と sync verdict（信用してよいか）を **1 つの enum に混ぜない** ★
//   本 state は「context にとってその source が何であったか」という第 3 の軸であり、
//   readStatus / syncStatus は provenance 側に**別 field として**保持し続ける。
//
// Canon §40 が要求する区別を潰さないこと。次の 4 つは**すべて別状態**である:
//   DB が 0 行           → 'empty'
//   purpose が許可しない → 'denied_by_purpose'（read を 1 本も発行していない）
//   query が失敗した     → 'unreadable'
//   Spine が対応していない → 'unsupported'
export type ExamContextSourceState =
  /** 読めて内容があり、使ってよい。class 1 は Source-Sync が verified の場合のみここに来る。 */
  | 'available'
  /** 正常に読めたが内容が無い（新規ユーザー / 未入力）。Canon §40 EMPTY。 */
  | 'empty'
  /** purpose が許可していない（E-S28）。**query を発行していない**。 */
  | 'denied_by_purpose'
  /** 取得に失敗した（error / truncated / skipped）。Canon §40 UNREADABLE。EMPTY と潰さない。 */
  | 'unreadable'
  /** 読めたが Source-Sync が verified にならなかった（E-S2 の負の安全ゲート）。 */
  | 'unverified'
  /** Spine が対応していない kind（adapter 未実装 / block 未定義）。存在＝authority ではない（Canon §22）。 */
  | 'unsupported';

export const EXAM_CONTEXT_SOURCE_STATES = [
  'available',
  'empty',
  'denied_by_purpose',
  'unreadable',
  'unverified',
  'unsupported',
] as const satisfies readonly ExamContextSourceState[];

/** context がその source の値を実際に prompt へ載せたか。state とは別軸（載せられる state でも purpose が使わないことがある）。 */
export type ExamSourceContribution = 'block' | 'metadata_only' | 'none';

// ── Provenance ────────────────────────────────────────────────────────
//
// Canon §39。「AI が見た情報の由来を後から説明可能にする」ための記録。
// ★ 生のユーザー本文をここへ複製しない（E-S13 / E-P5）。数値・enum・fingerprint のみ。
export type ExamSourceProvenance = {
  readonly kind: ExamSourceKind;
  /** Canon §4 の authority class。kind 単位で固定（E-L2）。 */
  readonly authority: 'device_canonical_mirrored' | 'server_authoritative';
  /** その kind の read path に現れてよい table の全集合（E-S15）。 */
  readonly tables: readonly string[];
  readonly state: ExamContextSourceState;
  /** Stage 3 の read 結果。state とは別軸で保持する。 */
  readonly readStatus: ExamSourceReadStatus;
  /** Source-Sync の verdict。class 2（E-S3）と未対応 kind は null。 */
  readonly syncStatus: ExamSyncStatus | null;
  /** §Context Origin（E-S26）。kind 単位。 */
  readonly origin: ExamContextOrigin;
  /**
   * origin が 'server' でも **bridge から来た field**。
   * Canon §17 は Mixed-Origin 自体を禁じてはおらず、**暗黙的**な Mixed-Origin を禁じている。
   * 明示的に列挙することで許容される。現状の実例は basic_info の `name`（E-P8 / E-P4）。
   */
  readonly bridgeFields: readonly string[];
  /** その kind が寄与した block id（無ければ空）。 */
  readonly blocks: readonly ExamContextBlockId[];
  readonly contribution: ExamSourceContribution;
  /** server 側で読めた行数。値は含めない。 */
  readonly rowCount: number;
  /** cap に達したか（E-S8。freshness の権威にしない）。 */
  readonly truncated: boolean;
  /** この source の正規化 view の fingerprint。未対応 / 未取得なら null。 */
  readonly fingerprint: ExamFingerprint | null;
  /** 論理状態の識別子。現時点で全 kind `absent`（無い revision を生成しない）。 */
  readonly revision: ExamRevisionValue;
};

// ── Omission / diagnostics ────────────────────────────────────────────
//
// fail-open で source が落ちても context 全体は落とさない（E-S1）。
// ただし「何が / なぜ」落ちたかは機械的に説明できること。
// ★ raw user content を絶対にコピーしない。kind と reason code だけ。
export type ExamOmissionReason =
  | 'denied_by_purpose'
  | 'read_error'
  | 'read_truncated'
  | 'not_requested'
  | 'sync_unverified'
  | 'no_block_defined'
  | 'source_empty';

export type ExamContextOmission = {
  readonly kind: ExamSourceKind;
  readonly reason: ExamOmissionReason;
  readonly state: ExamContextSourceState;
};

// ── Veto ──────────────────────────────────────────────────────────────
//
// Canon §18。「読めたっぽいからとりあえず LLM へ渡す」を禁じる。
//
// ★ veto は contract 違反に対する gate であって、データが少ないことへの罰ではない ★
//   source が空 / 一部が読めない、は fail-open（E-S1）の対象であり veto しない。
//   veto するのは「その context を渡すと Architecture invariant が壊れる」ときだけ。
export type ExamVetoReason =
  /** registry に無い purpose（E-S28 default deny）。 */
  | 'unknown_purpose'
  /** server auth が解決できなかった / 認可されなかった（E-L3 / E-S7）。 */
  | 'unauthenticated'
  | 'unauthorized'
  /** purpose が許可していない kind が context に寄与している（E-S28 違反）。 */
  | 'forbidden_source_contribution'
  /** registry 外の table を読んだ（E-S15 / Canon §22 違反）。 */
  | 'unregistered_table'
  /** 寄与している source の provenance が欠けている（Canon §39 違反）。 */
  | 'provenance_incomplete'
  /** fingerprint を計算できなかった（identity を主張できない）。 */
  | 'fingerprint_unavailable';

export type ExamContextVeto =
  | { readonly vetoed: false }
  | { readonly vetoed: true; readonly reasons: readonly ExamVetoReason[] };

// ── Context status ────────────────────────────────────────────────────
//
//   ok        … 要求した source がすべて available / empty
//   partial   … 一部が unreadable / unverified / unsupported。使える source はある
//   degraded  … available な source が 1 つも無い。**それでも AI は続行できる**（fail-open）
//   vetoed    … consumer へ渡してはいけない
export type ExamContextStatus = 'ok' | 'partial' | 'degraded' | 'vetoed';

// ── Canonical context ─────────────────────────────────────────────────
//
// ★ 生データを持たない ★
//   `sources` は **metadata のみ**（state / status / count / fingerprint）で、値を持たない。
//   prompt へ載る文字列は `blocks` だけである。
//   これにより「block 化されていない kind の本文が context に紛れ込む」経路が
//   構造的に存在しなくなる（E-P5 / Canon §55。essay 本文の混入防止に直結する）。
export type CanonicalExamContext = {
  readonly version: typeof EXAM_CONTEXT_VERSION;
  readonly purpose: ExamContextPurpose;
  readonly status: ExamContextStatus;
  /**
   * identity boundary。**userId そのものは持たない**（E-S13）。
   * 認可済みであることと、その識別子の fingerprint だけを持つ。
   */
  readonly subject: {
    readonly authenticated: true;
    /** userId の fingerprint。log へ出しても user を復元できない。 */
    readonly subjectFingerprint: ExamFingerprint;
  };
  /** Stage 2 の frozen contract が返す block。prompt 文字列はここにしか無い。 */
  readonly blocks: readonly ExamContextBlock[];
  /** 10 kind すべてについて必ず 1 件返す（要求しなかった kind も state を持つ）。 */
  readonly sources: readonly ExamSourceProvenance[];
  /** purpose gate が許可した kind。 */
  readonly allowedSources: readonly ExamSourceKind[];
  /** 要求されたが purpose が許可しなかった kind（E-S28）。 */
  readonly deniedSources: readonly ExamSourceKind[];
  /** 入力状態の識別子。purpose / block 選択には依存しない。 */
  readonly revision: ExamFingerprint;
  /** 出力 context の識別子。revision ＋ purpose ＋ block 構成に依存する。 */
  readonly fingerprint: ExamFingerprint;
  readonly veto: ExamContextVeto;
  readonly omissions: readonly ExamContextOmission[];
  /** 観測用。number / boolean / enum のみ（E-S12 / E-S13）。 */
  readonly diagnostics: {
    readonly sourceQueryCount: number;
    readonly freshlyReadKinds: readonly ExamSourceKind[];
    readonly servedFromSnapshotKinds: readonly ExamSourceKind[];
    readonly blockCount: number;
    readonly presentBlockCount: number;
    readonly fingerprintInputBytes: number;
  };
};

import type { TutorBasicInfoSlot } from './tutorBasicInfoSlot';
import type { TutorActivitySlot } from './tutorActivitySlot';
import type { TutorDiagnosisSlot } from './tutorDiagnosisSlot';

/** veto されたときに consumer が受け取る形。blocks は空で返す（渡さない）。 */
export type CanonicalExamContextResult =
  | {
      readonly ok: true;
      readonly context: CanonicalExamContext;
      /**
       * ★ shadow / migration 専用の副産物（Stage 5.1）★
       *   assembler が bridge と server projection を解決した結果そのもの。
       *   **`CanonicalExamContext` の一部ではない**（context は生値を持たない / E-S29）。
       *
       *   用途は「legacy と canonical を比較する」ことだけで、prompt へ渡さない。
       *   比較器は値を hash 化してから entry に載せるため、raw 値はここから先へ出ない。
       *   consumer が prompt に使ってよいのは `context.blocks` のみである。
       */
      readonly shadowResolvedInput: ExamContextInputSnapshot;
      /**
       * ★ Stage 5 Packet 3 / E-S40 — tutor `basic_info` slot の canonical 供給 ★
       *   Source-Sync が verified で canary が許した場合にのみ非 null。
       *   **これを prompt へ直接載せてはいけない**。consumer 側の
       *   `decideTutorBasicInfoSlot` が legacy と突き合わせ、完全一致した場合だけ採用する
       *   （AI-visible 出力を変えないため）。
       */
      readonly tutorBasicInfoSlot: TutorBasicInfoSlot | null;
      /**
       * tutor の `activity` slot（E-S58）。basic_info slot と同じ扱いで、
       * **これを prompt へ直接載せてはいけない**。consumer 側の
       * `decideTutorActivitySlot` が legacy と突き合わせ、完全一致した場合だけ採用する。
       */
      readonly tutorActivitySlot: TutorActivitySlot | null;
      /**
       * tutor の `diagnosis` slot（E-S60）。他 slot と同じ扱いで、
       * **これを prompt へ直接載せてはいけない**。consumer 側の
       * `decideTutorDiagnosisSlot` が legacy と突き合わせ、完全一致した場合だけ採用する。
       */
      readonly tutorDiagnosisSlot: TutorDiagnosisSlot | null;
      /**
       * canonical が読んだ `diagnosis_logs.schema_version`（E-S59 の eligibility 判定用）。
       * ★ prompt / block の材料ではない ★ 値は writer contract の版であって受験生の情報を含まない。
       */
      readonly tutorDiagnosisSchemaVersion: string | null;
    }
  | {
      readonly ok: false;
      readonly veto: Extract<ExamContextVeto, { vetoed: true }>;
      readonly purpose: ExamContextPurpose | null;
    };

/**
 * shadow 比較のために公開する解決済み入力。
 * `ExamContextInput` を含むが、**context ではない**ことを型名で示す。
 *
 * ★ shadow 専用 slot ★
 *   `ExamContextInput`（＝ block builder が受け取る型）には入れない値を、
 *   ここにだけ足す。block へ流れない一方で comparator からは参照できる。
 *   これらは canonical の consumer contract ではない（E-S44）。
 */
export type ExamContextInputSnapshot = Readonly<ExamContextInput> & {
  /**
   * canonical rows から作った legacy 相当の「志望理由書の課題」行（E-S44）。
   * canonical 固有の反復論点（`previousOutputSummary`）とは別物。
   */
  readonly statementWeaknessLine?: string | null;
};
