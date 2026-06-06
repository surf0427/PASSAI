/*
 * scripts/diagnosis-scoring-qa.ts
 *
 * 受験タイプ診断の判定ロジックの回帰テスト。
 *   Phase 1: 現行挙動（raw count + 小さい番号タイブレーク）の固定。
 *   Phase 2: normalized scoring + 安定タイブレークへ更新したため、本ファイルも更新。
 * AI は呼ばない。production code は import のみ。
 *
 * 使い方:  npx tsx scripts/diagnosis-scoring-qa.ts
 * 終了コード: 全 PASS → 0 / 1 件でも FAIL → 1
 *
 * DIAGNOSIS_QUESTIONS の option→type レイアウト（answer は option index）:
 *   Q1(idx0):[1,2,3,3]  Q2(idx1):[1,2,3,3]  Q3(idx2):[1,2,3,3]
 *   Q4(idx3):[4,4,3,1]  Q5(idx4):[1,2,3,3,3]
 *   採点対象は Q1/Q2/Q3/Q5（Q4 は type4 ショートサーキット専用）。
 *   面積（maxPossible）= {1:4, 2:4, 3:9, 4:0}
 */

import {
  calcDiagnosisResultType,
  computeDiagnosisScoreVector,
  computeMaxPossible,
  rankDiagnosisTypes,
  DIAGNOSIS_QUESTIONS,
} from '../lib/diagnosisScoring';
import { inferAnalysisType } from '../lib/analysis/inferAnalysisType';
import type { SummaryResult } from '../types/analysis';
import type { DiagnosisType } from '../types/diagnosis';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const TYPES: DiagnosisType[] = [1, 2, 3, 4];

// Phase 1 までの旧判定ロジック（分布比較・de-bias 検証用に再現）。
function calcResultTypeOld(answers: number[]): DiagnosisType {
  const q4 = DIAGNOSIS_QUESTIONS[3].options[answers[3]];
  if (q4.type === 4) return 4;
  const scores: Record<DiagnosisType, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  answers.forEach((ansIdx, qIdx) => {
    if (qIdx === 3) return;
    scores[DIAGNOSIS_QUESTIONS[qIdx].options[ansIdx].type]++;
  });
  let best: DiagnosisType = 1;
  if (scores[2] > scores[best]) best = 2;
  if (scores[3] > scores[best]) best = 3;
  return best;
}

console.log('=== diagnosis scoring QA (Phase 2: normalized scoring) ===\n');

// ── 0. 前提データ整合 / maxPossible ──
console.log('-- 0. 前提データ整合 --');
const layout = DIAGNOSIS_QUESTIONS.map((q) => q.options.map((o) => o.type));
const expectedLayout: DiagnosisType[][] = [
  [1, 2, 3, 3],
  [1, 2, 3, 3],
  [1, 2, 3, 3],
  [4, 4, 3, 1],
  [1, 2, 3, 3, 3],
];
check(
  'option→type レイアウトが想定と一致',
  JSON.stringify(layout) === JSON.stringify(expectedLayout),
);
const maxP = computeMaxPossible();
check(
  'maxPossible（面積）= {1:4,2:4,3:9,4:0}',
  maxP[1] === 4 && maxP[2] === 4 && maxP[3] === 9 && maxP[4] === 0,
  JSON.stringify(maxP),
);

// ── 1. Q4 type4 ショートサーキット（維持）──
console.log('\n-- 1. Q4 type4 ショートサーキット（維持）--');
check('Q4=idx0(type4) は他が全 type1 でも 4', calcDiagnosisResultType([0, 0, 0, 0, 0]) === 4);
check('Q4=idx1(type4) は他が全 type3 でも 4', calcDiagnosisResultType([2, 2, 2, 1, 2]) === 4);

