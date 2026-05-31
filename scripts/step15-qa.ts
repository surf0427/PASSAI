/*
 * scripts/step15-qa.ts
 *
 * STEP15 QA harness: subjectGrades semantic instruction の実 AI 出力検証
 *
 * 目的:
 *   STEP15b (statement-review) と STEP15c (interview-questions) で導入した
 *   SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE /
 *   route-specific qualifier が、固定入力 Case A/C/D/E/F に対して
 *   実 AI 出力を意図通りに変えるかを観測する。
 *
 * 設計方針:
 *   - production code は触らない（lib/...、app/api/...、aiInputHash.ts 等）
 *   - 各 Case の入力は本ファイル内に固定（regression QA で再現可能）
 *   - lib/ の SYSTEM_PROMPT と prompt builder を import して prompt を構築
 *   - Anthropic SDK を直接叩く（Next.js route 層は通さない）
 *   - 出力を tmp/step15-qa/ に保存、最後に report.md を生成
 *
 * 使い方:
 *   ANTHROPIC_API_KEY=sk-... npx tsx scripts/step15-qa.ts
 *   または .env.local に ANTHROPIC_API_KEY を書いて:
 *     npx tsx scripts/step15-qa.ts
 *
 * オプション:
 *   --dry              API を呼ばず prompt 構築のみ。lint は最小実行
 *   --verbose          prompt 全文を stdout にも出す
 *   --case <id>        単一 Case のみ実行（a / c / d / e / f）
 *   --route <r>        単一 route のみ実行（statement-review / interview-questions）
 *
 * 出力:
 *   tmp/step15-qa/case-<id>/<route>.json
 *   tmp/step15-qa/report.md
 */

import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// production prompt imports — STEP15b/c/d で改修した本番経路をそのまま叩く
import {
  STATEMENT_REVIEW_SYSTEM_PROMPT,
  buildStatementReviewPrompt,
} from '../lib/statement/review/statementPrompt';
import {
  INTERVIEW_QUESTION_SYSTEM_PROMPT,
  buildInterviewQuestionUserPrompt,
} from '../lib/interview/buildInterviewQuestionPrompt';
import { buildInterviewQuestionMaterials } from '../lib/interview/buildInterviewQuestionMaterials';
// STEP15d: matching の prompt も同様に lib/ から直接 import して本番経路を再現する。
import {
  MATCHING_SYSTEM_PROMPT,
  buildMatchingUserPrompt,
} from '../lib/matching/matchingPrompt';
// STEP15e: interview-feedback の SYSTEM_PROMPT を import（STEP-LIB-03 で lib/prompts/ に lift 済み）。
import { INTERVIEW_FEEDBACK_SYSTEM_PROMPT } from '../lib/prompts/interviewFeedbackPrompt';
import { buildBasicInfoPromptSection } from '../lib/buildBasicInfoPromptSection';
import { buildInterviewStudentProfileContext } from '../lib/contextBuilders/interviewContext';
// STEP15f: analysis (wallHitting) の SYSTEM_PROMPT / user prompt builder を import。
// analysis 出力は StudentProfile に固定化され下流に伝染するため、StudentProfile 汚染検証が中核。
// STEP15g: analysis/additional の SYSTEM_PROMPT / user prompt builder を import。
// additional は追加深掘り質問 2 問を生成する route。
import {
  ANALYSIS_SYSTEM_PROMPT,
  buildWallHittingPrompt,
  ADDITIONAL_QUESTIONS_SYSTEM_PROMPT,
  buildAdditionalQuestionsPrompt,
  // STEP15i: summarize の light/deep system prompt + user prompt builder。
  // 本 STEP では deep mode を QA 対象にする（成績表化リスクが最大かつ output 量も多い）。
  SUMMARIZE_DEEP_SYSTEM_PROMPT,
  buildSummarizePrompt,
} from '../lib/prompts';
// STEP15h: essay-review / essay-chat の SYSTEM_PROMPT を import。
// essay-review は STEP-LIB-04、essay-chat は STEP-LIB-05 で lib/prompts/ に lift 済み。
import { ESSAY_REVIEW_SYSTEM_PROMPT } from '../lib/prompts/essayReviewPrompt';
import { ESSAY_CHAT_SYSTEM_PROMPT } from '../lib/prompts/essayChatPrompt';

// type-only imports（runtime に持ち出さない / localStorage 経路を引きずらない）
import type { BasicInfo } from '../types/basicInfo';
import type { ActivityData } from '../types/activity';
import type { StudentProfile } from '../types/studentProfile';
import type { StatementDraft } from '../lib/statement/review/statementStorage';
import type { MatchingResult } from '../types/matching';

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

const SELECTED_CASE = getFlagValue('--case')?.toLowerCase() ?? null;
const SELECTED_ROUTE = getFlagValue('--route') ?? null;

// ─────────────────────────────────────────────────────────────
// .env.local loader（manual parse / 依存追加なし）
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
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
loadEnvLocal();

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const OUTPUT_DIR = join(process.cwd(), 'tmp', 'step15-qa');
const MODEL = 'claude-sonnet-4-6'; // 本番 statement-review / interview-questions と同じ

const STATEMENT_REVIEW_MAX_TOKENS = 2000;
const INTERVIEW_QUESTIONS_MAX_TOKENS = 2200;
const INTERVIEW_QUESTIONS_TEMPERATURE = 0.4; // 本番 route と同じ
const MATCHING_MAX_TOKENS = 500; // 本番 generateUniversityDetail と同じ
const INTERVIEW_FEEDBACK_MAX_TOKENS = 5000; // 本番 calculateInterviewMaxTokens(3 件) と同等の目安
const ANALYSIS_MAX_TOKENS = 3000; // 本番 /api/analysis と同等の目安（summary+strengths+weaknesses+futureConnections+questions5）
const ADDITIONAL_QUESTIONS_MAX_TOKENS = 800; // 質問 2 問 + カテゴリ + JSON で十分
const ESSAY_REVIEW_MAX_TOKENS = 1000; // 本番 essay-review/route.ts と同じ
const ESSAY_CHAT_MAX_TOKENS = 400; // 本番 essay-chat/route.ts と同じ
const ESSAY_REVIEW_TEMPERATURE = 0.2; // 本番と同じ
const ESSAY_CHAT_TEMPERATURE = 0.3; // 本番と同じ
const SUMMARIZE_MAX_TOKENS = 1500; // 本番 /api/summarize と同等の目安

// 「断定語」: shared instruction で禁止されている語。出力本文に検出したら violation。
// 「無理」「厳しい」は副詞・形容詞用法と衝突するため別管理（soft）。
const NG_HARD_WORDS = [
  '出願不可',
  '出願できない',
  '不合格',
  '不適格',
  '推薦不向き',
] as const;

const NG_SOFT_WORDS = ['厳しい', '無理'] as const;

// ─────────────────────────────────────────────────────────────
// Faculty ↔ 関連科目 マッピング（shared instruction §2 と一致させる）
// ─────────────────────────────────────────────────────────────

type FacultyCategory = 'international' | 'stem' | 'social_human' | 'unknown';

function classifyFaculty(faculty: string, department: string): FacultyCategory {
  const t = `${faculty}${department}`;
  if (/国際|外国語|異文化|英語|グローバル/.test(t)) return 'international';
  if (/理工|情報|建築|データ|工学|理学|機械|電気|化学|物理|生命|農|医|薬/.test(t)) return 'stem';
  if (/社会|人文|心理|法|経済|文芸|文学|教育|地域/.test(t)) return 'social_human';
  return 'unknown';
}

function relatedSubjectsFor(cat: FacultyCategory): string[] {
  switch (cat) {
    case 'international':
      return ['英語'];
    case 'stem':
      return ['数学', '理科'];
    case 'social_human':
      return ['国語', '社会'];
    case 'unknown':
      return [];
  }
}

const ALL_SUBJECTS = ['英語', '数学', '理科', '国語', '社会'] as const;

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type Route =
  | 'statement-review'
  | 'interview-questions'
  | 'matching'
  | 'interview-feedback'
  | 'analysis'
  | 'analysis-additional'
  | 'essay-review'
  | 'essay-chat'
  | 'summarize';

type LintResult = {
  violations: string[];
  warnings: string[];
};

type RunResult = {
  caseId: string;
  route: Route;
  systemPrompt: string;
  userPrompt: string;
  rawOutput: string;
  parsed: unknown;
  parseError: string | null;
  lint: LintResult;
  apiError: string | null;
  dryRun: boolean;
  usage: { input_tokens: number; output_tokens: number } | null;
  durationMs: number;
};

type QaCase = {
  id: string;
  description: string;
  basicInfo: BasicInfo;
  activityData: ActivityData;
  studentProfile: StudentProfile;
  activitySummary: string;
  statementDraft: StatementDraft;
  essay: string;
  // STEP15d: matching 用の deterministic fixture（手動構築）。
  // 本物の buildMatchingResults を通さずに最小限の MatchingResult を用意する。
  // 目的は AI narrative（reason）の振る舞い検証であり、score 値そのものの正確性ではない。
  matchingFixture: MatchingResult;
  // STEP15e: interview-feedback 用の Q/A 入力。
  // 本番 route は questionsAndAnswers + 受験情報を受け取って AI 評価を返す。
  // 評定が improvements / nextPractice / betterAnswer に侵食しないかを観測する。
  interviewFeedbackQa: {
    universityName: string;
    facultyName: string;
    motivation: string;
    questionsAndAnswers: { question: string; answer: string }[];
  };
  // STEP15h: essay-review / essay-chat 用の小論文入力。
  // essay-review は score / breakdown / feedback を返し、essay-chat は次の問いかけ 1〜2 文を返す。
  // subjectGrades が小論文採点に影響しないこと、feedback / 問いかけに評定値が直書きされないことを観測する。
  essayReviewQa: {
    theme: string;
    conclusion: string;
    reasonOne: string;
    reasonTwo: string;
    essayBody: string;
    chatQuestion: string;
  };
};

// matching の MatchingResult 最小 fixture を組み立てる helper。
// university 型の必須フィールドはすべて埋めるが、AI prompt に流れるのは
// id / name / faculty / admissionType / description / score だけ（buildMatchingUserPrompt 参照）。
function makeMatchingFixture(args: {
  universityId: string;
  universityName: string;
  faculty: string;
  admissionType: '総合型' | '学校推薦型';
  academicType: '文系' | '理系';
  description: string;
  score: number;
}): MatchingResult {
  return {
    university: {
      id: args.universityId,
      name: args.universityName,
      faculty: args.faculty,
      admissionType: args.admissionType,
      academicType: args.academicType,
      requiredGpa: null,
      hasInterview: true,
      hasEssay: false,
      hasPresentation: false,
      aoProfile: null,
      recommendationProfile: null,
      description: args.description,
      tags: [],
      similarSchools: [],
    },
    score: args.score,
    scoreBreakdown: { items: [], total: args.score },
    reason: '',
    strengthPoints: [],
    weaknesses: [],
    actionItems: [],
    suggestionType: '自分の志望校',
    matchSummary: '',
  };
}

// ─────────────────────────────────────────────────────────────
// Empty / fixture helpers
// ─────────────────────────────────────────────────────────────

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

function makeStudentProfile(args: {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  futureConnections: string[];
  valueKeywords: string[];
}): StudentProfile {
  return {
    version: 1,
    generatedAt: '2026-05-14T00:00:00.000Z',
    sourceHash: 'qa-harness-fixture',
    summary: args.summary,
    strengths: args.strengths,
    weaknesses: args.weaknesses,
    futureConnections: args.futureConnections,
    valueKeywords: args.valueKeywords,
    signatureEpisodes: [],
  };
}

// ─────────────────────────────────────────────────────────────
// CASE A: 英語強者・国際系志望
// ─────────────────────────────────────────────────────────────

