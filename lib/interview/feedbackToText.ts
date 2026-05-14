// 面接フィードバック JSON → improvementSummary 文字列フォーマッタ。
//
// 役割:
//   /api/interview-feedback の POST handler が AI から受け取った InterviewFeedback を
//   InterviewHistoryCard の parseImprovementSummary が解釈する ①〜⑦ セクション形式に
//   整形する純粋関数群。
//
// 切り出し経緯:
//   元は app/api/interview-feedback/route.ts に同居していたが、route.ts が 653 行に肥大化し
//   Claude Code の context / diff を圧迫していたため切り出した。AI 呼び出し経路 / parser /
//   normalize / POST handler とは無関係の formatter 層なので、純粋関数として独立できる。
//
// 注意:
//   - 出力フォーマット（①〜⑦ セクション見出し記号、改行構造）を変えてはいけない。
//     InterviewHistoryCard の parseImprovementSummary が見出し番号でセクションを判別し
//     色分けする UI 仕様に直接結びついている。
//   - 過去に保存された improvementSummary はこのフォーマットで localStorage に
//     存在するため、後方互換維持のためにも文言は不変条件。

import type { InterviewFeedback, Level, LevelEvaluation } from '@/types/interview';

// JSON → 既存 improvementSummary 文字列に変換する。
// InterviewHistoryCard の既存パーサー（①〜⑥ の行走査）と互換性を保つ形式にする。
const LEVEL_LABEL: Record<Level, string> = {
  weak: '弱い',
  normal: '普通',
  strong: '強い',
};

const LEVEL_AXES: [keyof LevelEvaluation, string][] = [
  ['logical', '論理性'],
  ['concrete', '具体性'],
  ['consistency', '一貫性'],
  ['originality', '独自性'],
  ['interviewReadiness', '面接完成度'],
];

function levelToNumber(level: Level): number {
  if (level === 'weak') return 0;
  if (level === 'normal') return 1;
  return 2;
}

function formatLevelEvaluation(lv: LevelEvaluation, index: number): string {
  return [
    `【質問${index + 1} レベル評価】`,
    `論理性：${LEVEL_LABEL[lv.logical]}`,
    `具体性：${LEVEL_LABEL[lv.concrete]}`,
    `一貫性：${LEVEL_LABEL[lv.consistency]}`,
    `独自性：${LEVEL_LABEL[lv.originality]}`,
    `面接完成度：${LEVEL_LABEL[lv.interviewReadiness]}`,
  ].join('\n');
}

// 前回フィードバックとの levelEvaluation を index ベースで比較する
function generateComparison(
  current: InterviewFeedback,
  previous: InterviewFeedback,
): string {
  let improved = 0;
  let unchanged = 0;
  let declined = 0;
  const perQBlocks: string[] = [];

  const count = Math.min(
    current.perQuestionFeedback.length,
    previous.perQuestionFeedback.length,
  );

  for (let i = 0; i < count; i++) {
    const currLv = current.perQuestionFeedback[i]?.levelEvaluation;
    const prevLv = previous.perQuestionFeedback[i]?.levelEvaluation;
    // 旧形式（levelEvaluation なし）の記録との比較はスキップ
    if (!currLv || !prevLv) continue;

    const lines: string[] = [`【質問${i + 1} 成長比較】`];
    for (const [key, label] of LEVEL_AXES) {
      const diff = levelToNumber(currLv[key]) - levelToNumber(prevLv[key]);
      const tag = diff > 0 ? '改善' : diff < 0 ? '悪化' : '変化なし';
      if (diff > 0) improved++;
      else if (diff < 0) declined++;
      else unchanged++;
      lines.push(`${label}：${LEVEL_LABEL[prevLv[key]]} → ${LEVEL_LABEL[currLv[key]]}（${tag}）`);
    }
    perQBlocks.push(lines.join('\n'));
  }

  if (perQBlocks.length === 0) return '';

  const summaryLines = [
    '今回の成長まとめ：',
    `・改善：${improved}項目`,
    `・変化なし：${unchanged}項目`,
  ];
  // 悪化は「改善の余地」として表現する
  if (declined > 0) summaryLines.push(`・改善の余地：${declined}項目`);

  return [summaryLines.join('\n'), ...perQBlocks].join('\n\n');
}

export function feedbackToText(
  feedback: InterviewFeedback,
  previousFeedback?: InterviewFeedback,
): string {
  const bullets = (items: string[]) => items.map((item) => `・${item}`).join('\n');

  const perQLines = feedback.perQuestionFeedback
    .map((q, i) =>
      [
        `【質問${i + 1}】\n質問：${q.question}\n回答：${q.answer}\n評価：${q.evaluation}\n改善点：${q.improvement}\nより良い回答例：${q.betterAnswer}`,
        formatLevelEvaluation(q.levelEvaluation, i),
      ].join('\n\n'),
    )
    .join('\n\n');

  const followUpLines = feedback.followUpQuestions
    .map(
      (f) =>
        `【質問${f.questionNumber}】\n元の質問：${f.originalQuestion}\n${f.followUps.map((q) => `・${q}`).join('\n')}`,
    )
    .join('\n\n');

  // 「結論ファースト UX」のため、ユーザーが最初に読むべき改善点・次の行動を先頭に置く。
  // セクション番号 ①〜⑥ は InterviewHistoryCard の parseImprovementSummary が
  // 見出しとして解釈するキー。色は番号で決まる（① 青 / ② 緑 …）。順序を変えると
  // 過去の保存データは旧順のまま、今後の保存データは新順で表示される。
  const sections = [
    `① まず直すべき改善点\n${bullets(feedback.improvements)}`,
    `② 次に練習すべきこと\n${bullets(feedback.nextPractice)}`,
    `③ 全体評価\n${feedback.overallEvaluation}`,
    `④ 良かった点\n${bullets(feedback.goodPoints)}`,
    `⑤ 質問ごとのフィードバック\n${perQLines}`,
    `⑥ 深掘りされそうな追加質問\n${followUpLines}`,
  ];

  if (previousFeedback) {
    const comparison = generateComparison(feedback, previousFeedback);
    if (comparison) sections.push(`⑦ 成長比較（前回との比較）\n${comparison}`);
  }

  return sections.join('\n\n');
}
