/*
 * scripts/step-applicant-type-qa.ts
 *
 * STEP D QA harness: analysis route の applicantType 推定品質検証
 *
 * 目的:
 *   STEP B で /api/analysis 出力 JSON schema に追加した applicantType（5 種 enum）が、
 *   固定 10 cases（T1〜T5: 各 type 期待 case / M1〜M3: mixed / E1〜E2: edge）に対して
 *   実 AI 出力で「期待通りに推定されるか」「分布に偏りがないか」「validity を保つか」を観測する。
 *
 * 設計方針:
 *   - production code は触らない（lib/...、app/api/...、aiInputHash.ts 等）
 *   - 各 case の入力は本ファイル内に固定（regression QA で再現可能）
 *   - lib/ の SYSTEM_PROMPT と prompt builder と isApplicantType validator を import して
 *     本番経路の挙動を完全再現する
 *   - Anthropic SDK を直接叩く（Next.js route 層は通さない → cache / log / route handler の
 *     副作用は一切発生しない）
 *   - 出力を tmp/applicant-type-qa/ に保存（per-call JSON + by-case 集計 + summary.md）
 *   - logAiUsage / logAiCache の本番レーンは利用しない（QA harness 独自の出力レーン）
 *
 * 使い方:
 *   ANTHROPIC_API_KEY=sk-... npx tsx scripts/step-applicant-type-qa.ts
 *   または .env.local に ANTHROPIC_API_KEY を書いて:
 *     npx tsx scripts/step-applicant-type-qa.ts
 *
 * オプション:
 *   --dry              API を呼ばず prompt 構築のみ。tmp/ への JSON 書き込みなし
 *   --verbose          system / user prompt を stdout にも出す
 *   --runs <N>         case あたりの繰り返し回数（default 3）
 *   --case <id>        単一 case のみ実行（例: T1-activity, E1-sparse）
 *
 * 出力:
 *   tmp/applicant-type-qa/case-<id>-run<n>.json   ... per-call の生 AI 出力 + parsed
 *   tmp/applicant-type-qa/by-case.json            ... case 別の集計（actuals / stable / validity）
 *   tmp/applicant-type-qa/summary.md              ... 人間可読サマリ（分布 / red flags）
 */

import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// production prompt + validator imports（本番経路をそのまま叩く）
import {
  ANALYSIS_SYSTEM_PROMPT,
  buildWallHittingPrompt,
} from '../lib/prompts/analysisPrompt';
import { extractJson } from '../lib/ai';
import {
  APPLICANT_TYPES,
  isApplicantType,
  type ApplicantType,
} from '../types/applicantType';

import type { BasicInfo } from '../types/basicInfo';
import type { UniversityContext } from '../types/universityContext';

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
  if (!raw) return 3;
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

// production analysis route と同じ model / max_tokens を hard-code（drift 防止）
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 2000;

const client = !FLAG_DRY && API_KEY ? new Anthropic({ apiKey: API_KEY }) : null;

// ─────────────────────────────────────────────────────────────
// shared inputs（全 case で固定。activityText だけが case ごとに変わる）
//
// 「同じ basicInfo / universityContext で activityText だけ変えたとき
//  applicantType がどう動くか」を観測したいので、basicInfo は中立に保つ。
// ─────────────────────────────────────────────────────────────

const baseBasicInfo: BasicInfo = {
  name: 'サンプル受験生',
  grade: '高3',
  track: '文系',
  preferences: [
    { university: '都内国公立大学', faculty: '人文社会系学部', department: '社会学科' },
  ],
  examTypes: ['総合型選抜（AO入試）'],
  overallGpa: '4.2',
};

const baseUniversityContext: UniversityContext = {
  universityName: '都内国公立大学',
  facultyName: '人文社会系学部',
  departmentName: '社会学科',
  examTypes: ['総合型選抜（AO入試）'],
};

