// 受験チューターAI 用「Supabase 保存済み生徒情報」context builder（server-only）。
//
// STEP-TUTOR-SUPABASE-CONTEXT-OUTPUT-01 / STEP-TUTOR-CONTEXT-PHASE2-CONNECT-01:
//   /api/tutor の Claude 呼び出し前に、Supabase 側に保存済みの生徒情報を server-side で
//   読み取り、受験相談に使える短いテキスト section へ要約して prompt に差し込む層。
//
// 既存の body 由来 context（lib/contextBuilders/tutorStudentContext.ts +
// lib/tutor/tutorPrompt.ts:buildTutorStudentContextSection）とは別レイヤー:
//   - 既存: client が localStorage から読んで body で送るデータを要約（canonical 経路）。
//   - 本層: server が Supabase の auth-scoped 永続層から読む（端末跨ぎ / body 欠落時の補完）。
//
// 【データソース】
//   いずれも auth-scoped durable table（owner SELECT RLS / user_id scope）。
//     - self_analysis_logs（§32-§34, 履歴型）… analysis / summary（Phase1 で接続済）
//     - basic_info_logs   （§41-§43, snapshot 型）… 学年 / 受験方式 / 志望校・志望分野
//     - diagnosis_logs    （§44-§46, snapshot 型）… 受験タイプ → 会話補助 hint へ言い換え
//     - activity_logs     （§47-§49, snapshot 型）… カテゴリ別件数のみ（narrative は読まない）
//   anonymous mirror（*_mirrors）は user_id も SELECT policy も無く read 不可のため使わない。
//
// 設計要件:
//   - server-only（getServerSupabaseClient は next/headers を import するため client 不可）。
//   - userId scope で取得する（RLS は auth.uid()=user_id で閉じるが、明示 .eq も付ける）。
//   - 取得失敗・未ログイン・データ不足・**SQL 未 apply で table 不存在**でも throw しない。
//     console.warn のみ。Promise.allSettled で部分成功を許容（一部 source 失敗でも他は使う）。
//   - row JSON を丸ごと返さない。受験相談に必要な field だけを抽出・truncate する。
//   - basic_info の PII（氏名 / 評定 / 欠席等）や activity の narrative 本文は読まない。
//
// 関連:
//   - lib/supabase/serverClient.ts (getServerSupabaseClient)
//   - app/api/tutor/route.ts (consumer / 接続位置は維持)

import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerSupabaseClient } from '@/lib/supabase/serverClient';
import { resolveDiagnosisTypeHint } from '@/lib/examDiagnosis/tutorHints';
import { summarizeActivityCategories } from '@/lib/activityCategories';
// AI 面接モードのラベル（純データモジュール。server-only 依存なし）。
import {
  INTERVIEW_TYPE_LABELS,
  isInterviewType,
} from '@/lib/interviewAi/interviewTypes';

// ── 型 ───────────────────────────────────────────────────────────

export type TutorStudentContext = {
  // self_analysis_logs 由来（最新 1 件）。
  selfAnalysis?: {
    summary?: string;
    strengths?: string[];
    weaknesses?: string[];
    futureConnections?: string[];
    appealPoints?: string;
  };
  // basic_info_logs 由来（snapshot）。PII（氏名 / 評定 / 欠席）は含めない。
  basicInfo?: {
    grade?: string;
    examType?: string;
    targetSchools?: string[];
    targetFields?: string[];
  };
  // diagnosis_logs 由来（snapshot）。タイプ名は出さず会話補助 hint に言い換える。
  diagnosis?: {
    typeHint?: string;
    summary?: string;
  };
  // activity_logs 由来（snapshot）。件数集計のみ。narrative は含めない。
  activity?: {
    totalCount: number;
    categoryCounts: Record<string, number>;
  };
  // interview_ai_results 由来（最新の completed AI 面接 1 件）。結果画面と同じ保存済み feedback を読む。
  //   - turn 履歴 / 音声 / STT 全文は含めない（結果サマリのみ）。
  //   - 直近 3 件へ拡張する場合は loadInterviewAiContext の limit を上げて配列化すればよい
  //     （type を配列にし、section builder で複数 block を出す）。MVP は最新 1 件のみ。
  interviewAi?: {
    modeLabel: string; // 面接モード（INTERVIEW_TYPE_LABELS）
    date?: string; // 実施日時（JST の年月日）
    overall?: string; // 総合評価
    goodPoints?: string[]; // 良かった点
    improvements?: string[]; // 改善点
    nextPractice?: string[]; // 次に練習すべきこと
  };
  // presentation_results 由来（最新の evaluated プレゼン 1 件）。結果画面と同じ保存済み feedback を読む。
  //   - 録画動画 / Storage URL / STT 全文 / 発表後 Q&A 履歴は含めない（結果サマリのみ）。
  //   - 直近 3 件へ拡張する場合は loadPresentationContext の limit を上げて配列化すればよい。MVP は最新 1 件のみ。
  presentation?: {
    date?: string; // 実施日時（JST の年月日）
    university?: string; // 大学名
    faculty?: string; // 学部名
    theme?: string; // 発表テーマ
    overall?: string; // 総合評価（overallComment）
    goodPoints?: string[]; // 良かった点
    improvements?: string[]; // 改善点
    nextPractice?: string[]; // 次に練習すると良い点
    // カテゴリ評価（存在時のみ）。weak/normal/strong を日本語ラベル化済み。
    categories?: { label: string; level: string }[];
  };
  // どの source が取得できたかの真偽サマリ（section 構築・観測用）。
  sourceSummary: {
    hasSelfAnalysis: boolean;
    hasBasicInfo: boolean;
    hasDiagnosis: boolean;
    hasActivity: boolean;
    hasInterviewAi: boolean;
    hasPresentation: boolean;
  };
};

