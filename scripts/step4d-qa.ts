/*
 * scripts/step4d-qa.ts
 *
 * STEP4d QA harness: statement-review への Admission Focus Context 接続検証。
 *
 * 目的:
 *   STEP4b で接続した admissionFocusContext が、固定入力 Case A/B/C に対して
 *   実 AI 出力を意図通りに変えるかを観測する（活動アピール寄り / 小論文寄り / fallback なし）。
 *
 * 設計方針:
 *   - production code は触らない（lib/...、app/api/...、aiInputHash.ts 等）
 *   - 各 Case の入力は本ファイル内に固定
 *   - lib/ の SYSTEM_PROMPT と prompt builder を import して本番経路を再現
 *   - Anthropic SDK を直接叩く（Next.js route 層は通さない）
 *   - 出力を tmp/step4d-qa/ に保存
 *
 * 使い方:
 *   npx tsx scripts/step4d-qa.ts
 */

import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// production prompt imports
import {
  STATEMENT_REVIEW_SYSTEM_PROMPT,
  buildStatementReviewPrompt,
} from '../lib/statement/review/statementPrompt';
import { getAdmissionFocusContextForUser } from '../lib/admissionFocus/getAdmissionFocusContextForUser';

import type { BasicInfo } from '../types/basicInfo';
import type { ActivityData } from '../types/activity';
import type { StudentProfile } from '../types/studentProfile';