const CASE_A: QaCase = {
  id: 'case-a',
  description: '英語強者・国際系志望（明治大 国際日本学部 / 立教大 異文化コミュニケーション）',
  basicInfo: {
    name: 'A子',
    grade: '高3',
    track: '文系',
    overallGpa: '4.1',
    examTypes: ['総合型選抜（AO入試）'],
    preferences: [
      { university: '明治大学', faculty: '国際日本学部', department: '' },
      { university: '立教大学', faculty: '異文化コミュニケーション学部', department: '' },
    ],
    subjectGrades: {
      english: '4.8',
      japanese: '4.0',
      math: '3.3',
      science: '3.5',
      social: '4.1',
      absenceDays: '2',
    },
  },
  activityData: {
    ...emptyActivityData(),
    studyAbroadActivities: [
      {
        type: 'studyAbroad',
        period: { from: '2025-07', to: '2025-08' },
        destination: 'ニュージーランド・オークランド',
        programContent: '現地校での通常授業参加。ホームステイ。',
        language: '英語',
        description: '現地高校に4週間通い、社会科・英語・体育の授業に参加。ホストファミリーと日常英語で交流。',
        achievement: '英語で討論授業に発言できるようになった。日本文化を英語で説明する経験を得た。',
        role: '参加生徒',
        challenge: '最初は授業の議論に入れず、自分の意見を組み立てる前に話題が次へ進んでしまった。',
        action: '日本のアニメや「間」の感覚など、自分の知識領域から例を引いて発言の足場を作った。',
        reflection: '言葉だけでなく、相手の文脈に合わせて話題を選ぶ重要性を学んだ。',
        futureConnection: '国際的な場で日本のことを発信できる人になりたい。',
      },
    ],
    contestActivities: [
      {
        type: 'contest',
        period: { from: '2025-11', to: '2025-11' },
        contestName: '全日本高校模擬国連大会',
        field: '国際政治',
        result: '予選通過・本選参加',
        description: '南スーダン代表として、難民受け入れ枠の交渉に参加。',
        achievement: '複数国と合意文書をまとめる議長補佐に選ばれた。',
        role: '代表団',
        challenge: '自国の主張だけでは合意が作れない。利害が真逆の国とどう着地点を作るかが課題だった。',
        action: '相手国の懸念を整理し、共通利益として表現し直す質問書を作った。',
        reflection: '合意は妥協ではなく、相手の論理を借りて自分の主張を翻訳する作業だと理解した。',
        futureConnection: '国際協力の場で、橋渡しをする役割を担いたい。',
      },
    ],
    partTimeJobActivities: [
      {
        type: 'partTimeJob',
        period: { from: '2024-04', to: '2026-03' },
        industry: '飲食',
        jobContent: 'ホール接客（観光地店舗で訪日客対応も含む）',
        workFrequency: '週2回',
        description: '観光地のカフェでホール。海外観光客の注文も英語で受ける。',
        achievement: '英語接客の安心感を上げ、外国人客のリピートが増えた。',
        role: 'スタッフ',
        challenge: '注文以外の質問（観光案内など）に咄嗟に英語で答えられない場面があった。',
        action: '頻出フレーズと観光地情報を英語でまとめ、休憩中に同僚と練習した。',
        reflection: '英語は道具で、内容と気遣いの方が伝わる距離を縮めると気づいた。',
        futureConnection: '相手を主語にして話す姿勢は、外交や国際広報でも生きるはず。',
      },
    ],
  },
  studentProfile: makeStudentProfile({
    summary:
      '日本文化を「外から見直す」視点を、留学と模擬国連を通じて言語化してきた高校3年生。利害が違う相手に対しても、相手の文脈で語り直す力がある。',
    strengths: [
      '異なる文脈の相手に対して、相手の論理を借りながら自分の主張を翻訳する力',
      '英語を「道具」として相手との距離を縮める姿勢（接客と討論の両方で発揮）',
      '自分の発言が伝わらなかった経験から学習方法を組み直す柔軟さ',
    ],
    weaknesses: [
      '構造的な政治・経済の知識はまだ薄く、議論の前提理解で時間を取られる',
      '深い反省を言語化するまでに時間がかかる傾向',
    ],
    futureConnections: [
      '国際機関・NGO で多文化チームの合意形成に貢献する',
      '日本の文化・社会を国際的に発信する役割を担う',
    ],
    valueKeywords: ['異文化理解', '合意形成', '相手の文脈', '橋渡し', '言語の越境'],
  }),
  activitySummary:
    'ニュージーランド短期留学で、英語の壁を「自分の知識領域から話題を作る」工夫で乗り越えた。模擬国連では南スーダン代表として難民交渉に参加し、合意は妥協ではなく相手の論理を借りた翻訳だと学んだ。観光地のカフェで英語接客を続け、英語を道具として使う実感を磨いている。日本を外から見る視点と、相手の文脈で語る姿勢が活動を貫くテーマである。',
  statementDraft: {
    university: '明治大学',
    faculty: '国際日本学部',
    department: '',
    statementText:
      '私は明治大学国際日本学部で、日本文化と異文化の交差点を学びたい。きっかけは高2のニュージーランド短期留学である。現地校での討論授業で、私の発言は最初英語の壁に阻まれた。だが日本のアニメに描かれる「間」の感覚を例に話したとき、クラスメイトの反応が変わった。日本を「外から見た自分」が初めて言葉になった瞬間だった。\n\n帰国後、模擬国連に参加した。私は南スーダン代表として、難民受け入れ枠の交渉に臨んだ。利害を超えて合意を作るには、自国の論理ではなく相手の文脈で語る言葉が要ると痛感した。合意は妥協ではなく、相手の論理を借りた翻訳だと学んだ。\n\n明治の国際日本学部は、日本研究と国際研究を統合し、英語による発信能力も鍛える点が魅力だ。私は日本文化研究のゼミで「外から見た日本」を研究し、卒業後は国際機関や国際広報の現場で、日本と世界の橋渡しになりたい。',
  },
  essay: '',
  matchingFixture: makeMatchingFixture({
    universityId: 'meiji-kokusai-nihon',
    universityName: '明治大学',
    faculty: '国際日本学部',
    admissionType: '総合型',
    academicType: '文系',
    description: '日本文化と国際社会の交差点を扱う学際的学部。英語による発信力と日本研究を統合する。',
    score: 76,
  }),
  interviewFeedbackQa: {
    universityName: '明治大学',
    facultyName: '国際日本学部',
    motivation:
      '高校2年のニュージーランド留学で日本を外から見る視点に興味を持ち、明治の国際日本学部で日本研究と国際研究を統合的に学びたい。',
    questionsAndAnswers: [
      {
        question: '明治大学国際日本学部を志望した理由を教えてください。',
        answer:
          '高校2年のニュージーランド短期留学で、英語の壁を感じる中、日本のアニメに描かれる「間」の感覚を例に話したらクラスメイトの反応が変わった経験をしました。日本を外から見る視点に興味を持ち、貴学部の日本研究と国際研究を統合するカリキュラムで学びたいと考えました。',
      },
      {
        question: '模擬国連の経験で印象に残っていることは何ですか？',
        answer:
          '南スーダン代表として難民交渉に参加した際、最初は自国の論理だけで発言していました。しかし合意は作れず、相手国の懸念を文書化し共通利益で再提案を作り直して、ようやく合意できました。合意は妥協ではなく相手の論理を借りた翻訳だと学びました。',
      },
      {
        question: '卒業後にやりたいことは何ですか？',
        answer:
          '国際機関や国際広報の現場で、日本と世界の橋渡しをする仕事に進みたいです。',
      },
    ],
  },
  essayReviewQa: {
    theme:
      'グローバル化が進む現代において、日本人は外国人とどのようにコミュニケーションを取るべきか、あなたの考えを述べなさい。',
    conclusion: '相手の文脈で語り直す姿勢こそが、グローバル時代に必要なコミュニケーションの核だと考える。',
    reasonOne: '英語の流暢さよりも、相手が何を求めているかを先に理解する姿勢が、留学先の討論授業で実際に有効だった。',
    reasonTwo: '模擬国連の交渉でも、自国の論理を押し付けず相手の懸念を取り込んだ提案が合意を導いた経験がある。',
    essayBody:
      'グローバル化が進む現代において、日本人は外国人とどのようにコミュニケーションを取るべきか。私は、英語の流暢さよりも「相手の文脈で語り直す姿勢」が最も重要だと考える。\n\n高校2年のニュージーランド短期留学で、私は英語で発言する自信がなかった。しかしクラスメイトに日本のアニメに描かれる「間」の感覚を例に話したところ、彼らの反応は明らかに変わった。流暢さではなく相手が興味を持つ切り口を選んだ瞬間に、コミュニケーションが成立した。\n\n模擬国連で南スーダン代表として難民交渉に臨んだときも同じだった。自国の論理を押し付けるだけでは合意が作れず、相手国の懸念を文書化して共通利益として再提案することで初めて合意に達した。\n\nグローバル化は英語ができれば良いという話ではない。相手の文脈を読み、その論理に乗せて自分の主張を翻訳する姿勢こそが、これからの日本人に求められると考える。',
    chatQuestion: '結論部分が弱いと指摘されました。どう書き直せばいいですか？',
  },
};
CASE_A.essay = CASE_A.statementDraft.statementText;

// ─────────────────────────────────────────────────────────────
// CASE C: 活動強・評定弱・AO向き
// ─────────────────────────────────────────────────────────────

const CASE_C: QaCase = {
  id: 'case-c',
  description: '評定弱・活動強・総合型志望（社会学部・地域創生系）',
  basicInfo: {
    name: 'C太',
    grade: '高3',
    track: '文系',
    overallGpa: '3.4',
    examTypes: ['総合型選抜（AO入試）'],
    preferences: [
      { university: 'X大学', faculty: '社会学部', department: '地域社会学科' },
      { university: 'Y大学', faculty: '地域創生学部', department: '' },
    ],
    subjectGrades: {
      english: '3.7',
      japanese: '3.5',
      math: '2.9',
      science: '3.0',
      social: '3.8',
      absenceDays: '4',
    },
  },
  activityData: {
    ...emptyActivityData(),
    researchActivities: [
      {
        type: 'research',
        period: { from: '2024-04', to: '2026-03' },
        theme: '地域観光活性化と若者の関与',
        trigger: '地元の祭りが担い手不足で中止になり、衝撃を受けた。',
        hypothesis: '若者が観光客より「次の担い手」として地域に関わる仕組みがあれば、祭りは続く。',
        methodology:
          '高校生15名へのインタビュー、町内会・観光協会への聞き取り、過去20年の祭り参加者データの分析。',
        output: '高校生向け祭り運営参加プログラムの提案書を町役場に提出。試験運用が決定。',
        description: '地域観光をテーマに、自治体・地域住民・高校生の3者が関わる方法を探究した。',
        achievement: '提案書が試験運用採択。来年度から実装予定。',
        role: '探究リーダー',
        challenge: '観光協会と町内会で利害が一致せず、当初は提案が両方から却下された。',
        action: '両者の懸念を文書化し、共通利益（後継不足解消）を軸に再提案を作った。',
        reflection: '正しい提案より、関係者の懸念に応える提案の方が動かす力がある。',
        futureConnection: '社会学のフィールドワーク手法を学び、地域課題の現場に応用したい。',
      },
    ],
    volunteerActivities: [
      {
        type: 'volunteer',
        period: { from: '2023-04', to: '2026-03' },
        activityContent: '高齢者向け買物代行・話し相手',
        target: '一人暮らし高齢者',
        purpose: '地域の孤立予防',
        frequency: '月2回',
        description: '町内ボランティア団体に所属し、買物代行と週末の話し相手を担当。',
        achievement: '3年継続。利用者から定期訪問の信頼を得た。',
        role: 'メンバー',
        challenge: '初期は会話が続かず、関係構築に失敗。',
        action: '利用者の過去の仕事や趣味を事前に聞いて準備するようにした。',
        reflection: '「支援する」より「教わる」姿勢の方が関係が深まる。',
        futureConnection: 'コミュニティの中の関係をデザインする仕事に興味がある。',
      },
    ],
    contestActivities: [
      {
        type: 'contest',
        period: { from: '2025-08', to: '2025-08' },
        contestName: '高校生地域課題コンテスト',
        field: '地域創生',
        result: '優秀賞',
        description: '探究の提案書をベースにプレゼンに参加。',
        achievement: '審査員特別賞。地元紙に取材。',
        role: '発表者',
        challenge: '審査員から「持続可能性の根拠が弱い」と指摘された。',
        action: '数値的根拠を後日提出し、提案書を改訂した。',
        reflection: 'プレゼンと検証は別物。後追いの修正が信頼を上げる。',
        futureConnection: '社会調査の方法論を体系的に学びたい。',
      },
    ],
  },
  studentProfile: makeStudentProfile({
    summary:
      '地元の祭り中止という喪失体験から、地域社会の持続性を探究してきた高校3年生。利害が割れる関係者の懸念を文書化し共通利益で再提案する力を、フィールドワークで磨いてきた。',
    strengths: [
      '関係者の利害対立を「懸念の翻訳」によって動かせる提案に組み替える力',
      '地域に3年間入り続けた持続性と、当事者からの信頼',
      '探究の指摘を後追いで検証し改訂する柔軟さ',
    ],
    weaknesses: [
      '数値・統計的根拠を最初から組み込むのが弱く、後追いになりがち',
      '基礎学力の継続的な維持に課題が残る',
    ],
    futureConnections: [
      '社会学・地域研究を学び、フィールドワーク手法を体系化したい',
      '行政・NPO・住民をつなぐ中間的な役割を担いたい',
    ],
    valueKeywords: ['地域', '持続可能性', '懸念の翻訳', 'フィールドワーク', '共通利益'],
  }),
  activitySummary:
    '地元の祭り中止をきっかけに、地域観光×若者関与を3年探究した。観光協会・町内会・高校生の3者が対立する場面では、両者の懸念を文書化し共通利益で再提案することで提案書を採択させた。並行して高齢者ボランティアを3年継続。話し相手から「教わる」姿勢で関係を作ってきた。コンテスト出場では「持続可能性の根拠が弱い」指摘を受け、後追いで数値を補完し提案を改訂した。',
  statementDraft: {
    university: 'X大学',
    faculty: '社会学部',
    department: '地域社会学科',
    statementText:
      '私はX大学社会学部地域社会学科で、地域の持続可能性を支える関係性のデザインを学びたい。きっかけは地元の祭りが担い手不足で中止になったことだ。「観光客を呼ぶ」より「次の担い手を作る」が必要だと感じ、高校生×祭り運営の提案を探究テーマにした。\n\n探究では、観光協会と町内会の利害が真逆で、最初の提案は両方から却下された。私は両者の懸念を文書にし、共通利益として「後継不足解消」を軸に再提案を作った。試験運用が採択された経験から、正しい提案より関係者の懸念に応える提案の方が動かす力があると学んだ。\n\n高齢者ボランティアでも、当初は会話が続かなかった。利用者の仕事や趣味を事前に聞いて準備するようにしてから、関係が深まった。「支援する」より「教わる」姿勢の方が、地域の中で信頼を作ると気づいた。\n\nX大学では◯◯先生のフィールドワーク手法を学び、卒業後は行政と住民をつなぐ中間支援の場で、関係性をデザインする実践者になりたい。',
  },
  essay: '',
  matchingFixture: makeMatchingFixture({
    universityId: 'x-shakai-chiiki',
    universityName: 'X大学',
    faculty: '社会学部',
    admissionType: '総合型',
    academicType: '文系',
    description: 'フィールドワーク中心の地域社会学。住民・自治体・NPO の関係をデザインする実践者を育てる。',
    score: 71,
  }),
  interviewFeedbackQa: {
    universityName: 'X大学',
    facultyName: '社会学部 地域社会学科',
    motivation:
      '地元の祭り中止をきっかけに地域社会の持続可能性を3年間探究してきた。X大学のフィールドワーク手法を学びたい。',
    questionsAndAnswers: [
      {
        question: '探究活動について教えてください。',
        answer:
          '地元の祭りが担い手不足で中止になったのをきっかけに、高校生×祭り運営の探究を3年間続けました。観光協会と町内会の利害対立を、両者の懸念を文書化して共通利益で再提案する方法で動かしました。提案書は試験運用が採択されました。',
      },
      {
        question: '評定平均が高くないですが、大学での学びについていけますか？',
        answer:
          '定期試験向けの暗記は得意ではありませんが、探究テーマを3年間追い続ける継続力はあります。フィールドワークと文献調査を組み合わせる力は身につけてきたので、大学のゼミでも追えると思います。',
      },
      {
        question: '卒業後にやりたいことを教えてください。',
        answer:
          '行政・NPO・住民をつなぐ中間支援の場で、関係性をデザインする実践者になりたいです。',
      },
    ],
  },
  essayReviewQa: {
    theme:
      '地方の人口減少問題に対して、若者ができることは何か、あなたの考えを述べなさい。',
    conclusion: '若者にできるのは「次の担い手を作る関係性をデザインする」ことだと考える。',
    reasonOne: '観光客を増やすだけでは祭りも商店街も継続せず、引き継ぐ人を育てる仕組みこそが本質的な解決になる。',
    reasonTwo: '地元での探究で、利害が対立する関係者を動かしたのは「正しい提案」より「懸念に応える提案」だった。',
    essayBody:
      '地方の人口減少問題に対して、若者ができることは何か。私は、若者にできるのは「次の担い手を作る関係性をデザインする」ことだと考える。\n\n私の地元では、担い手不足で祭りが中止になった。観光客を呼ぶ施策はあったが、引き継ぐ人を育てる仕組みは無かった。私は高校生×祭り運営をテーマに3年間探究を続け、観光協会と町内会という利害の異なる関係者に提案を持ち込んだ。\n\n最初の提案は両者から却下された。私は両者の懸念を文書化し、共通利益として「後継者不足解消」を軸に再提案したところ、試験運用が採択された。この経験から、正しい提案より関係者の懸念に応える提案の方が現場を動かすと学んだ。\n\n地方の人口減少は若者一人が止められる問題ではないが、若者が「次の担い手と関係性を育てる場」を地元に作ることで、減少を緩めることはできる。',
    chatQuestion: '具体例が少ないと言われました。どう増やしたらいいですか？',
  },
};
CASE_C.essay = CASE_C.statementDraft.statementText;

// ─────────────────────────────────────────────────────────────
// CASE D: 理系・数学理科強・英語弱め
// ─────────────────────────────────────────────────────────────