// ── truncation 定数（section 全体を最大 1200 字に収めるため）──────────
const MAX_STRENGTHS = 3;
const MAX_WEAKNESSES = 2;
const MAX_FUTURE = 2;
const MAX_TARGETS = 3;
const MAX_ITEM_LENGTH = 40;
const MAX_SUMMARY_LENGTH = 120;
const MAX_TOTAL_LENGTH = 1200;
// AI 面接結果サマリの件数上限（turn 履歴は渡さない。結果画面の主要項目だけ短く渡す）。
const MAX_INTERVIEW_AI_GOOD = 3;
const MAX_INTERVIEW_AI_IMPROVE = 3;
const MAX_INTERVIEW_AI_NEXT = 2;
// プレゼン結果サマリの件数上限（録画 / STT 全文 / Q&A 履歴は渡さない。結果画面の主要項目だけ短く渡す）。
const MAX_PRESENTATION_GOOD = 3;
const MAX_PRESENTATION_IMPROVE = 3;
const MAX_PRESENTATION_NEXT = 2;

// プレゼン評価カテゴリ key → 日本語ラベル（結果画面 CATEGORY_ORDER と一致）。
const PRESENTATION_CATEGORY_LABELS: Record<string, string> = {
  composition: '構成力',
  persuasion: '説得力',
  concreteness: '具体性',
  clarity: 'わかりやすさ',
  timeManagement: '時間配分',
  completeness: '完成度',
  materialConsistency: '資料整合性',
};
// プレゼン評価カテゴリの順序（資料整合性は存在時のみ末尾に付与）。
const PRESENTATION_CATEGORY_ORDER: readonly string[] = [
  'composition',
  'persuasion',
  'concreteness',
  'clarity',
  'timeManagement',
  'completeness',
  'materialConsistency',
];
// weak/normal/strong → 日本語ラベル（結果画面 LEVEL_LABEL と一致）。
const PRESENTATION_LEVEL_LABELS: Record<string, string> = {
  weak: '要改善',
  normal: '標準',
  strong: '良い',
};

// 受験タイプ診断 resultType(legacy 1-4) → 会話補助 hint（ラベル名そのものは出さない）。
// app/diagnosis/page.tsx:RESULT_TYPES の 4 タイプの趣旨を、断定しない支援方針へ言い換える。
// ★ 言い換えの正本は lib/examDiagnosis/tutorHints.ts へ移した（Stage 5.2）★
//   Canonical Exam Context の diagnosis block が同じ hint を使うため、
//   2 箇所に置くと同じ診断結果から違う prompt が出る。値は変えていない。

// 受験タイプ診断 9タイプ（ExamType）の hint は lib/examDiagnosis/tutorHints.ts に集約
// （Tutor へ渡してよい傾向 hint のみ。タイプ名 / score / 推薦大学 / NG生文は渡さない）。

// activity カテゴリ key → 表示ラベル（lib/contextBuilders/tutorStudentContext.ts と一致）。
// ★ ラベル表と件数集計の正本は lib/activityCategories.ts へ移した（Stage 5.3）★
//   Canonical Exam Context の activity block が同じ集計を使うため、
//   2 箇所に置くと同じ活動データから違う prompt が出る。値は変えていない。

// ── 汎用 shape guard（jsonb は DB 側で shape 強制しない契約のため defensive に読む）──

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .slice(0, max)
    .map((s) => (s.length > MAX_ITEM_LENGTH ? s.slice(0, MAX_ITEM_LENGTH) : s));
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

