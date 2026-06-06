/*
 * scripts/exam-diagnosis-scoring-qa.ts
 *
 * 受験タイプ診断 9タイプ版（ExamType・15問）の判定ロジック QA。
 * AI は呼ばない。production code は import のみ（pure module だけを参照し、
 * server-only な tutorContext.ts は踏まない＝next/headers 連鎖を避ける）。
 *
 * 使い方:  npx tsx scripts/exam-diagnosis-scoring-qa.ts
 * 終了コード: 全 PASS → 0 / 1 件でも FAIL → 1
 *
 * 検証項目（STEP-DIAGNOSIS-MIGRATION-02 Step 7）:
 *   1. 9タイプ全てが resultType として返り得る
 *   2. stable tie break が毎回同じ（決定論的）
 *   3. scoreVector を保存しない（保存 payload に scoreVector 系 key が無い）
 *   4. answers から scoreVector を再計算できる
 *   5. legacy 4タイプ scoring が壊れていない（読み取れる）
 *   6. 9タイプ scoring が ExamType を返す（読み取れる）
 *   7. Tutor hint に type名 / score / raw JSON が入らない
 *   8. maxPossible は理論最大方式（面積方式ではない）
 */

import {
  EXAM_TYPES,
  isExamType,
  type ExamType,
} from '../types/examDiagnosis';
import { EXAM_QUESTIONS } from '../lib/examDiagnosis/questions';
import { EXAM_RESULTS, getExamResult } from '../lib/examDiagnosis/results';
import {
  calcExamResultType,
  calculateExamDiagnosisResult,
  computeExamScoreVector,
  computeExamMaxPossible,
} from '../lib/examDiagnosis/scoring';
import { EXAM_DIAGNOSIS_TYPE_HINTS } from '../lib/examDiagnosis/tutorHints';
import { calcDiagnosisResultType } from '../lib/diagnosisScoring';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

console.log('=== exam diagnosis (9タイプ) scoring QA ===\n');

// ── 0. 前提データ整合 ──
console.log('-- 0. 前提データ整合 --');
check('質問は 15 問', EXAM_QUESTIONS.length === 15, `len=${EXAM_QUESTIONS.length}`);
check('タイプは 9 種', EXAM_TYPES.length === 9, `len=${EXAM_TYPES.length}`);
check(
  '結果コンテンツは全 9 タイプ分そろっている',
  EXAM_TYPES.every((t) => EXAM_RESULTS.some((r) => r.type === t)) &&
    EXAM_RESULTS.length === 9,
);

// 各質問について、あるタイプの「正味の優位（target への加点 − 他タイプへの加点合計）」を
// 最大化する option index を返す。target が不在の問では、ライバルを最も太らせない option を選ぶ。
// （単純な「target 最大化」だと、target の最良 option が同時にライバルへ高配点する問で
//   ライバルが膨らみ、reachability を過小評価してしまう。例: kaigai の好適 option は riaju も
//   同時に 3 点入れるため、素朴構成だと riaju に負ける。）
function netBestOptionForType(qIdx: number, type: ExamType): number {
  const q = EXAM_QUESTIONS[qIdx];
  let bestIdx = 0;
  let bestNet = -Infinity;
  q.options.forEach((opt, i) => {
    let net = 0;
    for (const p of opt.points) net += p.type === type ? p.score : -p.score;
    if (net > bestNet) {
      bestNet = net;
      bestIdx = i;
    }
  });
  return bestIdx;
}

// あるタイプを最大限に推す回答ベクトル（15問・各 option index）。
function decisiveAnswersFor(type: ExamType): number[] {
  return EXAM_QUESTIONS.map((_, qIdx) => netBestOptionForType(qIdx, type));
}

// ── 1. 9タイプ全てが resultType として返り得る ──
console.log('\n-- 1. 9タイプ全てが resultType として返り得る --');
const reachable = new Set<ExamType>();
for (const t of EXAM_TYPES) {
  const res = calcExamResultType(decisiveAnswersFor(t));
  reachable.add(res);
  check(`decisive(${t}) → ${t}`, res === t, `got=${res}`);
}
check('9タイプすべて到達可能', reachable.size === 9, `reached=${[...reachable].join(',')}`);

// ── 2. stable tie break（決定論的）──
console.log('\n-- 2. stable tie break（決定論的）--');
{
  const sample = [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2];
  const first = calcExamResultType(sample);
  let stable = true;
  for (let i = 0; i < 100; i++) {
    if (calcExamResultType(sample) !== first) stable = false;
  }
  check('同一 answers は常に同一結果（100 回）', stable, `result=${first}`);

  // primary / secondary / scoreVector も決定論的
  const a = JSON.stringify(calculateExamDiagnosisResult(sample));
  const b = JSON.stringify(calculateExamDiagnosisResult(sample));
  check('calculateExamDiagnosisResult が決定論的', a === b);
}
// 全 decisive ベクトルで calc と calculate.primaryType が一致
{
  let mismatch = 0;
  for (const t of EXAM_TYPES) {
    const ans = decisiveAnswersFor(t);
    if (calcExamResultType(ans) !== calculateExamDiagnosisResult(ans).primaryType) mismatch++;
  }
  check('calcExamResultType == calculateExamDiagnosisResult.primaryType', mismatch === 0);
}

