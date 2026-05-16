// Context builder layer の共通型定義（skeleton・現時点で消費者なし）。
//
// 配置方針:
//   全 feature 共通の「canonical 中間表現」と「builder 関数型」だけを置く。
//   feature-specific な型は各 {feature}/ に閉じ込め、ここには引き上げない。
//
// 現状:
//   消費者は存在しない（STEP-CB-0 で skeleton のみ作成）。
//   実 builder が BaseStudentContext を必要としたタイミングで採用する。
//
// 関連: lib/contextBuilders/README.md / types/studentProfile.ts

import type { StudentProfile, SignatureEpisode } from '@/types/studentProfile';

// StudentProfile から直接派生する canonical 中間表現。
// feature builder が「最低限ここから始める」共通スナップショット。
// strings / arrays のみで構成し、format 済み文字列は持たない（format は feature 側の責務）。
export type BaseStudentContext = {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  futureConnections: string[];
  valueKeywords: string[];
  signatureEpisodes: SignatureEpisode[];
};

// feature context builder の関数シグネチャ。
// 戻り値 T は feature ごとに異なる（string / 構造体）。
// 純粋関数前提のため副作用・非同期は許可しない。
export type FeatureContextBuilder<T> = (profile: StudentProfile | null) => T;
