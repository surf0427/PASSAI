// /api/analysis/additional の prompt builder と SYSTEM_PROMPT。
//
// 役割:
//   /api/analysis 本体（profile 生成）とは独立に、深掘り質問を +2 問だけ追加生成する
//   route 専用の SYSTEM_PROMPT と user prompt builder を提供する。
//
// 切り出し経緯:
//   元は lib/prompts.ts (669 行) に同居していたが、本ファイルを import するのは
//   /api/analysis/additional/route.ts と scripts/step15-qa.ts のみで、本来 lib/prompts.ts
//   全体を引きずる必要がない。Phase 2.1 で切り出して context を局所化した。
//
//   既存 import 経路（`from '@/lib/prompts'`）は lib/prompts.ts 側の re-export shim で
//   引き続き有効。route.ts / scripts/step15-qa.ts は本 STEP では import path を変えない。
//
// 注意:
//   - SYSTEM_PROMPT 本文（特に subjectGrades qualifier、JSON schema、件数ルール）は 1 文字も
//     変えてはいけない。lib/aiInputHash.ts の ADDITIONAL_QUESTIONS_PROMPT_VERSION を
//     bump せずに同 cache lane の互換性を保つ前提。
//   - AnalysisPromptContext 型は lib/prompts.ts で他 2 つの builder と共有されているため、
//     type-only import で参照する（runtime 循環なし）。

import type { AnalysisPromptContext } from '@/lib/prompts';
import {
  STUDENT_FIT_INSTRUCTION,
  SUBJECT_GRADES_SHARED_INSTRUCTION,
  SUBJECT_GRADES_ASYMMETRY_RULE,
} from '@/lib/prompts/sharedInstructions';
import { buildBasicInfoPromptSection } from '@/lib/buildBasicInfoPromptSection';
import { buildUniversityContextPromptSection } from '@/lib/buildUniversityContext';

// buildAdditionalQuestionsPrompt は「質問生成責務」専用プロンプト。
// profile 生成 (summary / strengths / weaknesses / futureConnections) は触らない。
// 将来は buildWallHittingPrompt の質問セクションをここに統合し、
// mode = 'initial' | 'additional' で切り替える形が候補（app/api/analysis/additional/route.ts 参照）。
export type BuildAdditionalQuestionsOptions = {
  activityText: string;
  existingQuestions: string[];
} & AnalysisPromptContext;

// ── STEP3.8: static rule を system パラメータへ切り出し ──────────
// 「毎回変わらない指示」（役割宣言・志望先文脈の解釈方針・制約・出力ルール・JSON schema）を
// SYSTEM_PROMPT に固定し、user 側（buildAdditionalQuestionsPrompt）には「今回の入力データ」だけを
// 渡す。これにより:
//   1. /api/analysis 本体（STEP3.5）と同じ system / user 分離構造に揃う
//   2. 将来 prompt caching（cache_control）を system 部にかけられる足場になる
// 現状 prompt caching 自体は未適用（system 候補は短く ~600 tokens 前後の見込みで、
// Sonnet 4-6 の実効 caching 閾値 ~2,048+ を大きく下回るため、付けても効果薄）。
//
// 不変条件:
//   - prompt の意味を変えない（questions=2 ルール / カテゴリプレフィックス /
//     JSON schema / トーンは一切変えない）
//   - buildContextPreamble の signature は変えない（buildSummarizePrompt /
//     buildAdditionalQuestionsPrompt の従来呼び出しを壊さないよう、本関数は preamble を
//     経由せず section helper を直接呼ぶ形に切り替える。STEP3.5 と同じ手法）
//   - STUDENT_FIT_INSTRUCTION は「分かる場合は…」と条件文化されているため、
//     universityContext が無いケースでも system 側に常駐させて安全。
//
// STEP15g: subjectGrades semantic instruction を SYSTEM_PROMPT に接続する。
//   - shared 2 つ（SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE）は
//     同ファイル内 const のため import 不要・直接参照。
//   - route 固有の field-level 制約は下記 ADDITIONAL_QUESTIONS_SUBJECT_GRADES_QUALIFIER に集約。
//     additional は AI 出力（質問 2 問）が次回 /api/summarize の入力にもなり、間接的に
//     StudentProfile の傾向にも影響しうるため、analysis 本体より一段軽い制約として
//     「subjectGrades 由来の質問を questions[0] に置かない」「数値直書き禁止」を中心に縛る。
//   - 挿入位置は STUDENT_FIT_INSTRUCTION の直後・「追加質問は」の前。
//   - user prompt（buildAdditionalQuestionsPrompt の戻り値）は本 STEP では 1 文字も変えない。
//   - PROMPT_VERSION は ADDITIONAL_QUESTIONS_PROMPT_VERSION 1→2 へ bump（lib/aiInputHash.ts）。