const CASE_D: QaCase = {
  id: 'case-d',
  description: '理系・数学理科強・情報系志望',
  basicInfo: {
    name: 'D郎',
    grade: '高3',
    track: '理系',
    overallGpa: '4.0',
    examTypes: ['総合型選抜（AO入試）'],
    preferences: [
      { university: 'Z工科大学', faculty: '情報理工学部', department: '情報科学科' },
      { university: 'W大学', faculty: '理工学部', department: '情報工学科' },
    ],
    subjectGrades: {
      english: '3.2',
      japanese: '3.7',
      math: '4.8',
      science: '4.6',
      social: '3.5',
      absenceDays: '1',
    },
  },
  activityData: {
    ...emptyActivityData(),
    researchActivities: [
      {
        type: 'research',
        period: { from: '2024-09', to: '2026-03' },
        theme: 'AI画像認識による校内ゴミ分別補助システムの試作',
        trigger: '体育祭後のゴミ集積場で、分別の手間で清掃が遅延する場面を見た。',
        hypothesis: 'カメラと軽量モデルで、投げ捨て時にラベルを判定できれば回収効率が上がる。',
        methodology:
          'Python と PyTorch で MobileNetV3 を fine-tune。教師データは校内 5 種類のゴミ各 300 枚で構築。',
        output: '校内ゴミ箱 1 台に試作機を設置。判定精度 78%、誤判定の傾向を学級新聞で公開。',
        description: 'AI画像認識を使い、校内のゴミ分別を補助する小規模システムを試作した。',
        achievement: '判定精度 78% を達成。校内文化祭で展示。',
        role: '研究リーダー',
        challenge: '学校環境の照明変化と汚れで精度が落ちた。教師データの偏りが原因と特定。',
        action: '異なる照度・汚れ条件で追加撮影を行い、データ拡張を実装。精度を 62%→78% に改善。',
        reflection: 'モデルではなくデータの質が支配的だと現場で実感した。',
        futureConnection: '応用可能な機械学習を、現実の運用環境で動く形にする研究をしたい。',
      },
    ],
    certificationActivities: [
      {
        type: 'certification',
        certificationName: '基本情報技術者試験',
        level: '合格',
        acquiredDate: '2025-04',
        purpose: '情報系学部志望のための基礎固め',
        studyMethod: '参考書 + 過去問演習を半年',
        difficulty: 'アルゴリズム分野が当初厳しかった',
        reflection: '理論を手を動かして書くと定着する',
        futureConnection: '応用情報・大学での専門科目に進む',
      },
    ],
  },
  studentProfile: makeStudentProfile({
    summary:
      '校内の運用問題から AI 画像認識システムを試作した高校3年生。モデル選択よりデータの質が精度を支配する事実を現場で発見した。',
    strengths: [
      '実問題から手を動かして仮説→実装→検証→改訂のサイクルを回す力',
      'モデル中心ではなくデータ中心で精度問題を捉え直せる視点',
      '校内環境という制約下で結果を出す現場対応力',
    ],
    weaknesses: [
      '英語論文の読解にまだ時間がかかる',
      '研究成果を一般向けに翻訳する記述が薄い',
    ],
    futureConnections: [
      '実環境で動く機械学習システムを設計する研究者・技術者になりたい',
      'データ品質に責任を持つエンジニアリングを実践したい',
    ],
    valueKeywords: ['データ品質', '実装中心', '校内運用', '機械学習', '現場対応'],
  }),
  activitySummary:
    '校内ゴミ集積場の遅延問題から、AI 画像認識による分別補助システムを試作した。MobileNetV3 を fine-tune し、当初 62% だった精度を、照度・汚れ条件のデータ拡張で 78% に改善。モデルではなくデータが精度を支配することを現場で学んだ。並行して基本情報技術者試験に合格。アルゴリズム分野は最初手を動かしながら理論を定着させた。',
  statementDraft: {
    university: 'Z工科大学',
    faculty: '情報理工学部',
    department: '情報科学科',
    statementText:
      '私はZ工科大学情報理工学部情報科学科で、現実の運用環境で動く機械学習システムを学びたい。きっかけは校内のゴミ集積場で清掃が遅れる場面を見たことだ。カメラとモデルでラベルを判定できれば改善できるのではと考え、AI画像認識システムを試作した。\n\nPyTorch で MobileNetV3 を fine-tune し、校内 5 種類のゴミの教師データを構築した。最初の精度は 62% で、照明や汚れで判定が崩れた。原因は教師データの偏りだと特定し、異なる照度・汚れ条件で追加撮影、データ拡張を実装することで精度を 78% に上げた。モデルの工夫より、データの質が支配的だと現場で学んだ。\n\nZ工科大学情報理工学部のカリキュラムでは、データ駆動の機械学習の基礎を体系的に学べる点に魅力を感じている。卒業後は、研究室での成果を実環境で運用できる形に翻訳する研究者・技術者になりたい。',
  },
  essay: '',
  matchingFixture: makeMatchingFixture({
    universityId: 'z-koka-jouhou',
    universityName: 'Z工科大学',
    faculty: '情報理工学部',
    admissionType: '総合型',
    academicType: '理系',
    description: 'データ駆動の機械学習と実環境運用に強い学部。校内実装・実環境再現の研究室が複数ある。',
    score: 74,
  }),
  interviewFeedbackQa: {
    universityName: 'Z工科大学',
    facultyName: '情報理工学部 情報科学科',
    motivation:
      '校内ゴミ集積場の遅延問題から AI 画像認識システムを試作し、実環境で動く機械学習を体系的に学びたい。',
    questionsAndAnswers: [
      {
        question: '探究活動について教えてください。',
        answer:
          '校内のゴミ集積場で清掃が遅れる場面を見て、AI画像認識による分別補助システムを試作しました。PyTorchでMobileNetV3をfine-tuneし、最初62%だった精度を、照明・汚れ条件のデータ拡張で78%まで上げました。モデルの工夫より、データの質が支配的だと現場で学びました。',
      },
      {
        question: 'なぜ Z 工科大学情報理工学部なのですか？',
        answer:
          'データ駆動の機械学習を体系的に学べる点と、実環境運用に強い研究室がある点に魅力を感じています。校内実装で実感した「データ品質が精度を支配する」という学びを、研究レベルで深めたいです。',
      },
      {
        question: '将来やりたいことは何ですか？',
        answer:
          '研究成果を実環境で運用できる形に翻訳する研究者・技術者になりたいです。',
      },
    ],
  },
  essayReviewQa: {
    theme:
      'AI技術の社会実装にあたって最も重要な課題は何か、あなたの考えを述べなさい。',
    conclusion: 'AI 社会実装の最重要課題は「モデル精度」ではなく「教師データの質と運用環境のずれ」だと考える。',
    reasonOne: '校内で AI 画像認識を試作した経験から、研究室レベルの精度と実環境の精度には大きな差があると実感した。',
    reasonTwo: '実環境では照明・汚れ・新しい対象物などが常に変化し、データを継続的に再収集する仕組みが必要になる。',
    essayBody:
      'AI 技術の社会実装にあたって最も重要な課題は何か。私は、最重要課題は「モデル精度」ではなく「教師データの質と運用環境のずれ」だと考える。\n\n私は校内のゴミ集積場で清掃が遅れる問題を見て、AI 画像認識による分別補助システムを試作した。PyTorch で MobileNetV3 を fine-tune し、最初の精度は 62% だった。原因はモデルではなく、教師データが特定の照明条件に偏っていたことだった。異なる照度・汚れ条件で追加撮影し、データ拡張を実装した結果、精度は 78% に上がった。\n\nこの経験から、AI が現場で機能するかは「モデルの賢さ」より「教師データが運用環境を正しく代表しているか」で決まると学んだ。実環境は常に変化する。新しい対象物が現れる、照明条件が変わる、季節で汚れ方が変わる。\n\nしたがって AI 社会実装の最重要課題は、データを継続的に更新する運用体制を組み込めるかだと考える。',
    chatQuestion: '論理が飛躍していると指摘されました。どう繋げればいいですか？',
  },
};
CASE_D.essay = CASE_D.statementDraft.statementText;

// ─────────────────────────────────────────────────────────────
// CASE E: 欠席日数 18 日
// ─────────────────────────────────────────────────────────────

const CASE_E: QaCase = {
  id: 'case-e',
  description: '欠席日数 18 日・学校推薦も検討',
  basicInfo: {
    name: 'E実',
    grade: '高3',
    track: '文系',
    overallGpa: '4.0',
    examTypes: ['学校推薦型選抜（公募・指定校）', '総合型選抜（AO入試）'],
    preferences: [
      { university: 'V大学', faculty: '文学部', department: '日本文学科' },
    ],
    subjectGrades: {
      english: '4.1',
      japanese: '4.2',
      math: '3.8',
      science: '3.7',
      social: '4.0',
      absenceDays: '18',
    },
  },
  activityData: {
    ...emptyActivityData(),
    clubActivities: [
      {
        type: 'club',
        clubName: '文芸部',
        sport: '文芸',
        competitionLevel: '校内',
        teamSize: '8名',
        period: { from: '2023-04', to: '2026-03' },
        description: '部誌の編集・寄稿、文化祭での朗読会企画。',
        achievement: '部長として年2冊の部誌を完成。文化祭朗読会は来場者 200 名超。',
        role: '部長（高3）',
        challenge: '部員間で寄稿の温度差があり、締切に間に合わない年があった。',
        action: '寄稿のテーマ提案と相談時間を設け、書く前の対話量を増やした。',
        reflection: '書く前の対話が、書き始めの抵抗を下げる。',
        futureConnection: '言葉と読者の関係を、編集や教育の場で問い続けたい。',
      },
    ],
    volunteerActivities: [
      {
        type: 'volunteer',
        activityContent: '生徒会活動（広報担当）',
        target: '校内全生徒',
        purpose: '校内行事の情報発信',
        frequency: '週1回',
        period: { from: '2024-04', to: '2025-03' },
        description: '校内行事のポスター制作と SNS 運用を担当。',
        achievement: 'SNS 閲覧数を前年比 3 倍に。',
        role: '広報',
        challenge: '行事ごとに読者層が違い、文体の調整が必要だった。',
        action: '行事ごとに読者像を 1 行で文書化してから制作を始める運用にした。',
        reflection: '読み手を想定することが情報発信の核だと学んだ。',
        futureConnection: '広報・編集の仕事の基礎になる経験だった。',
      },
    ],
  },
  studentProfile: makeStudentProfile({
    summary:
      '文芸部部長として書く前の対話を重視し、生徒会広報として読者を想定した発信を磨いてきた高校3年生。',
    strengths: [
      '書く前の対話で部員の温度差を埋める運営力',
      '読み手を文書化してから情報発信する習慣',
      '3 年間継続した部活動と校内活動の安定性',
    ],
    weaknesses: [
      '校外の活動に踏み出せていない（行動範囲が校内に集中）',
      '研究的探究の経験が薄い',
    ],
    futureConnections: ['言葉と読者の関係を、編集・国語教育の現場で探究したい'],
    valueKeywords: ['書く前の対話', '読者想定', '部誌', '広報', '日本文学'],
  }),
  activitySummary:
    '文芸部部長として、書く前の対話を重視する運営で年2冊の部誌を完成させた。生徒会広報担当として、行事ごとに読者像を文書化してからポスター・SNS を制作する運用に切り替え、SNS 閲覧数を前年比3倍に伸ばした。継続性と読者想定が活動を貫くテーマである。',
  statementDraft: {
    university: 'V大学',
    faculty: '文学部',
    department: '日本文学科',
    statementText:
      '私はV大学文学部日本文学科で、言葉と読者の関係を学びたい。文芸部の部長として、書く前の対話を重視する運営をしてきた。寄稿の温度差で締切が遅れた年に、書き始める前の相談時間を増やした。書く前の対話が、書き始めの抵抗を下げる。生徒会広報では、行事ごとに読者像を1行で文書化してから制作する運用に切り替え、SNS閲覧数を前年比3倍に伸ばした。\n\n二つの活動を貫くのは「読み手を想定する」姿勢だ。日本文学科では古典から現代まで、書き手と読み手の関係がどう変化してきたかを学びたい。卒業後は編集・国語教育の現場で、書く前の対話と読者想定を仕事の核に据えたい。',
  },
  essay: '',
  matchingFixture: makeMatchingFixture({
    universityId: 'v-bun-nihon',
    universityName: 'V大学',
    faculty: '文学部',
    admissionType: '学校推薦型',
    academicType: '文系',
    description: '日本文学を古典から現代まで縦断する学部。学校推薦型では校内活動の継続性が評価される。',
    score: 78,
  }),
  interviewFeedbackQa: {
    universityName: 'V大学',
    facultyName: '文学部 日本文学科',
    motivation:
      '文芸部部長と生徒会広報の経験から「読み手を想定する」姿勢を磨き、日本文学科で書き手と読み手の関係を学びたい。',
    questionsAndAnswers: [
      {
        question: '文芸部での経験を教えてください。',
        answer:
          '文芸部部長として3年間、年2冊の部誌制作と文化祭の朗読会を担当してきました。寄稿の温度差で締切が遅れた年に、書き始める前の相談時間を増やしたところ、参加率が上がりました。書く前の対話が、書き始めの抵抗を下げると気づきました。',
      },
      {
        question:
          '高校3年間を通じて欠席が一定数あったようですが、その期間に学校生活や活動への向き合い方で意識したことはありますか？',
        answer:
          '体調を崩した時期がありましたが、出席できる日は文芸部の活動を継続することと、部誌の編集作業を家でも進めることを意識しました。学校の先生にも報告し、課題の遅れを最小限にする工夫をしました。',
      },
      {
        question: '卒業後にやりたいことは何ですか？',
        answer:
          '編集や国語教育の現場で、書く前の対話と読者想定を仕事の核に据えたいです。',
      },
    ],
  },
  essayReviewQa: {
    theme:
      'SNS が普及した現代において、「書くこと」の意味はどのように変わったと考えるか、あなたの考えを述べなさい。',
    conclusion: 'SNS 時代では「書く」前に「誰に届くか」を想定する作業の比重が大幅に増したと考える。',
    reasonOne: '生徒会広報でも、読者像を1行で文書化してから制作する運用に切り替えた後、SNS 閲覧数が前年比3倍になった。',
    reasonTwo: '紙の作品集と SNS では届く相手も読まれ方も違い、書き手は読者を想定して文体・分量を選ぶ必要がある。',
    essayBody:
      'SNS が普及した現代において、「書くこと」の意味はどのように変わったか。私は、SNS 時代では「書く」前に「誰に届くか」を想定する作業の比重が大幅に増したと考える。\n\n文芸部の部誌では、書きたいことをまず書き、後から校正する流れだった。しかし生徒会広報で SNS 運用に関わったとき、同じ書き方は通用しなかった。短い文の塊に情報を絞り、写真と組み合わせ、見る相手の文脈に合わせる必要があった。私は行事ごとに「読者像」を1行で書き出してから制作する運用に切り替えた。閲覧数は前年比3倍に伸びた。\n\nSNS が変えたのは、文章を読む側の関与の仕方だ。読み始める前から、読者は次のコンテンツに移る選択肢を持っている。書き手は「読まれないかもしれない」を前提に、誰に何を届けるかを設計してから書くことを求められる。\n\n書くことは依然として大切だが、SNS 時代では「書く前の設計」が書く以上に重要になったと考える。',
    chatQuestion: '反対意見への反論が弱いと言われました。どうしたらいいですか？',
  },
};
CASE_E.essay = CASE_E.statementDraft.statementText;

// ─────────────────────────────────────────────────────────────
// CASE F: subjectGrades undefined
// ─────────────────────────────────────────────────────────────

