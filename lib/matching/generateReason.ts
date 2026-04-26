import type {
  University,
  StudentAnalysis,
  ScoreBreakdown,
  ScoreBreakdownItem,
  MatchingResult,
} from '@/types/matching';

// ── 強み説明文のテンプレート ────────────────────────────────────
// 項目ラベルごとに、具体的な説明文を返す。
// 生徒の strengths[0] を使ってできる限り具体化する。

function buildStrengthSentence(
  item: ScoreBreakdownItem,
  university: University,
  analysis: StudentAnalysis,
): string {
  const hint = analysis.strengths.length > 0 ? `「${analysis.strengths[0]}」などの` : '';

  const templates: Record<string, string> = {
    '主体性':
      `${hint}主体的な行動経験が、${university.name}の求める人物像と一致しています。`,
    '活動レベル':
      `${hint}活動実績（部活・ボランティアなど）が、${university.name}の評価する行動力と合っています。`,
    '探究の深さ':
      `${hint}探究的な取り組みが、${university.name}の重視するテーマ探究力と合致しています。`,
    '志望理由の一貫性':
      `志望理由が「${university.description}」という${university.name}の特色と方向性が一致しています。`,
    '評定平均':
      `これまでの学習実績が、${university.name}（${university.faculty}）の推薦基準を満たしています。`,
    '資格・検定':
      `取得した資格・検定が、${university.name}の重視する学習姿勢と一致しています。`,
    '学力':
      `基礎学力が、${university.name}（${university.faculty}）の推薦入試で求められる水準に近い状態です。`,
    '志望理由':
      `志望理由が、${university.name}（${university.faculty}）のアドミッションポリシーと合致しています。`,
  };

  return templates[item.label] ?? `あなたの「${item.label}」が、${university.name}の評価軸と合っています。`;
}

// ── 公開関数 ────────────────────────────────────────────────────

/**
 * 「一致点」と「課題点」を両方含むマッチ理由文を返す。
 * スコア内訳から最も合っている項目と最も不足している項目を使う。
 */
export function generateMatchReason(
  university: University,
  analysis: StudentAnalysis,
  breakdown: ScoreBreakdown,
): string {
  // contribution が高い順（最も合っている項目）
  const sorted = [...breakdown.items].sort((a, b) => b.contribution - a.contribution);
  const topItem = sorted[0];

  // 不足している項目のうち、ギャップが最大のもの
  const topWeakItem = breakdown.items
    .filter((item) => item.studentScore < item.required)
    .sort((a, b) => (b.required - b.studentScore) - (a.required - a.studentScore))[0];

  // 強みの文
  let reason = buildStrengthSentence(topItem, university, analysis);

  // 課題の文（不足がある場合のみ追加）
  if (topWeakItem) {
    const gap = topWeakItem.required - topWeakItem.studentScore;
    const severity = gap >= 3 ? '大きく不足している' : gap === 2 ? '不足している' : 'やや不足している';
    reason += `一方で、「${topWeakItem.label}」が${severity}点（あなた: ${topWeakItem.studentScore} / 大学要求: ${topWeakItem.required}）が課題になります。`;
  }

  return reason;
}

/**
 * 潜在マッチの場合に「なぜ志望校にないのにマッチするか」を説明する文を返す。
 */
export function generatePotentialMatchReason(
  university: University,
  analysis: StudentAnalysis,
): string {
  // 生徒の strengths と大学の tags で重なるものを探す
  const matchedTag = university.tags.find((tag) =>
    analysis.strengths.some((s) => s.includes(tag) || tag.includes(s)),
  );

  if (matchedTag) {
    return `志望校には含まれていませんが、あなたの「${matchedTag}」への関心が${university.name}の評価軸と一致しています。`;
  }

  // 重なりがない場合はスコアをベースにした汎用文
  return `志望校には含まれていませんが、あなたのプロフィールが${university.name}（${university.faculty}）の求める要件と高い適合度を示しています。`;
}

/**
 * スコア内訳から弱点を抽出する（最大2件、差が大きい順）。
 * 単なる不足ではなく「差の深刻度」も文に含める。
 */
export function extractWeaknesses(breakdown: ScoreBreakdown): string[] {
  return breakdown.items
    .filter((item) => item.studentScore < item.required)
    .sort((a, b) => (b.required - b.studentScore) - (a.required - a.studentScore))
    .slice(0, 2)
    .map((item) => {
      const gap = item.required - item.studentScore;
      const severity = gap >= 3 ? '大きく不足' : gap === 2 ? '不足' : 'やや不足';
      return `「${item.label}」が${severity}（あなた: ${item.studentScore} / 大学要求: ${item.required}）`;
    });
}

/**
 * 弱点から「何を・どうやって」改善するか具体的なアクションを返す（最大2件）。
 */
export function generateActionItems(weaknesses: string[]): string[] {
  // キーワード → 具体的アクションのマッピング
  const actionMap: { keyword: string; action: string }[] = [
    {
      keyword: '活動レベル',
      action: '参加中の活動で「いつ・何を・どうなった」を1つ書き出し、実績として言語化する',
    },
    {
      keyword: '探究の深さ',
      action: 'テーマを1つに絞り「仮説 → 調査 → 結論」の流れでA4 1枚にまとめる',
    },
    {
      keyword: '主体性',
      action: '「自分が発案・提案した」エピソードを1つ選び、きっかけ・行動・結果の順で整理する',
    },
    {
      keyword: '志望理由の一貫性',
      action: '志望校のアドミッションポリシーを読み、自分の経験と重なる言葉に線を引いて志望理由に組み込む',
    },
    {
      keyword: '評定平均',
      action: '直近の定期テストで1科目だけ集中対策し、提出物・小テストで平常点を積み上げる',
    },
    {
      keyword: '資格・検定',
      action: '志望学部に関連する検定（英検・漢検など）の目標級を設定し、3ヶ月の学習スケジュールを作る',
    },
    {
      keyword: '学力',
      action: '苦手科目の基礎問題集を1冊選んで終わらせ、模試で現状の偏差値を数字で確認する',
    },
    {
      keyword: '志望理由',
      action: '「この大学でしかできないこと」を1文で書く練習をし、大学の特色と自分の経験を結びつける',
    },
  ];

  const result: string[] = [];

  for (const weakness of weaknesses) {
    const matched = actionMap.find((m) => weakness.includes(m.keyword));
    if (matched && !result.includes(matched.action)) {
      result.push(matched.action);
    }
    if (result.length >= 2) break;
  }

  if (result.length === 0) {
    result.push('志望校のアドミッションポリシーを読み、自分の経験と重なる点を3つ書き出してみる');
  }

  return result;
}

/**
 * スコア内訳から「合っている点」を文章で返す（最大2件）。
 * MatchingResult の strengthPoints に使う。
 */
export function generateStrengthPoints(
  university: University,
  analysis: StudentAnalysis,
  breakdown: ScoreBreakdown,
): string[] {
  return breakdown.items
    .filter((item) => item.studentScore >= item.required)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 2)
    .map((item) => buildStrengthSentence(item, university, analysis));
}

/**
 * マッチング結果の1行要約を返す。
 */
export function generateMatchSummary(
  university: University,
  score: number,
  suggestionType: MatchingResult['suggestionType'],
): string {
  const level = score >= 80 ? '高相性' : score >= 60 ? '中相性' : '要強化';
  const typeLabel =
    suggestionType === '自分の志望校' ? '志望校' : suggestionType;
  return `${university.name}（${university.faculty}）: ${typeLabel} / ${level}（${score}点）`;
}
