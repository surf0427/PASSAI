// 活動カテゴリの key → 表示ラベルと、件数サマリの単一情報源（純粋・依存なし）。
//
// ★ なぜ 1 箇所に集めるか ★
//   同じ 10 カテゴリの label map が
//     lib/contextBuilders/tutorContext.ts       （Supabase 由来 section）
//     lib/contextBuilders/tutorStudentContext.ts（body 由来 section）
//   に **同一内容で 2 つ**存在していた。さらに Canonical Exam Context 側の
//   activity block も同じ集計を必要とする。3 箇所に散ると、カテゴリ追加や
//   ラベル変更のときに **同じ活動データから違う prompt が出る**。
//
//   Stage 5.2 の診断 hint 表（lib/examDiagnosis/tutorHints.ts）と同じ方針で、
//   legacy / canonical の双方が通る 1 関数へ寄せる。
//
// ★ ActivityData の field 名と一致させること ★
//   key は `types/activity.ts` の ActivityData の配列 field 名そのもの。
//   ここに無い key は集計されない（＝ prompt に出ない）。
//
// 純関数のみ。I/O / storage / Date / Math.random 非依存（isomorphic）。

/** 活動カテゴリ key → 表示ラベル。宣言順がそのまま出力順になる。 */
export const ACTIVITY_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  clubActivities: '部活動',
  volunteerActivities: 'ボランティア',
  studyAbroadActivities: '留学',
  researchActivities: '探究',
  partTimeJobActivities: 'アルバイト',
  certificationActivities: '資格',
  contestActivities: 'コンテスト',
  readingActivities: '読書',
  hobbyActivities: '趣味',
  otherActivities: 'その他',
};

export type ActivityCategorySummary = {
  /** 表示ラベル → 件数。件数 0 のカテゴリは含めない。宣言順を保つ。 */
  readonly categoryCounts: Readonly<Record<string, number>>;
  readonly totalCount: number;
};

/**
 * 活動 payload → カテゴリ別件数サマリ（純関数）。
 *
 * ★ 本文を読まない ★
 *   各カテゴリの配列は **長さだけ**を見る。活動名 / テーマ / 説明といった
 *   narrative は戻り値に現れないので、呼び出し側が誤って prompt へ載せる経路が無い。
 *
 * 合計 0 件なら `null`（＝ 活動セクションを出さない）。
 * legacy はこの状態で行ごと省略しており、代替文言を出さない。
 */
export function summarizeActivityCategories(
  payload: Record<string, unknown> | null | undefined,
): ActivityCategorySummary | null {
  if (!payload) return null;
  const categoryCounts: Record<string, number> = {};
  let totalCount = 0;
  for (const key of Object.keys(ACTIVITY_CATEGORY_LABELS)) {
    const arr = payload[key];
    if (Array.isArray(arr) && arr.length > 0) {
      categoryCounts[ACTIVITY_CATEGORY_LABELS[key]] = arr.length;
      totalCount += arr.length;
    }
  }
  if (totalCount === 0) return null;
  return { categoryCounts, totalCount };
}

/**
 * サマリ → legacy と同じ 1 行表現。
 * `部活動2件・ボランティア1件 が保存されています（計3件）` の「値」部分だけを作る。
 * 前後の定型句は section 側の書式なのでここには含めない。
 */
export function formatActivityCategoryCounts(summary: ActivityCategorySummary): string {
  return Object.entries(summary.categoryCounts)
    .map(([label, n]) => `${label}${n}件`)
    .join('・');
}