// snapshot 型 table（basic_info_logs / diagnosis_logs / activity_logs）の payload を
// userId scope で 1 件読む共通ヘルパ。table 不存在 / RLS 失敗 / 例外でも throw せず null。
async function readSnapshotPayload(
  client: SupabaseClient,
  table: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await client
      .from(table)
      .select('payload')
      .eq('user_id', userId)
      .maybeSingle<{ payload: unknown }>();
    if (error) {
      // SQL 未 apply（relation 不存在）/ RLS 失敗 等。静かに no-op。
      console.warn('tutor supabase context: snapshot read error', {
        table,
        code: error.code,
      });
      return null;
    }
    return asRecord(data?.payload);
  } catch {
    console.warn('tutor supabase context: snapshot read threw', { table });
    return null;
  }
}

// ── source loader: self_analysis_logs（最新 1 件）─────────────────
async function loadSelfAnalysis(
  client: SupabaseClient,
  userId: string,
): Promise<Partial<TutorStudentContext>> {
  let data: unknown;
  try {
    const res = await client
      .from('self_analysis_logs')
      .select('analysis, summary, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (res.error) {
      console.warn('tutor supabase context: self_analysis_logs read error', {
        code: res.error.code,
      });
      return {};
    }
    data = res.data;
  } catch {
    console.warn('tutor supabase context: self_analysis_logs read threw');
    return {};
  }

  const row = Array.isArray(data) ? data[0] : null;
  const rec = asRecord(row);
  if (!rec) return {};

  const analysis = asRecord(rec.analysis);
  const summary = asRecord(rec.summary);

  const summaryText = truncate(
    toTrimmedString(analysis?.summary) ||
      toTrimmedString(summary?.activitySummary),
    MAX_SUMMARY_LENGTH,
  );
  const strengths = toStringArray(analysis?.strengths, MAX_STRENGTHS);
  const weaknesses = toStringArray(analysis?.weaknesses, MAX_WEAKNESSES);
  const futureConnections = toStringArray(analysis?.futureConnections, MAX_FUTURE);
  const appealPoints = truncate(
    toTrimmedString(summary?.appealPoints),
    MAX_SUMMARY_LENGTH,
  );

  const hasAny =
    summaryText !== '' ||
    strengths.length > 0 ||
    weaknesses.length > 0 ||
    futureConnections.length > 0 ||
    appealPoints !== '';
  if (!hasAny) return {};

  return {
    selfAnalysis: {
      ...(summaryText !== '' ? { summary: summaryText } : {}),
      ...(strengths.length > 0 ? { strengths } : {}),
      ...(weaknesses.length > 0 ? { weaknesses } : {}),
      ...(futureConnections.length > 0 ? { futureConnections } : {}),
      ...(appealPoints !== '' ? { appealPoints } : {}),
    },
  };
}

// ── source loader: basic_info_logs（snapshot）───────────────────────
// 含める: 学年 / 受験方式 / 志望校 / 志望分野（各最大 3）。
// 含めない: 氏名・高校名・メール・電話・住所・評定平均・欠席日数（= name/subjectGrades/
//           overallGpa は read しない。氏名は書込時に strip 済だが念のため参照しない）。
async function loadBasicInfoContext(
  client: SupabaseClient,
  userId: string,
): Promise<Partial<TutorStudentContext>> {
  const payload = await readSnapshotPayload(client, 'basic_info_logs', userId);
  if (!payload) return {};

  const grade = truncate(toTrimmedString(payload.grade), MAX_ITEM_LENGTH);
  const examType = toStringArray(payload.examTypes, MAX_TARGETS).join('・');

  const prefs = Array.isArray(payload.preferences) ? payload.preferences : [];
  const targetSchools: string[] = [];
  const targetFields: string[] = [];
  for (const p of prefs.slice(0, MAX_TARGETS)) {
    const pr = asRecord(p);
    if (!pr) continue;
    const uni = truncate(toTrimmedString(pr.university), MAX_ITEM_LENGTH);
    const fac = truncate(toTrimmedString(pr.faculty), MAX_ITEM_LENGTH);
    if (uni !== '') targetSchools.push(uni);
    if (fac !== '') targetFields.push(fac);
  }

  const hasAny =
    grade !== '' ||
    examType !== '' ||
    targetSchools.length > 0 ||
    targetFields.length > 0;
  if (!hasAny) return {};

  return {
    basicInfo: {
      ...(grade !== '' ? { grade } : {}),
      ...(examType !== '' ? { examType } : {}),
      ...(targetSchools.length > 0 ? { targetSchools } : {}),
      ...(targetFields.length > 0 ? { targetFields } : {}),
    },
  };
}

// ── source loader: diagnosis_logs（snapshot）────────────────────────
// resultType を会話補助 hint へ言い換える。2 系統を typeof で判別:
//   - number（legacy 1-4）→ DIAGNOSIS_TYPE_HINTS。
//   - string（ExamType 9種）→ EXAM_DIAGNOSIS_TYPE_HINTS（isExamType でガード）。
// どちらの系統でも、固定タイプ名 / catchphrase / score / answers / 推薦大学 / NG生文は読まない・渡さない。
async function loadDiagnosisContext(
  client: SupabaseClient,
  userId: string,
): Promise<Partial<TutorStudentContext>> {
  const payload = await readSnapshotPayload(client, 'diagnosis_logs', userId);
  if (!payload) return {};

  const hint = resolveDiagnosisTypeHint(payload.resultType);
  if (!hint) return {};

  return { diagnosis: { typeHint: truncate(hint, MAX_SUMMARY_LENGTH) } };
}