const CASE_F: QaCase = {
  id: 'case-f',
  description: 'subjectGrades 未入力・国際系志望（評定推測の有無を確認）',
  basicInfo: {
    name: 'F奈',
    grade: '高3',
    track: '文系',
    overallGpa: '4.0',
    examTypes: ['総合型選抜（AO入試）'],
    preferences: [
      { university: '明治大学', faculty: '国際日本学部', department: '' },
    ],
    // subjectGrades: undefined（明示的に持たない / basicInfoStorage と aiInputHash で drop される設計）
  },
  activityData: {
    ...emptyActivityData(),
    studyAbroadActivities: [
      {
        type: 'studyAbroad',
        period: { from: '2025-07', to: '2025-08' },
        destination: 'カナダ・バンクーバー',
        programContent: 'ホームステイ＋ESL 短期コース',
        language: '英語',
        description: 'バンクーバーで4週間。語学学校と現地ボランティアに参加。',
        achievement: '現地ボランティアで日本文化紹介ワークショップを企画。',
        role: '参加生徒',
        challenge: '日本文化を英語で説明する語彙が足りなかった。',
        action: '事前に英語スクリプトを書き、現地で何度もリハーサルした。',
        reflection: '準備の量がそのまま現場の自信になる。',
        futureConnection: '国際的な場で日本を発信する力をつけたい。',
      },
    ],
    clubActivities: [
      {
        type: 'club',
        clubName: '英語ディベート部',
        sport: 'ディベート',
        competitionLevel: '都大会',
        teamSize: '6名',
        period: { from: '2023-04', to: '2026-03' },
        description: '英語ディベート部で都大会出場。',
        achievement: '都大会ベスト8。',
        role: 'メンバー',
        challenge: '反論の組み立てに時間がかかった。',
        action: '想定反論ノートを毎週更新し、論点パターンを蓄積した。',
        reflection: '即興力は事前準備の蓄積で支えられる。',
        futureConnection: '英語で議論する力を学術の場で磨きたい。',
      },
    ],
  },
  studentProfile: makeStudentProfile({
    summary:
      'カナダ短期留学と英語ディベート部の3年間を通じて、英語での発信と議論を「事前準備の蓄積」で支える姿勢を育てた高校3年生。',
    strengths: [
      '事前準備（スクリプト・想定反論ノート）の蓄積で即興場面を支える設計力',
      '日本文化を相手の文脈で英語に翻訳する経験',
      '3 年間継続した部活動',
    ],
    weaknesses: [
      '校外の探究活動が薄い',
      '英語以外の領域での発信経験が少ない',
    ],
    futureConnections: ['国際的な場で日本を発信する仕事に進みたい'],
    valueKeywords: ['事前準備', '英語発信', 'ディベート', '日本文化発信'],
  }),
  activitySummary:
    'カナダ短期留学で日本文化紹介ワークショップを企画。事前に英語スクリプトを書き、現地で何度もリハーサルすることで運営を成立させた。英語ディベート部では、想定反論ノートを毎週更新する運用で都大会ベスト8。事前準備の蓄積が即興場面を支えるテーマで活動を続けてきた。',
  statementDraft: {
    university: '明治大学',
    faculty: '国際日本学部',
    department: '',
    statementText:
      '私は明治大学国際日本学部で、日本を国際的に発信する力を学びたい。カナダ短期留学で日本文化紹介ワークショップを企画した際、英語で説明する語彙が足りず、事前にスクリプトを書き現地で何度もリハーサルした。準備の量がそのまま現場の自信になると学んだ。\n\n英語ディベート部では、即興の反論力が当初課題だった。想定反論ノートを毎週更新し論点パターンを蓄積することで、都大会ベスト8に届いた。即興力は事前準備の蓄積で支えられると確信している。\n\n明治の国際日本学部では、日本文化と国際社会の交差点を学び、卒業後は日本を国際的な場で発信する仕事に進みたい。',
  },
  essay: '',
  matchingFixture: makeMatchingFixture({
    universityId: 'meiji-kokusai-nihon',
    universityName: '明治大学',
    faculty: '国際日本学部',
    admissionType: '総合型',
    academicType: '文系',
    description: '日本文化と国際社会の交差点を扱う学際的学部。英語による発信力と日本研究を統合する。',
    score: 72,
  }),
  interviewFeedbackQa: {
    universityName: '明治大学',
    facultyName: '国際日本学部',
    motivation:
      'カナダ留学とディベートで磨いた「事前準備の蓄積で即興を支える」姿勢を、明治の国際日本学部で深めたい。',
    questionsAndAnswers: [
      {
        question: '明治大学国際日本学部を志望した理由を教えてください。',
        answer:
          'カナダ短期留学で日本文化紹介ワークショップを企画した際、事前に英語スクリプトを書きリハーサルを繰り返したことが現場の自信になりました。日本を国際的に発信する力を、貴学部で体系的に学びたいです。',
      },
      {
        question: '英語ディベート部での経験を教えてください。',
        answer:
          '想定反論ノートを毎週更新する運用で論点パターンを蓄積したことで、都大会ベスト8に届きました。即興力は事前準備の蓄積で支えられると確信しています。',
      },
      {
        question: '将来やりたいことは何ですか？',
        answer:
          '日本を国際的に発信する仕事に進みたいです。',
      },
    ],
  },
  essayReviewQa: {
    theme:
      '日本文化を海外に発信する上で、最も大切なことは何か、あなたの考えを述べなさい。',
    conclusion: '日本文化を海外に発信する上で最も大切なのは「相手の文脈に翻訳して伝える設計」だと考える。',
    reasonOne: 'カナダ留学でワークショップを企画した経験から、文化を「そのまま伝える」と「相手に届く形で伝える」は別物だと実感した。',
    reasonTwo: '事前にスクリプトを書きリハーサルを重ねるという「準備の蓄積」が、現場で相手の文脈に合わせる柔軟さを支えると学んだ。',
    essayBody:
      '日本文化を海外に発信する上で最も大切なことは何か。私は「相手の文脈に翻訳して伝える設計」だと考える。\n\nカナダ短期留学中、私は日本文化紹介ワークショップを企画した。当初は寿司や着物の写真を見せれば興味を持ってもらえると考えていたが、現地の参加者の反応は薄かった。私は内容を組み直し、現地の食文化と比較する切り口や、彼らが日常で抱いている疑問から逆算した順序で再構成した。準備の段階で英語スクリプトを書き、リハーサルを繰り返した結果、参加者は積極的に質問するようになった。\n\n日本文化を「そのまま」見せても伝わらない。海外発信は翻訳作業であり、相手の関心と文脈を起点に再構成する設計が必要だ。\n\n英語ディベート部で蓄積した「想定反論ノート」も同じ発想だ。事前に相手の論点を準備するほど、本番で柔軟に対応できる。発信は思いつきではなく設計で成り立つと考える。',
    chatQuestion: '主張がぼんやりしていると言われました。どう絞ればいいですか？',
  },
};
CASE_F.essay = CASE_F.statementDraft.statementText;

const ALL_CASES: QaCase[] = [CASE_A, CASE_C, CASE_D, CASE_E, CASE_F];

// ─────────────────────────────────────────────────────────────
// Runners
// ─────────────────────────────────────────────────────────────

function parseJsonLoose(raw: string): { parsed: unknown; error: string | null } {
  try {
    // production extractJson と同じ方針: ```json ブロック → ``` → { または [ から始まる部分
    const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) return { parsed: JSON.parse(codeBlockMatch[1].trim()), error: null };
    const jsonStart = raw.search(/[{[]/);
    const slice = jsonStart !== -1 ? raw.slice(jsonStart) : raw;
    return { parsed: JSON.parse(slice), error: null };
  } catch (e) {
    return { parsed: null, error: e instanceof Error ? e.message : String(e) };
  }
}

async function runStatementReview(
  c: QaCase,
  anthropic: Anthropic | null,
): Promise<RunResult> {
  const start = Date.now();
  const userPrompt = buildStatementReviewPrompt({
    university: c.basicInfo.preferences[0]?.university ?? '',
    faculty: c.basicInfo.preferences[0]?.faculty ?? '',
    department: c.basicInfo.preferences[0]?.department ?? '',
    essay: c.essay,
    basicInfo: c.basicInfo,
    activityData: c.activityData,
    studentProfile: c.studentProfile,
    wallHittingResult: null,
  });

  if (FLAG_VERBOSE) {
    console.log(`\n===== ${c.id} / statement-review =====`);
    console.log('--- SYSTEM ---\n' + STATEMENT_REVIEW_SYSTEM_PROMPT);
    console.log('--- USER ---\n' + userPrompt);
  }

  if (!anthropic) {
    return {
      caseId: c.id,
      route: 'statement-review',
      systemPrompt: STATEMENT_REVIEW_SYSTEM_PROMPT,
      userPrompt,
      rawOutput: '',
      parsed: null,
      parseError: null,
      lint: lintStatementReview(c, null, ''),
      apiError: null,
      dryRun: true,
      usage: null,
      durationMs: Date.now() - start,
    };
  }

  let rawOutput = '';
  let parsed: unknown = null;
  let parseError: string | null = null;
  let apiError: string | null = null;
  let usage: RunResult['usage'] = null;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: STATEMENT_REVIEW_MAX_TOKENS,
      system: STATEMENT_REVIEW_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const block = response.content.find((b) => b.type === 'text');
    rawOutput = block && block.type === 'text' ? block.text : '';
    usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };
    const parseResult = parseJsonLoose(rawOutput);
    parsed = parseResult.parsed;
    parseError = parseResult.error;
  } catch (e) {
    apiError = e instanceof Error ? e.message : String(e);
  }

  return {
    caseId: c.id,
    route: 'statement-review',
    systemPrompt: STATEMENT_REVIEW_SYSTEM_PROMPT,
    userPrompt,
    rawOutput,
    parsed,
    parseError,
    lint: lintStatementReview(c, parsed, rawOutput),
    apiError,
    dryRun: false,
    usage,
    durationMs: Date.now() - start,
  };
}

// STEP15i: summarize（deep mode）の AI 呼び出し検証。
//
// summarize の出力は SummaryResult = { activitySummary, strengths, appealPoints } の 3 フィールド。
// 短文中心のため評定値・欠席日数の直接転記が起きると即「自己分析 = 成績表」化する。
// 本 lint はそれを厳格にチェックする（analysis QA より厳しめ）。
//
// 本番 buildSummarizePrompt は { activityText, analysis, answers, basicInfo, universityContext, mode, ... }
// を受け取る。harness では:
//   - activityText: formatActivityDataAsText(c.activityData) を流用
//   - analysis: c.studentProfile のフィールドを WallHittingResult shape に流し込む（同 shape のため安全）
//   - answers: 各 Case で固定 5 件の analysis 深掘り回答 fixture
//   - mode: 'deep' 固定（成績表化リスクが最大の側を観測）
//   - universityContext: null（DB 経路を持ち込まない）

// summarize 用の simulated WallHittingResult を Case の StudentProfile から派生させる。
// 本番では analysis API の出力を渡すが、harness では合成で十分（subjectGrades 振る舞いの観測が目的）。
function buildWallHittingFixtureForSummarize(c: QaCase): {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  futureConnections: string[];
  questions: string[];
} {
  return {
    summary: c.studentProfile.summary,
    strengths: c.studentProfile.strengths.slice(0, 3),
    weaknesses: c.studentProfile.weaknesses.slice(0, 2),
    futureConnections: c.studentProfile.futureConnections.slice(0, 2),
    questions: ADDITIONAL_QUESTIONS_EXISTING_FIXTURE,
  };
}

// 各 Case の activitySummary を 1 問目の回答に流用し、残り 4 問は generic な回答にする。
// AI が活動素材を summary に変換できる程度に realistic、かつ Case 横断で構造同等にする。
function buildSummarizeAnswersFor(c: QaCase): string[] {
  return [
    c.activitySummary,
    '当初は手探りだったが、関係者と相談しながら進める姿勢を意識した。',
    '関係者の懸念を文書化して整理し、共通点を起点に再提案する方法で動かしてきた。',
    '小さな成果でも蓄積することで、自分の判断軸が言語化できるようになった。',
    '大学では実践的に深め、卒業後は地域・社会・国際の現場で活かしたい。',
  ];
}

async function runSummarize(c: QaCase, anthropic: Anthropic | null): Promise<RunResult> {
  const start = Date.now();
  const activityText = formatActivityDataAsText(c.activityData);
  const analysisFixture = buildWallHittingFixtureForSummarize(c);
  const answers = buildSummarizeAnswersFor(c);
  const userPrompt = buildSummarizePrompt({
    activityText,
    analysis: analysisFixture,
    answers,
    deepAnswers: undefined,
    freeMemo: undefined,
    basicInfo: c.basicInfo,
    universityContext: null,
  });

  if (FLAG_VERBOSE) {
    console.log(`\n===== ${c.id} / summarize (deep) =====`);
    console.log('--- SYSTEM ---\n' + SUMMARIZE_DEEP_SYSTEM_PROMPT);
    console.log('--- USER ---\n' + userPrompt);
  }

  if (!anthropic) {
    return {
      caseId: c.id,
      route: 'summarize',
      systemPrompt: SUMMARIZE_DEEP_SYSTEM_PROMPT,
      userPrompt,
      rawOutput: '',
      parsed: null,
      parseError: null,
      lint: lintSummarize(c, null, ''),
      apiError: null,
      dryRun: true,
      usage: null,
      durationMs: Date.now() - start,
    };
  }

  let rawOutput = '';
  let parsed: unknown = null;
  let parseError: string | null = null;
  let apiError: string | null = null;
  let usage: RunResult['usage'] = null;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: SUMMARIZE_MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: SUMMARIZE_DEEP_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    });
    const block = response.content.find((b) => b.type === 'text');
    rawOutput = block && block.type === 'text' ? block.text : '';
    usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };
    const r = parseJsonLoose(rawOutput);
    parsed = r.parsed;
    parseError = r.error;
  } catch (e) {
    apiError = e instanceof Error ? e.message : String(e);
  }

  return {
    caseId: c.id,
    route: 'summarize',
    systemPrompt: SUMMARIZE_DEEP_SYSTEM_PROMPT,
    userPrompt,
    rawOutput,
    parsed,
    parseError,
    lint: lintSummarize(c, parsed, rawOutput),
    apiError,
    dryRun: false,
    usage,
    durationMs: Date.now() - start,
  };
}

// STEP15h: essay-review の AI 呼び出し検証。
// 本番 route の userMessage 組み立てを harness 内で再現する。
// universityContext は QA では空文字（DB を引かない）。
function buildEssayReviewUserMessageHarness(args: {
  basicInfo: BasicInfo | null;
  theme: string;
  conclusion: string;
  reasonOne: string;
  reasonTwo: string;
  essayBody: string;
}): string {
  const basicInfoSection = buildBasicInfoPromptSection(args.basicInfo);
  // examTypeGuidance / essayUniversityContext は harness では空にする（本番経路には依存させない）
  return `以下の小論文を採点・添削してください。

${basicInfoSection}

【テーマ】
${args.theme || '（未入力）'}

【生徒の結論（1文）】
${args.conclusion || '（未入力）'}

【理由①】
${args.reasonOne || '（未入力）'}

【理由②】
${args.reasonTwo || '（未入力）'}

【本文】
${args.essayBody}`;
}

