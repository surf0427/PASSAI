/*
 * scripts/step-question-quality-qa.ts
 *
 * STEP-SELFANALYSIS-QUESTION-QUALITY-QA-01:
 *   v5 で deterministic catalog から AI 生成に戻した自己分析の初期 5 問と
 *   追加 2 問が、活動内容に直接言及した質の高い質問になっているかを実 AI 出力で検証する。
 *
 * 設計方針:
 *   - production prompt（ANALYSIS_SYSTEM_PROMPT / ADDITIONAL_QUESTIONS_SYSTEM_PROMPT）を
 *     lib/prompts/ から直接 import して本番経路を再現
 *   - Anthropic SDK を直接叩く（Next.js route 層は通さない）
 *   - 4 活動 fixture × 2 passes（analysis + additional）= 8 calls
 *   - generic 質問パターン（「なぜ始めましたか」等）と activity-specific 言及の
 *     片方/両方を満たしているかを deterministic lint
 *   - 出力は tmp/question-quality-qa/ 配下
 *
 * 使い方:
 *   --dry      : API を呼ばず prompt 構築のみ。lint は scaffolding 確認用に空でも継続
 *   --verbose  : prompt 本文を stdout に出す
 *   --case <c> : 単一活動のみ実行（study_abroad / part_time_job / passai / club）
 */

import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ANALYSIS_SYSTEM_PROMPT,
  buildWallHittingPrompt,
  ADDITIONAL_QUESTIONS_SYSTEM_PROMPT,
  buildAdditionalQuestionsPrompt,
} from '../lib/prompts';
import { extractJson } from '../lib/ai';
import type { BasicInfo } from '../types/basicInfo';
import type { ActivityData } from '../types/activity';
import { formatActivityData } from '../lib/formatActivity';

// ─── CLI args ───────────────────────────────────────────────
const ARGS = process.argv.slice(2);
const FLAG_DRY = ARGS.includes('--dry');
const FLAG_VERBOSE = ARGS.includes('--verbose');
function getFlagValue(name: string): string | null {
  const idx = ARGS.indexOf(name);
  if (idx === -1 || idx === ARGS.length - 1) return null;
  return ARGS[idx + 1];
}
const SELECTED_CASE = getFlagValue('--case')?.toLowerCase() ?? null;