// ── source loader: activity_logs（snapshot）─────────────────────────
// 件数集計のみ。narrative 本文 / 固有名詞 / raw payload は一切読まない・含めない。
async function loadActivityContext(
  client: SupabaseClient,
  userId: string,
): Promise<Partial<TutorStudentContext>> {
  const payload = await readSnapshotPayload(client, 'activity_logs', userId);
  if (!payload) return {};

  const summary = summarizeActivityCategories(payload);
  if (!summary) return {};

  return { activity: { totalCount: summary.totalCount, categoryCounts: summary.categoryCounts } };
}

// ── source loader: interview_ai_results（最新の completed AI 面接 1 件）──────
//
// 結果画面（lib/supabase/interviewAiResults.ts:listCompletedAiInterviews）と同じ保存済み
// データを server-side で読む。新しい面接結果は生成しない。turn 履歴 / 音声 / STT 全文は
// 一切読まず、結果サマリ（総合評価 / 良かった点 / 改善点 / 次の練習 / モード / 日時）だけを抽出する。
// interview_ai_results の SELECT は session 経由 EXISTS RLS で owner に閉じる（schema §60）。
// table 不存在 / RLS 失敗 / 例外でも throw せず {}。
async function loadInterviewAiContext(
  client: SupabaseClient,
  userId: string,
): Promise<Partial<TutorStudentContext>> {
  let data: unknown;
  try {
    const res = await client
      .from('interview_ai_sessions')
      .select('created_at, interview_type, interview_ai_results(feedback)')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1); // 最新 1 件。3 件対応時はここを上げて配列化する。
    if (res.error) {
      console.warn('tutor supabase context: interview_ai read error', {
        code: res.error.code,
      });
      return {};
    }
    data = res.data;
  } catch {
    console.warn('tutor supabase context: interview_ai read threw');
    return {};
  }

  const row = Array.isArray(data) ? data[0] : null;
  const rec = asRecord(row);
  if (!rec) return {};

  // embed（PostgREST）は配列 or 単体で返りうる（UNIQUE(session_id) なので実質 0/1 件）。
  const resultsRaw = rec.interview_ai_results;
  const resultRec = Array.isArray(resultsRaw)
    ? asRecord(resultsRaw[0])
    : asRecord(resultsRaw);
  const feedback = asRecord(resultRec?.feedback);
  if (!feedback) return {};

  const overall = truncate(
    toTrimmedString(feedback.overallEvaluation),
    MAX_SUMMARY_LENGTH,
  );
  const goodPoints = toStringArray(feedback.goodPoints, MAX_INTERVIEW_AI_GOOD);
  const improvements = toStringArray(feedback.improvements, MAX_INTERVIEW_AI_IMPROVE);
  const nextPractice = toStringArray(feedback.nextPractice, MAX_INTERVIEW_AI_NEXT);

  const hasAny =
    overall !== '' ||
    goodPoints.length > 0 ||
    improvements.length > 0 ||
    nextPractice.length > 0;
  if (!hasAny) return {};

  const typeRaw = toTrimmedString(rec.interview_type) || 'free';
  const modeLabel = isInterviewType(typeRaw)
    ? INTERVIEW_TYPE_LABELS[typeRaw]
    : INTERVIEW_TYPE_LABELS.free;
  const date = formatDateJst(toTrimmedString(rec.created_at));

  return {
    interviewAi: {
      modeLabel,
      ...(date !== '' ? { date } : {}),
      ...(overall !== '' ? { overall } : {}),
      ...(goodPoints.length > 0 ? { goodPoints } : {}),
      ...(improvements.length > 0 ? { improvements } : {}),
      ...(nextPractice.length > 0 ? { nextPractice } : {}),
    },
  };
}

