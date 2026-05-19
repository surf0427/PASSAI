/*
 * scripts/step-interview-applicant-type-qa.ts
 *
 * STEP E2 QA harness: interview-questions の applicantType 注入効果検証
 *
 * 目的:
 *   STEP E1 で buildInterviewQuestionMaterials / buildInterviewQuestionUserPrompt に
 *   追加した applicantType 由来「傾向」1 行が、固定 6 cases（baseline +
 *   5 種 applicantType）に対して以下を満たすかを観測する:
 *     - general 5 + personalized 5 の構造が壊れないこと
 *     - TwoLayerInterviewQuestions schema validity 100%
 *     - applicantType enum 文字列（"activity_driven" 等）が質問本文に漏れないこと
 *     - personalized の category / sourceHint / intent 分布が applicantType に応じて
 *       「薄く」方向シフトすること（observation のみ、自動判定はしない）
 *     - general 質問が applicantType に過度に依存しないこと（observation のみ）
 *
 * 設計方針:
 *   - production code は触らない（lib/...、app/api/...、aiInputHash.ts 等）
 *   - 各 case の入力は本ファイル内に固定（regression QA で再現可能）
 *   - lib/ の SYSTEM_PROMPT と prompt builder を直接 import して本番経路を再現
 *   - Anthropic SDK を直接叩く（Next.js route 層は通さない → cache / log / route handler
 *     の副作用は一切発生しない）
 *   - 出力を tmp/interview-applicant-type-qa/ に保存（per-call JSON + by-case 集計 +
 *     summary.md）
 *   - logAiUsage / logAiCache の本番レーンは利用しない（QA harness 独自レーン）
 *
 * 使い方:
 *   ANTHROPIC_API_KEY=sk-... npx tsx scripts/step-interview-applicant-type-qa.ts
 *   または .env.local に ANTHROPIC_API_KEY を書いて:
 *     npx tsx scripts/step-interview-applicant-type-qa.ts
 *
 * オプション:
 *   --dry              API を呼ばず prompt 構築のみ。tmp/ への JSON 書き込みなし
 *   --verbose          system / user prompt を stdout にも出す
 *   --runs <N>         case あたりの繰り返し回数（default 1）
 *   --case <id>        単一 case のみ実行（例: baseline, activity_driven, ...）
 *
 * 出力:
 *   tmp/interview-applicant-type-qa/case-<id>-run<n>.json
 *   tmp/interview-applicant-type-qa/by-case.json
 *   tmp/interview-applicant-type-qa/summary.md
 */

import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// production prompt + builder imports（本番経路をそのまま叩く）
import {
  INTERVIEW_QUESTION_SYSTEM_PROMPT,
  buildInterviewQuestionUserPrompt,
} from '../lib/interview/buildInterviewQuestionPrompt';
import { buildInterviewQuestionMaterials } from '../lib/interview/buildInterviewQuestionMaterials';
import { parseInterviewQuestions } from '../lib/interview/parseInterviewQuestions';
import {
  APPLICANT_TYPES,
  type ApplicantType,
} from '../types/applicantType';

import type { BasicInfo } from '../types/basicInfo';
import type { StudentProfile } from '../types/studentProfile';
import type { StatementDraft } from '../lib/statement/review/statementStorage';
import type {
  TwoLayerInterviewQuestions,
  PersonalizedInterviewQuestion,
} from '../types/interviewQuestions';

// ─────────────────────────────────────────────────────────────
// CLI args
// ─────────────────────────────────────────────────────────────

const ARGS = process.argv.slice(2);
const FLAG_DRY = ARGS.includes('--dry');
const FLAG_VERBOSE = ARGS.includes('--verbose');

function getFlagValue(name: string): string | null {
  const idx = ARGS.indexOf(name);
  if (idx === -1 || idx === ARGS.length - 1) return null;
  return ARGS[idx + 1];
}

const SELECTED_CASE = getFlagValue('--case');
const RUNS = (() => {
  const raw = getFlagValue('--runs');
  if (!raw) return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    console.error(`--runs must be a positive integer (got: ${raw})`);
    process.exit(1);
  }
  return n;
})();