async function runEssayReview(c: QaCase, anthropic: Anthropic | null): Promise<RunResult> {
  const start = Date.now();
  const userPrompt = buildEssayReviewUserMessageHarness({
    basicInfo: c.basicInfo,
    theme: c.essayReviewQa.theme,
    conclusion: c.essayReviewQa.conclusion,
    reasonOne: c.essayReviewQa.reasonOne,
    reasonTwo: c.essayReviewQa.reasonTwo,
    essayBody: c.essayReviewQa.essayBody,
  });

  if (FLAG_VERBOSE) {
    console.log(`\n===== ${c.id} / essay-review =====`);
    console.log('--- SYSTEM ---\n' + ESSAY_REVIEW_SYSTEM_PROMPT);
    console.log('--- USER ---\n' + userPrompt);
  }

  if (!anthropic) {
    return {
      caseId: c.id,
      route: 'essay-review',
      systemPrompt: ESSAY_REVIEW_SYSTEM_PROMPT,
      userPrompt,
      rawOutput: '',
      parsed: null,
      parseError: null,
      lint: lintEssayReview(c, null, ''),
      apiError: null,
      dryRun: true,
      usage: null,
      durationMs: Date.now() - start,
    };
  }

  let rawOutput = '';
  let parsed: unknown = null;
  let parseError: string | null = null;
  let apiError: string | null = null;
  let usage: RunResult['usage'] = null;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: ESSAY_REVIEW_MAX_TOKENS,
      temperature: ESSAY_REVIEW_TEMPERATURE,
      system: [
        {
          type: 'text',
          text: ESSAY_REVIEW_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    });
    const block = response.content.find((b) => b.type === 'text');
    rawOutput = block && block.type === 'text' ? block.text : '';
    usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };
    const r = parseJsonLoose(rawOutput);
    parsed = r.parsed;
    parseError = r.error;
  } catch (e) {
    apiError = e instanceof Error ? e.message : String(e);
  }

  return {
    caseId: c.id,
    route: 'essay-review',
    systemPrompt: ESSAY_REVIEW_SYSTEM_PROMPT,
    userPrompt,
    rawOutput,
    parsed,
    parseError,
    lint: lintEssayReview(c, parsed, rawOutput),
    apiError,
    dryRun: false,
    usage,
    durationMs: Date.now() - start,
  };
}

// STEP15h: essay-chat の AI 呼び出し検証。
// 本番 route は plain text 応答（JSON parse なし）。1〜2 文の問いかけを返す。
function buildEssayChatUserMessageHarness(args: {
  basicInfo: BasicInfo | null;
  theme: string;
  conclusion: string;
  reasonOne: string;
  reasonTwo: string;
  essayBody: string;
  userQuestion: string;
}): string {
  const basicInfoSection = buildBasicInfoPromptSection(args.basicInfo);
  return `${basicInfoSection}

【テーマ】
${args.theme}

【生徒の結論（1文）】
${args.conclusion || '（未記入）'}

【生徒の理由①】
${args.reasonOne || '（未記入）'}

【生徒の理由②】
${args.reasonTwo || '（未記入）'}

【生徒の本文】
${args.essayBody || '（未記入）'}

【生徒の相談内容】
${args.userQuestion}`;
}

async function runEssayChat(c: QaCase, anthropic: Anthropic | null): Promise<RunResult> {
  const start = Date.now();
  const userPrompt = buildEssayChatUserMessageHarness({
    basicInfo: c.basicInfo,
    theme: c.essayReviewQa.theme,
    conclusion: c.essayReviewQa.conclusion,
    reasonOne: c.essayReviewQa.reasonOne,
    reasonTwo: c.essayReviewQa.reasonTwo,
    essayBody: c.essayReviewQa.essayBody,
    userQuestion: c.essayReviewQa.chatQuestion,
  });

  if (FLAG_VERBOSE) {
    console.log(`\n===== ${c.id} / essay-chat =====`);
    console.log('--- SYSTEM ---\n' + ESSAY_CHAT_SYSTEM_PROMPT);
    console.log('--- USER ---\n' + userPrompt);
  }

  if (!anthropic) {
    return {
      caseId: c.id,
      route: 'essay-chat',
      systemPrompt: ESSAY_CHAT_SYSTEM_PROMPT,
      userPrompt,
      rawOutput: '',
      parsed: null,
      parseError: null,
      lint: lintEssayChat(c, ''),
      apiError: null,
      dryRun: true,
      usage: null,
      durationMs: Date.now() - start,
    };
  }

  let rawOutput = '';
  let apiError: string | null = null;
  let usage: RunResult['usage'] = null;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: ESSAY_CHAT_MAX_TOKENS,
      temperature: ESSAY_CHAT_TEMPERATURE,
      // essay-chat の本番は system: string で渡しているため harness も同形で送る。
      system: ESSAY_CHAT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const block = response.content.find((b) => b.type === 'text');
    rawOutput = block && block.type === 'text' ? block.text.trim() : '';
    usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };
  } catch (e) {
    apiError = e instanceof Error ? e.message : String(e);
  }

  return {
    caseId: c.id,
    route: 'essay-chat',
    systemPrompt: ESSAY_CHAT_SYSTEM_PROMPT,
    userPrompt,
    rawOutput,
    parsed: rawOutput, // chat は plain text なので raw == parsed として扱う
    parseError: null,
    lint: lintEssayChat(c, rawOutput),
    apiError,
    dryRun: false,
    usage,
    durationMs: Date.now() - start,
  };
}

// STEP15g: analysis/additional の AI 呼び出し検証。
//
// 本 route は activityText + 既存質問リストを入力にして 2 問の追加質問を生成する。
// 既存質問は本番では /api/analysis の出力 questions[] が渡されるが、harness では
// QA 用に「Case 横断で使い回せる現実的な既存質問 5 件」を固定する（毎回 fresh AI 呼び出しで
// 揺らぐのを避けるため）。lint 観点は 2 問の質問文に対して:
//   - 評定数値（X.X）/ 欠席日数（N日）の直書き禁止
//   - questions[0] が subjectGrades 主題でないこと
//   - 無関係科目低評定が質問主題でないこと
//   - 欠席質問が不安煽りでないこと
//   - Case F hallucination ゼロ
const ADDITIONAL_QUESTIONS_EXISTING_FIXTURE: string[] = [
  '【動機】志望分野に興味を持った最初のきっかけを、当時の感情も含めて教えてください。',
  '【課題】活動の中で最もうまくいかなかった場面と、そのときの判断を教えてください。',
  '【行動】チームや関係者が動かなかったとき、自分なりにどんな工夫をしましたか。',
  '【成果】活動の結果として、自分の中で一番変わったことは何ですか。',
  '【将来】学んだことを大学や将来の現場でどう活かしたいと考えていますか。',
];

async function runAdditionalQuestions(c: QaCase, anthropic: Anthropic | null): Promise<RunResult> {
  const start = Date.now();
  const activityText = formatActivityDataAsText(c.activityData);
  const userPrompt = buildAdditionalQuestionsPrompt({
    activityText,
    existingQuestions: ADDITIONAL_QUESTIONS_EXISTING_FIXTURE,
    basicInfo: c.basicInfo,
    universityContext: null,
  });

  if (FLAG_VERBOSE) {
    console.log(`\n===== ${c.id} / analysis-additional =====`);
    console.log('--- SYSTEM ---\n' + ADDITIONAL_QUESTIONS_SYSTEM_PROMPT);
    console.log('--- USER ---\n' + userPrompt);
  }

  if (!anthropic) {
    return {
      caseId: c.id,
      route: 'analysis-additional',
      systemPrompt: ADDITIONAL_QUESTIONS_SYSTEM_PROMPT,
      userPrompt,
      rawOutput: '',
      parsed: null,
      parseError: null,
      lint: lintAdditionalQuestions(c, null, ''),
      apiError: null,
      dryRun: true,
      usage: null,
      durationMs: Date.now() - start,
    };
  }

  let rawOutput = '';
  let parsed: unknown = null;
  let parseError: string | null = null;
  let apiError: string | null = null;
  let usage: RunResult['usage'] = null;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: ADDITIONAL_QUESTIONS_MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: ADDITIONAL_QUESTIONS_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    });
    const block = response.content.find((b) => b.type === 'text');
    rawOutput = block && block.type === 'text' ? block.text : '';
    usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };
    const r = parseJsonLoose(rawOutput);
    parsed = r.parsed;
    parseError = r.error;
  } catch (e) {
    apiError = e instanceof Error ? e.message : String(e);
  }

  return {
    caseId: c.id,
    route: 'analysis-additional',
    systemPrompt: ADDITIONAL_QUESTIONS_SYSTEM_PROMPT,
    userPrompt,
    rawOutput,
    parsed,
    parseError,
    lint: lintAdditionalQuestions(c, parsed, rawOutput),
    apiError,
    dryRun: false,
    usage,
    durationMs: Date.now() - start,
  };
}

// STEP15f: analysis (wallHitting) の AI 呼び出し検証。
//
// 重要: analysis の出力は StudentProfile に固定化され、下流の全 4 route に伝染する。
// そのため lint は他 route よりも厳しめにする:
//   - strengths / weaknesses / futureConnections / summary に評定数値 / 欠席日数 / 科目別評定の引用が
//     一切残らないことを違反としてチェックする
//   - weaknesses に「無関係科目低評定」が混入していないかチェック
//   - questions（5 問）には評定数値が出ても warning（質問は AI 出力ではなく次回プロンプト入力に
//     なるため軽度に扱う）
//
// activityText は本番 route と同じ「自由テキスト」形式で渡す。各 Case の activityData を
// 簡潔な人間読みテキストへ整形して渡す（本番では client が同様の整形を行う）。
function formatActivityDataAsText(d: ActivityData): string {
  const parts: string[] = [];
  for (const club of d.clubActivities) {
    parts.push(
      `■部活: ${club.clubName}（${club.sport}）\n内容: ${club.description}\n成果: ${club.achievement}\n学び: ${club.reflection}`,
    );
  }
  for (const r of d.researchActivities) {
    parts.push(
      `■探究: ${r.theme}\nきっかけ: ${r.trigger}\n方法: ${r.methodology}\n成果: ${r.achievement}\n学び: ${r.reflection}`,
    );
  }
  for (const sa of d.studyAbroadActivities) {
    parts.push(
      `■留学: ${sa.destination}\n内容: ${sa.programContent}\n言語: ${sa.language}\n成果: ${sa.achievement}\n学び: ${sa.reflection}`,
    );
  }
  for (const v of d.volunteerActivities) {
    parts.push(
      `■ボランティア: ${v.activityContent}\n対象: ${v.target}\n目的: ${v.purpose}\n成果: ${v.achievement}`,
    );
  }
  for (const ct of d.contestActivities) {
    parts.push(
      `■コンテスト: ${ct.contestName}\n分野: ${ct.field}\n結果: ${ct.result}\n学び: ${ct.reflection}`,
    );
  }
  for (const cert of d.certificationActivities) {
    parts.push(`■資格: ${cert.certificationName}（${cert.level}）\n取得目的: ${cert.purpose}`);
  }
  for (const pt of d.partTimeJobActivities) {
    parts.push(`■アルバイト: ${pt.industry}\n業務: ${pt.jobContent}\n学び: ${pt.reflection}`);
  }
  return parts.length > 0 ? parts.join('\n\n') : '（活動データなし）';
}

async function runAnalysis(c: QaCase, anthropic: Anthropic | null): Promise<RunResult> {
  const start = Date.now();
  const activityText = formatActivityDataAsText(c.activityData);
  const userPrompt = buildWallHittingPrompt({
    activityText,
    basicInfo: c.basicInfo,
    universityContext: null,
  });

  if (FLAG_VERBOSE) {
    console.log(`\n===== ${c.id} / analysis =====`);
    console.log('--- SYSTEM ---\n' + ANALYSIS_SYSTEM_PROMPT);
    console.log('--- USER ---\n' + userPrompt);
  }

  if (!anthropic) {
    return {
      caseId: c.id,
      route: 'analysis',
      systemPrompt: ANALYSIS_SYSTEM_PROMPT,
      userPrompt,
      rawOutput: '',
      parsed: null,
      parseError: null,
      lint: lintAnalysis(c, null, ''),
      apiError: null,
      dryRun: true,
      usage: null,
      durationMs: Date.now() - start,
    };
  }

  let rawOutput = '';
  let parsed: unknown = null;
  let parseError: string | null = null;
  let apiError: string | null = null;
  let usage: RunResult['usage'] = null;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: ANALYSIS_MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: ANALYSIS_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    });
    const block = response.content.find((b) => b.type === 'text');
    rawOutput = block && block.type === 'text' ? block.text : '';
    usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };
    const r = parseJsonLoose(rawOutput);
    parsed = r.parsed;
    parseError = r.error;
  } catch (e) {
    apiError = e instanceof Error ? e.message : String(e);
  }

  return {
    caseId: c.id,
    route: 'analysis',
    systemPrompt: ANALYSIS_SYSTEM_PROMPT,
    userPrompt,
    rawOutput,
    parsed,
    parseError,
    lint: lintAnalysis(c, parsed, rawOutput),
    apiError,
    dryRun: false,
    usage,
    durationMs: Date.now() - start,
  };
}

// STEP15e: interview-feedback の AI 呼び出し検証。
// 本番 route の userPrompt 組み立てを harness 内で再現する。
//   - basicInfoSection / examTypeGuidance / studentProfileSection は同じ helper を使う
//   - interviewUniversityContext は universityContext を harness では空文字で渡す（DB 副作用回避）
// AI 評価の対象は次の検証ポイント:
//   - levelEvaluation の各値が weak/normal/strong の enum に正規化されているか
//   - betterAnswer に評定数値（X.X）や欠席日数（N日）が直接出ていないか
//   - improvements[0] / nextPractice[0] が subjectGrades 主題になっていないか
//   - 欠席に関する助言が「不安煽り」になっていないか
//   - Case F で評定推測が混入していないか

// 本番 route 内の buildExamTypeInterviewGuidance を逐語コピー（route 内 const のため re-export 不可、
// harness で本番経路を完全再現するために最小限の重複を許容）。文字列は同期する必要がある。
function buildExamTypeInterviewGuidanceLocal(examTypes: string[] | undefined): string {
  const types = examTypes ?? [];
  const rules: string[] = [];
  if (types.includes('総合型選抜（AO入試）')) {
    rules.push('- 総合型選抜（AO）対策として、活動・自己分析・志望理由の一貫性を厳しめにチェックする。');
  }
  if (types.includes('学校推薦型選抜（公募・指定校）')) {
    rules.push('- 学校推薦型選抜対策として、評定平均・学校生活の継続性・推薦理由の妥当性を踏まえてフィードバックする。');
  }
  if (types.includes('一般選抜') || types.includes('共通テスト利用')) {
    rules.push('- 一般選抜（共通テスト利用を含む）も併願しているため、「なぜ一般受験だけでなく推薦・総合型も使うのか」を聞かれる前提で深掘り質問・改善点を出す。');
  }
  if (types.includes('海外大学受験')) {
    rules.push('- 海外大学受験を含むため、語学力・国際経験との接続も評価軸に加える。');
  }
  if (types.includes('まだ決まっていない')) {
    rules.push('- 受験方式が未確定なので、特定方式に偏らず幅広く使えるアドバイスを優先する。');
  }
  if (rules.length === 0) return '';
  return ['【受験方式に応じたフィードバック方針】', ...rules].join('\n');
}

// 本番 POST handler の userPrompt 組み立てを harness で再現する。
// universityContext は QA では空文字（DB 経路を持ち込まない）。
function buildInterviewFeedbackUserPromptHarness(args: {
  basicInfo: BasicInfo | null;
  studentProfile: StudentProfile | null;
  universityName: string;
  facultyName: string;
  motivation: string;
  questionsAndAnswers: { question: string; answer: string }[];
}): string {
  const basicInfoSection = buildBasicInfoPromptSection(args.basicInfo);
  const examTypeGuidance = buildExamTypeInterviewGuidanceLocal(args.basicInfo?.examTypes);
  const studentProfileSection = buildInterviewStudentProfileContext(args.studentProfile);
  const interviewUniversityContext = ''; // harness では DB を引かない
  const qaText = args.questionsAndAnswers
    .map((item, index) => `${index + 1}.\n質問：${item.question}\n回答：${item.answer}`)
    .join('\n\n');

  return `${basicInfoSection}

【受験情報（今回の練習で対象とした内容）】
大学名：${args.universityName}
学部・学科：${args.facultyName}
志望理由：${args.motivation || '（未入力）'}
${examTypeGuidance ? `\n${examTypeGuidance}\n` : ''}
${interviewUniversityContext ? `${interviewUniversityContext}\n\n` : ''}${studentProfileSection ? `${studentProfileSection}\n\n` : ''}【質問と回答】
${qaText}`;
}