// ── env ──────────────────────────────────────────────────────────
const ENV_PATH = join(process.cwd(), '.env.local');
if (existsSync(ENV_PATH)) {
  const raw = readFileSync(ENV_PATH, 'utf-8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('ANTHROPIC_API_KEY missing');
  process.exit(1);
}
const client = new Anthropic({ apiKey: API_KEY });
const MODEL = 'claude-sonnet-4-6'; // 本番 statement-review と同じ
const MAX_TOKENS = 1500;
const TEMPERATURE = 0.3;

// ── shared dummy inputs (compact / 各 case で上書き) ─────────────
const baseBasicInfo: BasicInfo = {
  schoolName: '都立サンプル高校',
  grade: '3年',
  gpa: '4.0',
  examTypes: ['総合型選抜（AO入試）'],
  subjectGrades: [],
  absences: '',
} as unknown as BasicInfo;

const baseActivityData: ActivityData = {
  clubActivities: [
    { clubName: 'サッカー部', role: 'キャプテン', achievement: '都大会ベスト16', period: '3年間' },
  ],
  volunteerActivities: [
    { name: '子ども食堂運営補助', period: '高2-高3', impact: '月2回参加、配膳と学習サポート' },
  ],
  researchActivities: [
    { theme: '地域の高齢化と地域包括ケアの実態', method: '聞き取り調査', result: '校内発表で受賞' },
  ],
  studyAbroadActivities: [],
  contestActivities: [],
  certificationActivities: [
    { certificationName: '英検準2級' },
  ],
} as unknown as ActivityData;

const baseStudentProfile: StudentProfile = {
  strengths: ['粘り強さ', 'チームをまとめる力'],
  weaknesses: ['視点を広げる時間が足りない'],
  valueKeywords: ['継続', '貢献'],
  summary: '部活で培ったリーダーシップと地域貢献活動を通じて、社会課題に関心を持ち始めた。',
  futureConnections: ['地域包括ケアに関わる人になりたい'],
} as unknown as StudentProfile;

// ── case definitions ────────────────────────────────────────────
type Case = {
  id: 'A' | 'B' | 'C';
  description: string;
  university: string;
  faculty: string;
  department: string;
  essay: string;
};

const CASES: Case[] = [
  {
    id: 'A',
    description: '活動アピール寄り（中央大学 経済学部 経済学科・自己推薦型・プレゼン有）',
    university: '中央大学',
    faculty: '経済学部',
    department: '経済学科',
    essay:
      '私は中学からサッカーを続け、高校3年間は部のキャプテンを務め、チームを都大会ベスト16へと導きました。練習メニューを再設計し、全員参加型のミーティングを毎週開催することで部内の温度差を縮めることに注力しました。' +
      '加えて、月2回の子ども食堂の運営補助に高2から参加しています。配膳と学習サポートを通じて、地域に必要とされる「居場所」とは何かを考えるようになりました。' +
      '校内では「地域の高齢化と地域包括ケアの実態」というテーマで聞き取り調査を実施し、校内発表会で受賞しました。' +
      '貴学を志望する理由は、こうした自分の経験を伸ばしたいからです。社会と関わり続け、人の役に立てるよう、貴学で学びを深めたいと考えています。よろしくお願いします。',
  },
  {
    id: 'B',
    description: '小論文・論述寄り（学習院大学 文学部 哲学科・公募制・小論文有）',
    university: '学習院大学',
    faculty: '文学部',
    department: '哲学科',
    essay:
      '私は現代社会において「働くこと」の意味が大きく揺らいでいると感じています。SNSやAIの普及で職業の境界線が曖昧になり、効率や成果のみで人間を測る価値観が広がっているように思います。' +
      'こうした現状に違和感を覚え、人間の幸福や意味とは何かを根本から問い直したいと考えるようになりました。高校の倫理の授業でカントやアリストテレスに触れた時、自分の問いが哲学という形ですでに問い続けられてきたことに気づき、強く惹かれました。' +
      'また、大学のオープンキャンパスで参加した模擬授業も志望のきっかけです。哲学を通じて社会を見つめ直す視点を得たいと考えています。' +
      '将来は、こうした問いを社会に開いていく仕事に関わりたいと考えています。ぜひ貴学で学ばせていただきたく、志望いたします。',
  },
  {
    id: 'C',
    description: 'fallback / focus なし（DB 未登録大学：架空大学）',
    university: '架空大学',
    faculty: '人間科学部',
    department: '社会学科',
    essay:
      '私は高校で生徒会活動に取り組み、行事の運営や校則見直しの議論に参加してきました。多様な意見を調整する難しさと、合意形成の重要さを実感しました。' +
      'また、地域のボランティア清掃にも継続的に参加し、地域住民との対話を通じて、街づくりに対する関心が深まりました。' +
      '貴学の人間科学部 社会学科では、人と社会の関係を多角的に学べる点に魅力を感じています。志望理由は、これらの経験を学問として体系的に学び直したいからです。' +
      '将来は地域コミュニティを支える仕事に就き、人と人をつなぐ役割を果たしたいと考えています。よろしくお願いいたします。',
  },
];

// ── runner ───────────────────────────────────────────────────────
async function runOne(c: Case) {
  const admissionFocusContext = getAdmissionFocusContextForUser({
    university: c.university,
    faculty: c.faculty,
    department: c.department,
    examTypes: baseBasicInfo.examTypes,
  });

  const userPrompt = buildStatementReviewPrompt({
    university: c.university,
    faculty: c.faculty,
    department: c.department,
    essay: c.essay,
    basicInfo: baseBasicInfo,
    activityData: baseActivityData,
    studentProfile: baseStudentProfile,
    wallHittingResult: null,
    admissionFocusContext,
  });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    system: STATEMENT_REVIEW_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  const rawText = textBlock?.type === 'text' ? textBlock.text : '';

  let parsed: unknown = null;
  let parseError: string | null = null;
  try {
    const m = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : rawText);
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }

  return {
    case: c,
    admissionFocusContext,
    admissionFocusEmpty: admissionFocusContext.trim() === '',
    userPrompt,
    rawText,
    parsed,
    parseError,
    stopReason: response.stop_reason,
    usage: response.usage,
  };
}

async function main() {
  const outDir = join(process.cwd(), 'tmp', 'step4d-qa');
  await mkdir(outDir, { recursive: true });

  const summary: Array<Record<string, unknown>> = [];

  for (const c of CASES) {
    process.stdout.write(`Running case ${c.id}... `);
    const r = await runOne(c);
    await writeFile(
      join(outDir, `case-${c.id}.json`),
      JSON.stringify(
        {
          id: c.id,
          description: c.description,
          admissionFocusEmpty: r.admissionFocusEmpty,
          admissionFocusContext: r.admissionFocusContext,
          stopReason: r.stopReason,
          parseError: r.parseError,
          parsed: r.parsed,
          rawText: r.rawText,
        },
        null,
        2,
      ),
      'utf-8',
    );
    summary.push({
      id: c.id,
      description: c.description,
      admissionFocusEmpty: r.admissionFocusEmpty,
      stopReason: r.stopReason,
      parseOk: r.parseError === null,
    });
    console.log(
      `done [focusEmpty=${r.admissionFocusEmpty} stop=${r.stopReason} parseOk=${r.parseError === null}]`,
    );
  }

  await writeFile(
    join(outDir, 'summary.json'),
    JSON.stringify(summary, null, 2),
    'utf-8',
  );
  console.log('\n=== summary ===');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
