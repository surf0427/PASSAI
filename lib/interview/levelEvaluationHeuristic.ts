// Deterministic heuristic for interview-feedback's per-question levelEvaluation 5 axes.
//
// 役割:
//   AI が毎回 0 ベースで判定している 5 軸（logical / concrete / consistency / originality /
//   interviewReadiness）について、文字数 / 因果接続詞 / 具体性キーワード / 大学名メンション /
//   抽象表現多用 から **tentative な候補** を deterministic に算出する。
//
// 重要原則:
//   - AI の最終判断を置き換えない（補助情報として渡すだけ）
//   - 真実ではなく rough heuristic（採点フェーズと同等の精度は出さない）
//   - 純関数 / 副作用なし / 同期処理のみ
//   - 入力不変（trim / normalize / overwrite 一切しない）
//
// 関連:
//   - app/api/interview-feedback/route.ts（唯一の consumer）
//   - lib/prompts/interviewFeedbackPrompt.ts（LEVEL_EVALUATION_HEURISTIC_QUALIFIER が
//     section の解釈ルールを AI に伝える）
//   - types/interview.ts（Level / LevelEvaluation の型正本）

import type { Level } from '@/types/interview';

export type LevelEvaluationHeuristic = {
  question: string;
  candidate: {
    logical: Level;
    concrete: Level;
    consistency: Level;
    originality: Level;
    interviewReadiness: Level;
  };
};

// 論理性の signals: 因果接続詞・結論マーカー
const CAUSAL_PATTERN =
  /(なぜなら|そのため|だから|このため|そこで|その結果|から|ため|ので)/;
const CONCLUSION_PATTERN =
  /(と考え|と思|だと考え|だと思|考えます|思います|だと言える)/;

// 具体性の signals: 数字 / カタカナ固有名詞（3 文字以上）/ 活動キーワード
const NUMBER_PATTERN = /\d/;
const KATAKANA_PROPER_PATTERN = /[゠-ヿ]{3,}/;
const ACTIVITY_KEYWORD_PATTERN =
  /(部活|大会|コンテスト|留学|実験|研究|インターン|ボランティア|発表会|授業|文化祭|体育祭|生徒会|プログラミング|ディベート|プレゼン)/;

// 独自性の counter-signal: 抽象表現の多用（複数ヒットで weak 寄り）
const ABSTRACT_PHRASES_PATTERN =
  /(成長したい|頑張った|貢献したい|社会に貢献|興味がある|魅力を感じ|学びたいです|視野を広げ|役に立ちたい)/g;

// 面接完成度の signals: 文の区切り
const SENTENCE_DELIM_PATTERN = /[。！？]/;

function scoreLogical(answer: string): Level {
  const hasCausal = CAUSAL_PATTERN.test(answer);
  const hasConclusion = CONCLUSION_PATTERN.test(answer);
  if (hasCausal && hasConclusion) return 'strong';
  if (hasCausal || hasConclusion) return 'normal';
  return 'weak';
}

function scoreConcrete(answer: string): Level {
  const signals = [
    NUMBER_PATTERN.test(answer),
    KATAKANA_PROPER_PATTERN.test(answer),
    ACTIVITY_KEYWORD_PATTERN.test(answer),
  ].filter(Boolean).length;
  if (signals >= 2) return 'strong';
  if (signals === 1) return 'normal';
  return 'weak';
}

function scoreConsistency(
  answer: string,
  universityName: string,
  facultyName: string,
): Level {
  const targets = [universityName, facultyName]
    .map((s) => s.trim())
    .filter(Boolean);
  if (targets.length === 0) return 'normal';
  const mentioned = targets.some((t) => {
    if (answer.includes(t)) return true;
    const stripped = t.replace(/(大学院?|大学|学部|学科|研究科)$/, '').trim();
    return stripped.length >= 3 && answer.includes(stripped);
  });
  return mentioned ? 'normal' : 'weak';
}

function scoreOriginality(answer: string): Level {
  const matches = answer.match(ABSTRACT_PHRASES_PATTERN);
  if (matches && matches.length >= 2) return 'weak';
  return 'normal';
}

function scoreInterviewReadiness(answer: string): Level {
  const length = answer.length;
  if (length < 50) return 'weak';
  if (length > 400) return 'normal';
  const sentenceCount = answer
    .split(SENTENCE_DELIM_PATTERN)
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;
  if (sentenceCount >= 3 && length >= 100) return 'strong';
  if (sentenceCount >= 1) return 'normal';
  return 'weak';
}

export function computeLevelEvaluationHeuristic(
  questionAnswerPairs: { question: string; answer: string }[],
  universityName: string,
  facultyName: string,
): LevelEvaluationHeuristic[] {
  return questionAnswerPairs.map(({ question, answer }) => ({
    question,
    candidate: {
      logical: scoreLogical(answer),
      concrete: scoreConcrete(answer),
      consistency: scoreConsistency(answer, universityName, facultyName),
      originality: scoreOriginality(answer),
      interviewReadiness: scoreInterviewReadiness(answer),
    },
  }));
}