// ─────────────────────────────────────────────────────────────
// .env.local loader（依存追加なし）
// ─────────────────────────────────────────────────────────────

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
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvLocal();

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!FLAG_DRY && !API_KEY) {
  console.error('ANTHROPIC_API_KEY missing (.env.local or env var). --dry で API 呼び出し回避可能。');
  process.exit(1);
}

// production interview-questions route と同じ model / max_tokens / temperature を hard-code。
// app/api/interview-questions/route.ts の MODEL / MAX_TOKENS / TEMPERATURE と揃えること。
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 2200;
const TEMPERATURE = 0.4;

const client = !FLAG_DRY && API_KEY ? new Anthropic({ apiKey: API_KEY }) : null;

// ─────────────────────────────────────────────────────────────
// shared inputs（全 case で固定。applicantType だけが case ごとに変わる）
//
// 同一の basicInfo / statementDraft / activitySummary / baseStudentProfile を使い、
// studentProfile.applicantType のみ 6 種類（undefined + 5 種）で切り替えることで、
// 「同じ受験生情報で型の傾向だけ変わったときの質問の方向シフト」を観測する。
// ─────────────────────────────────────────────────────────────

const baseBasicInfo: BasicInfo = {
  name: 'サンプル受験生',
  grade: '高3',
  track: '文系',
  preferences: [
    { university: '中央大学', faculty: '経済学部', department: '経済学科' },
  ],
  examTypes: ['総合型選抜（AO入試）'],
  overallGpa: '4.2',
};

const baseStatementDraft: StatementDraft = {
  university: '中央大学',
  faculty: '経済学部',
  department: '経済学科',
  statementText:
    '私は高校3年間で部活動・地域ボランティア・探究活動に取り組み、社会と関わる経験を通じて、' +
    '人と地域が支え合う仕組みに関心を持つようになりました。サッカー部キャプテンとして組織を動かす経験、' +
    '子ども食堂の運営補助で見た地域の実態、地域包括ケアをテーマにした探究活動、' +
    'これらが少しずつ繋がりはじめています。貴学経済学部では、社会の仕組みを支える人や制度を' +
    '経済的視点で学び直し、自分の関心を学問として深めたいと考えています。将来は地域に根差した' +
    '仕事を通じて、人と社会をつなぐ役割を担いたいです。',
};

const baseActivitySummary =
  'サッカー部（高1〜高3、キャプテン、都大会ベスト16）。' +
  '子ども食堂運営補助（高1〜、月2回）。' +
  '探究活動「地域の高齢化と地域包括ケアの実態」（高2〜高3、校内発表で受賞）。';

const baseStudentProfile: Omit<StudentProfile, 'applicantType'> = {
  version: 1,
  generatedAt: '2026-05-19T00:00:00Z',
  sourceHash: 'qa-interview-applicantType-baseline',
  summary:
    'サッカー部キャプテンと地域ボランティアを通じて社会と関わる経験を積んできた。' +
    '志望理由書では、活動・問題意識・将来像を結びつけたい。',
  strengths: [
    'サッカー部キャプテンとして組織を動かす力（都大会ベスト16導出）',
    '地域ボランティア活動の継続力（子ども食堂月2回・高1から3年継続）',
    '社会課題への問題意識（地域包括ケアの探究活動で校内発表受賞）',
  ],
  weaknesses: [
    '志望理由書本文で活動と将来像の接続がやや弱い',
    '学問領域への踏み込みが現時点では不足している',
  ],
  futureConnections: [
    '地域包括ケアに関わる人になりたい',
    '社会と人の関係を学問的に理解する素地を作りたい',
  ],
  valueKeywords: ['継続', '貢献', 'リーダーシップ', '探究'],
  signatureEpisodes: [
    {
      title: 'サッカー部キャプテン',
      summary:
        'サッカー部キャプテンとして都大会ベスト16導出。練習メニュー再設計と全員参加型ミーティングで部の温度差を縮めた。',
      relatedStrengthIdx: 0,
    },
    {
      title: '地域包括ケア探究',
      summary:
        '高齢化の地域実態を聞き取り調査し、校内発表で受賞。社会課題への問題意識の起点。',
      relatedStrengthIdx: 2,
    },
  ],
};

