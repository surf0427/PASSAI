// StudentProfile → BaseStudentContext の placeholder helper（skeleton・現時点で消費者なし）。
//
// 役割:
//   StudentProfile を canonical な最小 context に写す deterministic 関数。
//   feature builder が「共通のスタート地点」として import するための受け皿。
//
// 現状:
//   どこからも import されていない（STEP-CB-0 で skeleton のみ作成）。
//   実 builder が必要としたタイミングで採用する。早期に消費しないことで、
//   shape 変更時の影響範囲を 0 のまま保つ。
//
// 制約:
//   - 純粋関数（AI / fetch / storage 直読み禁止）
//   - StudentProfile を mutate しない
//   - null safe（profile=null なら null を返す）
//
// 関連: lib/contextBuilders/README.md / lib/studentProfileStorage.ts

import type { StudentProfile } from '@/types/studentProfile';
import type { BaseStudentContext } from './types';

export function buildBaseStudentContext(
  profile: StudentProfile | null,
): BaseStudentContext | null {
  if (!profile) return null;
  return {
    summary: profile.summary,
    strengths: profile.strengths,
    weaknesses: profile.weaknesses,
    futureConnections: profile.futureConnections,
    valueKeywords: profile.valueKeywords,
    signatureEpisodes: profile.signatureEpisodes,
  };
}
