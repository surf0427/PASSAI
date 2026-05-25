// rewrite/[id] v4: 各 ImprovementActionCard で「現在の本文（= 直す対象の文）」を表示する
// ための pure heuristic。AI を使わず、deterministic に essay から「最も axis-related と
// 思われる 1 文」を拾う。
//
// 戦略（優先順）:
//   1. 引用アンカー: weaknessText 中の 「」/『』/"…"/'…' 等で囲まれた語が essay に含まれる
//      場合、その語を含む文を返す（AI 出力は具体的な phrase を引用する傾向が強いため命中率
//      が高い）。
//   2. axis keyword スキャン: essay を文に分割し、軸 keyword の出現回数で score。最大値の
//      文を返す。
//   3. 該当無し: null（呼び出し側で「現在の本文」セクション自体を skip する）。
//
// 注意:
//   - 改善対象を「意識させる」のが目的。完璧な sentence retrieval は目指さない
//   - 1 文単位で分割（。？！ と改行が区切り）。trim だけし、空白圧縮はしない
//   - 副作用なし・deterministic。SSR / test で安全に評価可能

const AXIS_EXCERPT_KEYWORDS: Record<string, readonly string[]> = {
  logic: [
    'なぜなら', 'したがって', 'ため', 'から', '結論',
    'まず', '次に', '最後に',
  ],
  specificity: [
    // 抽象動詞・抽象経験表現を含む文（= 具体性が低い文）を引きやすい keyword
    '経験', '学んだ', '感じた', '考えた', '成長',
    '気づい', '触れ', '価値観', '大切さ', '思い',
    '旅行', '海外', '活動', '取り組み',
  ],
  universityFit: [
    '大学', '学部', '学科', '貴学', '御学',
    '志望', '入学', '学びたい',
  ],
  futureGoal: [
    '将来', '卒業後', '目標', '夢', 'なりたい',
    'やりたい', 'キャリア',
  ],
  originality: [
    // よくある紋切り型表現の例
    '大切さ', '学びました', '感じました', 'みんな',
    '頑張', '一生懸命', '協力',
  ],
};

function splitIntoSentences(text: string): string[] {
  // 句点・問符・感嘆符の直後で分割（終端記号は文末に残す）。改行も区切り扱い。
  const out: string[] = [];
  let buf = '';
  for (const ch of text) {
    if (ch === '\n') {
      const t = buf.trim();
      if (t.length > 0) out.push(t);
      buf = '';
      continue;
    }
    buf += ch;
    if (ch === '。' || ch === '？' || ch === '！') {
      const t = buf.trim();
      if (t.length > 0) out.push(t);
      buf = '';
    }
  }
  const tail = buf.trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

function extractQuoted(text: string): string[] {
  // 「」 / 『』 / "" / '' / "" / '' で囲まれた語を取り出す（短すぎ/長すぎは捨てる）。
  const out: string[] = [];
  const pairs: Array<[string, string]> = [
    ['「', '」'],
    ['『', '』'],
    ['“', '”'], // “ ”
    ['‘', '’'], // ' '
    ['"', '"'],
    ["'", "'"],
  ];
  for (const [open, close] of pairs) {
    let i = 0;
    while (i < text.length) {
      const start = text.indexOf(open, i);
      if (start === -1) break;
      const end = text.indexOf(close, start + open.length);
      if (end === -1) break;
      const inner = text.slice(start + open.length, end).trim();
      // 単一文字の括弧マッチ（例: '' を文章内に含む）でノイズを拾わないよう長さ制限。
      if (inner.length >= 2 && inner.length <= 40) out.push(inner);
      i = end + close.length;
    }
  }
  return out;
}

function scoreSentence(sentence: string, axisId: string): number {
  const kws = AXIS_EXCERPT_KEYWORDS[axisId] ?? [];
  let total = 0;
  for (const kw of kws) {
    let i = 0;
    for (;;) {
      const idx = sentence.indexOf(kw, i);
      if (idx === -1) break;
      total += 1;
      i = idx + kw.length;
    }
  }
  return total;
}

export function pickRelevantExcerpt(
  essay: string,
  axisId: string,
  weaknessText: string,
): string | null {
  if (!essay || essay.trim().length === 0) return null;
  const sentences = splitIntoSentences(essay);
  if (sentences.length === 0) return null;

  // 1. 引用アンカー優先
  const quoted = extractQuoted(weaknessText);
  if (quoted.length > 0) {
    let bestSentence: string | null = null;
    let bestHits = 0;
    for (const sentence of sentences) {
      let hits = 0;
      for (const q of quoted) {
        if (sentence.includes(q)) hits += 1;
      }
      if (hits > bestHits) {
        bestHits = hits;
        bestSentence = sentence;
      }
    }
    if (bestSentence) return bestSentence;
  }

  // 2. axis keyword スキャン
  let bestSentence: string | null = null;
  let bestScore = 0;
  for (const sentence of sentences) {
    const s = scoreSentence(sentence, axisId);
    if (s > bestScore) {
      bestScore = s;
      bestSentence = sentence;
    }
  }
  if (bestSentence) return bestSentence;

  return null;
}