// ── source loader: presentation_results（最新の evaluated プレゼン 1 件）────
//
// 結果画面（app/presentation/result/PresentationResultClient.tsx）と同じ保存済みデータを
// server-side で読む。新しい評価は生成しない。録画動画 / Storage URL / STT 全文(transcript) /
// 発表後 Q&A 履歴は一切読まず、結果サマリ（総合評価 / 良かった点 / 改善点 / 次の練習 / カテゴリ /
// 大学・学部・テーマ・日時）だけを抽出する。
//   - core: presentation_results を user_id scope で最新 1 件（feedback / created_at）。これが取れねば {}。
//   - enrichment: attempt 経由で session の大学名 / 学部名 / テーマを best-effort で補う（失敗しても core は返す）。
// presentation_results / attempts / sessions はいずれも owner SELECT RLS。table 不存在 / 例外でも throw せず {}。
async function loadPresentationContext(
  client: SupabaseClient,
  userId: string,
): Promise<Partial<TutorStudentContext>> {
  // core: 最新の評価結果（feedback 本体）。
  let resultRow: Record<string, unknown> | null = null;
  let attemptId = '';
  try {
    const res = await client
      .from('presentation_results')
      .select('created_at, feedback, attempt_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1); // 最新 1 件。3 件対応時はここを上げて配列化する。
    if (res.error) {
      console.warn('tutor supabase context: presentation read error', {
        code: res.error.code,
      });
      return {};
    }
    const row = Array.isArray(res.data) ? res.data[0] : null;
    resultRow = asRecord(row);
    attemptId = toTrimmedString(resultRow?.attempt_id);
  } catch {
    console.warn('tutor supabase context: presentation read threw');
    return {};
  }
  if (!resultRow) return {};

  const feedback = asRecord(resultRow.feedback);
  if (!feedback) return {};

  const overall = truncate(
    toTrimmedString(feedback.overallComment),
    MAX_SUMMARY_LENGTH,
  );
  const goodPoints = toStringArray(feedback.goodPoints, MAX_PRESENTATION_GOOD);
  const improvements = toStringArray(feedback.improvements, MAX_PRESENTATION_IMPROVE);
  const nextPractice = toStringArray(feedback.nextPractice, MAX_PRESENTATION_NEXT);

  // カテゴリ評価（存在時のみ）。weak/normal/strong を日本語ラベルへ。資料整合性は付いていれば末尾に。
  const cats = asRecord(feedback.categories);
  const categories: { label: string; level: string }[] = [];
  if (cats) {
    for (const key of PRESENTATION_CATEGORY_ORDER) {
      const level = PRESENTATION_LEVEL_LABELS[toTrimmedString(cats[key])];
      if (level) {
        categories.push({ label: PRESENTATION_CATEGORY_LABELS[key], level });
      }
    }
  }

  const hasAny =
    overall !== '' ||
    goodPoints.length > 0 ||
    improvements.length > 0 ||
    nextPractice.length > 0 ||
    categories.length > 0;
  if (!hasAny) return {};

  const date = formatDateJst(toTrimmedString(resultRow.created_at));

  // enrichment（best-effort）: attempt → session の大学名 / 学部名 / テーマ。失敗しても core は返す。
  let university = '';
  let faculty = '';
  let theme = '';
  if (attemptId) {
    try {
      const res = await client
        .from('presentation_attempts')
        .select('presentation_sessions(university_name, faculty_name, theme)')
        .eq('id', attemptId)
        .maybeSingle();
      const attemptRec = asRecord(res.data);
      const sessRaw = attemptRec?.presentation_sessions;
      const sess = Array.isArray(sessRaw) ? asRecord(sessRaw[0]) : asRecord(sessRaw);
      if (sess) {
        university = truncate(toTrimmedString(sess.university_name), MAX_ITEM_LENGTH);
        faculty = truncate(toTrimmedString(sess.faculty_name), MAX_ITEM_LENGTH);
        theme = truncate(toTrimmedString(sess.theme), MAX_SUMMARY_LENGTH);
      }
    } catch {
      // enrichment 失敗は無視（core feedback のみで section を出す）。
    }
  }

  return {
    presentation: {
      ...(date !== '' ? { date } : {}),
      ...(university !== '' ? { university } : {}),
      ...(faculty !== '' ? { faculty } : {}),
      ...(theme !== '' ? { theme } : {}),
      ...(overall !== '' ? { overall } : {}),
      ...(goodPoints.length > 0 ? { goodPoints } : {}),
      ...(improvements.length > 0 ? { improvements } : {}),
      ...(nextPractice.length > 0 ? { nextPractice } : {}),
      ...(categories.length > 0 ? { categories } : {}),
    },
  };
}

// ISO 文字列 → JST の年月日（不正値は ''）。section builder は純粋関数のため日時整形はここで行う。
function formatDateJst(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return '';
  }
}

