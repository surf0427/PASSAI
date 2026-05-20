/*
 * scripts/infer-analysis-type-dry-run.ts
 *
 * inferAnalysisType()（lib/analysis/inferAnalysisType.ts）の判定品質を
 * console で目視確認するための軽量ドライラン。AI は呼ばない。
 *
 * 目的:
 *   keyword 群や語彙バランスを編集したときに「どの sample がどの type に
 *   倒れるか」を即時確認し、判定の偏り / 取り逃し / null 落ち を可視化する。
 *
 * 使い方:
 *   npx tsx scripts/infer-analysis-type-dry-run.ts
 *
 * 設計方針:
 *   - production code は触らない（inferAnalysisType / SummaryResult を import のみ）
 *   - 実 AI 呼び出しなし・ネットワーク不要・tmp/ への書き込みなし
 *   - 失敗時 process.exit せず、case ごとの PASS/FAIL と総数を末尾に出すだけ
 *   - sample は SummaryResult の実形状（plain string × 3 フィールド）に合わせる
 */

import {
  inferAnalysisType,
  type InferAnalysisTypeResult,
} from '../lib/analysis/inferAnalysisType';
import type { SummaryResult } from '../types/analysis';
import type { DiagnosisType } from '../types/diagnosis';

// ── 型名マッピング ──────────────────────────────────────────────

const TYPE_LABELS: Record<DiagnosisType, string> = {
  1: '活動アピール型',
  2: '探究・研究型',
  3: '将来ビジョン型',
  4: '成長ポテンシャル型',
};

const ALL_TYPES: DiagnosisType[] = [1, 2, 3, 4];

// ── サンプル定義 ───────────────────────────────────────────────
// expected は「人間が読んでどう判定されるべきか」の期待値。
// null は「語彙が薄くて inferAnalysisType が null を返すべき」ケース。

type Sample = {
  id: string;
  label: string;
  expected: DiagnosisType | null;
  summary: SummaryResult;
};

const SAMPLES: Sample[] = [
  // ── 純度高めの 4 タイプ ─────────────────────────────────
  {
    id: 'pure-activity',
    label: '活動アピール型（部活＋ボランティア＋留学）',
    expected: 1,
    summary: {
      activitySummary:
        '高校では部活動でサッカー部のキャプテンを務め、チームをまとめてきた。地域のボランティアにも継続して参加し、課外活動として留学プログラムにも挑戦した。',
      strengths:
        '部活やチームでの実績を通じて、リーダーとして行動できる点が強みです。',
      appealPoints:
        '大会での受賞や、ボランティア活動での具体的な行動量をアピールできます。',
    },
  },
  {
    id: 'pure-research',
    label: '探究・研究型（社会課題への問題意識）',
    expected: 2,
    summary: {
      activitySummary:
        '高校の探究の授業で「地方の人口減少」という社会課題に興味を持ち、原因を調べた。問題意識を深めるために関連書籍を読み、地域の方にもインタビューを行った。',
      strengths:
        '関心のあるテーマを深く分析し、なぜそうなるのかを考察できる点が強みです。',
      appealPoints:
        '大学では地域経済の仕組みをさらに研究し、学びたい分野を絞り込みたい。',
    },
  },
  {
    id: 'pure-vision',
    label: '将来ビジョン型（医師というキャリア像）',
    expected: 3,
    summary: {
      activitySummary:
        '将来は医療現場で社会で役立つ職業に就きたいと考えている。父の闘病をきっかけに、医師というキャリアを志すようになった。',
      strengths:
        '目標がはっきりしており、なりたい将来像から逆算して行動できる点が強みです。',
      appealPoints:
        '大学での学びを通じて、地域医療に貢献するというビジョンを実現したい。',
    },
  },
  {
    id: 'pure-growth',
    label: '成長ポテンシャル型（苦手の克服）',
    expected: 4,
    summary: {
      activitySummary:
        '中学までは人前で話すのが苦手だったが、高校で生徒会の挑戦を通じて少しずつ変わった。失敗もあったが努力を続け、克服できた経験がある。',
      strengths:
        '苦手なことから逃げず、変化や成長の過程を言葉にできる点が強みです。',
      appealPoints:
        'これから大学でさらに挑戦し、伸びていきたい気持ちが強みです。',
    },
  },

  // ── 境界 / 混合ケース ──────────────────────────────────
  // 「どちらに倒れるか」を観察する目的なので expected は仮置き。
  // 倒れ方が想定と違うときの傾向分析に使う。
  {
    id: 'mix-activity-vision',
    label: '活動 × 将来（実績の上に将来像）',
    expected: 1,
    summary: {
      activitySummary:
        '部活動で全国大会に出場し、チームでの実績を作った。将来は教員になりたいと考えている。',
      strengths:
        'リーダー経験と、教員という目標が両方ある点が強みです。',
      appealPoints: '実績を活かして、将来のキャリアにつなげていきたい。',
    },
  },
  {
    id: 'mix-research-growth',
    label: '探究 × 成長（苦手を分析的に克服）',
    expected: 2,
    summary: {
      activitySummary:
        '数学が苦手だったが、なぜ解けないのかを分析する過程で興味が湧き、探究的に学ぶようになった。',
      strengths:
        '苦手を克服する過程で、分析や考察を深められるようになった点が強み。',
      appealPoints: '大学では数学のより深い仕組みを学びたい。',
    },
  },

  // ── スパース / 抽象（null 期待）─────────────────────────
  {
    id: 'sparse-vague',
    label: '語彙が抽象的で取り掛かりが少ないケース',
    expected: null,
    summary: {
      activitySummary: '日々を大切に過ごしてきた。',
      strengths: '前向きなところ。',
      appealPoints: 'これから頑張りたい。', // 「これから」は GROWTH に拾われる想定
    },
  },
  {
    id: 'empty',
    label: '完全空（保存直後など）',
    expected: null,
    summary: { activitySummary: '', strengths: '', appealPoints: '' },
  },
];