// ── 2. Q4 非 type4 → normalized scoring（decisive は自分のタイプ）──
console.log('\n-- 2. Q4 非 type4 → normalized 判定 --');
check('全 type1 → 1', calcDiagnosisResultType([0, 0, 0, 2, 0]) === 1);
check('全 type2 → 2', calcDiagnosisResultType([1, 1, 1, 2, 1]) === 2);
check('全 type3 → 3（面積で割っても自分のタイプは勝つ）', calcDiagnosisResultType([2, 2, 2, 2, 2]) === 3);

// ── 3. type3 の面積が広くても過剰に有利にならない ──
console.log('\n-- 3. type3 面積偏りの是正 --');
{
  // raw{1:1,2:1,3:2}。旧 raw count では type3(2)が勝つ。
  const ans = [0, 2, 2, 3, 1];
  const old = calcResultTypeOld(ans);
  const neu = calcDiagnosisResultType(ans);
  check('旧ロジックでは type3 が勝っていた', old === 3, `old=${old}`);
  check('normalized では type3 は勝たない（面積で割られる）', neu !== 3, `new=${neu}`);
}

// ── 4. 空 / 不正入力は現行どおり throw ──
console.log('\n-- 4. 空 / 不正入力の throw（維持）--');
function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}
check('空配列は throw', throws(() => calcDiagnosisResultType([])));
check('長さ不足（Q4 未回答）は throw', throws(() => calcDiagnosisResultType([0, 0, 0])));
check('範囲外 option index は throw', throws(() => calcDiagnosisResultType([0, 0, 0, 2, 9])));

// ── 5. 安定タイブレーク（決定論的・小さい番号固定ではない）──
console.log('\n-- 5. 安定タイブレーク --');
// 5a. 同一 answers は常に同一結果
{
  const ans = [0, 0, 1, 2, 1];
  const a = calcDiagnosisResultType(ans);
  let stable = true;
  for (let i = 0; i < 50; i++) if (calcDiagnosisResultType(ans) !== a) stable = false;
  check('同一 answers は常に同一結果', stable, `result=${a}`);
}
// 5b. 完全同点で「最小番号固定」ではない（全 combo を走査）
{
  const lens = DIAGNOSIS_QUESTIONS.map((q) => q.options.length);
  let tieCount = 0;
  let winnerNotMin = 0;
  let winnerOutsideTied = 0;
  let nonDeterministic = 0;
  for (let a0 = 0; a0 < lens[0]; a0++)
    for (let a1 = 0; a1 < lens[1]; a1++)
      for (let a2 = 0; a2 < lens[2]; a2++)
        for (let a3 = 0; a3 < lens[3]; a3++)
          for (let a4 = 0; a4 < lens[4]; a4++) {
            const ans = [a0, a1, a2, a3, a4];
            // Q4 ショートサーキットは対象外（タイブレークが起きるのは非 type4 経路）
            if (DIAGNOSIS_QUESTIONS[3].options[a3].type === 4) continue;
            const { normalized } = computeDiagnosisScoreVector(ans);
            const maxN = Math.max(normalized[1], normalized[2], normalized[3], normalized[4]);
            const tied = TYPES.filter((t) => normalized[t] === maxN);
            if (tied.length < 2) continue;
            tieCount++;
            const winner = rankDiagnosisTypes(normalized, ans.map((a, i) => `${i}:${a}`).join('|'))[0];
            const winner2 = calcDiagnosisResultType(ans);
            if (winner !== winner2) nonDeterministic++;
            if (!tied.includes(winner)) winnerOutsideTied++;
            if (winner !== Math.min(...tied)) winnerNotMin++;
          }
  check('完全同点ケースが存在する', tieCount > 0, `ties=${tieCount}`);
  check('同点勝者は必ず同点集合内', winnerOutsideTied === 0);
  check('タイブレークは決定論的（calc と rank が一致）', nonDeterministic === 0);
  check(
    '同点が「最小番号固定」ではない（最小以外が勝つケースがある）',
    winnerNotMin > 0,
    `winnerNotMin=${winnerNotMin}/${tieCount}`,
  );
}