// ─────────────────────────────────────────────────────────────
// cases
//
// 設計（STEP D 設計案 §2 より）:
//   T1-T5 = 5 type それぞれを純度高めに表現する case（期待値あり）
//   M1-M3 = 2 type が同程度に混ざる case（期待値なし、AI の重み付けを観測）
//   E1-E2 = sparse / generic な edge case（期待値なし、prompt の弱さを炙る）
// activityText は本番経路で formatActivityData() が出力する文字列の代わりに
// 手書きの文章を直接渡す（QA で観測したいのは「prompt が文章特性を拾えるか」のため、
// formatActivityData 経由ではなく直接渡す方が変数が少ない）。
// ─────────────────────────────────────────────────────────────

type Case = {
  id: string;
  expected: ApplicantType | null; // null = mixed / edge（評価軸が「期待 hit」ではない）
  description: string;
  activityText: string;
};

const CASES: Case[] = [
  {
    id: 'T1-activity',
    expected: 'activity_driven',
    description: '部活キャプテン + 生徒会長 + 学園祭運営。実績・運営・主体性が前面',
    activityText:
      '【活動データ】\n' +
      'サッカー部キャプテン（高1〜高3）。3年間継続し、最終学年で都大会ベスト8に導いた。' +
      '練習メニューを部員主導で再設計し、全員参加型のミーティングを毎週実施した。\n' +
      '生徒会副会長（高2〜高3）。全校行事の運営を統括し、文化祭・体育祭・卒業式の進行を取り仕切った。' +
      '校則改革プロジェクトを発案し、生徒投票を経て複数項目の改定を実現した。\n' +
      '学園祭実行委員長（高3）。600人規模のイベントを企画運営し、企画書作成から当日運営まで主導。' +
      '来場者数を前年比1.5倍に伸ばした。\n' +
      'いずれの活動でも自分が中心で動き、組織を回すこと・成果を出すことに最も手応えを感じている。',
  },
  {
    id: 'T2-issue',
    expected: 'issue_driven',
    description: '地域高齢化 + 子ども食堂 + 環境問題。社会課題が出発点',
    activityText:
      '【活動データ】\n' +
      '地域の高齢化と独居高齢者の孤立に強い違和感を覚え、高1から月2回、子ども食堂の運営補助に参加している。' +
      '配膳と学習サポートを担当し、世代を超えた居場所がいかに必要かを実感した。\n' +
      'プラスチック削減運動に高2から関わり、地域の小学校で出前授業を企画。' +
      '海洋ごみ問題と生活の関わりを教材化して伝えた。\n' +
      '校内ではフードロスについて全校生徒へ意識調査を実施し、給食残量データと併せて校内発表した。' +
      '社会の課題を見聞きすると放置できず、現場に出向いて当事者の声を聞くことに時間を割いている。' +
      '何かを「解決したい」気持ちが自分を動かす原動力になっている。',
  },
  {
    id: 'T3-academic',
    expected: 'academic_driven',
    description: '数学探究 + 研究 + 知的関心。学問的好奇心が中心',
    activityText:
      '【活動データ】\n' +
      '中学から数学が好きで、高校では数学オリンピック予選に3年連続出場した。' +
      '「なぜ素数は無限に存在するか」というユークリッドの証明に出会って整数論に強い関心を持ち、' +
      '入門書を独学で読み進めた。\n' +
      '高2からの探究授業では「感染症の数理モデル」をテーマに研究。微分方程式を独習し、' +
      'SIR モデルのシミュレーションを Python で実装した。校内研究発表で受賞した。\n' +
      '読書は科学史と数理科学の専門書が中心で、「なぜそうなるのか」を突き詰めることが性格的に' +
      '止められない。何かに行動するより前に、まずその現象の構造を理解したいと思う。',
  },
  {
    id: 'T4-growth',
    expected: 'growth_driven',
    description: '英語苦手 → 留学 → 克服。挑戦・自己変容の物語',
    activityText:
      '【活動データ】\n' +
      '中学までは英語が大の苦手で、定期テストは平均以下が続いた。' +
      '高校入学時に「このままでは何も変わらない」と一念発起し、両親に頭を下げて' +
      '高1の夏にニュージーランドへ3ヶ月の語学留学に挑戦した。\n' +
      'ホームステイ先で英語が全く通じず最初の2週間は毎晩泣いていたが、' +
      '帰国後も毎日2時間の英語学習を継続。高3で英検準1級に合格した。\n' +
      'この経験を経て、苦手な自分を変えられた手応えが大きな自信になり、' +
      '部活でも新しいポジションへの挑戦、生徒会でも初めての企画立案など、' +
      '何かを「変える側」に立つことに自分のテーマがあると感じるようになった。',
  },
  {
    id: 'T5-value',
    expected: 'value_driven',
    description: '祖母介護 + ボランティア + 人との関わり。原体験・価値観が中心',
    activityText:
      '【活動データ】\n' +
      '小学5年のとき、祖母を介護する母を間近で見て育った。祖母との会話で' +
      '「人は最期まで誰かと関わりたいんだ」と感じたことが、今の自分の根本にある。\n' +
      '高校では老人ホームでのボランティアに高1から継続参加し、入居者の人生史を' +
      '聞き取りながらノートに記録している。一人ひとりの人生の重みに触れるたび、' +
      '人と深く関わる時間が自分にとって何よりも意味のあるものだと再確認する。\n' +
      '学業や部活の成果よりも、「誰と」「どんな関係性で」過ごせたかを大切にしてきた。' +
      '価値観の出発点はいつも家族と祖母にあり、そこから自分の進路を考えている。',
  },
  {
    id: 'M1-activity+issue',
    expected: null,
    description: '生徒会長 + フードバンク。活動と社会課題が同程度',
    activityText:
      '【活動データ】\n' +
      '高2〜高3で生徒会長を務め、校則改革プロジェクトを主導した。' +
      '全校アンケートを設計し、教員と6回の交渉会を経て4項目の改定を実現した。\n' +
      '同時に、地域の貧困家庭を支援するフードバンクのボランティアに高1から関わり、' +
      '月4回の食料配布と運営会議への参加を継続している。\n' +
      '組織を動かすことと、社会の困りごとに現場で関わること、どちらも自分の中で' +
      '同じくらい大切で、どちらか片方では物足りないと感じる。',
  },
  {
    id: 'M2-academic+growth',
    expected: null,
    description: '物理苦手 → 量子力学研究。学問と成長が同程度',
    activityText:
      '【活動データ】\n' +
      '高校入学時、物理がまったく理解できず最下位レベルだった。' +
      '「分からないことが悔しい」と感じ、基礎から学び直すために独習を始めた。\n' +
      '高2で探究テーマに「量子力学の確率解釈」を選び、関連書籍を10冊以上読破。' +
      'ファインマン経路積分の入門部分まで自力で読み解いた。\n' +
      '苦手だった分野が一番好きな分野に変わった経験を経て、' +
      '「知らないことを知っていくプロセス」そのものに強い快感を覚えるようになった。' +
      '知的好奇心と、変わる自分への手応えが、自分の中で分かちがたく結びついている。',
  },
  {
    id: 'M3-value+academic',
    expected: null,
    description: '弟の闘病 → 生命倫理研究。原体験と学問が同程度',
    activityText:
      '【活動データ】\n' +
      '幼少期、難病の弟の闘病を家族で支えた経験から、医療と倫理について' +
      '深く考えるようになった。家族の中で交わされた「治療をどこまで続けるか」の議論が、' +
      '今も自分の問いの起点になっている。\n' +
      '高校では生命倫理に関する探究テーマを選び、安楽死をめぐる各国の議論を比較。' +
      '校内発表会で論考を発表した。\n' +
      '原体験が研究テーマに直結している自覚があり、家族のことを学問として問い直すこと自体が、' +
      '自分にとっての出発点になっている。価値観と学問探究が分けられない感覚がある。',
  },
  {
    id: 'E1-sparse',
    expected: null,
    description: 'sparse: 活動 1 件・短文・特性薄い',
    activityText:
      '【活動データ】\n' +
      '高校で軽音楽部に所属し、文化祭で演奏した。',
  },
  {
    id: 'E2-generic',
    expected: null,
    description: 'generic: 真面目に過ごしただけ、特徴ほぼなし',
    activityText:
      '【活動データ】\n' +
      '高校では真面目に勉強し、部活動も頑張りました。友人とも仲良くやってきました。' +
      '特別な活動はありませんが、毎日コツコツ努力してきたつもりです。',
  },
];