async function runInterviewFeedback(
  c: QaCase,
  anthropic: Anthropic | null,
): Promise<RunResult> {
  const start = Date.now();
  const userPrompt = buildInterviewFeedbackUserPromptHarness({
    basicInfo: c.basicInfo,
    studentProfile: c.studentProfile,
    universityName: c.interviewFeedbackQa.universityName,
    facultyName: c.interviewFeedbackQa.facultyName,
    motivation: c.interviewFeedbackQa.motivation,
    questionsAndAnswers: c.interviewFeedbackQa.questionsAndAnswers,
  });

  if (FLAG_VERBOSE) {
    console.log(`\n===== ${c.id} / interview-feedback =====`);
    console.log('--- SYSTEM ---\n' + INTERVIEW_FEEDBACK_SYSTEM_PROMPT);
    console.log('--- USER ---\n' + userPrompt);
  }

  if (!anthropic) {
    return {
      caseId: c.id,
      route: 'interview-feedback',
      systemPrompt: INTERVIEW_FEEDBACK_SYSTEM_PROMPT,
      userPrompt,
      rawOutput: '',
      parsed: null,
      parseError: null,
      lint: lintInterviewFeedback(c, null, ''),
      apiError: null,
      dryRun: true,
      usage: null,
      durationMs: Date.now() - start,
    };
  }

  let rawOutput = '';
  let parsed: unknown = null;
  let parseError: string | null = null;
  let apiError: string | null = null;
  let usage: RunResult['usage'] = null;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-7', // 本番 route と同じ
      max_tokens: INTERVIEW_FEEDBACK_MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: INTERVIEW_FEEDBACK_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    });
    const block = response.content.find((b) => b.type === 'text');
    rawOutput = block && block.type === 'text' ? block.text : '';
    usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };
    const r = parseJsonLoose(rawOutput);
    parsed = r.parsed;
    parseError = r.error;
  } catch (e) {
    apiError = e instanceof Error ? e.message : String(e);
  }

  return {
    caseId: c.id,
    route: 'interview-feedback',
    systemPrompt: INTERVIEW_FEEDBACK_SYSTEM_PROMPT,
    userPrompt,
    rawOutput,
    parsed,
    parseError,
    lint: lintInterviewFeedback(c, parsed, rawOutput),
    apiError,
    dryRun: false,
    usage,
    durationMs: Date.now() - start,
  };
}

// STEP15d: matching の AI 呼び出し検証。
// production の generateUniversityDetail と同形（system + user / cache_control / max_tokens 500）で叩く。
// 候補大学は Case 固定の matchingFixture を 1 件使用。本番では 5 大学処理だが harness ではコスト最小化のため 1 件。
async function runMatching(c: QaCase, anthropic: Anthropic | null): Promise<RunResult> {
  const start = Date.now();
  const userPrompt = buildMatchingUserPrompt({
    result: c.matchingFixture,
    studentProfile: c.studentProfile,
    basicInfo: c.basicInfo,
    activityData: c.activityData,
    universityContext: null,
  });

  if (FLAG_VERBOSE) {
    console.log(`\n===== ${c.id} / matching =====`);
    console.log('--- SYSTEM ---\n' + MATCHING_SYSTEM_PROMPT);
    console.log('--- USER ---\n' + userPrompt);
  }

  if (!anthropic) {
    return {
      caseId: c.id,
      route: 'matching',
      systemPrompt: MATCHING_SYSTEM_PROMPT,
      userPrompt,
      rawOutput: '',
      parsed: null,
      parseError: null,
      lint: lintMatching(c, null, ''),
      apiError: null,
      dryRun: true,
      usage: null,
      durationMs: Date.now() - start,
    };
  }

  let rawOutput = '';
  let parsed: unknown = null;
  let parseError: string | null = null;
  let apiError: string | null = null;
  let usage: RunResult['usage'] = null;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MATCHING_MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: MATCHING_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    });
    const block = response.content.find((b) => b.type === 'text');
    rawOutput = block && block.type === 'text' ? block.text : '';
    usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };
    const r = parseJsonLoose(rawOutput);
    parsed = r.parsed;
    parseError = r.error;
  } catch (e) {
    apiError = e instanceof Error ? e.message : String(e);
  }

  return {
    caseId: c.id,
    route: 'matching',
    systemPrompt: MATCHING_SYSTEM_PROMPT,
    userPrompt,
    rawOutput,
    parsed,
    parseError,
    lint: lintMatching(c, parsed, rawOutput),
    apiError,
    dryRun: false,
    usage,
    durationMs: Date.now() - start,
  };
}

async function runInterviewQuestions(
  c: QaCase,
  anthropic: Anthropic | null,
): Promise<RunResult> {
  const start = Date.now();
  const materials = buildInterviewQuestionMaterials({
    basicInfo: c.basicInfo,
    statementDraft: c.statementDraft,
    studentProfile: c.studentProfile,
    activitySummary: c.activitySummary,
  });
  const userPrompt = buildInterviewQuestionUserPrompt({
    materials,
    universityContext: null,
    examTypeGuidance: null,
  });

  if (FLAG_VERBOSE) {
    console.log(`\n===== ${c.id} / interview-questions =====`);
    console.log('--- SYSTEM ---\n' + INTERVIEW_QUESTION_SYSTEM_PROMPT);
    console.log('--- USER ---\n' + userPrompt);
  }

  if (!anthropic) {
    return {
      caseId: c.id,
      route: 'interview-questions',
      systemPrompt: INTERVIEW_QUESTION_SYSTEM_PROMPT,
      userPrompt,
      rawOutput: '',
      parsed: null,
      parseError: null,
      lint: lintInterviewQuestions(c, null, ''),
      apiError: null,
      dryRun: true,
      usage: null,
      durationMs: Date.now() - start,
    };
  }

  let rawOutput = '';
  let parsed: unknown = null;
  let parseError: string | null = null;
  let apiError: string | null = null;
  let usage: RunResult['usage'] = null;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: INTERVIEW_QUESTIONS_MAX_TOKENS,
      temperature: INTERVIEW_QUESTIONS_TEMPERATURE,
      system: INTERVIEW_QUESTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const block = response.content.find((b) => b.type === 'text');
    rawOutput = block && block.type === 'text' ? block.text : '';
    usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };
    const parseResult = parseJsonLoose(rawOutput);
    parsed = parseResult.parsed;
    parseError = parseResult.error;
  } catch (e) {
    apiError = e instanceof Error ? e.message : String(e);
  }

  return {
    caseId: c.id,
    route: 'interview-questions',
    systemPrompt: INTERVIEW_QUESTION_SYSTEM_PROMPT,
    userPrompt,
    rawOutput,
    parsed,
    parseError,
    lint: lintInterviewQuestions(c, parsed, rawOutput),
    apiError,
    dryRun: false,
    usage,
    durationMs: Date.now() - start,
  };
}

// ─────────────────────────────────────────────────────────────
// Lints
// ─────────────────────────────────────────────────────────────

function lintNgWords(text: string): { violations: string[]; warnings: string[] } {
  const violations: string[] = [];
  const warnings: string[] = [];
  for (const w of NG_HARD_WORDS) {
    if (text.includes(w)) violations.push(`断定 NG 語「${w}」が出力に含まれる`);
  }
  for (const w of NG_SOFT_WORDS) {
    if (text.includes(w)) {
      // 「無理」が「無理に〜しない」「無理難題」等の副詞用法ならノイズになりやすい。
      // 文脈判定までは harness では行わず、人間判読フラグとして warning にする。
      warnings.push(`soft NG 語「${w}」が出力に含まれる（副詞用法の可能性あり、目視確認）`);
    }
  }
  return { violations, warnings };
}

function lintFCaseHallucination(c: QaCase, raw: string): string[] {
  if (c.id !== 'case-f') return [];
  const violations: string[] = [];
  // Case F は subjectGrades undefined。AI が評定値を作り出していないか
  const gradeMentionPatterns = [
    /英語評定/,
    /数学評定/,
    /理科評定/,
    /国語評定/,
    /社会評定/,
    /欠席日数/,
    /評定[が は].*(?:[0-9]\.[0-9]|高い|低い)/,
  ];
  for (const p of gradeMentionPatterns) {
    if (p.test(raw)) {
      violations.push(`Case F: 評定推測の痕跡（pattern ${p.source}）`);
    }
  }
  return violations;
}

function lintStatementReview(c: QaCase, parsed: unknown, raw: string): LintResult {
  const { violations, warnings } = lintNgWords(raw);
  violations.push(...lintFCaseHallucination(c, raw));

  if (parsed && typeof parsed === 'object') {
    const p = parsed as {
      totalScore?: unknown;
      scores?: unknown;
      strengths?: unknown;
      weaknesses?: unknown;
      actions?: unknown;
    };

    // scores 整合性（totalScore = sum(scores)?）
    if (p.scores && typeof p.scores === 'object' && p.scores !== null) {
      const scoresObj = p.scores as Record<string, unknown>;
      const sum = Object.values(scoresObj).reduce<number>(
        (acc, v) => acc + (typeof v === 'number' ? v : 0),
        0,
      );
      if (typeof p.totalScore === 'number' && Math.abs(sum - p.totalScore) > 1) {
        warnings.push(`scores の合計 ${sum} が totalScore ${p.totalScore} と乖離`);
      }
    }

    // weaknesses[0] に無関係科目の低評定が来ていないか
    const fac = c.basicInfo.preferences[0]?.faculty ?? '';
    const dept = c.basicInfo.preferences[0]?.department ?? '';
    const cat = classifyFaculty(fac, dept);
    const related = relatedSubjectsFor(cat);
    const unrelated = ALL_SUBJECTS.filter((s) => !related.includes(s));

    if (Array.isArray(p.weaknesses) && p.weaknesses.length > 0) {
      const w0 = String(p.weaknesses[0]);
      for (const subj of unrelated) {
        // 「数学が」「数学の評定」「数学評定」のいずれかでマッチ。負の文脈とセットで violation
        const subjPattern = new RegExp(`${subj}(?:評定|の評定|が)`);
        if (subjPattern.test(w0)) {
          violations.push(
            `weaknesses[0] に無関係科目「${subj}」が登場（cat=${cat}, related=[${related.join(',')}]）: "${w0.slice(0, 60)}…"`,
          );
        }
      }
    }

    // strengths に評定数値「のみ」の項がないか（評定値が登場するが活動・経験への接続が薄いもの）
    if (Array.isArray(p.strengths)) {
      for (let i = 0; i < p.strengths.length; i++) {
        const s = String(p.strengths[i]);
        const hasGradeDigit = /[0-9]\.[0-9]/.test(s);
        const hasActivityRef = /(活動|経験|留学|探究|ボランティア|部活|コンテスト|ディベート|生徒会|文芸|研究)/.test(s);
        if (hasGradeDigit && !hasActivityRef) {
          warnings.push(`strengths[${i}] が評定単独に見える: "${s.slice(0, 60)}…"`);
        }
      }
    }

    // actions[0] が無関係科目の評定改善になっていないか
    if (Array.isArray(p.actions) && p.actions.length > 0) {
      const a0 = String(p.actions[0]);
      for (const subj of unrelated) {
        if (new RegExp(`${subj}(?:評定|の評定|が)`).test(a0)) {
          warnings.push(
            `actions[0] に無関係科目「${subj}」が登場: "${a0.slice(0, 60)}…"`,
          );
        }
      }
    }
  }

  return { violations, warnings };
}

// STEP15i: summarize の lint。
// 出力 schema: SummaryResult = { activitySummary: string, strengths: string, appealPoints: string }
// 3 フィールドすべて短文。評定数値・欠席日数・科目別評定の直書きを最厳格にチェックする。
//   - activitySummary に評定値・欠席日数・科目別評定の引用ゼロ
//   - strengths に評定値・欠席日数・科目別評定の引用ゼロ
//   - appealPoints に評定値・欠席日数・科目別評定の引用ゼロ
//   - 無関係科目の低評定言及ゼロ
//   - Case F hallucination ゼロ
function lintSummarize(c: QaCase, parsed: unknown, raw: string): LintResult {
  const { violations, warnings } = lintNgWords(raw);
  violations.push(...lintFCaseHallucination(c, raw));

  if (parsed && typeof parsed === 'object') {
    const p = parsed as {
      activitySummary?: unknown;
      strengths?: unknown;
      appealPoints?: unknown;
    };

    const gradeDigit = /[0-9]\.[0-9]/;
    const absenceLiteral = /[0-9]+\s*日/;
    const subjectGradeMention = /(英語|数学|理科|国語|社会)評定/;

    const fac = c.basicInfo.preferences[0]?.faculty ?? '';
    const dept = c.basicInfo.preferences[0]?.department ?? '';
    const cat = classifyFaculty(fac, dept);
    const related = relatedSubjectsFor(cat);
    const unrelated = ALL_SUBJECTS.filter((s) => !related.includes(s));

    const check = (field: 'activitySummary' | 'strengths' | 'appealPoints', text: string) => {
      if (gradeDigit.test(text)) {
        violations.push(`${field} に評定数値直書き: "${text.slice(0, 80)}…"`);
      }
      if (absenceLiteral.test(text)) {
        violations.push(`${field} に欠席日数直書き: "${text.slice(0, 80)}…"`);
      }
      if (subjectGradeMention.test(text)) {
        violations.push(`${field} に科目別評定の引用: "${text.slice(0, 80)}…"`);
      }
      for (const s of unrelated) {
        if (new RegExp(`${s}(?:評定|の評定|が低い|が苦手)`).test(text)) {
          violations.push(`${field} に無関係科目「${s}」: "${text.slice(0, 80)}…"`);
        }
      }
    };

    if (typeof p.activitySummary === 'string') check('activitySummary', p.activitySummary);
    if (typeof p.strengths === 'string') check('strengths', p.strengths);
    if (typeof p.appealPoints === 'string') check('appealPoints', p.appealPoints);
  }

  return { violations, warnings };
}

