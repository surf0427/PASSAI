// 受験チューターAI 用「PASSAI 内 生徒情報」context builder（純粋関数）。
//
// 役割:
//   - PASSAI 内の各機能で保存済みのデータ（志望校 / 自己分析 / 志望理由書レビュー /
//     活動 / 小論文添削）を、受験相談に必要な範囲だけ要約した 1 本の string にする。
//   - 生データをそのまま載せず、各 field を圧縮・truncate して最大 2,500 字程度に収める。
//   - データが無い field は無理に補完せず「未入力」として扱う。
//   - すべての field が未入力なら空文字を返す（route 側で section ごと省略するため）。
//
// 設計方針:
//   - throw しない純粋関数。fetch / localStorage / Supabase / Date / Math.random / console なし。
//   - 入力は unknown | null で受け、内部で defensive に shape guard する
//     （client から JSON 越しに渡る生データのため）。
//   - section の header / 利用ルール（参考情報である旨など）は本 builder では付けない。
//     それらは lib/tutor/tutorPrompt.ts:buildTutorStudentContextSection が付与する。
//
// 関連:
//   - types/tutorContext.ts (TutorStudentContextInput)
//   - lib/tutor/tutorPrompt.ts (buildTutorStudentContextSection)
//   - app/api/tutor/route.ts (consumer)

import type { TutorStudentContextInput } from '@/types/tutorContext';

// ── truncation 定数 ──────────────────────────────────────────────
// 値を変えると出力 string が変わるが、本 context は Anthropic prompt cache の
// cached prefix（TUTOR_SYSTEM_PROMPT）の外側に置く dynamic block のため、
// TUTOR_PROMPT_VERSION の bump 対象ではない。

const MAX_TOTAL_LENGTH = 2500;
const MAX_PREFERENCES = 3;
const MAX_PREFERENCE_LABEL = 40;
const MAX_SUMMARY_LENGTH = 120;
const MAX_PROFILE_ITEM_LENGTH = 30;
const MAX_STRENGTHS = 3;
const MAX_WEAKNESSES = 2;
const MAX_REVIEW_WEAKNESS_LENGTH = 60;
const MAX_REVIEW_WEAKNESSES = 2;
// 面接練習: 改善点 1 件あたりの長さ・件数・section 全体長の上限。
// 上限 3 件 × 80 字 ≒ 最大 250 字程度で、要件の「300〜500 字以内」に収まる。
const MAX_INTERVIEW_ITEM_LENGTH = 80;
const MAX_INTERVIEW_ITEMS = 3;
const MAX_INTERVIEW_SECTION_LENGTH = 500;

// マイページ機能 key → 表示ラベル。RecentActivityFeature の核 5 機能と一致させる。
// diagnosis / matching は核機能でないため意図的に含めない（recentFeatures で除外される）。
const MYPAGE_FEATURE_LABELS: Record<string, string> = {
  selfAnalysis: '自己分析',
  statement: '志望理由書',
  interview: '面接練習',
  essay: '小論文',
  selfPR: '自己PR',
};
// 利用状況を並べる固定順（自己理解 → 出願書類 → 面接 → 小論文 → PR）。
const MYPAGE_CORE_FEATURES = [
  'selfAnalysis',
  'statement',
  'interview',
  'essay',
  'selfPR',
] as const;
// マイページ由来 section の合計長 cap（要件: 300〜500 字程度）。
const MAX_MYPAGE_SECTION_LENGTH = 500;
// 成長傾向行の長さ cap（要件: 120 字程度）。
const MAX_MYPAGE_GROWTH_LENGTH = 120;
// recent line に出す「最近よく使っている機能」の最大件数。
const MAX_MYPAGE_RECENT_FEATURES = 2;

// 活動カテゴリ key → 表示ラベル。ActivityData の field 名と一致させる。
const ACTIVITY_CATEGORY_LABELS: Record<string, string> = {
  clubActivities: '部活動',
  volunteerActivities: 'ボランティア',
  studyAbroadActivities: '留学',
  researchActivities: '探究',
  partTimeJobActivities: 'アルバイト',
  certificationActivities: '資格',
  contestActivities: 'コンテスト',
  readingActivities: '読書',
  hobbyActivities: '趣味',
  otherActivities: 'その他',
};

// ── 汎用 shape guard ─────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

// 非負整数として読む。number でない / 負 / NaN は 0 に倒す。
function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