function makeProfile(applicantType: ApplicantType | undefined): StudentProfile {
  return {
    ...baseStudentProfile,
    applicantType,
  };
}

// ─────────────────────────────────────────────────────────────
// cases
//
// 6 cases:
//   - baseline (applicantType undefined)
//   - 5 種それぞれ
// 同一 baseStudentProfile に対して applicantType だけ変える。
// ─────────────────────────────────────────────────────────────

type Case = {
  id: string;
  applicantType: ApplicantType | undefined;
  description: string;
};

const CASES: Case[] = [
  {
    id: 'baseline',
    applicantType: undefined,
    description: 'baseline: applicantType 未保持（旧 StudentProfile 互換）',
  },
  {
    id: 'activity_driven',
    applicantType: 'activity_driven',
    description: '活動実績型: 問題意識/学問との接続深掘り方向',
  },
  {
    id: 'issue_driven',
    applicantType: 'issue_driven',
    description: '社会課題型: 経験との接続/当事者性深掘り方向',
  },
  {
    id: 'academic_driven',
    applicantType: 'academic_driven',
    description: '学問探究型: 行動・実践への落とし込み深掘り方向',
  },
  {
    id: 'growth_driven',
    applicantType: 'growth_driven',
    description: '自己成長型: 大学・将来との接続/継続性深掘り方向',
  },
  {
    id: 'value_driven',
    applicantType: 'value_driven',
    description: '原体験・価値観型: 学問・志望先との論理的接続深掘り方向',
  },
];

// ─────────────────────────────────────────────────────────────
// enum string leak detection
//
// AI が prompt の「傾向（参考情報・断定ではない）」を質問本文・answerTip 内に
// 反復してしまうと内部 context が漏洩する。enum 文字列 5 種は prompt 内では
// 流していない（日本語ラベル + ヒント文だけ）ので、質問テキストに出てきたら
// 即座に red flag。
// ─────────────────────────────────────────────────────────────

const ENUM_LEAK_PATTERNS: readonly string[] = APPLICANT_TYPES; // 5 種 enum 文字列そのもの

function detectEnumLeak(parsed: TwoLayerInterviewQuestions): string[] {
  const hits: string[] = [];
  const allTexts: Array<{ where: string; text: string }> = [];
  for (let i = 0; i < parsed.general.length; i++) {
    allTexts.push({ where: `general[${i}].question`, text: parsed.general[i].question });
    allTexts.push({ where: `general[${i}].answerTip`, text: parsed.general[i].answerTip });
  }
  for (let i = 0; i < parsed.personalized.length; i++) {
    allTexts.push({ where: `personalized[${i}].question`, text: parsed.personalized[i].question });
    allTexts.push({ where: `personalized[${i}].answerTip`, text: parsed.personalized[i].answerTip });
    const intent = parsed.personalized[i].intent;
    if (intent) allTexts.push({ where: `personalized[${i}].intent`, text: intent });
  }
  for (const { where, text } of allTexts) {
    for (const pattern of ENUM_LEAK_PATTERNS) {
      if (text.includes(pattern)) {
        hits.push(`${where} contains "${pattern}"`);
      }
    }
  }
  return hits;
}

// ─────────────────────────────────────────────────────────────
// runner
// ─────────────────────────────────────────────────────────────

type RunResult = {
  caseId: string;
  run: number;
  applicantType: ApplicantType | undefined;
  schemaValid: boolean;
  parseError: string | null;
  generalCount: number;
  personalizedCount: number;
  personalizedCategories: Record<string, number>;
  personalizedSourceHints: Record<string, number>;
  personalizedIntents: string[];
  enumLeakHits: string[];
  stopReason: string | null;
  usage: { input_tokens: number; output_tokens: number } | null;
  parsed: TwoLayerInterviewQuestions | null;
  rawText: string;
};