// ── 3. scoreVector を保存しない（保存 payload に scoreVector 系 key が無い）──
console.log('\n-- 3. scoreVector を保存しない（Option B）--');
{
  // ExamDiagnosisFlow が保存する payload と同形を再構成して key を検査。
  const answers = decisiveAnswersFor('riaju');
  const { primaryType } = calculateExamDiagnosisResult(answers);
  const content = getExamResult(primaryType);
  const savedPayload = {
    resultType: primaryType,
    resultTitle: content.name,
    resultDescription: content.description,
    answers,
    createdAt: '2026-06-06T00:00:00.000Z',
  };
  const keys = Object.keys(savedPayload).sort();
  const expected = ['answers', 'createdAt', 'resultDescription', 'resultTitle', 'resultType'].sort();
  check('保存 payload の key は answers + resultType + 表示文のみ', JSON.stringify(keys) === JSON.stringify(expected), keys.join(','));
  const forbidden = ['scoreVector', 'raw', 'normalized', 'maxPossible', 'secondaryType'];
  check(
    '保存 payload に scoreVector / secondaryType 系 key が無い',
    forbidden.every((k) => !(k in savedPayload)),
  );
}

// ── 4. answers から scoreVector を再計算できる ──
console.log('\n-- 4. answers から scoreVector を再計算できる --');
{
  const answers = decisiveAnswersFor('kyoyo');
  const v1 = computeExamScoreVector(answers);
  const v2 = computeExamScoreVector(answers);
  check('再計算は決定論的', JSON.stringify(v1) === JSON.stringify(v2));
  // normalized = raw / maxPossible の整合
  let ok = true;
  for (const t of EXAM_TYPES) {
    const expected = v1.maxPossible[t] > 0 ? v1.raw[t] / v1.maxPossible[t] : 0;
    if (Math.abs(v1.normalized[t] - expected) > 1e-9) ok = false;
  }
  check('normalized = raw / maxPossible が成立', ok);
  check('primary の normalized が最大', EXAM_TYPES.every((t) => v1.normalized.kyoyo >= v1.normalized[t]));
}
// 空 / 不正入力は throw（本番は 15 問完答後にのみ呼ぶ前提）
{
  function throws(fn: () => unknown): boolean {
    try { fn(); return false; } catch { return true; }
  }
  check('空配列は throw', throws(() => computeExamScoreVector([])));
  check('範囲外 index は throw', throws(() => computeExamScoreVector([9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9])));
}

// ── 5. legacy 4タイプ scoring が壊れていない ──
console.log('\n-- 5. legacy 4タイプ scoring（読み取れる・不変）--');
{
  const legacy = calcDiagnosisResultType([0, 0, 0, 2, 0]); // 全 type1
  check('legacy calcDiagnosisResultType が 1-4 を返す', [1, 2, 3, 4].includes(legacy), `got=${legacy}`);
}

// ── 6. 9タイプ scoring が ExamType を返す ──
console.log('\n-- 6. 9タイプ scoring が ExamType を返す --');
{
  const r = calcExamResultType(decisiveAnswersFor('gariben'));
  check('calcExamResultType が ExamType 文字列を返す', isExamType(r), `got=${r}`);
}

// ── 7. Tutor hint に type名 / score / raw JSON が入らない ──
console.log('\n-- 7. Tutor hint の非漏洩（type名 / score / raw JSON）--');
{
  let leak = 0;
  for (const t of EXAM_TYPES) {
    const hint = EXAM_DIAGNOSIS_TYPE_HINTS[t];
    const r = getExamResult(t);
    const leaks: string[] = [];
    if (!hint || hint.trim() === '') leaks.push('empty');
    if (hint.includes(r.name)) leaks.push('name');
    if (hint.includes(r.catchphrase)) leaks.push('catchphrase');
    if (r.universities.some((u) => hint.includes(u))) leaks.push('university');
    if (r.badExamples.some((b) => hint.includes(b))) leaks.push('badExample');
    if (hint.includes(r.ngExplanation)) leaks.push('ngExplanation');
    if (/[0-9０-９]/.test(hint)) leaks.push('digit/score');
    if (/[{}\[\]]/.test(hint)) leaks.push('json');
    if (EXAM_TYPES.some((k) => hint.includes(k))) leaks.push('rawTypeKey');
    if (leaks.length > 0) {
      leak++;
      console.log(`    ${t}: leaks=${leaks.join(',')}`);
    }
  }
  check('全 9 hint に type名 / score / raw が混入しない', leak === 0, `leaking=${leak}`);
}

// ── 8. maxPossible は理論最大方式（面積方式ではない）──
console.log('\n-- 8. maxPossible は理論最大方式 --');
{
  const max = computeExamMaxPossible();
  // 理論最大: 各問でそのタイプのベスト option 1 つ分（score 3 中心）を合計するので、
  // 出現タイプは「面積（選択肢数 = 各 1 点）」より大きくなる（重み 3 が効く）。
  // 面積方式なら各 hit option +1 なので、riaju の max は出現選択肢数に一致してしまう。
  // ここでは「重み付き理論最大 > 単純出現選択肢数」を確認する。
  const areaCount: Record<string, number> = {};
  for (const t of EXAM_TYPES) areaCount[t] = 0;
  for (const q of EXAM_QUESTIONS) {
    // 1問1回答のため、面積方式は「そのタイプを含む option があれば +1」。
    for (const t of EXAM_TYPES) {
      if (q.options.some((o) => o.points.some((p) => p.type === t))) areaCount[t] += 1;
    }
  }
  check('全タイプ maxPossible > 0', EXAM_TYPES.every((t) => max[t] > 0), JSON.stringify(max));
  check(
    '理論最大方式 = 面積方式ではない（重み 3 が効くタイプが存在）',
    EXAM_TYPES.some((t) => max[t] > areaCount[t]),
    `max=${JSON.stringify(max)} area=${JSON.stringify(areaCount)}`,
  );
}

console.log(`\n=== ${failures === 0 ? 'ALL PASS' : `${failures} FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
