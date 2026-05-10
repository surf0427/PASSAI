// 自己分析添削ページ → AI志望校マッチングページへ引き継ぐデータ型。
// 将来 Supabase に移行するときはこの型を API レスポンス型としても使える。

import type { BasicInfo } from './basicInfo';
import type { ActivityData } from './activity';
import type { SelfPR } from './selfPR';
import type { WallHittingResult } from './analysis';

export type AdmissionMatchingInput = {
  basicInfo: BasicInfo | null;
  activityData: ActivityData | null;
  selfPRs: SelfPR[];
  wallHittingResult: WallHittingResult | null;
  savedAt: string; // ISO string
};
