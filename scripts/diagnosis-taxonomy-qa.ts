/*
 * scripts/diagnosis-taxonomy-qa.ts
 *
 * R12「タクソノミー衝突」修正の回帰検証（AI は呼ばない・production code は import のみ）。
 *
 * 目的:
 *   DiagnosisType（1|2|3|4）という同じ番号が、来歴によって別の意味を持つ。
 *     - /diagnosis 由来      → DIAGNOSIS_FEEDBACK（1 整理 / 2 言語化 / 3 書類完成度 / 4 一般受験並行）
 *     - self-analysis 由来   → TYPE_FEEDBACK     （1 活動アピール / 2 探究・研究 / 3 将来ビジョン / 4 成長）
 *   DiagnosisTypeCard が resolved.source で feedback テーブルを出し分けることで、
 *   /diagnosis の resultType が「別タクソノミーの文言」で表示される事故を防ぐ。
 *
 *   本スクリプトは「番号 → 文言」の対応が両テーブルで意図どおり分離されていること、
 *   および両者が同一番号で別文言になっていること（＝衝突が解消されていること）を検証する。
 *
 * 使い方:
 *   npx tsx scripts/diagnosis-taxonomy-qa.ts
 *
 * 終了コード:
 *   全 PASS → 0 / 1 件でも FAIL → 1
 */

import {
  TYPE_FEEDBACK,
  DIAGNOSIS_FEEDBACK,
} from '../app/home/diagnosisFeedback';
import type { DiagnosisType } from '../types/diagnosis';

const TYPES: DiagnosisType[] = [1, 2, 3, 4];

// 各タクソノミーで「その番号なら summary に必ず含まれるべき語」と
// 「混入してはいけない他タクソノミーの語」。
// /diagnosis 側は app/diagnosis/page.tsx の RESULT_TYPES と意味を一致させる。
const DIAGNOSIS_MUST: Record<DiagnosisType, string> = {
  1: '整理タイプ',
  2: '経験言語化',
  3: '書類完成度',
  4: '一般受験並行',
};
const SELF_MUST: Record<DiagnosisType, string> = {
  1: '活動アピール型',
  2: '探究・研究型',
  3: '将来ビジョン型',
  4: '成長ポテンシャル型',
};

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  const tag = ok ? 'PASS' : 'FAIL';
  if (!ok) failures++;
  console.log(`[${tag}] ${name}${detail ? ` — ${detail}` : ''}`);
}

console.log('=== R12 diagnosis taxonomy separation QA ===\n');

// 1) /diagnosis 由来: DIAGNOSIS_FEEDBACK が /diagnosis の意味を表示する
console.log('-- /diagnosis 由来（DIAGNOSIS_FEEDBACK）--');
for (const t of TYPES) {
  const s = DIAGNOSIS_FEEDBACK[t].summary;
  check(
    `type${t} は「${DIAGNOSIS_MUST[t]}」の意味で表示`,
    s.includes(DIAGNOSIS_MUST[t]),
    s,
  );
  // 他タクソノミー（self-analysis）の語が混入していないこと
  check(
    `type${t} に self-analysis 用語「${SELF_MUST[t]}」が混入しない`,
    !s.includes(SELF_MUST[t]),
  );
}

// 2) self-analysis 由来: TYPE_FEEDBACK は従来どおり自己分析の意味で表示
console.log('\n-- self-analysis 由来（TYPE_FEEDBACK）--');
for (const t of TYPES) {
  const s = TYPE_FEEDBACK[t].summary;
  check(
    `type${t} は「${SELF_MUST[t]}」の意味で表示`,
    s.includes(SELF_MUST[t]),
    s,
  );
}

// 3) 衝突解消の核心: 同じ番号でも 2 テーブルの summary は別文言
console.log('\n-- 衝突解消（同番号で別文言）--');
for (const t of TYPES) {
  check(
    `type${t} は来歴で別文言になる`,
    DIAGNOSIS_FEEDBACK[t].summary !== TYPE_FEEDBACK[t].summary,
  );
}

// 4) 旧バグの直接回帰: /diagnosis type3 が「将来ビジョン型」と出ない
console.log('\n-- 旧バグの回帰ガード --');
check(
  '/diagnosis type3 が「将来ビジョン型」と表示されない',
  !DIAGNOSIS_FEEDBACK[3].summary.includes('将来ビジョン'),
  DIAGNOSIS_FEEDBACK[3].summary,
);

// 5) 構造健全性: 全 field が非空・ctaHref が絶対パス
console.log('\n-- 構造健全性 --');
for (const table of [DIAGNOSIS_FEEDBACK, TYPE_FEEDBACK]) {
  for (const t of TYPES) {
    const f = table[t];
    const allFilled =
      !!f.summary.trim() &&
      !!f.strengths.trim() &&
      !!f.caution.trim() &&
      !!f.nextStep.trim() &&
      f.ctaHref.startsWith('/') &&
      !!f.ctaLabel.trim();
    check(`feedback field が全て揃っている (type${t})`, allFilled);
  }
}

console.log(
  `\n=== ${failures === 0 ? 'ALL PASS' : `${failures} FAILED`} ===`,
);
process.exit(failures === 0 ? 0 : 1);