// ── 6. inferAnalysisType 代表ケース（Phase 2 では未変更）──
console.log('\n-- 6. inferAnalysisType 代表ケース（未変更）--');
type InferCase = { label: string; expected: DiagnosisType | null; summary: SummaryResult };
const inferCases: InferCase[] = [
  {
    label: 'pure-activity → 1',
    expected: 1,
    summary: {
      activitySummary:
        '部活動でサッカー部のキャプテンを務め、チームをまとめた。地域のボランティアや留学にも挑戦し、課外活動の実績がある。',
      strengths: '部活やチームでリーダーとして行動できる点が強み。',
      appealPoints: '大会での受賞やボランティアの行動量をアピールできる。',
    },
  },
  {
    label: 'pure-research → 2',
    expected: 2,
    summary: {
      activitySummary:
        '探究の授業で社会課題に興味を持ち、なぜそうなるのか原因を調べた。問題意識を深め、研究的に分析した。',
      strengths: '関心のあるテーマを深く分析し考察できる点が強み。',
      appealPoints: '大学で仕組みをさらに研究し、学びたい分野を絞りたい。',
    },
  },
  {
    label: 'pure-vision → 3',
    expected: 3,
    summary: {
      activitySummary:
        '将来は社会で役立つ職業に就きたい。医師というキャリアを志し、目標から逆算している。',
      strengths: 'なりたい将来像が明確で、夢から逆算して動ける点が強み。',
      appealPoints: '大学での学びで地域医療に貢献するビジョンを実現したい。',
    },
  },
  {
    label: 'pure-growth → 4',
    expected: 4,
    summary: {
      activitySummary:
        '人前で話すのが苦手だったが、生徒会の挑戦で少しずつ変わった。失敗もあったが努力を続け克服した。',
      strengths: '苦手から逃げず、変化や成長の過程を言葉にできる点が強み。',
      appealPoints: 'これから大学でさらに挑戦し、伸びていきたい。',
    },
  },
  { label: 'empty → null', expected: null, summary: { activitySummary: '', strengths: '', appealPoints: '' } },
];
for (const c of inferCases) {
  const r = inferAnalysisType(c.summary);
  const got = r === null ? null : r.type;
  check(c.label, got === c.expected, `got=${got === null ? 'null' : got}`);
}

// ── 7. 変更前後の分布比較（全 combo 走査）──
console.log('\n-- 7. 変更前後の resultType 分布（全 1280 combo）--');
{
  const lens = DIAGNOSIS_QUESTIONS.map((q) => q.options.length);
  const oldDist: Record<DiagnosisType, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const newDist: Record<DiagnosisType, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let total = 0;
  for (let a0 = 0; a0 < lens[0]; a0++)
    for (let a1 = 0; a1 < lens[1]; a1++)
      for (let a2 = 0; a2 < lens[2]; a2++)
        for (let a3 = 0; a3 < lens[3]; a3++)
          for (let a4 = 0; a4 < lens[4]; a4++) {
            const ans = [a0, a1, a2, a3, a4];
            oldDist[calcResultTypeOld(ans)]++;
            newDist[calcDiagnosisResultType(ans)]++;
            total++;
          }
  const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;
  console.log(`total combos = ${total}`);
  console.log('type |   old (raw count)   |   new (normalized)');
  for (const t of TYPES) {
    console.log(
      `  ${t}  | ${String(oldDist[t]).padStart(5)} (${pct(oldDist[t]).padStart(6)})    | ${String(
        newDist[t],
      ).padStart(5)} (${pct(newDist[t]).padStart(6)})`,
    );
  }
  // type4（Q4 ショートサーキット）は前後で不変であること = Q4 仕様維持の証拠
  check('type4 の分布は前後で不変（Q4 仕様維持）', oldDist[4] === newDist[4], `old=${oldDist[4]} new=${newDist[4]}`);
  // type3 のシェアは縮小しているはず（面積偏りの是正）
  check('type3 のシェアは新ロジックで縮小', newDist[3] < oldDist[3], `old=${oldDist[3]} new=${newDist[3]}`);
}

console.log(`\n=== ${failures === 0 ? 'ALL PASS' : `${failures} FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