// ── 主 entry: loadTutorStudentContext ────────────────────────────
//
// userId scope で Supabase の各 auth-scoped durable から保存済み生徒情報を取得し、
// TutorStudentContext を返す。throw しない。各 source は allSettled で部分成功を許容し、
// 失敗は console.warn のみ。client は 1 回だけ生成して全 loader で共有する。
export async function loadTutorStudentContext(
  userId: string,
  // STEP-TUTOR-ROUTING-AUDIT-01 (P0): user-scoped supabase client を外から注入できる。
  //   route 側で auth 済の client を渡すと、本関数内での getServerSupabaseClient 再生成
  //   （= cookie 再パース）を避けられる。未指定なら従来どおり自前で生成する（後方互換）。
  injectedClient?: SupabaseClient | null,
): Promise<TutorStudentContext> {
  const empty: TutorStudentContext = {
    sourceSummary: {
      hasSelfAnalysis: false,
      hasBasicInfo: false,
      hasDiagnosis: false,
      hasActivity: false,
      hasInterviewAi: false,
      hasPresentation: false,
    },
  };

  if (!userId) return empty;

  const client = injectedClient ?? (await getServerSupabaseClient());
  if (!client) {
    // env 未設定 / cookie 無し（未ログイン相当）。静かに空を返す。
    return empty;
  }

  // STEP-TUTOR-LATENCY-ROOTCAUSE-01: 各 source の実測時間を計測する instrumentation。
  // ⚠️ 計測のみ。query 内容・順序・並列性・戻り値は一切変更していない（behavioral change なし）。
  // 目的: context_load_ms の ~40s が
  //   (a) どの source か（1 つだけ遅い = その query / 全部遅い = 接続・コールド要因）、
  //   (b) 並列が効いているか（allSettled_ms ≈ max なら並列 / ≈ 合算なら直列化）、
  //   を切り分ける。durations と真偽のみ出力（PII・本文・生徒情報は出さない）。
  const sourceTimings: Record<string, number> = {};
  const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const s = Date.now();
    try {
      return await fn();
    } finally {
      sourceTimings[name] = Date.now() - s;
    }
  };

  let settled: Array<PromiseSettledResult<Partial<TutorStudentContext>>>;
  const allSettledStart = Date.now();
  try {
    settled = await Promise.allSettled([
      timed('selfAnalysis_ms', () => loadSelfAnalysis(client, userId)),
      timed('basicInfo_ms', () => loadBasicInfoContext(client, userId)),
      timed('diagnosis_ms', () => loadDiagnosisContext(client, userId)),
      timed('activity_ms', () => loadActivityContext(client, userId)),
      timed('interviewAi_ms', () => loadInterviewAiContext(client, userId)),
      timed('presentation_ms', () => loadPresentationContext(client, userId)),
    ]);
  } catch {
    // allSettled は本来 reject しないが、念のため。
    console.info(
      '[TutorContextSources]',
      JSON.stringify({
        ...sourceTimings,
        allSettled_ms: Date.now() - allSettledStart,
        clientInjected: injectedClient != null,
        error: 'allSettled_threw',
      }),
    );
    return empty;
  }
  // 並列性の確認: allSettled_ms が max(各 source) に近ければ並列、合算に近ければ直列。
  console.info(
    '[TutorContextSources]',
    JSON.stringify({
      ...sourceTimings,
      allSettled_ms: Date.now() - allSettledStart,
      clientInjected: injectedClient != null,
    }),
  );

  const merged: TutorStudentContext = {
    sourceSummary: { ...empty.sourceSummary },
  };
  for (const r of settled) {
    if (r.status !== 'fulfilled') {
      console.warn('tutor supabase context: source rejected');
      continue;
    }
    const v = r.value;
    if (v.selfAnalysis) {
      merged.selfAnalysis = v.selfAnalysis;
      merged.sourceSummary.hasSelfAnalysis = true;
    }
    if (v.basicInfo) {
      merged.basicInfo = v.basicInfo;
      merged.sourceSummary.hasBasicInfo = true;
    }
    if (v.diagnosis) {
      merged.diagnosis = v.diagnosis;
      merged.sourceSummary.hasDiagnosis = true;
    }
    if (v.activity) {
      merged.activity = v.activity;
      merged.sourceSummary.hasActivity = true;
    }
    if (v.interviewAi) {
      merged.interviewAi = v.interviewAi;
      merged.sourceSummary.hasInterviewAi = true;
    }
    if (v.presentation) {
      merged.presentation = v.presentation;
      merged.sourceSummary.hasPresentation = true;
    }
  }

  return merged;
}

