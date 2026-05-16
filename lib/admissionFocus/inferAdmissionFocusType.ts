// AdmissionFocusInference を返す pure function（STEP1b）。
//
// 責務:
// - entries / steps を受け取り、signal 抽出 → score 算出 → primary/secondary/confidence
//   → reasons の順で AdmissionFocusInference を構築する。
// - DB アクセス・I/O・AI 呼び出しなし。完全な pure function。
//
// 設計方針:
// - 入力型は data/universityEntries.ts / data/selectionSteps.ts の最小 subset を構造的に
//   定義する（AdmissionFocusEntryInput / AdmissionFocusStepInput）。UniversityEntry を
//   そのまま渡しても構造的に互換。理由:
//     1. data/ 直 import 禁止 & lib/universities.ts は SelectionStep 型を re-export していない
//     2. テスト側で mock を作りやすい
//     3. 推定が依存するフィールドが型から自明になる
// - scores マップは内部局所変数として保持し、public return には含めない
//   （「点数診断サービス化したくない」方針の型レベル固定）。
// - signal の hasActivityReport は CSV に専用カラムが無く、format / notes / selection_notes /
//   admission_policy の文字列マッチで判定する。**精度低めの signal** と認識した上で、
//   score 重みを +2 に抑えている。CSV 列追加で改善する余地あり。
// - 複数 entries が同一大学・学部に存在するケース（明治商学部の複数方式など）では
//   全件を合算する。examTypes による絞り込みは wrapper 層（STEP2 以降）で行う。
//
// 関連: lib/admissionFocus/types.ts / lib/admissionFocus/admissionFocusDefinitions.ts

import type {
  AdmissionFocusInference,
  AdmissionFocusSignals,
  AdmissionFocusType,
} from '@/lib/admissionFocus/types';

// ── 入力型（structural subset） ──────────────────────────────────

// data/universityEntries.UniversityEntry の最小 subset。
// 推定が読むフィールドだけを列挙する。UniversityEntry はこの shape を満たす。
export type AdmissionFocusEntryInput = {
  readonly has_essay: string;
  readonly has_interview: string;
  readonly has_presentation: string;
  readonly gpa_required: string;
  readonly qualification_required: string;
  readonly selection_notes: string;
};

// data/selectionSteps.SelectionStep の最小 subset。
export type AdmissionFocusStepInput = {
  readonly selection_type: string;
  readonly format: string;
  readonly evaluation_points: string;
  readonly ai_strategy_hint: string;
  readonly admission_policy: string;
};

// ── 共通 helper ──────────────────────────────────────────────────

function isYes(value: string): boolean {
  return value.trim() === 'あり';
}

function isMeaningful(value: string): boolean {
  const t = value.trim();
  return t !== '' && t !== 'なし' && t !== '不明';
}

// ── signal 抽出 ──────────────────────────────────────────────────

const ESSAY_TYPE_PATTERN = /(小論文|論述|筆記|作文)/;
const PRESENTATION_TYPE_PATTERN = /(プレゼン|発表)/;
const ACTIVITY_REPORT_PATTERN = /(活動報告|活動実績|活動記録|課外活動)/;
const LANGUAGE_REQ_PATTERN = /(英検|TOEFL|IELTS|TOEIC|GTEC|ケンブリッジ|外国語検定)/;