async function runOne(c: Case, run: number): Promise<RunResult> {
  const profile = makeProfile(c.applicantType);
  const materials = buildInterviewQuestionMaterials({
    basicInfo: baseBasicInfo,
    statementDraft: baseStatementDraft,
    studentProfile: profile,
    activitySummary: baseActivitySummary,
  });
  // QA harness では universityContext / examTypeGuidance を null にして変数を絞る
  // （step15-qa.ts の interview セクションと同方針）。
  const userPrompt = buildInterviewQuestionUserPrompt({
    materials,
    universityContext: null,
    examTypeGuidance: null,
  });

  if (FLAG_VERBOSE && run === 1) {
    console.log(`\n──── case ${c.id} ─ system prompt ────\n${INTERVIEW_QUESTION_SYSTEM_PROMPT}\n`);
    console.log(`──── case ${c.id} ─ user prompt ────\n${userPrompt}\n`);
  }

  if (FLAG_DRY || !client) {
    return {
      caseId: c.id,
      run,
      applicantType: c.applicantType,
      schemaValid: false,
      parseError: null,
      generalCount: 0,
      personalizedCount: 0,
      personalizedCategories: {},
      personalizedSourceHints: {},
      personalizedIntents: [],
      enumLeakHits: [],
      stopReason: 'dry',
      usage: null,
      parsed: null,
      rawText: '',
    };
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    system: INTERVIEW_QUESTION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  const rawText = textBlock?.type === 'text' ? textBlock.text : '';

  let parsed: TwoLayerInterviewQuestions | null = null;
  let parseError: string | null = null;
  try {
    parsed = parseInterviewQuestions(rawText);
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }

  const personalizedCategories: Record<string, number> = {};
  const personalizedSourceHints: Record<string, number> = {};
  const personalizedIntents: string[] = [];
  let enumLeakHits: string[] = [];

  if (parsed) {
    for (const p of parsed.personalized) {
      personalizedCategories[p.category] = (personalizedCategories[p.category] ?? 0) + 1;
      const sh = (p as PersonalizedInterviewQuestion).sourceHint;
      if (sh) {
        personalizedSourceHints[sh] = (personalizedSourceHints[sh] ?? 0) + 1;
      } else {
        personalizedSourceHints['(none)'] = (personalizedSourceHints['(none)'] ?? 0) + 1;
      }
      if (p.intent) personalizedIntents.push(p.intent);
    }
    enumLeakHits = detectEnumLeak(parsed);
  }

  return {
    caseId: c.id,
    run,
    applicantType: c.applicantType,
    schemaValid: parsed !== null,
    parseError,
    generalCount: parsed?.general.length ?? 0,
    personalizedCount: parsed?.personalized.length ?? 0,
    personalizedCategories,
    personalizedSourceHints,
    personalizedIntents,
    enumLeakHits,
    stopReason: response.stop_reason,
    usage: response.usage
      ? {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        }
      : null,
    parsed,
    rawText,
  };
}

// ─────────────────────────────────────────────────────────────
// aggregation
// ─────────────────────────────────────────────────────────────

type CaseAggregate = {
  id: string;
  applicantType: ApplicantType | undefined;
  description: string;
  runs: number;
  schemaValidCount: number;
  generalCounts: number[];
  personalizedCounts: number[];
  personalizedCategoriesSum: Record<string, number>;
  personalizedSourceHintsSum: Record<string, number>;
  personalizedIntentSamples: string[];
  enumLeakAny: boolean;
  enumLeakHits: string[];
  redFlags: string[];
};

function aggregateCase(c: Case, results: RunResult[]): CaseAggregate {
  const personalizedCategoriesSum: Record<string, number> = {};
  const personalizedSourceHintsSum: Record<string, number> = {};
  const personalizedIntentSamples: string[] = [];
  const enumLeakHits: string[] = [];

  for (const r of results) {
    for (const [k, v] of Object.entries(r.personalizedCategories)) {
      personalizedCategoriesSum[k] = (personalizedCategoriesSum[k] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(r.personalizedSourceHints)) {
      personalizedSourceHintsSum[k] = (personalizedSourceHintsSum[k] ?? 0) + v;
    }
    personalizedIntentSamples.push(...r.personalizedIntents);
    enumLeakHits.push(...r.enumLeakHits.map((h) => `run${r.run}: ${h}`));
  }

  const redFlags: string[] = [];
  for (const r of results) {
    if (!r.schemaValid) {
      redFlags.push(`run${r.run}: schema parse failed (${r.parseError ?? 'unknown'})`);
    }
    if (r.schemaValid && r.generalCount !== 5) {
      redFlags.push(`run${r.run}: general が ${r.generalCount} 問（5 問でない）`);
    }
    if (r.schemaValid && r.personalizedCount !== 5) {
      redFlags.push(`run${r.run}: personalized が ${r.personalizedCount} 問（5 問でない）`);
    }
  }
  if (enumLeakHits.length > 0) {
    redFlags.push(
      `enum 文字列漏洩 ${enumLeakHits.length} 件: ${enumLeakHits.slice(0, 3).join(' / ')}${enumLeakHits.length > 3 ? ' ...' : ''}`,
    );
  }
  // personalized 観点が全部同じ単一 category の場合（diversity 崩壊）
  const categoryEntries = Object.entries(personalizedCategoriesSum);
  if (categoryEntries.length === 1 && (categoryEntries[0][1] ?? 0) >= 5) {
    redFlags.push(
      `personalized が単一 category (${categoryEntries[0][0]}) に偏っている`,
    );
  }

  return {
    id: c.id,
    applicantType: c.applicantType,
    description: c.description,
    runs: results.length,
    schemaValidCount: results.filter((r) => r.schemaValid).length,
    generalCounts: results.map((r) => r.generalCount),
    personalizedCounts: results.map((r) => r.personalizedCount),
    personalizedCategoriesSum,
    personalizedSourceHintsSum,
    personalizedIntentSamples,
    enumLeakAny: enumLeakHits.length > 0,
    enumLeakHits,
    redFlags,
  };
}

function buildSummaryMarkdown(aggregates: CaseAggregate[]): string {
  const lines: string[] = [];
  lines.push('# Interview applicantType QA summary');
  lines.push('');
  lines.push(
    `model: ${MODEL} / max_tokens: ${MAX_TOKENS} / temperature: ${TEMPERATURE} / runs per case: ${RUNS} / cases: ${aggregates.length}`,
  );
  lines.push(`generated: ${new Date().toISOString()}`);
  lines.push('');

  // per-case overview
  lines.push('## per-case overview');
  lines.push('');
  lines.push('| case | applicantType | runs | schema valid | general | personalized | enum leak |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const a of aggregates) {
    const generalStr = a.generalCounts.length > 0 ? a.generalCounts.join('/') : '-';
    const personalizedStr = a.personalizedCounts.length > 0 ? a.personalizedCounts.join('/') : '-';
    lines.push(
      `| ${a.id} | ${a.applicantType ?? '(undefined)'} | ${a.runs} | ${a.schemaValidCount}/${a.runs} | ${generalStr} | ${personalizedStr} | ${a.enumLeakAny ? 'YES' : 'none'} |`,
    );
  }
  lines.push('');

  // personalized category distribution
  const allCategories = new Set<string>();
  for (const a of aggregates) {
    for (const k of Object.keys(a.personalizedCategoriesSum)) allCategories.add(k);
  }
  const orderedCategories = [...allCategories].sort();
  if (orderedCategories.length > 0) {
    lines.push('## personalized category distribution (count per case across all runs)');
    lines.push('');
    lines.push(`| case | ${orderedCategories.join(' | ')} |`);
    lines.push(`|---|${orderedCategories.map(() => '---').join('|')}|`);
    for (const a of aggregates) {
      const row = orderedCategories.map((k) => String(a.personalizedCategoriesSum[k] ?? 0));
      lines.push(`| ${a.id} | ${row.join(' | ')} |`);
    }
    lines.push('');
  }

  // personalized sourceHint distribution
  const allSourceHints = new Set<string>();
  for (const a of aggregates) {
    for (const k of Object.keys(a.personalizedSourceHintsSum)) allSourceHints.add(k);
  }
  const orderedHints = [...allSourceHints].sort();
  if (orderedHints.length > 0) {
    lines.push('## personalized sourceHint distribution (count per case across all runs)');
    lines.push('');
    lines.push(`| case | ${orderedHints.join(' | ')} |`);
    lines.push(`|---|${orderedHints.map(() => '---').join('|')}|`);
    for (const a of aggregates) {
      const row = orderedHints.map((k) => String(a.personalizedSourceHintsSum[k] ?? 0));
      lines.push(`| ${a.id} | ${row.join(' | ')} |`);
    }
    lines.push('');
  }

  // intent samples per case (first 5)
  lines.push('## personalized intent samples (up to 5 per case)');
  lines.push('');
  for (const a of aggregates) {
    const sampled = a.personalizedIntentSamples.slice(0, 5);
    lines.push(`- **${a.id}**${a.applicantType ? ` (${a.applicantType})` : ''}:`);
    if (sampled.length === 0) {
      lines.push('  - （intent が記録されなかった / dry mode）');
    } else {
      for (const s of sampled) lines.push(`  - ${s}`);
    }
  }
  lines.push('');

  // red flags
  lines.push('## red flags');
  lines.push('');
  const allRedFlags: string[] = [];
  for (const a of aggregates) {
    for (const f of a.redFlags) {
      allRedFlags.push(`${a.id}: ${f}`);
    }
  }
  if (allRedFlags.length === 0) {
    lines.push('- （特になし）');
  } else {
    for (const f of allRedFlags) lines.push(`- ${f}`);
  }
  lines.push('');

  // note on observation
  lines.push('## 観察メモ（自動判定外）');
  lines.push('');
  lines.push(
    '- general 質問が applicantType に過度に依存していないかは、case 間の general 質問本文を per-call JSON で比較して人間が判断する',
  );
  lines.push(
    '- personalized 観点シフトの「合理性」も per-call JSON で確認する（数値分布だけでは判断不能）',
  );
  lines.push(
    '- baseline と各 applicantType case の質問構成（category 分布・intent 文言）を見比べることが本 QA の目的',
  );
  lines.push('');

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `interview applicantType QA harness — model=${MODEL} runs=${RUNS} dry=${FLAG_DRY} verbose=${FLAG_VERBOSE}`,
  );

  const outDir = join(process.cwd(), 'tmp', 'interview-applicant-type-qa');
  await mkdir(outDir, { recursive: true });

  const filteredCases = SELECTED_CASE
    ? CASES.filter((c) => c.id.toLowerCase() === SELECTED_CASE.toLowerCase())
    : CASES;
  if (filteredCases.length === 0) {
    console.error(`No case matches --case=${SELECTED_CASE}`);
    console.error(`Available: ${CASES.map((c) => c.id).join(', ')}`);
    process.exit(1);
  }

  const aggregates: CaseAggregate[] = [];

  for (const c of filteredCases) {
    process.stdout.write(`Running ${c.id} (${RUNS} runs)... `);
    const results: RunResult[] = [];
    for (let run = 1; run <= RUNS; run++) {
      const r = await runOne(c, run);
      results.push(r);
      if (!FLAG_DRY) {
        await writeFile(
          join(outDir, `case-${c.id}-run${run}.json`),
          JSON.stringify(r, null, 2),
          'utf-8',
        );
      }
    }
    const agg = aggregateCase(c, results);
    aggregates.push(agg);
    const summaryStr = FLAG_DRY
      ? 'dry'
      : `valid=${agg.schemaValidCount}/${agg.runs} general=${agg.generalCounts.join('/')} personalized=${agg.personalizedCounts.join('/')} leak=${agg.enumLeakAny ? 'YES' : 'no'}`;
    console.log(`done — ${summaryStr}`);
  }

  if (FLAG_DRY) {
    console.log('\n(dry mode) prompt 構築までで終了。tmp/ への JSON 書き込みは skip。');
    return;
  }

  // by-case.json
  const byCase: Record<string, CaseAggregate> = {};
  for (const a of aggregates) byCase[a.id] = a;
  await writeFile(
    join(outDir, 'by-case.json'),
    JSON.stringify(byCase, null, 2),
    'utf-8',
  );

  // summary.md
  const summary = buildSummaryMarkdown(aggregates);
  await writeFile(join(outDir, 'summary.md'), summary, 'utf-8');

  console.log(`\n=== Output: ${outDir} ===`);
  console.log('\n' + summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