// STEP15h: essay-review の lint。
// 出力 schema: { totalScore, verdict, breakdown[5], improvement, goodPoints[], weakPoints[] }
// チェック観点:
//   - NG 語 / Case F hallucination
//   - feedback / improvement / weakPoints / goodPoints に評定数値・欠席日数・科目別評定の直書きゼロ
//   - 採点 (totalScore / breakdown.score) は本文の質のみで判断されているはず（直接検証は困難なため
//     範囲・合計整合性のみ確認）
function lintEssayReview(c: QaCase, parsed: unknown, raw: string): LintResult {
  const { violations, warnings } = lintNgWords(raw);
  violations.push(...lintFCaseHallucination(c, raw));

  if (parsed && typeof parsed === 'object') {
    const p = parsed as {
      totalScore?: unknown;
      breakdown?: unknown;
      improvement?: unknown;
      goodPoints?: unknown;
      weakPoints?: unknown;
    };

    const gradeDigit = /[0-9]\.[0-9]/;
    const absenceLiteral = /[0-9]+\s*日/;
    const subjectGradeMention = /(英語|数学|理科|国語|社会)評定/;

    // improvement / goodPoints / weakPoints に評定値直書きがないか
    const allTexts: { field: string; text: string }[] = [];
    if (typeof p.improvement === 'string') allTexts.push({ field: 'improvement', text: p.improvement });
    if (Array.isArray(p.goodPoints)) {
      p.goodPoints.forEach((x, i) => {
        if (typeof x === 'string') allTexts.push({ field: `goodPoints[${i}]`, text: x });
      });
    }
    if (Array.isArray(p.weakPoints)) {
      p.weakPoints.forEach((x, i) => {
        if (typeof x === 'string') allTexts.push({ field: `weakPoints[${i}]`, text: x });
      });
    }
    for (const { field, text } of allTexts) {
      if (gradeDigit.test(text)) violations.push(`${field} に評定数値直書き: "${text.slice(0, 80)}…"`);
      if (absenceLiteral.test(text)) violations.push(`${field} に欠席日数直書き: "${text.slice(0, 80)}…"`);
      if (subjectGradeMention.test(text)) violations.push(`${field} に科目別評定の引用: "${text.slice(0, 80)}…"`);
    }

    // totalScore / breakdown 整合性
    const total = typeof p.totalScore === 'number' ? p.totalScore : null;
    if (total !== null && (total < 0 || total > 100)) {
      warnings.push(`totalScore が範囲外: ${total}`);
    }
    if (Array.isArray(p.breakdown)) {
      const sum = p.breakdown.reduce<number>(
        (acc, item) =>
          item && typeof item === 'object' && typeof (item as { score?: unknown }).score === 'number'
            ? acc + ((item as { score: number }).score)
            : acc,
        0,
      );
      if (total !== null && Math.abs(sum - total) > 1) {
        warnings.push(`breakdown 合計 ${sum} が totalScore ${total} と一致しない`);
      }
    }
  }

  return { violations, warnings };
}

// STEP15h: essay-chat の lint。
// 本番は plain text 応答（1〜2 文の問いかけ）。
// チェック観点:
//   - NG 語 / Case F hallucination
//   - 返答に評定数値（X.X）/ 欠席日数（N日）/ 科目別評定の直書きゼロ
//   - 返答が subjectGrades 主題（評定/科目/欠席を中心とした問いかけ）になっていないか
function lintEssayChat(c: QaCase, raw: string): LintResult {
  const { violations, warnings } = lintNgWords(raw);
  violations.push(...lintFCaseHallucination(c, raw));

  const gradeDigit = /[0-9]\.[0-9]/;
  const absenceLiteral = /[0-9]+\s*日/;
  const subjectGradeMention = /(英語|数学|理科|国語|社会)評定/;
  const subjectMain = /評定|科目別|欠席|出席日数/;

  if (gradeDigit.test(raw)) {
    violations.push(`reply に評定数値直書き: "${raw.slice(0, 80)}…"`);
  }
  if (absenceLiteral.test(raw)) {
    violations.push(`reply に欠席日数直書き: "${raw.slice(0, 80)}…"`);
  }
  if (subjectGradeMention.test(raw)) {
    violations.push(`reply に科目別評定の引用: "${raw.slice(0, 80)}…"`);
  }
  // reply 冒頭が subjectGrades 主題（warning レベル）
  if (subjectMain.test(raw.slice(0, 30))) {
    warnings.push(`reply 冒頭に subjectGrades 主題: "${raw.slice(0, 60)}…"`);
  }

  return { violations, warnings };
}

// STEP15g: analysis/additional の lint。
// 出力 schema: { "questions": [string, string] }（カテゴリプレフィックス付き）
// チェック観点:
//   - 質問文に評定数値（X.X）/ 欠席日数（N日）/ 科目別評定が直書きされていないか
//   - questions[0] が subjectGrades 主題（評定/科目/欠席/出席）になっていないか
//   - 無関係科目低評定が質問主題になっていないか
//   - 欠席を主題にする場合、不安煽り表現でないか
//   - Case F hallucination ゼロ
function lintAdditionalQuestions(c: QaCase, parsed: unknown, raw: string): LintResult {
  const { violations, warnings } = lintNgWords(raw);
  violations.push(...lintFCaseHallucination(c, raw));

  if (parsed && typeof parsed === 'object') {
    const p = parsed as { questions?: unknown };

    const gradeDigit = /[0-9]\.[0-9]/;
    const absenceLiteral = /[0-9]+\s*日/;
    const subjectGradeMention = /(英語|数学|理科|国語|社会)評定/;
    const subjectMain = /評定|科目別|欠席|出席日数/;
    const anxietyPattern = /(?:不利|不利益|受からない|落ちる|致命的|問題視|出願不可)/;

    const fac = c.basicInfo.preferences[0]?.faculty ?? '';
    const dept = c.basicInfo.preferences[0]?.department ?? '';
    const cat = classifyFaculty(fac, dept);
    const related = relatedSubjectsFor(cat);
    const unrelated = ALL_SUBJECTS.filter((s) => !related.includes(s));

    if (Array.isArray(p.questions)) {
      p.questions.forEach((q, i) => {
        const text = String(q);

        // 数値直書き / 科目別評定の引用
        if (gradeDigit.test(text)) {
          violations.push(`questions[${i}] に評定数値直書き: "${text.slice(0, 80)}…"`);
        }
        if (absenceLiteral.test(text)) {
          violations.push(`questions[${i}] に欠席日数直書き: "${text.slice(0, 80)}…"`);
        }
        if (subjectGradeMention.test(text)) {
          violations.push(`questions[${i}] に科目別評定の引用: "${text.slice(0, 80)}…"`);
        }

        // questions[0] が subjectGrades 主題（カテゴリラベルを除いた本文で判定）
        if (i === 0) {
          const body = text.replace(/^【[^】]+】/, '').trim();
          if (subjectMain.test(body.slice(0, 30))) {
            violations.push(`questions[0] が subjectGrades 主題: "${text.slice(0, 80)}…"`);
          }
        }

        // 無関係科目低評定が質問主題に
        for (const s of unrelated) {
          if (new RegExp(`${s}(?:評定|の評定|が低い|が苦手)`).test(text)) {
            violations.push(`questions[${i}] に無関係科目「${s}」: "${text.slice(0, 80)}…"`);
          }
        }

        // 欠席質問が不安煽り
        if (/欠席/.test(text) && anxietyPattern.test(text)) {
          violations.push(`questions[${i}] に欠席不安煽り: "${text.slice(0, 80)}…"`);
        }
      });
    }
  }

  return { violations, warnings };
}

// STEP15f: analysis (wallHitting) の lint。
// **最重要**: analysis 出力は StudentProfile に固定化され下流に伝染するため、
// 評定数値・欠席日数・科目別評定の引用を strengths / weaknesses / futureConnections / summary に
// 一切残さないことを違反として厳格にチェックする。
function lintAnalysis(c: QaCase, parsed: unknown, raw: string): LintResult {
  const { violations, warnings } = lintNgWords(raw);
  violations.push(...lintFCaseHallucination(c, raw));

  if (parsed && typeof parsed === 'object') {
    const p = parsed as {
      summary?: unknown;
      strengths?: unknown;
      weaknesses?: unknown;
      futureConnections?: unknown;
      questions?: unknown;
    };

    const gradeDigit = /[0-9]\.[0-9]/;
    const absenceLiteral = /[0-9]+\s*日/;
    const subjectGradeMention = /(英語|数学|理科|国語|社会)評定/;
    const subjectMain = /評定|科目別|欠席|出席日数/;

    // summary: 数値・科目別評定の引用ゼロが要件
    const summary = typeof p.summary === 'string' ? p.summary : '';
    if (gradeDigit.test(summary))
      violations.push(`summary に評定数値直書き: "${summary.slice(0, 80)}…"`);
    if (absenceLiteral.test(summary))
      violations.push(`summary に欠席日数直書き: "${summary.slice(0, 80)}…"`);
    if (subjectGradeMention.test(summary))
      violations.push(`summary に科目別評定の引用: "${summary.slice(0, 80)}…"`);

    // strengths: 数値・科目別評定の引用ゼロが要件（StudentProfile への伝染を防ぐ）
    if (Array.isArray(p.strengths)) {
      p.strengths.forEach((s, i) => {
        const text = String(s);
        if (gradeDigit.test(text))
          violations.push(`strengths[${i}] に評定数値直書き: "${text.slice(0, 80)}…"`);
        if (absenceLiteral.test(text))
          violations.push(`strengths[${i}] に欠席日数直書き: "${text.slice(0, 80)}…"`);
        if (subjectGradeMention.test(text))
          violations.push(`strengths[${i}] に科目別評定の引用: "${text.slice(0, 80)}…"`);
      });
    }

    // weaknesses: 数値・科目別評定 + 無関係科目チェック
    const fac = c.basicInfo.preferences[0]?.faculty ?? '';
    const dept = c.basicInfo.preferences[0]?.department ?? '';
    const cat = classifyFaculty(fac, dept);
    const related = relatedSubjectsFor(cat);
    const unrelated = ALL_SUBJECTS.filter((s) => !related.includes(s));

    if (Array.isArray(p.weaknesses)) {
      p.weaknesses.forEach((w, i) => {
        const text = String(w);
        if (gradeDigit.test(text))
          violations.push(`weaknesses[${i}] に評定数値直書き: "${text.slice(0, 80)}…"`);
        if (absenceLiteral.test(text))
          violations.push(`weaknesses[${i}] に欠席日数直書き: "${text.slice(0, 80)}…"`);
        if (subjectGradeMention.test(text))
          violations.push(`weaknesses[${i}] に科目別評定の引用: "${text.slice(0, 80)}…"`);
        for (const s of unrelated) {
          if (new RegExp(`${s}(?:評定|の評定|が低い|が苦手)`).test(text)) {
            violations.push(`weaknesses[${i}] に無関係科目「${s}」: "${text.slice(0, 80)}…"`);
          }
        }
      });
    }

    // futureConnections: 数値直書きは violation、冒頭 subjectGrades 主題は warning
    if (Array.isArray(p.futureConnections)) {
      p.futureConnections.forEach((f, i) => {
        const text = String(f);
        if (gradeDigit.test(text))
          violations.push(`futureConnections[${i}] に評定数値: "${text.slice(0, 80)}…"`);
        if (absenceLiteral.test(text))
          violations.push(`futureConnections[${i}] に欠席日数: "${text.slice(0, 80)}…"`);
        if (subjectGradeMention.test(text))
          violations.push(`futureConnections[${i}] に科目別評定: "${text.slice(0, 80)}…"`);
        if (subjectMain.test(text.slice(0, 30))) {
          warnings.push(
            `futureConnections[${i}] 冒頭に subjectGrades 主題: "${text.slice(0, 60)}…"`,
          );
        }
      });
    }

    // questions（5 問）: 質問は次回プロンプト入力になるが、数値直書きは warning として観測する
    if (Array.isArray(p.questions)) {
      p.questions.forEach((q, i) => {
        const text = String(q);
        if (gradeDigit.test(text))
          warnings.push(`questions[${i}] に評定数値: "${text.slice(0, 60)}…"`);
        if (absenceLiteral.test(text))
          warnings.push(`questions[${i}] に欠席日数: "${text.slice(0, 60)}…"`);
      });
    }
  }

  return { violations, warnings };
}

// STEP15e: interview-feedback の lint。
// チェック観点:
//   - NG ハード / soft 語
//   - Case F hallucination
//   - levelEvaluation の各値が weak/normal/strong に正規化されているか
//   - betterAnswer に評定数値（X.X 形式）や欠席日数（N日）が直接出ていないか
//   - improvements[0] / nextPractice[0] が subjectGrades 主題（評定 / 科目 / 欠席）になっていないか
//   - 欠席関連の助言が不安煽り表現になっていないか
function lintInterviewFeedback(c: QaCase, parsed: unknown, raw: string): LintResult {
  const { violations, warnings } = lintNgWords(raw);
  violations.push(...lintFCaseHallucination(c, raw));

  if (parsed && typeof parsed === 'object') {
    const p = parsed as {
      improvements?: unknown;
      nextPractice?: unknown;
      perQuestionFeedback?: unknown;
      goodPoints?: unknown;
      overallEvaluation?: unknown;
    };

    const subjectMain = /評定|科目別|欠席|出席日数/;

    // improvements[0] / nextPractice[0] が subjectGrades 主題になっていないか
    if (Array.isArray(p.improvements) && p.improvements.length > 0) {
      const v = String(p.improvements[0]);
      if (subjectMain.test(v)) {
        violations.push(`improvements[0] が subjectGrades 主題: "${v.slice(0, 80)}…"`);
      }
    }
    if (Array.isArray(p.nextPractice) && p.nextPractice.length > 0) {
      const v = String(p.nextPractice[0]);
      if (subjectMain.test(v)) {
        violations.push(`nextPractice[0] が subjectGrades 主題: "${v.slice(0, 80)}…"`);
      }
    }

    // perQuestionFeedback の betterAnswer に評定数値・欠席日数が直書きされていないか
    const gradeDigit = /[0-9]\.[0-9]/;
    const absenceLiteral = /[0-9]+\s*日/;
    if (Array.isArray(p.perQuestionFeedback)) {
      p.perQuestionFeedback.forEach((q: unknown, i: number) => {
        if (!q || typeof q !== 'object') return;
        const qo = q as { betterAnswer?: unknown; improvement?: unknown; levelEvaluation?: unknown };
        const better = typeof qo.betterAnswer === 'string' ? qo.betterAnswer : '';
        if (gradeDigit.test(better)) {
          violations.push(
            `perQuestionFeedback[${i}].betterAnswer に評定数値が直書き: "${better.slice(0, 80)}…"`,
          );
        }
        if (absenceLiteral.test(better)) {
          violations.push(
            `perQuestionFeedback[${i}].betterAnswer に欠席日数が直書き: "${better.slice(0, 80)}…"`,
          );
        }
        // levelEvaluation の正規化チェック
        if (qo.levelEvaluation && typeof qo.levelEvaluation === 'object') {
          const lv = qo.levelEvaluation as Record<string, unknown>;
          for (const axis of ['logical', 'concrete', 'consistency', 'originality', 'interviewReadiness']) {
            const v = lv[axis];
            if (v !== 'weak' && v !== 'normal' && v !== 'strong') {
              warnings.push(`perQuestionFeedback[${i}].levelEvaluation.${axis} が enum 外: "${String(v)}"`);
            }
          }
        }
        // improvement に subjectGrades 主題が冒頭に来ていないか（warning レベル）
        const imp = typeof qo.improvement === 'string' ? qo.improvement : '';
        if (subjectMain.test(imp.slice(0, 30))) {
          warnings.push(
            `perQuestionFeedback[${i}].improvement 冒頭に subjectGrades 主題: "${imp.slice(0, 60)}…"`,
          );
        }
      });
    }

    // 欠席関連が不安煽りになっていないか（全 narrative フィールドを横断検査）
    const anxietyPattern = /(?:不利|不利益|受からない|落ちる|致命的|問題視)/;
    const allTexts: string[] = [];
    if (typeof p.overallEvaluation === 'string') allTexts.push(p.overallEvaluation);
    if (Array.isArray(p.improvements)) p.improvements.forEach((x) => typeof x === 'string' && allTexts.push(x));
    if (Array.isArray(p.nextPractice)) p.nextPractice.forEach((x) => typeof x === 'string' && allTexts.push(x));
    if (Array.isArray(p.goodPoints)) p.goodPoints.forEach((x) => typeof x === 'string' && allTexts.push(x));
    if (Array.isArray(p.perQuestionFeedback)) {
      p.perQuestionFeedback.forEach((q) => {
        if (!q || typeof q !== 'object') return;
        const qo = q as { improvement?: unknown; betterAnswer?: unknown; evaluation?: unknown };
        if (typeof qo.improvement === 'string') allTexts.push(qo.improvement);
        if (typeof qo.betterAnswer === 'string') allTexts.push(qo.betterAnswer);
        if (typeof qo.evaluation === 'string') allTexts.push(qo.evaluation);
      });
    }
    for (const t of allTexts) {
      if (/欠席/.test(t) && anxietyPattern.test(t)) {
        violations.push(`欠席に関する不安煽り表現: "${t.slice(0, 80)}…"`);
        break;
      }
    }
  }

  return { violations, warnings };
}

