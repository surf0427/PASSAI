// Exam Spine Phase 3 — Tutor prompt composition QA fixtures。
//
// 役割:
//   canary OFF / ON の最終 prompt を比較するための合成入力。
//   scripts/exam-spine-tutor-composition-qa.ts が唯一の消費者。
//
// 厳守:
//   - **完全 synthetic**。実ユーザーデータ・実 PII を一切含まない。
//   - deterministic。Date / Math.random / 環境依存値を使わない。
//   - production runtime から import しない（scripts/ 専用）。
//
// sentinel 設計:
//   CLIENT_ONLY_* … body（localStorage 由来）にだけ置く。canary ON の prompt に出たら失格。
//   SPINE_ONLY_*  … Spine context（Supabase 由来）にだけ置く。ON でも必ず残る。
//   WORK_ONLY_*   … intent 固有の作業材料。Spine に durable source が無く、
//                   ON でも残さなければならない（過剰除去の検出用）。
//   いずれも 40 字未満。builder の truncate で消えないようにするため。

import type { TutorStudentContext } from '@/lib/contextBuilders/tutorContext';
import type { TutorIntent } from '@/lib/tutor/types';

export const CLIENT_ONLY_UNIV = 'CLIENTONLYUNIV';
export const CLIENT_ONLY_STRENGTH = 'CLIENTONLYSTRENGTH';
export const SPINE_ONLY_UNIV = 'SPINEONLYUNIV';
export const SPINE_ONLY_STRENGTH = 'SPINEONLYSTRENGTH';
export const WORK_ONLY_DRAFT = 'WORKONLYDRAFT';

export type CompositionFixture = {
  id: string;
  description: string;
  intent: TutorIntent;
  userMessage: string;
  body: Record<string, unknown>;
  spineContext: TutorStudentContext;
};

const EMPTY_SUMMARY: TutorStudentContext['sourceSummary'] = {
  hasSelfAnalysis: false,
  hasBasicInfo: false,
  hasDiagnosis: false,
  hasActivity: false,
  hasInterviewAi: false,
  hasPresentation: false,
};

export const COMPOSITION_FIXTURES: readonly CompositionFixture[] = [
  {
    id: 'A-full-user',
    description: 'client / Spine 双方に十分なデータがある利用者',
    intent: 'general',
    userMessage: '志望理由書の書き出しで悩んでいます。',
    body: {
      basicInfo: {
        grade: '高校3年',
        track: '文系',
        examTypes: ['総合型選抜'],
        preferences: [{ university: CLIENT_ONLY_UNIV, faculty: 'サンプル学部' }],
      },
      studentProfile: {
        summary: 'サンプル自己分析サマリー（client 由来）',
        strengths: [CLIENT_ONLY_STRENGTH, 'サンプル強み2'],
        weaknesses: ['サンプル弱み'],
        futureConnections: ['サンプル将来接続'],
        valueKeywords: ['サンプル価値観'],
        signatureEpisodes: [],
      },
      activityData: { clubActivities: [{ title: 'サンプル部活' }] },
    },
    spineContext: {
      basicInfo: {
        grade: '高校3年',
        examType: '総合型選抜',
        targetSchools: [SPINE_ONLY_UNIV],
        targetFields: ['サンプル学部'],
      },
      selfAnalysis: {
        summary: 'サンプル自己分析サマリー（Spine 由来）',
        strengths: [SPINE_ONLY_STRENGTH, 'サンプル強みB'],
        weaknesses: ['サンプル弱みB'],
      },
      activity: { totalCount: 2, categoryCounts: { 部活動: 2 } },
      sourceSummary: {
        ...EMPTY_SUMMARY,
        hasBasicInfo: true,
        hasSelfAnalysis: true,
        hasActivity: true,
      },
    },
  },

  {
    id: 'B-new-user',
    description: '新規ユーザー。body も Spine も空（Tutor は動作継続すること）',
    intent: 'general',
    userMessage: 'まず何から始めればいいですか。',
    body: {},
    spineContext: { sourceSummary: { ...EMPTY_SUMMARY } },
  },

  {
    id: 'C-partial-user',
    description:
      'client には情報があるが Spine は basic_info のみ（ON で薄くなっても動作継続すること）',
    intent: 'general',
    userMessage: '活動をどう書けばいいですか。',
    body: {
      basicInfo: {
        grade: '高校2年',
        preferences: [{ university: CLIENT_ONLY_UNIV, faculty: 'サンプル学部' }],
      },
      studentProfile: {
        summary: 'client 側にだけある自己分析',
        strengths: [CLIENT_ONLY_STRENGTH],
        weaknesses: [],
        futureConnections: [],
        valueKeywords: [],
        signatureEpisodes: [],
      },
      activityData: { volunteerActivities: [{ title: 'サンプル活動' }] },
    },
    spineContext: {
      basicInfo: { grade: '高校2年', targetSchools: [SPINE_ONLY_UNIV] },
      sourceSummary: { ...EMPTY_SUMMARY, hasBasicInfo: true },
    },
  },

  {
    id: 'D-conflicting-client-vs-spine',
    description:
      '★最重要: client と Spine が食い違う。ON では Spine 側だけが残ること',
    intent: 'general',
    userMessage: '志望校について相談したいです。',
    body: {
      basicInfo: {
        grade: '高校3年',
        // client は A 大学だと言っている
        preferences: [{ university: CLIENT_ONLY_UNIV, faculty: 'クライアント学部' }],
      },
      studentProfile: {
        summary: 'client 側の自己分析サマリー',
        strengths: [CLIENT_ONLY_STRENGTH],
        weaknesses: ['client 側の弱み'],
        futureConnections: [],
        valueKeywords: [],
        signatureEpisodes: [],
      },
    },
    spineContext: {
      // Spine（DB）は B 大学だと言っている
      basicInfo: {
        grade: '高校3年',
        targetSchools: [SPINE_ONLY_UNIV],
        targetFields: ['スパイン学部'],
      },
      selfAnalysis: { strengths: [SPINE_ONLY_STRENGTH] },
      sourceSummary: { ...EMPTY_SUMMARY, hasBasicInfo: true, hasSelfAnalysis: true },
    },
  },

  {
    id: 'E-working-material-preserved',
    description:
      'intent=statement。作業材料（statementDraft）は Spine に source が無いため ON でも残ること',
    intent: 'statement',
    userMessage: 'この志望理由書を見てください。',
    body: {
      basicInfo: {
        grade: '高校3年',
        preferences: [{ university: CLIENT_ONLY_UNIV, faculty: 'サンプル学部' }],
      },
      studentProfile: {
        summary: 'client 側の自己分析',
        strengths: [CLIENT_ONLY_STRENGTH],
        weaknesses: [],
        futureConnections: [],
        valueKeywords: [],
        signatureEpisodes: [],
      },
      // 作業材料。Spine に durable table が無い（E-P3 / SD-1）。
      // field 名は buildTutorStatementContext が読む statementText に合わせること。
      statementDraft: {
        statementText: `${WORK_ONLY_DRAFT} 私が貴学を志望する理由は…`,
      },
    },
    spineContext: {
      basicInfo: { grade: '高校3年', targetSchools: [SPINE_ONLY_UNIV] },
      sourceSummary: { ...EMPTY_SUMMARY, hasBasicInfo: true },
    },
  },
];