// ─────────────────────────────────────────────────────────────
// runner
// ─────────────────────────────────────────────────────────────

type RunResult = {
  caseId: string;
  run: number;
  expected: ApplicantType | null;
  rawApplicantType: unknown; // validation 前の生値
  actual: ApplicantType | null; // validation 通過後（null = drop された）
  valid: boolean;
  parseError: string | null;
  stopReason: string | null;
  usage: { input_tokens: number; output_tokens: number } | null;
  parsed: unknown;
  rawText: string;
};

async function runOne(c: Case, run: number): Promise<RunResult> {
  // 本番経路と同じ user prompt builder を使う。dynamic 部だけ組み立てる。
  const userPrompt = buildWallHittingPrompt({
    activityText: c.activityText,
    basicInfo: baseBasicInfo,
    universityContext: baseUniversityContext,
  });

  if (FLAG_VERBOSE && run === 1) {
    console.log(`\n──── case ${c.id} ─ system prompt ────\n${ANALYSIS_SYSTEM_PROMPT}\n`);
    console.log(`──── case ${c.id} ─ user prompt ────\n${userPrompt}\n`);
  }

  if (FLAG_DRY || !client) {
    // dry mode: AI を呼ばずに prompt 構築だけ確認する。null result を返す。
    return {
      caseId: c.id,
      run,
      expected: c.expected,
      rawApplicantType: null,
      actual: null,
      valid: false,
      parseError: null,
      stopReason: 'dry',
      usage: null,
      parsed: null,
      rawText: '',
    };
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: ANALYSIS_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  const rawText = textBlock?.type === 'text' ? textBlock.text : '';

  let parsed: unknown = null;
  let parseError: string | null = null;
  try {
    parsed = JSON.parse(extractJson(rawText));
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }

  const rawApplicantType =
    parsed && typeof parsed === 'object'
      ? (parsed as { applicantType?: unknown }).applicantType
      : null;
  const valid = isApplicantType(rawApplicantType);
  const actual = valid ? (rawApplicantType as ApplicantType) : null;

  return {
    caseId: c.id,
    run,
    expected: c.expected,
    rawApplicantType: rawApplicantType ?? null,
    actual,
    valid,
    parseError,
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
  expected: ApplicantType | null;
  description: string;
  runs: number;
  actuals: (ApplicantType | null)[];
  distribution: Partial<Record<ApplicantType | 'invalid', number>>;
  stable: boolean;
  validCount: number;
  expectedHits: number | null; // expected が null の case では null
};

function aggregateCase(c: Case, results: RunResult[]): CaseAggregate {
  const actuals = results.map((r) => r.actual);
  const distribution: Partial<Record<ApplicantType | 'invalid', number>> = {};
  for (const a of actuals) {
    const key = a ?? 'invalid';
    distribution[key] = (distribution[key] ?? 0) + 1;
  }
  const stable =
    actuals.length > 1 &&
    actuals.every((a) => a !== null && a === actuals[0]);
  const validCount = results.filter((r) => r.valid).length;
  const expectedHits =
    c.expected === null
      ? null
      : actuals.filter((a) => a === c.expected).length;

  return {
    id: c.id,
    expected: c.expected,
    description: c.description,
    runs: results.length,
    actuals,
    distribution,
    stable,
    validCount,
    expectedHits,
  };
}

function buildSummaryMarkdown(aggregates: CaseAggregate[]): string {
  const lines: string[] = [];
  lines.push('# applicantType QA summary');
  lines.push('');
  lines.push(
    `model: ${MODEL} / max_tokens: ${MAX_TOKENS} / runs per case: ${RUNS} / cases: ${aggregates.length}`,
  );
  lines.push(`generated: ${new Date().toISOString()}`);
  lines.push('');

  // per-case table
  lines.push('## per-case');
  lines.push('');
  lines.push('| case | expected | runs | distribution | stable | validity | expected hit |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const a of aggregates) {
    const distStr = Object.entries(a.distribution)
      .sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0))
      .map(([k, v]) => `${k}:${v}`)
      .join(' ');
    const stableStr = a.actuals.length > 1 ? (a.stable ? 'yes' : 'no') : 'n/a';
    const expectedHitStr =
      a.expectedHits === null ? 'n/a' : `${a.expectedHits}/${a.runs}`;
    lines.push(
      `| ${a.id} | ${a.expected ?? '(mixed/edge)'} | ${a.runs} | ${distStr} | ${stableStr} | ${a.validCount}/${a.runs} | ${expectedHitStr} |`,
    );
  }
  lines.push('');

  // global distribution
  const totalCalls = aggregates.reduce((sum, a) => sum + a.runs, 0);
  const globalDist: Record<string, number> = {};
  for (const a of aggregates) {
    for (const [k, v] of Object.entries(a.distribution)) {
      globalDist[k] = (globalDist[k] ?? 0) + (v ?? 0);
    }
  }
  lines.push(`## global distribution (${aggregates.length} cases × ${RUNS} runs = ${totalCalls} calls)`);
  lines.push('');
  const orderedKeys = [...APPLICANT_TYPES, 'invalid'];
  for (const k of orderedKeys) {
    const v = globalDist[k] ?? 0;
    const pct = totalCalls > 0 ? ((v / totalCalls) * 100).toFixed(1) : '0.0';
    lines.push(`- ${k.padEnd(20)} : ${v} (${pct}%)`);
  }
  lines.push('');

  // red flags
  const redFlags: string[] = [];
  for (const a of aggregates) {
    if (a.expected !== null && a.expectedHits !== null) {
      if (a.expectedHits < a.runs) {
        const mismatched = a.actuals
          .filter((x) => x !== a.expected)
          .map((x) => x ?? '(invalid)')
          .join(', ');
        redFlags.push(
          `${a.id}: expected=${a.expected} だが ${a.runs - a.expectedHits}/${a.runs} で逸脱（${mismatched}）`,
        );
      }
    }
    if (a.validCount < a.runs) {
      redFlags.push(
        `${a.id}: validity ${a.validCount}/${a.runs}（${a.runs - a.validCount} 件で 5 enum 以外を返した）`,
      );
    }
  }
  // global skew check
  if (totalCalls > 0) {
    for (const [k, v] of Object.entries(globalDist)) {
      if (k === 'invalid') continue;
      const ratio = v / totalCalls;
      if (ratio > 0.5) {
        redFlags.push(
          `global: ${k} が ${v}/${totalCalls} (${(ratio * 100).toFixed(1)}%) で過半数を占める → 偏り兆候`,
        );
      }
    }
  }
  lines.push('## red flags');
  lines.push('');
  if (redFlags.length === 0) {
    lines.push('- （特になし）');
  } else {
    for (const f of redFlags) lines.push(`- ${f}`);
  }
  lines.push('');

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `applicantType QA harness — model=${MODEL} runs=${RUNS} dry=${FLAG_DRY} verbose=${FLAG_VERBOSE}`,
  );

  const outDir = join(process.cwd(), 'tmp', 'applicant-type-qa');
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
    const actualsStr = agg.actuals.map((a) => a ?? '(invalid)').join(', ');
    console.log(`done — actuals=[${actualsStr}]`);
  }

  // dry mode は集計と summary 出力を skip（API 呼ばないので意味のある集計にならない）
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