function extractSignals(
  entries: readonly AdmissionFocusEntryInput[],
  steps: readonly AdmissionFocusStepInput[],
): AdmissionFocusSignals {
  const hasEssay =
    entries.some((e) => isYes(e.has_essay)) ||
    steps.some((s) => ESSAY_TYPE_PATTERN.test(s.selection_type));

  const interviewStepCount = steps.filter(
    (s) => s.selection_type.trim() === '面接',
  ).length;
  // steps に面接行が無いが entries.has_interview = "あり" の場合の補助。
  // selectionSteps は CSV 由来で欠損があるため、entries 側を fallback として 1 とみなす。
  const interviewCount =
    interviewStepCount === 0 && entries.some((e) => isYes(e.has_interview))
      ? 1
      : interviewStepCount;

  const hasPresentation =
    entries.some((e) => isYes(e.has_presentation)) ||
    steps.some(
      (s) =>
        PRESENTATION_TYPE_PATTERN.test(s.selection_type) ||
        PRESENTATION_TYPE_PATTERN.test(s.format),
    );

  const hasActivityReport =
    steps.some((s) => {
      const haystack = `${s.format} ${s.selection_type} ${s.evaluation_points} ${s.admission_policy}`;
      return ACTIVITY_REPORT_PATTERN.test(haystack);
    }) ||
    entries.some((e) => ACTIVITY_REPORT_PATTERN.test(e.selection_notes));

  const hasAcademicCondition = entries.some((e) => {
    const gpa = e.gpa_required.trim();
    if (gpa === '' || gpa === 'なし' || gpa === '不明') return false;
    // CSV に "3.8" / "4.0" のような数値と "履修要件あり" のような文言が混在する。
    return !Number.isNaN(Number(gpa)) || /あり|要件/.test(gpa);
  });

  const hasLanguageRequirement = entries.some((e) =>
    LANGUAGE_REQ_PATTERN.test(e.qualification_required),
  );

  const hasQualificationRequirement = entries.some((e) =>
    isMeaningful(e.qualification_required),
  );

  return {
    hasEssay,
    interviewCount,
    hasPresentation,
    hasActivityReport,
    hasAcademicCondition,
    hasLanguageRequirement,
    hasQualificationRequirement,
  };
}

// ── score 算出 ───────────────────────────────────────────────────

type ScoreMap = Record<AdmissionFocusType, number>;

// 非 unknown 6 タイプ。primary / secondary 選択時の deterministic 列挙順としても利用。
const TYPES_NON_UNKNOWN: readonly Exclude<AdmissionFocusType, 'unknown'>[] = [
  'activity_appeal',
  'essay_heavy',
  'interview_heavy',
  'presentation',
  'academic_mixed',
  'international',
];

function makeEmptyScoreMap(): ScoreMap {
  return {
    activity_appeal: 0,
    essay_heavy: 0,
    interview_heavy: 0,
    presentation: 0,
    academic_mixed: 0,
    international: 0,
    unknown: 0,
  };
}

const TEXT_HINT_RULES: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly target: Exclude<AdmissionFocusType, 'unknown'>;
  readonly weight: number;
}> = [
  { pattern: /(主体|探究|活動|実践)/, target: 'activity_appeal', weight: 1 },
  { pattern: /(論理|課題|考察|小論文)/, target: 'essay_heavy', weight: 1 },
  { pattern: /(面接|対話|表現)/, target: 'interview_heavy', weight: 1 },
  { pattern: /(国際|英語|多文化|グローバル)/, target: 'international', weight: 1 },
  { pattern: /(発表|プレゼン|提案)/, target: 'presentation', weight: 1 },
];

function computeScores(
  signals: AdmissionFocusSignals,
  corpus: string,
): ScoreMap {
  const scores = makeEmptyScoreMap();

  if (signals.hasEssay) scores.essay_heavy += 3;
  if (signals.interviewCount >= 2) scores.interview_heavy += 4;
  else if (signals.interviewCount === 1) scores.interview_heavy += 1;
  if (signals.hasPresentation) {
    scores.presentation += 4;
    scores.activity_appeal += 1;
  }
  if (signals.hasActivityReport) scores.activity_appeal += 2;
  if (signals.hasAcademicCondition) scores.academic_mixed += 2;
  if (signals.hasLanguageRequirement) scores.international += 4;
  if (signals.hasQualificationRequirement) scores.academic_mixed += 1;

  for (const rule of TEXT_HINT_RULES) {
    if (rule.pattern.test(corpus)) {
      scores[rule.target] += rule.weight;
    }
  }

  return scores;
}

function buildCorpus(
  entries: readonly AdmissionFocusEntryInput[],
  steps: readonly AdmissionFocusStepInput[],
): string {
  const parts: string[] = [];
  for (const s of steps) {
    parts.push(s.admission_policy, s.evaluation_points, s.ai_strategy_hint);
  }
  for (const e of entries) {
    parts.push(e.selection_notes);
  }
  return parts.join(' ');
}