// ── per-user context cache（STEP-TUTOR-ROUTING-AUDIT-01 P0）──────────
//
// loadTutorStudentContext の結果を userId 単位で短期キャッシュする。
// 目的: 同一会話の連続ターンで Supabase の 4 read を毎ターン繰り返さず、pre-Claude の
//       レイテンシを削る。取得「内容」は intent / feature に依存しないため userId だけを key にする。
//
// 方針:
//   - key  : userId のみ。
//   - TTL  : 60 秒。生徒情報は分単位では変わらないため品質中立（prompt 側も「参考情報・
//            古い可能性あり・最新発言優先」と明記済み）。
//   - store: プロセス内 Map。**dev / serverless では永続・インスタンス間共有を保証しない**
//            （複数インスタンス・cold start で空から始まる）。同一インスタンス・短時間の
//            ベストエフォート最適化であり、正しさは cache 無しでも成立する設計。
//   - 非キャッシュ条件: 取得結果が「全 source 空」のときはキャッシュしない。
//            理由: loadTutorStudentContext は never-throw で一時的失敗も空に倒れるため、空を
//            60 秒 hit として固定すると生徒情報を隠してしまう。品質優先で空はキャッシュしない
//            （= データのあるユーザーだけが cache の恩恵を受ける）。
//   - invalidation: TTL のみ（明示 invalidation なし）。保存情報の更新は最大 60 秒で反映される。
//   - quality: truncation / 要約 / tiering は一切しない。loadTutorStudentContext の結果を
//            そのまま保持・返す（品質は cache 有無で不変）。
const CONTEXT_CACHE_TTL_MS = 60_000;

type ContextCacheEntry = { value: TutorStudentContext; expiresAt: number };
const contextCache = new Map<string, ContextCacheEntry>();

function hasAnySource(ctx: TutorStudentContext): boolean {
  const s = ctx.sourceSummary;
  return (
    s.hasSelfAnalysis ||
    s.hasBasicInfo ||
    s.hasDiagnosis ||
    s.hasActivity ||
    s.hasInterviewAi ||
    s.hasPresentation
  );
}

/**
 * loadTutorStudentContext の 60 秒 per-user キャッシュ付きラッパ。
 * 戻り値に cacheHit を含め、呼び出し側でレイテンシログに使えるようにする。
 * throw しない（内部の loadTutorStudentContext が never-throw）。
 */
export async function loadTutorStudentContextCached(
  userId: string,
  injectedClient?: SupabaseClient | null,
): Promise<{ context: TutorStudentContext; cacheHit: boolean }> {
  const empty: TutorStudentContext = {
    sourceSummary: {
      hasSelfAnalysis: false,
      hasBasicInfo: false,
      hasDiagnosis: false,
      hasActivity: false,
      hasInterviewAi: false,
      hasPresentation: false,
    },
  };
  if (!userId) return { context: empty, cacheHit: false };

  const now = Date.now();
  const cached = contextCache.get(userId);
  if (cached && cached.expiresAt > now) {
    return { context: cached.value, cacheHit: true };
  }
  if (cached) contextCache.delete(userId); // 期限切れの掃除

  const context = await loadTutorStudentContext(userId, injectedClient);
  if (hasAnySource(context)) {
    contextCache.set(userId, {
      value: context,
      expiresAt: now + CONTEXT_CACHE_TTL_MS,
    });
  }
  return { context, cacheHit: false };
}

