// 面接練習の「成長メモ」型定義。
//
// 役割:
//   PASSAI 循環（面接練習 → 改善 → 再練習 → 成長実感）の
//   「再練習 → 成長実感」レーンを deterministic に表現するための中間型。
//   直近 2 件の面接 feedback を比較し、軸ごとの weak 件数差を出す。
//
// MVP スコープ:
//   - 軸は concrete / consistency のみ（PASSAI の循環の主軸）
//   - logical / originality / interviewReadiness は今回は扱わない
//   - 点数化・グラフ化はしない。件数 + 質的言語で「軽い振り返り」に留める
//
// 関連:
//   lib/interview/buildGrowthMemo.ts（本型を生成する deterministic builder）

export type GrowthAxis = 'concrete' | 'consistency';

export type GrowthDirection = 'improved' | 'unchanged' | 'declined';

export type GrowthAxisDelta = {
  axis: GrowthAxis;
  // UI に出す日本語ラベル（'具体性' / '一貫性'）
  label: string;
  // 前回 / 今回 の weak 件数
  prevWeakCount: number;
  currWeakCount: number;
  direction: GrowthDirection;
};

export type InterviewGrowthMemo = {
  // 前回 / 今回 の練習日（practiceDate 優先、空なら createdAt の YYYY-MM-DD）
  previousDate: string;
  currentDate: string;
  axisDeltas: GrowthAxisDelta[];
  // 最新 record の improvements の上位 2 件をそのまま採用
  remainingIssues: string[];
};
