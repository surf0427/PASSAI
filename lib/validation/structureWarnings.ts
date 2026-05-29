// Soft structure heuristics for AI-input. Non-blocking — caller displays as
// hints; AI call always proceeds. Read-only / pure / deterministic.
// Aim is "obvious weakness", not accurate scoring.

export type StructureWarningCode =
  | 'LOW_PARAGRAPH_COUNT'
  | 'LOW_SENTENCE_COUNT'
  | 'MISSING_REASON_PATTERN'
  | 'NO_CONCLUSION_PATTERN'
  | 'CONJUNCTION_BIAS';

export type StructureWarning = {
  code: StructureWarningCode;
  message: string;
};

const PARAGRAPH_MIN = 2;
const SENTENCE_MIN = 3;
const SENTENCE_DELIMITERS = /[。！？!?]/;
const PARAGRAPH_DELIMITER = /\r?\n+/;

const REASON_KEYWORDS = ['なぜなら', '理由', 'ため', 'きっかけ'] as const;
const REASON_MIN_HITS = 1;

const CONCLUSION_KEYWORDS = ['志望', '学びたい', '将来', '目指', '取り組'] as const;

const CONJUNCTION_KEYWORDS = ['そして', 'また', 'さらに'] as const;
const CONJUNCTION_BIAS_MIN_TOTAL = 3;
const CONJUNCTION_BIAS_RATIO = 0.7;

export function detectStructureWarnings(text: string): StructureWarning[] {
  const warnings: StructureWarning[] = [];

  const paragraphCount = text
    .split(PARAGRAPH_DELIMITER)
    .map((p) => p.trim())
    .filter((p) => p.length > 0).length;
  if (paragraphCount < PARAGRAPH_MIN) {
    warnings.push({
      code: 'LOW_PARAGRAPH_COUNT',
      message:
        '段落分けが少ないようです。改行で論点ごとに段落を分けると読みやすくなります。',
    });
  }

  const sentenceCount = text
    .split(SENTENCE_DELIMITERS)
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;
  if (sentenceCount < SENTENCE_MIN) {
    warnings.push({
      code: 'LOW_SENTENCE_COUNT',
      message:
        '文の数が少ないようです。「。」で区切りながら一文ずつ主張を組み立てると伝わりやすくなります。',
    });
  }

  const reasonHits = REASON_KEYWORDS.reduce(
    (acc, kw) => acc + countOccurrences(text, kw),
    0,
  );
  if (reasonHits < REASON_MIN_HITS) {
    warnings.push({
      code: 'MISSING_REASON_PATTERN',
      message:
        '理由を示す表現（「なぜなら」「〜のため」「きっかけは」など）が見当たりません。具体的な理由を補うと説得力が増します。',
    });
  }

  const hasConclusion = CONCLUSION_KEYWORDS.some((kw) => text.includes(kw));
  if (!hasConclusion) {
    warnings.push({
      code: 'NO_CONCLUSION_PATTERN',
      message:
        '志望や将来像を示す表現が見当たりません。「学びたい」「将来は〜」「取り組みたい」などで方向性を補うと結論が伝わりやすくなります。',
    });
  }

  const conjunctionCounts = CONJUNCTION_KEYWORDS.map((kw) =>
    countOccurrences(text, kw),
  );
  const conjunctionTotal = conjunctionCounts.reduce((sum, n) => sum + n, 0);
  if (conjunctionTotal >= CONJUNCTION_BIAS_MIN_TOTAL) {
    const maxCount = Math.max(...conjunctionCounts);
    if (maxCount / conjunctionTotal >= CONJUNCTION_BIAS_RATIO) {
      warnings.push({
        code: 'CONJUNCTION_BIAS',
        message:
          '特定の接続詞（「そして」「また」など）が偏って多用されています。別の表現に置き換えると流れがなめらかになります。',
      });
    }
  }

  return warnings;
}

function countOccurrences(text: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = text.indexOf(needle, idx)) !== -1) {
    count += 1;
    idx += needle.length;
  }
  return count;
}