// ── buildTutorSupabaseContextSection ─────────────────────────────
//
// TutorStudentContext を SYSTEM prompt 追加用の単一 section 文字列へ整形する純粋関数。
// 4 source（basic_info / self_analysis / activity / diagnosis）を 1 つの
// 【保存済みの生徒情報】 section に統合する（source ごとに block を増やさない）。
//
// 規約:
//   - 全 source 空なら '' を返す（route 側は空なら block ごと省略する）。
//   - 空 source は行ごと省略する。
//   - 冒頭に「参考情報 / 最新発言優先 / 矛盾時は確認」を必ず入れる。
//   - raw JSON を出さない。断定しない（「あなたは〜です」禁止）。
//   - 「保存情報では」「過去入力では」を使う。section 全体 1200 字以内。
//
// 純粋関数: fetch / Supabase / Date / Math.random なし。
export function buildTutorSupabaseContextSection(
  context: TutorStudentContext,
): string {
  const lines: string[] = [];

  // 1. 基本情報（学年 / 受験方式 / 志望校 / 志望分野）
  const bi = context.basicInfo;
  if (bi) {
    const head: string[] = [];
    if (bi.grade) head.push(bi.grade);
    if (bi.examType) head.push(`受験方式は${bi.examType}`);
    if (head.length > 0) {
      lines.push(`・保存情報では、${head.join('・')} のようです。`);
    }
    if (bi.targetSchools && bi.targetSchools.length > 0) {
      lines.push(
        `・過去入力では、志望校として${bi.targetSchools
          .map((s) => `「${s}」`)
          .join('')}が挙がっています。`,
      );
    }
    if (bi.targetFields && bi.targetFields.length > 0) {
      lines.push(
        `・保存情報では、志望分野として${bi.targetFields
          .map((s) => `「${s}」`)
          .join('')}への関心が見られます。`,
      );
    }
  }

  // 2. 自己分析（強み / 課題 / 将来の方向性 / 要約）
  const sa = context.selfAnalysis;
  if (sa) {
    if (sa.strengths && sa.strengths.length > 0) {
      lines.push(
        `・保存情報では、強みとして${sa.strengths
          .map((s) => `「${s}」`)
          .join('')}が整理されています。`,
      );
    }
    if (sa.weaknesses && sa.weaknesses.length > 0) {
      lines.push(
        `・過去入力では、課題として${sa.weaknesses
          .map((s) => `「${s}」`)
          .join('')}が挙がっています。`,
      );
    }
    if (sa.futureConnections && sa.futureConnections.length > 0) {
      lines.push(
        `・保存情報では、将来の方向性として${sa.futureConnections
          .map((s) => `「${s}」`)
          .join('')}が見られます。`,
      );
    }
    if (sa.summary) {
      lines.push(`・自己分析の要約: ${sa.summary}`);
    } else if (sa.appealPoints) {
      lines.push(`・自己PR で使えそうな要点: ${sa.appealPoints}`);
    }
  }

  // 3. 活動（カテゴリ別件数のみ）
  const ac = context.activity;
  if (ac) {
    const parts = Object.entries(ac.categoryCounts).map(
      ([label, n]) => `${label}${n}件`,
    );
    if (parts.length > 0) {
      lines.push(
        `・活動整理には、${parts.join('・')} が保存されています（計${ac.totalCount}件）。`,
      );
    }
  }

  // 4. 診断（タイプ名は出さず会話補助 hint）
  const dg = context.diagnosis;
  if (dg?.typeHint) {
    lines.push(`・保存情報からは、${dg.typeHint}。`);
  }

  // 5. 直近の AI 面接練習の結果（結果画面と同じ保存済み feedback。turn 履歴は含めない）。
  const ia = context.interviewAi;
  if (ia) {
    const head = ia.date ? `${ia.date}実施の${ia.modeLabel}` : ia.modeLabel;
    lines.push(`・直近のAI面接練習（${head}）の結果が保存されています。`);
    if (ia.overall) {
      lines.push(`  - 総合評価: ${ia.overall}`);
    }
    if (ia.goodPoints && ia.goodPoints.length > 0) {
      lines.push(
        `  - 良かった点: ${ia.goodPoints.map((s) => `「${s}」`).join('')}`,
      );
    }
    if (ia.improvements && ia.improvements.length > 0) {
      lines.push(
        `  - 改善点: ${ia.improvements.map((s) => `「${s}」`).join('')}`,
      );
    }
    if (ia.nextPractice && ia.nextPractice.length > 0) {
      lines.push(
        `  - 次に練習すると良い点: ${ia.nextPractice.map((s) => `「${s}」`).join('')}`,
      );
    }
  }

  // 6. 直近のプレゼン練習の結果（結果画面と同じ保存済み feedback。録画 / STT 全文 / Q&A 履歴は含めない）。
  const pr = context.presentation;
  if (pr) {
    const headParts: string[] = [];
    if (pr.date) headParts.push(`${pr.date}実施`);
    if (pr.university) {
      headParts.push(pr.faculty ? `${pr.university} ${pr.faculty}` : pr.university);
    }
    const head = headParts.join('・');
    lines.push(
      `・直近のプレゼン練習${head ? `（${head}）` : ''}の結果が保存されています。`,
    );
    if (pr.theme) {
      lines.push(`  - 発表テーマ: ${pr.theme}`);
    }
    if (pr.overall) {
      lines.push(`  - 総合評価: ${pr.overall}`);
    }
    if (pr.categories && pr.categories.length > 0) {
      lines.push(
        `  - カテゴリ評価: ${pr.categories.map((c) => `${c.label}=${c.level}`).join(' / ')}`,
      );
    }
    if (pr.goodPoints && pr.goodPoints.length > 0) {
      lines.push(
        `  - 良かった点: ${pr.goodPoints.map((s) => `「${s}」`).join('')}`,
      );
    }
    if (pr.improvements && pr.improvements.length > 0) {
      lines.push(
        `  - 改善点: ${pr.improvements.map((s) => `「${s}」`).join('')}`,
      );
    }
    if (pr.nextPractice && pr.nextPractice.length > 0) {
      lines.push(
        `  - 次に練習すると良い点: ${pr.nextPractice.map((s) => `「${s}」`).join('')}`,
      );
    }
  }

  if (lines.length === 0) return '';

  const section = [
    '【保存済みの生徒情報】',
    '以下は過去の入力に基づく参考情報です。最新のユーザー発言を常に最優先してください。',
    '保存情報と最新の発言が食い違う場合は、断定せず確認質問をしてください。',
    '',
    ...lines,
    '・注意: 志望校・進路・学力は変わる可能性があるため、断定せず必要に応じて確認してください。',
    '',
    'この生徒情報の扱い方:',
    '・参考情報です。古い可能性があるため断定せず、必要なときだけ自然に参照してください。',
    '・ここに無い個人情報を推測・補完したり、「未入力」を責めたりしないでください。',
  ].join('\n');

  return truncate(section, MAX_TOTAL_LENGTH);
}