// STEP15d: matching reason の lint。
// チェック観点:
//   - NG ハード / soft 語
//   - Case F hallucination
//   - reason 冒頭が評定数値（4.8 / 3.3 等）から始まっていないか
//   - reason 冒頭 30 字に無関係科目の評定言及がないか
//   - 評定値と適性断定（「向いている」「有利」「合格可能性」）の組み合わせがないか
//   - score / eligibility 不変は production code を触っていないため自明（lint では検査しない）
function lintMatching(c: QaCase, parsed: unknown, raw: string): LintResult {
  const { violations, warnings } = lintNgWords(raw);
  violations.push(...lintFCaseHallucination(c, raw));

  if (parsed && typeof parsed === 'object') {
    const p = parsed as { reason?: unknown; universityId?: unknown };
    const reason = typeof p.reason === 'string' ? p.reason : '';

    // 冒頭 20 字に評定数値（X.X 形式）が出ていないか
    const head20 = reason.slice(0, 20);
    if (/[0-9]\.[0-9]/.test(head20)) {
      violations.push(`reason 冒頭 20 字に評定数値が直書き: "${head20}"`);
    }
    // 冒頭に「英語◯」「数学◯」のような科目+評定パターン
    if (/^(?:[\s]*)(英語|数学|理科|国語|社会).{0,5}[0-9]/.test(head20)) {
      violations.push(`reason 冒頭が「科目+評定」型: "${head20}"`);
    }

    // 無関係科目の評定言及が reason 冒頭 30 字に来ていないか
    const fac = c.basicInfo.preferences[0]?.faculty ?? '';
    const dept = c.basicInfo.preferences[0]?.department ?? '';
    const cat = classifyFaculty(fac, dept);
    const related = relatedSubjectsFor(cat);
    const unrelated = ALL_SUBJECTS.filter((s) => !related.includes(s));
    const head30 = reason.slice(0, 30);
    for (const subj of unrelated) {
      if (new RegExp(`${subj}(?:評定|の評定|が)`).test(head30)) {
        violations.push(
          `reason 冒頭 30 字に無関係科目「${subj}」: "${head30}…"`,
        );
      }
    }

    // 評定値と適性断定の組み合わせ（warning レベル）
    if (/[0-9]\.[0-9].*(?:向いている|有利|合格可能性が高い|合格しやすい)/.test(reason)) {
      warnings.push(`reason に評定値と適性断定の組合せ: "${reason.slice(0, 80)}…"`);
    }
    if (/(?:向いている|有利|合格可能性が高い|合格しやすい).*[0-9]\.[0-9]/.test(reason)) {
      warnings.push(`reason に適性断定と評定値の組合せ: "${reason.slice(0, 80)}…"`);
    }
  }

  return { violations, warnings };
}

function lintInterviewQuestions(c: QaCase, parsed: unknown, raw: string): LintResult {
  const { violations, warnings } = lintNgWords(raw);
  violations.push(...lintFCaseHallucination(c, raw));

  if (parsed && typeof parsed === 'object') {
    const p = parsed as { general?: unknown; personalized?: unknown };

    type QuestionShape = { question?: unknown; category?: unknown; intent?: unknown };

    const general: QuestionShape[] = Array.isArray(p.general) ? (p.general as QuestionShape[]) : [];
    const personalized: QuestionShape[] = Array.isArray(p.personalized)
      ? (p.personalized as QuestionShape[])
      : [];

    // 数値直書き（評定値・欠席日数）が質問文に出ていないか
    const gradePattern = /[0-9]\.[0-9]/;
    const absencePattern = /[0-9]+\s*日/;

    for (let i = 0; i < general.length; i++) {
      const q = String(general[i]?.question ?? '');
      if (gradePattern.test(q)) {
        violations.push(`general[${i}] に評定数値が直書き: "${q.slice(0, 60)}…"`);
      }
      if (absencePattern.test(q)) {
        violations.push(`general[${i}] に欠席日数値が直書き: "${q.slice(0, 60)}…"`);
      }
      // general に subjectGrades 主題が混入していないか
      if (/評定|科目別|欠席|出席日数/.test(q)) {
        violations.push(`general[${i}] に subjectGrades 由来主題: "${q.slice(0, 60)}…"`);
      }
    }

    for (let i = 0; i < personalized.length; i++) {
      const q = String(personalized[i]?.question ?? '');
      if (gradePattern.test(q)) {
        violations.push(`personalized[${i}] に評定数値が直書き: "${q.slice(0, 60)}…"`);
      }
      if (absencePattern.test(q)) {
        violations.push(`personalized[${i}] に欠席日数値が直書き: "${q.slice(0, 60)}…"`);
      }
    }

    // personalized[0] が subjectGrades 主題になっていないか
    if (personalized.length > 0) {
      const p0 = String(personalized[0]?.question ?? '');
      const p0Subj = /評定|科目別|欠席|出席日数|出席が/.test(p0);
      if (p0Subj) {
        violations.push(
          `personalized[0] が subjectGrades 主題: "${p0.slice(0, 80)}…"（2 領域橋渡し優先のはず）`,
        );
      }
    }

    // 欠席質問が不安煽りになっていないか
    for (let i = 0; i < personalized.length; i++) {
      const q = String(personalized[i]?.question ?? '');
      if (/欠席|出席日数/.test(q)) {
        if (/不利|受からない|落ちる|問題視|難しいの|致命的/.test(q)) {
          violations.push(`personalized[${i}] の欠席質問が不安煽り: "${q.slice(0, 80)}…"`);
        }
      }
    }
  }

  return { violations, warnings };
}

// ─────────────────────────────────────────────────────────────
// Verdict
// ─────────────────────────────────────────────────────────────

type Verdict = 'PASS' | 'WATCH' | 'FAIL';

function verdict(lint: LintResult, apiError: string | null, parseError: string | null): Verdict {
  if (apiError || parseError) return 'FAIL';
  if (lint.violations.length > 0) return 'FAIL';
  if (lint.warnings.length > 0) return 'WATCH';
  return 'PASS';
}

// ─────────────────────────────────────────────────────────────
// Save / report
// ─────────────────────────────────────────────────────────────

async function saveRunResult(result: RunResult): Promise<void> {
  const path = join(OUTPUT_DIR, result.caseId, `${result.route}.json`);
  await mkdir(join(OUTPUT_DIR, result.caseId), { recursive: true });
  await writeFile(path, JSON.stringify(result, null, 2), 'utf8');
}

function buildReportMd(results: RunResult[]): string {
  const lines: string[] = [];
  lines.push('# STEP15 QA Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Model: ${MODEL}`);
  lines.push(`Dry run: ${FLAG_DRY ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Case | description | statement-review | interview-questions | matching | interview-feedback | analysis | analysis-additional | essay-review | essay-chat | summarize |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of ALL_CASES) {
    const sr = results.find((r) => r.caseId === c.id && r.route === 'statement-review');
    const iq = results.find((r) => r.caseId === c.id && r.route === 'interview-questions');
    const mt = results.find((r) => r.caseId === c.id && r.route === 'matching');
    const fb = results.find((r) => r.caseId === c.id && r.route === 'interview-feedback');
    const an = results.find((r) => r.caseId === c.id && r.route === 'analysis');
    const ad = results.find((r) => r.caseId === c.id && r.route === 'analysis-additional');
    const er = results.find((r) => r.caseId === c.id && r.route === 'essay-review');
    const ec = results.find((r) => r.caseId === c.id && r.route === 'essay-chat');
    const sm = results.find((r) => r.caseId === c.id && r.route === 'summarize');
    const srV = sr ? verdict(sr.lint, sr.apiError, sr.parseError) : '—';
    const iqV = iq ? verdict(iq.lint, iq.apiError, iq.parseError) : '—';
    const mtV = mt ? verdict(mt.lint, mt.apiError, mt.parseError) : '—';
    const fbV = fb ? verdict(fb.lint, fb.apiError, fb.parseError) : '—';
    const anV = an ? verdict(an.lint, an.apiError, an.parseError) : '—';
    const adV = ad ? verdict(ad.lint, ad.apiError, ad.parseError) : '—';
    const erV = er ? verdict(er.lint, er.apiError, er.parseError) : '—';
    const ecV = ec ? verdict(ec.lint, ec.apiError, ec.parseError) : '—';
    const smV = sm ? verdict(sm.lint, sm.apiError, sm.parseError) : '—';
    lines.push(`| ${c.id} | ${c.description} | ${srV} | ${iqV} | ${mtV} | ${fbV} | ${anV} | ${adV} | ${erV} | ${ecV} | ${smV} |`);
  }
  lines.push('');

  // Per-case details
  for (const c of ALL_CASES) {
    lines.push(`## ${c.id}: ${c.description}`);
    lines.push('');
    const routes: Route[] = ['statement-review', 'interview-questions', 'matching', 'interview-feedback', 'analysis', 'analysis-additional', 'essay-review', 'essay-chat', 'summarize'];
    for (const route of routes) {
      const r = results.find((x) => x.caseId === c.id && x.route === route);
      if (!r) {
        lines.push(`### ${route}: (skipped)`);
        lines.push('');
        continue;
      }
      const v = verdict(r.lint, r.apiError, r.parseError);
      lines.push(`### ${route}: ${v}${r.dryRun ? ' (dry-run)' : ''}`);
      lines.push('');
      if (r.apiError) {
        lines.push(`- API error: ${r.apiError}`);
      }
      if (r.parseError) {
        lines.push(`- Parse error: ${r.parseError}`);
      }
      if (r.lint.violations.length > 0) {
        lines.push(`- **violations** (${r.lint.violations.length}):`);
        for (const v0 of r.lint.violations) lines.push(`  - ${v0}`);
      }
      if (r.lint.warnings.length > 0) {
        lines.push(`- warnings (${r.lint.warnings.length}):`);
        for (const w of r.lint.warnings) lines.push(`  - ${w}`);
      }
      if (r.usage) {
        lines.push(
          `- usage: input=${r.usage.input_tokens} / output=${r.usage.output_tokens} tokens / ${r.durationMs}ms`,
        );
      }
      lines.push('');
    }
  }

  // Route 傾向
  lines.push('## Route 別傾向');
  lines.push('');
  const routes: Route[] = ['statement-review', 'interview-questions', 'matching', 'interview-feedback', 'analysis', 'analysis-additional', 'essay-review', 'essay-chat', 'summarize'];
  for (const route of routes) {
    const routeResults = results.filter((r) => r.route === route);
    const violationTotal = routeResults.reduce((a, r) => a + r.lint.violations.length, 0);
    const warningTotal = routeResults.reduce((a, r) => a + r.lint.warnings.length, 0);
    lines.push(
      `- ${route}: violations=${violationTotal} / warnings=${warningTotal} / cases=${routeResults.length}`,
    );
  }
  lines.push('');

  // 「無理に」問題の集計
  const muriOffenders = results.filter((r) =>
    r.lint.warnings.some((w) => w.includes('無理')),
  );
  lines.push('## 「無理に」副詞 vs 禁止語衝突の観察');
  lines.push('');
  if (muriOffenders.length === 0) {
    lines.push('- 出力本文に「無理」を含む結果はなかった。qualifier の副詞用法は AI 出力に伝染していない可能性が高い。');
  } else {
    lines.push(`- ${muriOffenders.length}/${results.length} 件で「無理」が出力に含まれた。文脈の人間判読が必要：`);
    for (const r of muriOffenders) {
      lines.push(`  - ${r.caseId}/${r.route}: 該当 raw 出力を tmp/step15-qa/${r.caseId}/${r.route}.json で確認`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const anthropic = !FLAG_DRY && apiKey ? new Anthropic({ apiKey }) : null;

  if (!FLAG_DRY && !apiKey) {
    console.error('ERROR: ANTHROPIC_API_KEY が見つかりません。');
    console.error('  - 環境変数で渡す: ANTHROPIC_API_KEY=sk-... npx tsx scripts/step15-qa.ts');
    console.error('  - .env.local に書く: 自動で読み込まれます');
    console.error('  - API を呼ばずに prompt 構築だけ試す: --dry を付ける');
    process.exit(2);
  }

  const cases = SELECTED_CASE
    ? ALL_CASES.filter((c) => c.id === `case-${SELECTED_CASE}` || c.id === SELECTED_CASE)
    : ALL_CASES;

  if (cases.length === 0) {
    console.error(`ERROR: --case ${SELECTED_CASE} に一致する Case がありません`);
    process.exit(2);
  }

  const routesToRun: Route[] =
    SELECTED_ROUTE === 'statement-review'
      ? ['statement-review']
      : SELECTED_ROUTE === 'interview-questions'
        ? ['interview-questions']
        : SELECTED_ROUTE === 'matching'
          ? ['matching']
          : SELECTED_ROUTE === 'interview-feedback'
            ? ['interview-feedback']
            : SELECTED_ROUTE === 'analysis'
              ? ['analysis']
              : SELECTED_ROUTE === 'analysis-additional'
                ? ['analysis-additional']
                : SELECTED_ROUTE === 'essay-review'
                  ? ['essay-review']
                  : SELECTED_ROUTE === 'essay-chat'
                    ? ['essay-chat']
                    : SELECTED_ROUTE === 'summarize'
                      ? ['summarize']
                      : [
                          'statement-review',
                          'interview-questions',
                          'matching',
                          'interview-feedback',
                          'analysis',
                          'analysis-additional',
                          'essay-review',
                          'essay-chat',
                          'summarize',
                        ];

  await mkdir(OUTPUT_DIR, { recursive: true });

  const results: RunResult[] = [];
  for (const c of cases) {
    console.log(`\n[${c.id}] ${c.description}`);
    for (const route of routesToRun) {
      process.stdout.write(`  - ${route} ... `);
      const r =
        route === 'statement-review'
          ? await runStatementReview(c, anthropic)
          : route === 'interview-questions'
            ? await runInterviewQuestions(c, anthropic)
            : route === 'matching'
              ? await runMatching(c, anthropic)
              : route === 'interview-feedback'
                ? await runInterviewFeedback(c, anthropic)
                : route === 'analysis'
                  ? await runAnalysis(c, anthropic)
                  : route === 'analysis-additional'
                    ? await runAdditionalQuestions(c, anthropic)
                    : route === 'essay-review'
                      ? await runEssayReview(c, anthropic)
                      : route === 'essay-chat'
                        ? await runEssayChat(c, anthropic)
                        : await runSummarize(c, anthropic);
      const v = verdict(r.lint, r.apiError, r.parseError);
      console.log(
        `${v} (violations=${r.lint.violations.length}, warnings=${r.lint.warnings.length}, ${r.durationMs}ms${r.usage ? `, in=${r.usage.input_tokens} out=${r.usage.output_tokens}` : ''})`,
      );
      await saveRunResult(r);
      results.push(r);
    }
  }

  const md = buildReportMd(results);
  const reportPath = join(OUTPUT_DIR, 'report.md');
  await writeFile(reportPath, md, 'utf8');
  console.log(`\n✓ report: ${reportPath}`);
  console.log(`✓ per-case outputs: ${OUTPUT_DIR}/case-*/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
