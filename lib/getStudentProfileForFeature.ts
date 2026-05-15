// 下流 feature（statement / interview / matching / essay / self-pr）が
// StudentProfile を取得するためのクライアント側 helper。
//
// 優先順位:
//   1. localStorage に保存済みの StudentProfile（canonical artifact）
//   2. 渡された WallHittingResult から toStudentProfile() で派生（旧経路の互換）
//   3. どちらも無ければ null
//
// 設計意図:
//   - 下流 feature は WallHittingResult を直接読まずに本関数を経由する。
//     これにより「自己分析が完了すれば下流は storage を見るだけで済む」関係に揃う
//   - WallHittingResult fallback は段階移行のための保険。canonical が保存されている
//     ケースでは fallback には到達しない
//   - サーバ API は localStorage を読めないので、本関数はクライアント専用。
//     サーバは body から studentProfile / wallHittingResult を受け取り、
//     好みのもの（studentProfile を優先）を直接使う
//
// 関連: lib/studentProfileStorage.ts / lib/studentProfile.ts(toStudentProfile)

import type { WallHittingResult } from '@/types/analysis';
import type { StudentProfile } from '@/types/studentProfile';
import { loadStudentProfile } from '@/lib/studentProfileStorage';
import { toStudentProfile } from '@/lib/studentProfile';

export type GetStudentProfileForFeatureInput = {
  // 旧経路の互換 fallback。null / undefined なら fallback に進まない。
  wallHittingResult?: WallHittingResult | null;
};

export function getStudentProfileForFeature(
  input: GetStudentProfileForFeatureInput = {},
): StudentProfile | null {
  // 1. 保存済み canonical を最優先
  const stored = loadStudentProfile();
  if (stored) return stored;

  // 2. 旧経路: WallHittingResult から派生
  if (input.wallHittingResult) {
    return toStudentProfile(input.wallHittingResult);
  }

  // 3. どちらも無ければ null
  return null;
}