// ── 各 section builder（値が無ければ null）─────────────────────────

// 志望校: basicInfo.preferences[].{university, faculty} を「大学 学部」形で連結。
function buildTargetLine(basicInfo: unknown): string | null {
  const rec = asRecord(basicInfo);
  if (!rec) return null;
  if (!Array.isArray(rec.preferences)) return null;

  const items: string[] = [];
  for (const pref of rec.preferences.slice(0, MAX_PREFERENCES)) {
    const pr = asRecord(pref);
    if (!pr) continue;
    const label = [toTrimmedString(pr.university), toTrimmedString(pr.faculty)]
      .filter((s) => s !== '')
      .join(' ');
    if (label !== '') items.push(truncate(label, MAX_PREFERENCE_LABEL));
  }
  return items.length > 0 ? items.join(' / ') : null;
}

// 自己分析の要約: studentProfile.summary（compact / full どちらも summary を持つ）。
function buildSummaryLine(profile: unknown): string | null {
  const rec = asRecord(profile);
  if (!rec) return null;
  const summary = toTrimmedString(rec.summary);
  return summary !== '' ? truncate(summary, MAX_SUMMARY_LENGTH) : null;
}

// 自己分析の強み: studentProfile.strengths（優先度順）から最大 MAX_STRENGTHS 件。
function buildStrengthsLine(profile: unknown): string | null {
  const rec = asRecord(profile);
  if (!rec) return null;
  const items = toStringArray(rec.strengths)
    .slice(0, MAX_STRENGTHS)
    .map((s) => truncate(s, MAX_PROFILE_ITEM_LENGTH));
  return items.length > 0 ? items.join(' / ') : null;
}

// 自己分析で見えている課題: studentProfile.weaknesses から最大 MAX_WEAKNESSES 件。
function buildWeaknessesLine(profile: unknown): string | null {
  const rec = asRecord(profile);
  if (!rec) return null;
  const items = toStringArray(rec.weaknesses)
    .slice(0, MAX_WEAKNESSES)
    .map((s) => truncate(s, MAX_PROFILE_ITEM_LENGTH));
  return items.length > 0 ? items.join(' / ') : null;
}

// 志望理由書レビューの直近の課題:
//   StatementResult.weaknesses をそのまま、または ReviewHistoryItem.result.weaknesses を掘る。
function buildStatementWeaknessLine(latest: unknown): string | null {
  const rec = asRecord(latest);
  if (!rec) return null;
  // ReviewHistoryItem 形（result を内包）なら result を、そうでなければ自身を見る。
  const src = asRecord(rec.result) ?? rec;
  const items = toStringArray(src.weaknesses)
    .slice(0, MAX_REVIEW_WEAKNESSES)
    .map((s) => truncate(s, MAX_REVIEW_WEAKNESS_LENGTH));
  return items.length > 0 ? items.join(' / ') : null;
}

// 活動経験: 各カテゴリの件数を「ラベルN件」で列挙。
// 入力 2 形式に対応する（payload スリム化のため client は compact 形を送る）:
//   - compact: { counts: { clubActivities: 3, ... } }（本文を載せず件数のみ）
//   - legacy : ActivityData そのもの（{ clubActivities: [...], ... }）。後方互換で配列長を読む。
function buildActivityLine(data: unknown): string | null {
  const rec = asRecord(data);
  if (!rec) return null;
  const counts = asRecord(rec.counts);

  const parts: string[] = [];
  let total = 0;
  for (const key of Object.keys(ACTIVITY_CATEGORY_LABELS)) {
    let n = 0;
    if (counts && typeof counts[key] === 'number') {
      n = toCount(counts[key]);
    } else if (Array.isArray(rec[key])) {
      n = rec[key].length;
    }
    if (n > 0) {
      parts.push(`${ACTIVITY_CATEGORY_LABELS[key]}${n}件`);
      total += n;
    }
  }
  return parts.length > 0 ? `${parts.join('・')}（計${total}件）` : null;
}

