// PASSAI 受験版 Exam Spine — Stage 4 revision / fingerprint（純関数のみ）。
//
// Canon §16 は revision と fingerprint を **別の概念**として定義している。
// 混同すると「内容が同じでも purpose が違えば別物」「purpose が同じなら
// 入力が変わっても同じ」のどちらかの誤りが起きるため、役割を固定する。
//
//   revision     … **入力状態**の識別子。
//                  「どの source の、どの論理状態から作ったか」。
//                  purpose / block 選択 / render には依存しない。
//                  → 同じユーザーデータなら、tutor 用でも matching 用でも同じ revision。
//
//   fingerprint  … **出力 context**の識別子。
//                  consumer が実際に受け取るものが同一かを比較する。
//                  revision ＋ purpose ＋ block 構成 ＋ origin に依存する。
//                  → 同じ revision でも purpose が違えば別 fingerprint。
//
// 決定性の要件（Canon §16 / Stage 4 §13）:
//   - 同一入力 → 同一値
//   - key の宣言順・呼び出し側の配列順で変わらない（正規化してから hash する）
//   - request 時刻 / Request object identity で変わらない（clock も random も使わない）
//   - 意味のある canonical data が変われば必ず変わる
//
// hash は sync core の `examFingerprint`（安定 serialization ＋ SHA-256）を使う。
// **ここで別の hash 実装を作らない**（E-P9 / 単一 authority）。

import { examFingerprint, type ExamFingerprint } from '../sync/fingerprint';
import { EXAM_SOURCE_KINDS } from '../sourceData/types';
import type { ExamSourceKind } from '../sourceData/types';
import type { ExamContextBlock } from '../blocks/types';
import type { ExamContextPurpose } from '../types';
import { EXAM_CONTEXT_VERSION } from './types';
import type { ExamSourceProvenance } from './types';

/** revision / fingerprint の入力に使う版。混ぜると意味が変わるので context 版とは別に持つ。 */
export const EXAM_CONTEXT_IDENTITY_VERSION = 'eci1';

/**
 * 入力状態の識別子（revision）。
 *
 * 含めるもの:
 *   kind / state / source fingerprint / revision form / rowCount / truncated
 * 含めないもの:
 *   purpose / block / origin / render / 時刻 / userId
 *
 * ★ 生の値を 1 つも含めない ★
 *   source の内容は既に `fingerprint`（sync adapter の正規化 view の SHA-256）へ
 *   畳まれている。したがって本文・氏名・小論文が hash 入力に現れる経路が無い。
 *   fingerprint を持たない kind（adapter 未対応 / 未取得）は `null` として
 *   「識別できない」ことを明示する（適当な代替値で埋めない）。
 *
 * ★ 順序は EXAM_SOURCE_KINDS で固定 ★
 *   呼び出し側が sources を何順で渡しても同じ revision になる。
 */
export function computeContextRevision(
  sources: readonly ExamSourceProvenance[],
): ExamFingerprint {
  const byKind = new Map<ExamSourceKind, ExamSourceProvenance>();
  for (const s of sources) byKind.set(s.kind, s);

  const material = {
    v: EXAM_CONTEXT_IDENTITY_VERSION,
    sources: EXAM_SOURCE_KINDS.map((kind) => {
      const s = byKind.get(kind);
      if (!s) return { kind, state: 'unsupported' as const, fp: null, rev: 'absent', rows: 0, trunc: false };
      return {
        kind,
        state: s.state,
        fp: s.fingerprint,
        rev: s.revision.form,
        rows: s.rowCount,
        trunc: s.truncated,
      };
    }),
  };
  return examFingerprint(material);
}

export type ExamContextFingerprintResult = {
  readonly fingerprint: ExamFingerprint;
  /** hash に渡した正規化材料のバイト数（性能記録用 / Stage 4 §22）。 */
  readonly inputBytes: number;
};

/**
 * 出力 context の識別子（fingerprint）。
 *
 * ★ block の本文をそのまま hash 材料に載せない ★
 *   block content は prompt 文字列そのものであり、氏名・志望理由書・小論文の断片を含む。
 *   これを材料 object に入れると、その object を誤って log / diagnostics へ出した瞬間に
 *   PII 露出になる（E-S13）。そこで content は **先に 1 段 hash してから**載せる。
 *   情報は落ちない（content が 1 文字変われば block fingerprint が変わる）。
 *
 * 含めるもの:
 *   version / purpose / revision / allowedSources /
 *   block（id・presence・origin・provenance・derivation・content の fingerprint・長さ）/
 *   source（kind・state・origin・contribution・bridgeFields）
 */
export function computeContextFingerprint(input: {
  readonly purpose: ExamContextPurpose;
  readonly revision: ExamFingerprint;
  readonly allowedSources: readonly ExamSourceKind[];
  readonly blocks: readonly ExamContextBlock[];
  readonly sources: readonly ExamSourceProvenance[];
}): ExamContextFingerprintResult {
  const byKind = new Map<ExamSourceKind, ExamSourceProvenance>();
  for (const s of input.sources) byKind.set(s.kind, s);

  const material = {
    v: EXAM_CONTEXT_IDENTITY_VERSION,
    ctx: EXAM_CONTEXT_VERSION,
    purpose: input.purpose,
    revision: input.revision,
    // 許可集合は宣言順に依存させない。
    allowed: [...input.allowedSources].sort(),
    // block は plan の宣言順が意味を持つ（順序が変われば prompt が変わる）ため sort しない。
    blocks: input.blocks.map((b) => ({
      id: b.id,
      presence: b.presence,
      origin: b.origin,
      provenance: b.provenance,
      derivation: b.derivation,
      // ★ 本文ではなく本文の fingerprint。
      content: examFingerprint(b.content),
      chars: b.content.length,
    })),
    sources: EXAM_SOURCE_KINDS.map((kind) => {
      const s = byKind.get(kind);
      return s
        ? {
            kind,
            state: s.state,
            origin: s.origin,
            contribution: s.contribution,
            bridgeFields: [...s.bridgeFields].sort(),
          }
        : { kind, state: 'unsupported' as const, origin: 'bridge' as const, contribution: 'none' as const, bridgeFields: [] };
    }),
  };

  return {
    fingerprint: examFingerprint(material),
    inputBytes: JSON.stringify(material).length,
  };
}

/**
 * subject（誰の context か）の識別子。
 * ★ userId そのものを context にも log にも持たせない（E-S13）。
 *   domain separator を付けて hash し、他用途の hash と衝突しないようにする。
 */
export function computeSubjectFingerprint(userId: string): ExamFingerprint {
  return examFingerprint({ v: EXAM_CONTEXT_IDENTITY_VERSION, subject: userId });
}