// ── 出力ヘルパ ──────────────────────────────────────────────────

const SEP = '━'.repeat(60);

function padLabel(s: string, width: number): string {
  // 全角を 2 幅で扱う簡易整形
  let w = 0;
  for (const ch of s) {
    w += /[　-鿿＀-｠]/.test(ch) ? 2 : 1;
  }
  return s + ' '.repeat(Math.max(0, width - w));
}

function expectedLabel(expected: DiagnosisType | null): string {
  return expected === null
    ? 'null (判定不能を期待)'
    : `${expected} ${TYPE_LABELS[expected]}`;
}

function renderSample(
  sample: Sample,
  result: InferAnalysisTypeResult | null,
): { passed: boolean; lines: string[] } {
  const lines: string[] = [];
  lines.push(SEP);
  lines.push(`Sample:   ${sample.label}   [id=${sample.id}]`);
  lines.push(`Expected: ${expectedLabel(sample.expected)}`);

  if (result === null) {
    lines.push(`Predicted: null (maxScore < MIN_SCORE)`);
    const passed = sample.expected === null;
    lines.push(`Result:    ${passed ? 'PASS' : 'FAIL'}`);
    return { passed, lines };
  }

  lines.push(`Predicted: ${result.type} ${TYPE_LABELS[result.type]}`);
  lines.push('');
  lines.push('Scores:');
  for (const t of ALL_TYPES) {
    lines.push(`  ${padLabel(`${t} ${TYPE_LABELS[t]}`, 22)}: ${result.scores[t]}`);
  }
  lines.push('');
  lines.push('Matched keywords:');
  let anyMatch = false;
  for (const t of ALL_TYPES) {
    const matched = result.matchedKeywords[t];
    if (matched.length === 0) continue;
    anyMatch = true;
    lines.push(
      `  ${padLabel(`${t} ${TYPE_LABELS[t]}`, 22)}: ${matched.join(', ')}`,
    );
  }
  if (!anyMatch) lines.push('  (none)');

  const passed = sample.expected === result.type;
  lines.push('');
  lines.push(`Result:    ${passed ? 'PASS' : 'FAIL (expected と異なる)'}`);
  return { passed, lines };
}

// ── main ───────────────────────────────────────────────────────

function main(): void {
  console.log('');
  console.log('inferAnalysisType dry-run');
  console.log('');

  let pass = 0;
  let fail = 0;

  for (const sample of SAMPLES) {
    const result = inferAnalysisType(sample.summary);
    const { passed, lines } = renderSample(sample, result);
    console.log(lines.join('\n'));
    if (passed) pass++;
    else fail++;
  }

  console.log(SEP);
  console.log(
    `Summary: ${pass} PASS / ${fail} FAIL  (total ${SAMPLES.length})`,
  );
  console.log('');
  // exit code は立てない。CI 連携が必要になったら caller 側で判断する。
}

main();