// 面接練習の課題: 利用優先順位に従って 1 source だけ採用する。
//   1. interviewFeedbackLatest.improvements（AI フィードバックの改善点）
//   2. interviewRecordLatest の自己記録（improvementSummary → whatWentWrong）
//   3. どちらも無ければ null（未出力）
// 面接本文（Q&A）・betterAnswer・スコア・日付は一切載せず、課題の圧縮要約のみ。
function buildInterviewLine(
  feedbackLatest: unknown,
  recordLatest: unknown,
): string | null {
  // 優先順位 1: AI フィードバックの improvements
  const feedback = asRecord(feedbackLatest);
  if (feedback) {
    const improvements = toStringArray(feedback.improvements)
      .slice(0, MAX_INTERVIEW_ITEMS)
      .map((s) => truncate(s, MAX_INTERVIEW_ITEM_LENGTH));
    if (improvements.length > 0) {
      return truncate(improvements.join(' / '), MAX_INTERVIEW_SECTION_LENGTH);
    }
  }

  // 優先順位 2: 自己記録（improvementSummary を優先し、無ければ whatWentWrong）
  const record = asRecord(recordLatest);
  if (record) {
    const items = [
      toTrimmedString(record.improvementSummary),
      toTrimmedString(record.whatWentWrong),
    ]
      .filter((s) => s !== '')
      .slice(0, MAX_INTERVIEW_ITEMS)
      .map((s) => truncate(s, MAX_INTERVIEW_ITEM_LENGTH));
    if (items.length > 0) {
      return truncate(items.join(' / '), MAX_INTERVIEW_SECTION_LENGTH);
    }
  }

  // 優先順位 3: 両方なし
  return null;
}

// 小論文添削の直近の課題: SavedReview.weakPoints の先頭 1 件。
function buildEssayWeaknessLine(latest: unknown): string | null {
  const rec = asRecord(latest);
  if (!rec) return null;
  const items = toStringArray(rec.weakPoints)
    .slice(0, 1)
    .map((s) => truncate(s, MAX_REVIEW_WEAKNESS_LENGTH));
  return items.length > 0 ? items.join(' / ') : null;
}

// ── マイページ集約状況（STEP-TUTOR-CONTEXT-MYPAGE-01）────────────
//
// 入力は client が loadMypageData() から projection した compact shape:
//   { counts: { statement, essay, interview, selfAnalysis, selfPR },
//     recentFeatures: string[], monthlyTopFeatures: string[] }
// 本文・日付・生スコア・chart series は含まれない前提だが、builder 側でも
// 必要な field（counts の数値と feature enum 配列）だけを defensive に読む。

// counts を 5 核機能の非負整数 map に正規化。counts が無ければ null。
function getMypageCounts(mypageSummary: unknown): Record<string, number> | null {
  const rec = asRecord(mypageSummary);
  if (!rec) return null;
  const counts = asRecord(rec.counts);
  if (!counts) return null;
  return {
    selfAnalysis: toCount(counts.selfAnalysis),
    statement: toCount(counts.statement),
    interview: toCount(counts.interview),
    essay: toCount(counts.essay),
    selfPR: toCount(counts.selfPR),
  };
}

// 利用回数 → 定性的な利用状態。日付・生スコアは出さない。
function usageState(feature: string, count: number): string {
  if (count <= 0) return '未実施';
  if (feature === 'selfAnalysis') return '完了';
  if (count === 1) return '利用済み';
  return '継続利用中';
}

// feature enum 配列を「核 5 機能のみ・既知のもの」に絞って読む。
function toFeatureArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (x): x is string =>
      typeof x === 'string' && Object.prototype.hasOwnProperty.call(MYPAGE_FEATURE_LABELS, x),
  );
}

// 利用状況: 「自己分析 完了 / 志望理由書 継続利用中 / 面接練習 未実施 / ...」。
// 1 機能も使われていなければ null（新規ユーザーに「全部未実施」の noise を出さない）。
function buildMypageUsageLine(mypageSummary: unknown): string | null {
  const counts = getMypageCounts(mypageSummary);
  if (!counts) return null;
  if (!MYPAGE_CORE_FEATURES.some((f) => counts[f] > 0)) return null;

  const parts = MYPAGE_CORE_FEATURES.map(
    (f) => `${MYPAGE_FEATURE_LABELS[f]} ${usageState(f, counts[f])}`,
  );
  return truncate(parts.join(' / '), MAX_MYPAGE_SECTION_LENGTH);
}

