// rewrite/[id] v3: 「改善ポイント card」の見出しに、analysis レポート由来の essay-specific
// な指摘文（StatementResult.weaknesses / actions）を出すための pure keyword matcher。
//
// 背景:
//   StatementResult.weaknesses / actions は flat な string[] で axis 情報が付随しない。
//   一方 rewrite/[id] のカードは getImprovementSuggestions(items, 3) の axis 単位で出すため、
//   AI 出力テキストを各 axis に「どれが一番その軸の話っぽいか」で振り分ける必要がある。
//
// 設計:
//   - 各 axis ごとに日本語 keyword リストを定義（軸固有の語に絞り、共通語は外す）
//   - text 内の出現回数を合算して score。score 最大の candidate を greedy に割り当て
//   - 重複防止のため一度割り当てた candidate は他 axis から使わない（used set）
//   - score 0 の axis には null を返し、呼び出し側で
//     IMPROVEMENT_REASONINGS / IMPROVEMENT_COMMENTS の generic 文に fallback する
//
// 重要:
//   - AI call は一切しない。pure function。SSR / test で安全に評価可能
//   - keyword は緩い heuristic（誤割当は起きうる）。最悪でも fallback で generic 説明が出るので
//     UX が壊れない設計にしている
//
// 軸優先度は呼び出し側で決まる（getImprovementSuggestions は diff 降順）。greedy 順は
// 「より直すべき軸」が先に良い candidate を取る挙動になる。

const AXIS_KEYWORDS: Record<string, readonly string[]> = {
  // 「大学」「将来」など個別軸の枠を越えて頻出する一般語は意図的に外し、
  // 軸固有の指摘で使われやすい語に絞る。
  logic: [
    '論理', '構造', '流れ', '結論', '主張', '因果',
    '一貫', '展開', '段落', '順序', '前提', '飛躍',
    '冒頭',
  ],
  specificity: [
    '具体', '抽象', '経験', 'エピソード', '描写',
    '詳細', '読み取', '伝わりにく', '行動', '感情',
    '情景',
  ],
  universityFit: [
    'なぜこの大学', '大学との', '学部', '学科',
    'カリキュラム', 'ゼミ', '教授', '研究室',
    '授業名', 'シラバス', '一致', '接続',
  ],
  futureGoal: [
    '将来', '目標', '卒業後', '職業', 'キャリア',
    '進路', 'ビジョン', '展望', 'やりたいこと',
  ],
  originality: [
    '独自', '個性', 'オリジナリティ', '差別化',
    '独創', '誰でも', '一般的', '紋切',
  ],
};

function scoreText(text: string, axisId: string): number {
  const kws = AXIS_KEYWORDS[axisId] ?? [];
  let total = 0;
  for (const kw of kws) {
    let i = 0;
    for (;;) {
      const idx = text.indexOf(kw, i);
      if (idx === -1) break;
      total += 1;
      i = idx + kw.length;
    }
  }
  return total;
}

/**
 * candidates（weaknesses / actions 等）を axisIds に対して greedy に割り当てる。
 * - 同一 text は最大 1 度しか使われない（カード間の重複防止）
 * - 戻り値 record の値が null の axis は「該当 candidate なし → fallback 必要」
 * - 副作用なし・deterministic。candidates / axisIds の順序を保ったまま 1 passes
 */
export function pickAnalysisForAxes(
  candidates: readonly string[],
  axisIds: readonly string[],
): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  const used = new Set<number>();
  for (const axisId of axisIds) {
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < candidates.length; i++) {
      if (used.has(i)) continue;
      const c = candidates[i] ?? '';
      if (c.length === 0) continue;
      const s = scoreText(c, axisId);
      if (s > bestScore) {
        bestScore = s;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      used.add(bestIdx);
      result[axisId] = candidates[bestIdx] ?? null;
    } else {
      result[axisId] = null;
    }
  }
  return result;
}
