// Server route 専用: HTTP request body から StudentProfile を取り出す helper。
//
// 優先順位:
//   1. body.studentProfile が isStudentProfile を満たすならそれを返す
//   2. fallbackSource が渡されていれば toStudentProfile(fallbackSource) を派生して返す
//   3. いずれにも当てはまらなければ null を返す
//
// 設計意図:
//   - 各 server route に分散していた 3 段 fallback の重複を 1 関数に寄せる
//   - throw しない（不正データは null に倒す）
//   - request は受け取らず、body と fallbackSource を引数で受ける
//     （HTTP I/O 層と純粋なロジックを分離する）
//
// client 用は lib/getStudentProfileForFeature.ts（localStorage 経由で canonical を引く）。
// 用途が異なる（client は storage を読む / server は body を読む）ため混ぜないこと。
//
// 関連: lib/studentProfileStorage.ts(isStudentProfile) /
//       lib/studentProfile.ts(toStudentProfile)

import type { WallHittingResult } from '@/types/analysis';
import type { StudentProfile } from '@/types/studentProfile';
import { isStudentProfile } from '@/lib/studentProfileStorage';
import { toStudentProfile } from '@/lib/studentProfile';

export type GetStudentProfileFromRequestInput = {
  // route が `await req.json()` で得た body。studentProfile field 以外は参照しない。
  body: { studentProfile?: unknown };
  // 旧経路の互換 fallback。null / undefined なら fallback に進まない。
  fallbackSource?: WallHittingResult | null;
};

export function getStudentProfileFromRequest(
  input: GetStudentProfileFromRequestInput,
): StudentProfile | null {
  if (isStudentProfile(input.body.studentProfile)) {
    return input.body.studentProfile;
  }
  if (input.fallbackSource) {
    return toStudentProfile(input.fallbackSource);
  }
  return null;
}
