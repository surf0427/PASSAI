// StudentProfile への変換層（純粋関数のみ・AI は呼ばない）。
//
// 役割:
//   WallHittingResult から、下流共通の StudentProfile を deterministic に作る。
//   下流（statement / interview / essay / matching）は WallHittingResult を
//   直参照せず、必ず toStudentProfile() を経由する設計に段階移行する。
//
// 重要:
//   - questions / answers / selfPRDraft は受け取らない・保持しない
//     （questions / answers は壁打ちフロー内部の working memory。canonical artifact ではない）
//   - AI 呼び出しなし。すべての派生は deterministic
//   - sourceHash は将来の「素材が変わってないなら再生成しない」判定の足場
//
// 詳細な責務境界は AI API 責務分離設計（前タスク）参照。

import type { WallHittingResult } from '@/types/analysis';
import type {
  SignatureEpisode,
  StudentProfile,
} from '@/types/studentProfile';

// 任意の追加素材（activityData / answers など）を sourceHash の入力にしたい場合に渡す。
// 渡さなければ wallHitting 自身だけが hash の入力になる。
export type ToStudentProfileOptions = {
  extraSource?: unknown;
  // 生成時刻を上書きしたい場合（テスト用）。
  // 通常は省略して new Date().toISOString() を使う。
  now?: string;
};

export function toStudentProfile(
  wallHitting: WallHittingResult,
  options: ToStudentProfileOptions = {},
): StudentProfile {
  const strengths = sanitizeStringArray(wallHitting.strengths);
  const weaknesses = sanitizeStringArray(wallHitting.weaknesses);
  const futureConnections = sanitizeStringArray(wallHitting.futureConnections);
  const summary = (wallHitting.summary ?? '').trim();

  const valueKeywords = extractValueKeywords({
    summary,
    strengths,
    futureConnections,
  });

  const signatureEpisodes = makeSignatureEpisodes(strengths);

  return {
    version: 1,
    generatedAt: options.now ?? new Date().toISOString(),
    sourceHash: hashSourceContent({
      // hash の入力は profile に含まれる素材＋呼び出し側が指定した追加素材。
      // questions / answers は profile に含めないが、呼び出し側が
      // extraSource として渡せば hash に反映できる（再生成判定用）。
      summary,
      strengths,
      weaknesses,
      futureConnections,
      extra: options.extraSource ?? null,
    }),

    summary,
    strengths,
    weaknesses,
    futureConnections,
    valueKeywords,
    signatureEpisodes,
  };
}

// ── 内部ヘルパ ─────────────────────────────────────────────────────

function sanitizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const result: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed === '') continue;
    result.push(trimmed);
  }
  return result;
}

// djb2 系の軽量文字列 hash を base36 で表現する。
// crypto を使わないのは、Node / Edge / Browser のいずれの環境でも動くようにするため。
// 衝突耐性は要求しない（再生成判定の cache key 用途のみ）。
function hashSourceContent(input: unknown): string {
  const text = JSON.stringify(input ?? null);
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

// ── valueKeywords ──────────────────────────────────────────────────
//
// 下流が「strengths 全文を毎回 AI に読ませる」のを避けるため、価値観タグだけ抽出して渡す。
// 抽出は deterministic（辞書ベース）。AI は使わない。最初は単純実装で OK。

const VALUE_KEYWORD_MAP: Array<{ tag: string; patterns: string[] }> = [
  { tag: '継続力',           patterns: ['継続', '粘り強', '続け', '長期間', 'やり抜'] },
  { tag: '主体性',           patterns: ['主体', '自ら', '率先', '自分から', 'リーダー'] },
  { tag: '探究心',           patterns: ['探究', '探求', '研究', '仮説', '掘り下', '突き詰'] },
  { tag: '協調性',           patterns: ['協調', 'チーム', '協力', '仲間', '一緒に'] },
  { tag: '論理的思考',       patterns: ['論理', '分析', '構造化', 'データ', '根拠'] },
  { tag: '行動力',           patterns: ['行動', '動いた', '実行', '実践', '取り組ん'] },
  { tag: 'コミュニケーション', patterns: ['対話', '伝え', '聞く', '対人', '交渉'] },
  { tag: '適応力',           patterns: ['適応', '柔軟', '変化', '対応'] },
  { tag: '創造性',           patterns: ['創造', '工夫', '新しい', 'アイデア', '発想'] },
  { tag: '責任感',           patterns: ['責任', '任さ', '担当', '託'] },
  { tag: '国際性',           patterns: ['国際', '英語', '留学', '異文化', 'グローバル'] },
  { tag: '課題解決',         patterns: ['課題解決', '解決', '問題発見', '原因'] },
  { tag: '挑戦',             patterns: ['挑戦', 'チャレンジ', '初めて'] },
];

// 抽出上限。AI prompt に流すとき長くなりすぎないように 8 で打ち切る。
const VALUE_KEYWORDS_MAX = 8;

function extractValueKeywords(input: {
  summary: string;
  strengths: string[];
  futureConnections: string[];
}): string[] {
  const haystack = [
    input.summary,
    ...input.strengths,
    ...input.futureConnections,
  ].join('\n');

  const found: string[] = [];
  for (const { tag, patterns } of VALUE_KEYWORD_MAP) {
    if (found.includes(tag)) continue;
    if (patterns.some((p) => haystack.includes(p))) {
      found.push(tag);
      if (found.length >= VALUE_KEYWORDS_MAX) break;
    }
  }
  return found;
}

// ── signatureEpisodes ─────────────────────────────────────────────
//
// 下流の prompt で「具体例を 1 つだけ引きたい」ときに参照する短いエピソード。
// strengths の上位 3 件から、deterministic に作る（AI を呼ばない）。
// 「（探究活動より）」のような末尾の出典タグがあれば title に反映する。

const SIGNATURE_EPISODES_MAX = 3;
const TITLE_MAX_CHARS = 20;
const SUMMARY_MAX_CHARS = 100;

// 末尾の「（XXX より）」「（XXX）」を category として拾う。
// 例：
//   "試行錯誤を繰り返しながら仮説を立て直す粘り強さ（探究活動での取り組みより）"
//   → category="探究活動での取り組み"
const PARENTHETICAL_TAIL = /[（(]([^（()）]{1,30})[）)]\s*$/;
const SOURCE_TRAILING_WORDS = /(での取り組み|より|から|を通じて)$/;

function makeSignatureEpisodes(strengths: string[]): SignatureEpisode[] {
  const episodes: SignatureEpisode[] = [];
  for (let i = 0; i < strengths.length && episodes.length < SIGNATURE_EPISODES_MAX; i++) {
    const raw = strengths[i];
    episodes.push({
      title: buildEpisodeTitle(raw),
      summary: truncate(raw, SUMMARY_MAX_CHARS),
      relatedStrengthIdx: i,
    });
  }
  return episodes;
}

function buildEpisodeTitle(strengthText: string): string {
  // 「XXX（探究活動での取り組みより）」のような出典タグがあれば category として使う
  const match = strengthText.match(PARENTHETICAL_TAIL);
  if (match) {
    const category = match[1].replace(SOURCE_TRAILING_WORDS, '').trim();
    // 出典を除いた本文側の先頭から「強みフレーズ」を 1 つ取り出す
    const body = strengthText.replace(PARENTHETICAL_TAIL, '').trim();
    const headline = truncate(body, TITLE_MAX_CHARS - category.length - 1);
    if (category && headline) {
      return `${category}：${headline}`;
    }
    if (category) return category;
  }
  return truncate(strengthText, TITLE_MAX_CHARS);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