// analysis/additional route 固有の subjectGrades 取り扱い制約。
// shared 側で断定禁止・AO 推薦混同禁止・関連科目以外の過剰減点禁止は既に効いている。
// 本 route は追加質問 2 問を生成する route のため、subjectGrades は「質問観点の補助」に
// 限定し、活動・価値観・志望理由・将来目標の深掘りを主軸にする。
const ADDITIONAL_QUESTIONS_SUBJECT_GRADES_QUALIFIER = `【analysis/additional route での subjectGrades の使い方】
・subjectGrades は、追加質問の観点を補助するためだけに使う。

・追加質問は、活動・価値観・志望理由・将来目標の深掘りを主軸にする。

・評定値や欠席日数を質問文に直接書かない。

・subjectGrades 由来の質問を questions[0] に置かない。questions[0] は活動・経験・価値観の深掘りを優先する。

・志望学部に関連する高評定がある場合でも、「その力をどの活動でどう使ったか」を聞く形に変換する。

・志望学部に関連しない低評定を質問主題にしない。

・欠席日数がある場合は、不安を煽らず「その期間に何を大切にして行動したか」「継続したことは何か」を整理する方向の質問に留める。

・subjectGrades 未入力時は、評定・欠席に関する質問を作らない。`;

export const ADDITIONAL_QUESTIONS_SYSTEM_PROMPT = `あなたは総合型選抜・学校推薦型選抜の受験指導のプロです。
以下の活動データをもとに、深掘り質問を2問だけ追加生成してください。

${STUDENT_FIT_INSTRUCTION}

${SUBJECT_GRADES_SHARED_INSTRUCTION}

${SUBJECT_GRADES_ASYMMETRY_RULE}

${ADDITIONAL_QUESTIONS_SUBJECT_GRADES_QUALIFIER}

追加質問は、上記の志望大学・学部・学科の特性に踏み込む内容にすること。
学部のカリキュラム適合性、学科の専門性、受験方式に応じた観点を意識する。

【制約】
・questions は必ず2問だけ生成する
・上記の既存質問と重複しないこと
・AO面接・志望理由書で役立つ具体的な質問にする
・各質問には【カテゴリ】を付ける（例：【動機】【課題】【行動】【成果】【将来】）

【出力ルール（厳守）】
・出力は純粋なJSONのみ
・最初の文字は { でなければならない
・最後の文字は } でなければならない
・\`\`\`json や \`\`\` は絶対に使わない
・前置き・説明文・日本語の文章を一切書かない
・JSON以外の文字を1文字も含めない
・ただし、正しいJSON構造を保つことを最優先とする。JSON構造が壊れるくらいなら正確なJSONを優先すること

【出力形式】
{
  "questions": [
    "【カテゴリ】具体的な質問文",
    "【カテゴリ】具体的な質問文"
  ]
}`;

export function buildAdditionalQuestionsPrompt(opts: BuildAdditionalQuestionsOptions): string {
  const { activityText, existingQuestions } = opts;
  // 共有の buildContextPreamble は使わない。preamble は STUDENT_FIT_INSTRUCTION を含んでおり、
  // これは system 側に移したため。basicInfo / universityContext の section helper を
  // 直接呼んで dynamic 部だけを組み立てる（buildContextPreamble の signature は他 API も
  // 利用するため不変に保つ。STEP3.5 と同じ方針）。
  const basicInfoSection = buildBasicInfoPromptSection(opts.basicInfo);
  const uniContextSection = buildUniversityContextPromptSection(opts.universityContext);
  const existingQuestionsText = existingQuestions
    .map((q, i) => `${i + 1}. ${q}`)
    .join('\n');

  const sections: string[] = [basicInfoSection];
  if (uniContextSection) sections.push(uniContextSection);
  sections.push(`【活動データ】\n${activityText}`);
  sections.push(`【すでに出している質問（重複禁止）】\n${existingQuestionsText}`);
  return `以下の活動データから追加の深掘り質問を生成してください。\n\n${sections.join('\n\n')}`;
}