// ─── .env.local loader ───────────────────────────────────────
function loadEnvLocal(): void {
  const envPath = join(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
loadEnvLocal();

// ─── Constants ──────────────────────────────────────────────
const OUTPUT_DIR = join(process.cwd(), 'tmp', 'question-quality-qa');
const MODEL = 'claude-sonnet-4-6';
const ANALYSIS_MAX_TOKENS = 2400; // production route と同じ
const ADDITIONAL_MAX_TOKENS = 500; // production route と同じ

// ─── Fixtures ──────────────────────────────────────────────
// 既存 activityData の型をフルに満たす空 ActivityData を作るヘルパ。
function emptyActivityData(): ActivityData {
  return {
    clubActivities: [],
    volunteerActivities: [],
    studyAbroadActivities: [],
    researchActivities: [],
    partTimeJobActivities: [],
    certificationActivities: [],
    contestActivities: [],
    readingActivities: [],
    hobbyActivities: [],
    otherActivities: [],
  };
}

const BASE_BASIC_INFO: BasicInfo = {
  name: 'QAテスト',
  grade: '高校3年',
  gpa: '3.8',
  examTypes: ['総合型選抜（AO入試）'],
  subjectGrades: [],
  absences: '',
  preferences: [
    {
      university: '早稲田大学',
      faculty: '国際教養学部',
      department: '',
    },
  ],
} as unknown as BasicInfo;

type Case = {
  id: 'study_abroad' | 'part_time_job' | 'passai' | 'club';
  label: string;
  // 活動データに登場する「具体名詞・固有要素」のキーワード集合。
  // lint で「質問に少なくとも 1 つは含まれているか」を判定する。
  specificKeywords: string[];
  activityData: ActivityData;
};

const CASES: Case[] = [
  {
    id: 'study_abroad',
    label: 'A. 留学（オーストラリア）',
    specificKeywords: ['オーストラリア', '英語', 'ホストファミリー', '寮', '留学'],
    activityData: (() => {
      const d = emptyActivityData();
      d.studyAbroadActivities.push({
        type: 'studyAbroad',
        destination: 'オーストラリア・シドニー',
        programContent: '現地高校への 6 か月留学プログラム',
        language: '英語',
        period: { from: '2024年9月', to: '2025年3月' },
        description:
          '寮生活で最初の 3 か月は誰とも深い会話ができず、ホストファミリーの夕食でも黙ってしまう状態が続いた。',
        achievement:
          'クラスのプレゼンで日本のアニメ文化をテーマに発表し、初めて現地の友人ができた。',
        role: '寮の日本人代表として日本文化紹介イベントを 2 回主催',
        challenge:
          '英語のリスニングが追いつかず、授業のディスカッションで発言できず孤立した。',
        action:
          '毎晩授業の録音を聞き返し、よく出てくる表現をノートにまとめて翌日使うようにした。',
        reflection:
          '「分かるまで黙る」より「分からなくても聞き返す」方が前に進むと体感した。',
        futureConnection:
          '国際教養学部で多文化チームでの協働を体系的に学びたい。',
      });
      return d;
    })(),
  },
  {
    id: 'part_time_job',
    label: 'B. 飲食店アルバイト',
    specificKeywords: ['飲食店', 'ホール', '接客', 'オーダー', 'クレーム', 'アルバイト'],
    activityData: (() => {
      const d = emptyActivityData();
      d.partTimeJobActivities.push({
        type: 'partTimeJob',
        industry: '飲食店（イタリアン）',
        jobContent: 'ホール接客・オーダー受付・会計',
        workFrequency: '週 3 日・1 日 5 時間',
        period: { from: '2023年4月', to: '現在' },
        description:
          'ピーク時にオーダー漏れが続き、常連客から「いつまで待たせるんだ」と強くクレームを受けた。',
        achievement:
          'オーダー入力のダブルチェックフローを店長に提案し、ミスを月 10 件から 2 件に減らした。',
        role: 'ホールリーダー（新人 2 名の OJT 担当）',
        challenge:
          '初めてクレーム対応を任された際、頭が真っ白になりお客様の話を遮ってしまった。',
        action:
          '「まず最後まで聞く」を自分のルールに設定し、3 ヶ月続けて常連からの信頼を取り戻した。',
        reflection:
          '焦りで遮るより、聞き切ってから動く方が結果的に解決が早いと学んだ。',
        futureConnection:
          '将来は人と直接関わる仕事に進みたく、対人の場数を大学でも積みたい。',
      });
      return d;
    })(),
  },
  {
    id: 'passai',
    label: 'C. PASSAI 開発（その他）',
    specificKeywords: ['PASSAI', '開発', 'AI', 'β版', 'ユーザー'],
    activityData: (() => {
      const d = emptyActivityData();
      d.otherActivities.push({
        type: 'other',
        activityName: 'PASSAI 開発（総合型受験生向け AI ツール）',
        period: { from: '2024年6月', to: '現在' },
        description:
          '総合型受験生が自己分析に詰まる現状を変えたく、Next.js と Claude API を使った AI 自己分析ツールを高校 2 年から開発開始。',
        achievement:
          '3 か月で β 版をリリースし、自校の同級生 12 名に使ってもらいフィードバックを集めた。',
        role: '個人開発（企画・実装・ユーザーヒアリングを全て自分で担当）',
        challenge:
          '「AI が出す質問が抽象的すぎて答えられない」と β ユーザーから言われ、当初の固定質問テンプレ設計が破綻していると気づいた。',
        action:
          'deterministic 固定テンプレを廃止し、活動データに直接言及する AI 生成方式に作り直した。',
        reflection:
          'プロダクトの中核価値はコスト削減ではなく「ユーザーが答えやすい質問」だと体感した。',
        futureConnection:
          '大学で AI と教育の交差点を研究し、受験生支援サービスとして育てたい。',
      });
      return d;
    })(),
  },
  {
    id: 'club',
    label: 'D. 部活動（生徒会）',
    specificKeywords: ['生徒会', '副会長', '文化祭', 'クラス', '部活'],
    activityData: (() => {
      const d = emptyActivityData();
      d.clubActivities.push({
        type: 'club',
        clubName: '生徒会',
        sport: '生徒会（副会長）',
        competitionLevel: '校内',
        teamSize: '12 名',
        period: { from: '2023年6月', to: '2024年6月' },
        description:
          '副会長として文化祭の運営を任され、各クラスの出し物調整と予算配分で意見が割れた。',
        achievement:
          '前年比で来場者アンケート満足度を 68% → 84% に引き上げた。',
        role: '副会長（文化祭実行委員長を兼任）',
        challenge:
          '3 クラスが同じ縁日企画を出したい意向で衝突し、最終週まで枠が決まらなかった。',
        action:
          '希望理由を 1 クラスずつ個別に聞き、3 案を時間帯分割するハイブリッド案で合意形成した。',
        reflection:
          '「全員に同じ説明」ではなく「相手の前提に合わせた説明」を分けることの重要性を学んだ。',
        futureConnection:
          '組織論を体系的に学び、将来は教育現場でリーダー育成に関わりたい。',
      });
      return d;
    })(),
  },
];

// ─── Generic question patterns（禁止） ────────────────────────
// 「活動への言及がない / generic すぎる」と判断する pattern 集合。
// 文末の敬体ゆらぎを吸収するため、部分一致で検出する。
const GENERIC_PATTERNS: RegExp[] = [
  /^【[^】]*】\s*なぜ始めましたか[？?。]?$/,
  /^【[^】]*】\s*なぜ続けていますか[？?。]?$/,
  /^【[^】]*】\s*苦労したことは[何ですか]*[？?。]?$/,
  /^【[^】]*】\s*工夫したことは[何ですか]*[？?。]?$/,
  /^【[^】]*】\s*学んだことは[何ですか]*[？?。]?$/,
  /^【[^】]*】\s*どんなきっかけ[ですか？?。]*$/,
];

// 「活動を始めた最初のきっかけ」「一番苦労した場面」など、固有名詞ゼロの
// 抽象パターンに対する soft check。活動 specificKeywords が含まれていない場合に
// warning として上げる。
function questionMentionsActivity(q: string, keywords: string[]): boolean {
  return keywords.some((kw) => q.includes(kw));
}

function isHardGeneric(q: string): boolean {
  return GENERIC_PATTERNS.some((re) => re.test(q.trim()));
}

type Lint = {
  hardGenerics: string[];      // 完全 generic（禁止パターン一致）
  missingKeyword: string[];    // 活動 specificKeywords を 1 つも含まない（soft）
};

function lintQuestions(questions: string[], keywords: string[]): Lint {
  const hardGenerics: string[] = [];
  const missingKeyword: string[] = [];
  for (const q of questions) {
    if (isHardGeneric(q)) hardGenerics.push(q);
    if (!questionMentionsActivity(q, keywords)) missingKeyword.push(q);
  }
  return { hardGenerics, missingKeyword };
}

// ─── Output types ──────────────────────────────────────────
type CaseResult = {
  caseId: Case['id'];
  label: string;
  activityText: string;
  initialQuestions: string[] | null;
  additionalQuestions: string[] | null;
  initialRaw: string;
  additionalRaw: string;
  initialLint: Lint;
  additionalLint: Lint;
  initialApiError: string | null;
  additionalApiError: string | null;
  initialUsage: { input_tokens: number; output_tokens: number } | null;
  additionalUsage: { input_tokens: number; output_tokens: number } | null;
};

// ─── API call helpers ──────────────────────────────────────
async function callAnalysis(
  anthropic: Anthropic,
  activityData: ActivityData,
): Promise<{ raw: string; usage: { input_tokens: number; output_tokens: number } | null; error: string | null }> {
  const activityText = formatActivityData(activityData);
  const userPrompt = buildWallHittingPrompt({
    activityText,
    basicInfo: BASE_BASIC_INFO,
    universityContext: null,
  });
  if (FLAG_VERBOSE) {
    console.log('--- analysis user prompt ---\n', userPrompt, '\n---');
  }
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: ANALYSIS_MAX_TOKENS,
      system: [{ type: 'text', text: ANALYSIS_SYSTEM_PROMPT }],
      messages: [{ role: 'user', content: userPrompt }],
    });
    const raw = message.content[0].type === 'text' ? message.content[0].text : '';
    return {
      raw,
      usage: message.usage
        ? { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens }
        : null,
      error: message.stop_reason === 'max_tokens' ? 'truncated (max_tokens)' : null,
    };
  } catch (e) {
    return { raw: '', usage: null, error: e instanceof Error ? e.message : String(e) };
  }
}