// ── primary / secondary / confidence ─────────────────────────────

function pickPrimary(scores: ScoreMap): {
  primaryType: AdmissionFocusType;
  topScore: number;
} {
  let topScore = 0;
  let primaryType: AdmissionFocusType = 'unknown';
  // TYPES_NON_UNKNOWN の列挙順で先勝ち（同点時の決定論性確保）
  for (const type of TYPES_NON_UNKNOWN) {
    if (scores[type] > topScore) {
      topScore = scores[type];
      primaryType = type;
    }
  }
  return { primaryType, topScore };
}

function pickSecondary(
  scores: ScoreMap,
  primaryType: AdmissionFocusType,
  topScore: number,
): AdmissionFocusType[] {
  if (primaryType === 'unknown') return [];
  const threshold = Math.max(3, topScore * 0.6);
  return TYPES_NON_UNKNOWN
    .filter((t) => t !== primaryType && scores[t] >= threshold)
    .sort((a, b) => scores[b] - scores[a])
    .slice(0, 2);
}

function pickConfidence(topScore: number): 'high' | 'medium' | 'low' {
  if (topScore >= 8) return 'high';
  if (topScore >= 4) return 'medium';
  return 'low';
}

// ── reasons ──────────────────────────────────────────────────────

function buildReasons(
  signals: AdmissionFocusSignals,
  corpus: string,
): string[] {
  const reasons: string[] = [];
  if (signals.hasEssay) reasons.push('小論文系の選考が確認できる');
  if (signals.interviewCount >= 2) {
    reasons.push(`面接が複数回設定されている（${signals.interviewCount}回）`);
  } else if (signals.interviewCount === 1) {
    reasons.push('面接が設定されている');
  }
  if (signals.hasPresentation) {
    reasons.push('プレゼン・発表系の選考が確認できる');
  }
  if (signals.hasActivityReport) {
    reasons.push('活動報告・活動実績に関する記述がある');
  }
  if (signals.hasLanguageRequirement) {
    reasons.push('英語・語学系の資格条件が確認できる');
  }
  if (signals.hasAcademicCondition) {
    reasons.push('評定など学力面の条件が設定されている');
  }

  // テキスト由来の補足理由。signal で既に拾えているものは重複させない。
  if (/(主体|探究)/.test(corpus) && !signals.hasActivityReport) {
    reasons.push('admission_policy に主体性・探究に関する文言が含まれる');
  }
  if (/(論理|考察)/.test(corpus) && !signals.hasEssay) {
    reasons.push('論理性・考察を求める記述がある');
  }
  if (/(国際|多文化|グローバル)/.test(corpus) && !signals.hasLanguageRequirement) {
    reasons.push('国際性・多文化に関する記述がある');
  }

  return reasons.slice(0, 5);
}

// ── main ─────────────────────────────────────────────────────────

export function inferAdmissionFocusType(input: {
  entries: readonly AdmissionFocusEntryInput[];
  steps: readonly AdmissionFocusStepInput[];
}): AdmissionFocusInference {
  const { entries, steps } = input;

  const signals = extractSignals(entries, steps);
  const corpus = buildCorpus(entries, steps);
  const scores = computeScores(signals, corpus);
  const { primaryType, topScore } = pickPrimary(scores);

  // topScore === 0 のときは「signal が一切無い」もしくは「signal はあるが
  // scoring に乗らなかった」状態。前者は state (a)(b)、後者は state (c) 寄り。
  // どちらも primary は unknown で良いが、signals 自体は返すことで context builder
  // が state を区別できるようにする。
  const finalPrimary: AdmissionFocusType =
    topScore === 0 ? 'unknown' : primaryType;
  const secondaryTypes = pickSecondary(scores, finalPrimary, topScore);
  const confidence = pickConfidence(topScore);
  const reasons = buildReasons(signals, corpus);

  return {
    primaryType: finalPrimary,
    secondaryTypes,
    confidence,
    reasons,
    signals,
  };
}