// 最近よく使っている機能: recentFeatures の先頭から重複を除いて最大 N 件のラベル。
// recentFeatures が空（または核機能を含まない）なら null。
function buildMypageRecentLine(mypageSummary: unknown): string | null {
  const rec = asRecord(mypageSummary);
  if (!rec) return null;
  const recent = toFeatureArray(rec.recentFeatures);
  if (recent.length === 0) return null;

  const picked: string[] = [];
  for (const f of recent) {
    if (!picked.includes(f)) picked.push(f);
    if (picked.length >= MAX_MYPAGE_RECENT_FEATURES) break;
  }
  return picked.map((f) => MYPAGE_FEATURE_LABELS[f]).join(' / ');
}

// delta（最新 − 最古 の差分）→ 定性的な成長傾向ラベル。
// loadMypageData.ts:summarizeTimeline の仕様（timeline は old→new 昇順、
// delta = latest - first）に従う。数値そのものは出さない。
function trendLabel(delta: number): string {
  if (delta > 0) return '改善傾向';
  if (delta < 0) return '停滞傾向';
  return '横ばい';
}

// 最近の成長傾向: growth.{statement,essay} の delta を定性ラベルへ変換。
//   - delta が number でない（statementLatest/essayLatest なし / 1 件のみで delta 不明 /
//     shape 不一致）→ その機能はスキップ。
//   - 両方ともスキップなら null。
// 絶対スコア・delta 数値は一切出さない。
function buildMypageGrowthLine(mypageSummary: unknown): string | null {
  const rec = asRecord(mypageSummary);
  if (!rec) return null;
  const growth = asRecord(rec.growth);
  if (!growth) return null;

  const features: Array<[string, string]> = [
    ['statement', '志望理由書'],
    ['essay', '小論文'],
  ];
  const parts: string[] = [];
  for (const [key, label] of features) {
    const delta = growth[key];
    if (typeof delta === 'number' && Number.isFinite(delta)) {
      parts.push(`${label} ${trendLabel(delta)}`);
    }
  }
  if (parts.length === 0) return null;
  return truncate(parts.join(' / '), MAX_MYPAGE_GROWTH_LENGTH);
}

// まだ未着手の機能: 利用回数 0 の核機能ラベル。
// 1 機能も使われていない（= 新規ユーザー）か、未着手が無ければ null。
function buildMypageUntouchedLine(mypageSummary: unknown): string | null {
  const counts = getMypageCounts(mypageSummary);
  if (!counts) return null;
  if (!MYPAGE_CORE_FEATURES.some((f) => counts[f] > 0)) return null;

  const untouched = MYPAGE_CORE_FEATURES.filter((f) => counts[f] === 0);
  if (untouched.length === 0) return null;
  return untouched.map((f) => MYPAGE_FEATURE_LABELS[f]).join(' / ');
}

// ── 主 entry ─────────────────────────────────────────────────────

export function buildTutorStudentContext(input: TutorStudentContextInput): string {
  const rows: Array<{ label: string; value: string | null }> = [
    { label: '志望校', value: buildTargetLine(input.basicInfo) },
    { label: '自己分析の要約', value: buildSummaryLine(input.studentProfile) },
    { label: '自己分析で出ている強み', value: buildStrengthsLine(input.studentProfile) },
    { label: '自己分析で見えている課題', value: buildWeaknessesLine(input.studentProfile) },
    {
      label: '志望理由書レビューの直近の課題',
      value: buildStatementWeaknessLine(input.statementReviewLatest),
    },
    {
      label: '面接練習の課題',
      value: buildInterviewLine(
        input.interviewFeedbackLatest,
        input.interviewRecordLatest,
      ),
    },
    { label: '活動経験', value: buildActivityLine(input.activityData) },
    {
      label: '小論文添削の直近の課題',
      value: buildEssayWeaknessLine(input.essayReviewLatest),
    },
    {
      label: 'マイページの利用状況',
      value: buildMypageUsageLine(input.mypageSummary),
    },
    {
      label: '最近よく使っている機能',
      value: buildMypageRecentLine(input.mypageSummary),
    },
    {
      label: 'まだ未着手の機能',
      value: buildMypageUntouchedLine(input.mypageSummary),
    },
    {
      label: '最近の成長傾向',
      value: buildMypageGrowthLine(input.mypageSummary),
    },
  ];

  // どの field も未入力なら section ごと省く（all-未入力 の無意味な block を作らない）。
  if (!rows.some((r) => r.value !== null)) return '';

  const out = rows.map((r) => `・${r.label}: ${r.value ?? '未入力'}`).join('\n');
  return out.length > MAX_TOTAL_LENGTH ? out.slice(0, MAX_TOTAL_LENGTH) : out;
}