async function callAdditional(
  anthropic: Anthropic,
  activityData: ActivityData,
  existingQuestions: string[],
): Promise<{ raw: string; usage: { input_tokens: number; output_tokens: number } | null; error: string | null }> {
  const activityText = formatActivityData(activityData);
  const userPrompt = buildAdditionalQuestionsPrompt({
    activityText,
    existingQuestions,
    basicInfo: BASE_BASIC_INFO,
    universityContext: null,
  });
  if (FLAG_VERBOSE) {
    console.log('--- additional user prompt ---\n', userPrompt, '\n---');
  }
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: ADDITIONAL_MAX_TOKENS,
      system: [{ type: 'text', text: ADDITIONAL_QUESTIONS_SYSTEM_PROMPT }],
      messages: [{ role: 'user', content: userPrompt }],
    });
    const raw = message.content[0].type === 'text' ? message.content[0].text : '';
    return {
      raw,
      usage: message.usage
        ? { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens }
        : null,
      error: message.stop_reason === 'max_tokens' ? 'truncated (max_tokens)' : null,
    };
  } catch (e) {
    return { raw: '', usage: null, error: e instanceof Error ? e.message : String(e) };
  }
}

function parseQuestions(raw: string): string[] | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(extractJson(raw)) as { questions?: unknown };
    if (!Array.isArray(j.questions)) return null;
    return j.questions.filter((q): q is string => typeof q === 'string');
  } catch {
    return null;
  }
}

// ─── Main ──────────────────────────────────────────────────
async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  if (!FLAG_DRY) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('ANTHROPIC_API_KEY が見つかりません。');
      console.error('  - .env.local に書く / 環境変数で渡す のいずれかが必要です');
      process.exit(1);
    }
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const targetCases = SELECTED_CASE
    ? CASES.filter((c) => c.id === SELECTED_CASE)
    : CASES;

  const results: CaseResult[] = [];

  for (const c of targetCases) {
    console.log(`\n=== ${c.label} ===`);
    const activityText = formatActivityData(c.activityData);

    if (FLAG_DRY) {
      // dry mode: prompt 構築のみ。実 API は呼ばない。
      const userPrompt = buildWallHittingPrompt({
        activityText,
        basicInfo: BASE_BASIC_INFO,
        universityContext: null,
      });
      console.log(`[dry] analysis prompt length=${userPrompt.length}`);
      const additionalPrompt = buildAdditionalQuestionsPrompt({
        activityText,
        existingQuestions: ['【動機】サンプル既存質問'],
        basicInfo: BASE_BASIC_INFO,
        universityContext: null,
      });
      console.log(`[dry] additional prompt length=${additionalPrompt.length}`);
      results.push({
        caseId: c.id,
        label: c.label,
        activityText,
        initialQuestions: null,
        additionalQuestions: null,
        initialRaw: '',
        additionalRaw: '',
        initialLint: { hardGenerics: [], missingKeyword: [] },
        additionalLint: { hardGenerics: [], missingKeyword: [] },
        initialApiError: 'dry-run',
        additionalApiError: 'dry-run',
        initialUsage: null,
        additionalUsage: null,
      });
      continue;
    }

    // ── Pass 1: /api/analysis (initial 5 questions) ──
    const t0 = Date.now();
    const analysis = await callAnalysis(anthropic, c.activityData);
    const initialQuestions = parseQuestions(analysis.raw);
    console.log(
      `analysis: ${initialQuestions ? `${initialQuestions.length} questions` : 'PARSE FAILED'} (${Date.now() - t0}ms, in=${analysis.usage?.input_tokens ?? '?'} out=${analysis.usage?.output_tokens ?? '?'})`,
    );
    if (initialQuestions) {
      initialQuestions.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));
    } else {
      console.log('  raw:', analysis.raw.slice(0, 400));
    }

    // ── Pass 2: /api/analysis/additional (2 questions) ──
    const t1 = Date.now();
    const additional = await callAdditional(
      anthropic,
      c.activityData,
      initialQuestions ?? [],
    );
    const additionalQuestions = parseQuestions(additional.raw);
    console.log(
      `additional: ${additionalQuestions ? `${additionalQuestions.length} questions` : 'PARSE FAILED'} (${Date.now() - t1}ms, in=${additional.usage?.input_tokens ?? '?'} out=${additional.usage?.output_tokens ?? '?'})`,
    );
    if (additionalQuestions) {
      additionalQuestions.forEach((q, i) => console.log(`  +${i + 1}. ${q}`));
    } else {
      console.log('  raw:', additional.raw.slice(0, 400));
    }

    const initialLint = lintQuestions(initialQuestions ?? [], c.specificKeywords);
    const additionalLint = lintQuestions(additionalQuestions ?? [], c.specificKeywords);

    if (initialLint.hardGenerics.length > 0) {
      console.log(`  ❌ initial hard-generic: ${initialLint.hardGenerics.length} 件`);
    }
    if (initialLint.missingKeyword.length > 0) {
      console.log(
        `  ⚠️ initial missing keyword: ${initialLint.missingKeyword.length}/${initialQuestions?.length ?? 0}`,
      );
    }
    if (additionalLint.hardGenerics.length > 0) {
      console.log(`  ❌ additional hard-generic: ${additionalLint.hardGenerics.length} 件`);
    }
    if (additionalLint.missingKeyword.length > 0) {
      console.log(
        `  ⚠️ additional missing keyword: ${additionalLint.missingKeyword.length}/${additionalQuestions?.length ?? 0}`,
      );
    }

    results.push({
      caseId: c.id,
      label: c.label,
      activityText,
      initialQuestions,
      additionalQuestions,
      initialRaw: analysis.raw,
      additionalRaw: additional.raw,
      initialLint,
      additionalLint,
      initialApiError: analysis.error,
      additionalApiError: additional.error,
      initialUsage: analysis.usage,
      additionalUsage: additional.usage,
    });

    await writeFile(
      join(OUTPUT_DIR, `${c.id}.json`),
      JSON.stringify(results[results.length - 1], null, 2),
      'utf8',
    );
  }

  // ── Report ──
  const reportLines: string[] = [];
  reportLines.push('# STEP-SELFANALYSIS-QUESTION-QUALITY-QA-01 結果');
  reportLines.push('');
  reportLines.push(`- model: ${MODEL}`);
  reportLines.push(`- analysis max_tokens: ${ANALYSIS_MAX_TOKENS}`);
  reportLines.push(`- additional max_tokens: ${ADDITIONAL_MAX_TOKENS}`);
  reportLines.push(`- dry: ${FLAG_DRY}`);
  reportLines.push('');

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalHardGenerics = 0;
  let totalMissingKeyword = 0;
  let totalQuestions = 0;

  for (const r of results) {
    reportLines.push(`## ${r.label}`);
    reportLines.push('');
    reportLines.push('### 初期 5 問');
    if (r.initialQuestions) {
      r.initialQuestions.forEach((q, i) =>
        reportLines.push(`${i + 1}. ${q}`),
      );
    } else {
      reportLines.push(`(parse failed) error=${r.initialApiError}`);
      reportLines.push('raw head: ' + r.initialRaw.slice(0, 200));
    }
    reportLines.push('');
    reportLines.push('### 追加 2 問');
    if (r.additionalQuestions) {
      r.additionalQuestions.forEach((q, i) =>
        reportLines.push(`+${i + 1}. ${q}`),
      );
    } else {
      reportLines.push(`(parse failed) error=${r.additionalApiError}`);
      reportLines.push('raw head: ' + r.additionalRaw.slice(0, 200));
    }
    reportLines.push('');
    reportLines.push('### Lint 結果');
    reportLines.push(`- 初期 hard-generic: ${r.initialLint.hardGenerics.length}`);
    reportLines.push(`- 初期 keyword 欠落: ${r.initialLint.missingKeyword.length}`);
    reportLines.push(`- 追加 hard-generic: ${r.additionalLint.hardGenerics.length}`);
    reportLines.push(`- 追加 keyword 欠落: ${r.additionalLint.missingKeyword.length}`);
    reportLines.push('');
    reportLines.push('### Usage');
    reportLines.push(
      `- analysis input/output: ${r.initialUsage?.input_tokens ?? '?'} / ${r.initialUsage?.output_tokens ?? '?'}`,
    );
    reportLines.push(
      `- additional input/output: ${r.additionalUsage?.input_tokens ?? '?'} / ${r.additionalUsage?.output_tokens ?? '?'}`,
    );
    reportLines.push('');

    totalInputTokens += (r.initialUsage?.input_tokens ?? 0) + (r.additionalUsage?.input_tokens ?? 0);
    totalOutputTokens += (r.initialUsage?.output_tokens ?? 0) + (r.additionalUsage?.output_tokens ?? 0);
    totalHardGenerics += r.initialLint.hardGenerics.length + r.additionalLint.hardGenerics.length;
    totalMissingKeyword += r.initialLint.missingKeyword.length + r.additionalLint.missingKeyword.length;
    totalQuestions += (r.initialQuestions?.length ?? 0) + (r.additionalQuestions?.length ?? 0);
  }

  reportLines.push('## サマリ');
  reportLines.push(`- 総質問数: ${totalQuestions}`);
  reportLines.push(`- hard-generic 違反: ${totalHardGenerics} 件`);
  reportLines.push(`- keyword 欠落 (warning): ${totalMissingKeyword} / ${totalQuestions}`);
  reportLines.push(`- 合計 token usage: input=${totalInputTokens} output=${totalOutputTokens}`);

  await writeFile(join(OUTPUT_DIR, 'report.md'), reportLines.join('\n'), 'utf8');
  console.log(`\nreport: ${join(OUTPUT_DIR, 'report.md')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
