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

import { djb2 } from '@/lib/hash/djb2';
import type { WallHittingResult } from '@/types/analysis';
import type {
  SignatureEpisode,
  StudentProfile,
} from '@/types/studentProfile';
// STEP-DIVERGENCE-03A: VALUE_KEYWORD_MAP を共有辞書へ lift（single source of truth）。
// ThemeFrequency builder と本ファイルの extractValueKeywords が同一辞書を参照する。
// 辞書の値は不変のため valueKeywords 出力は byte-identical（後方互換維持）。
import { VALUE_KEYWORD_MAP } from '@/lib/contextBuilders/divergence/themeDictionary';

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
      // applicantType は hash 入力に含めない（STEP B の最小 passthrough 方針）。
      // AI 出力の同一 input は同一 applicantType を返す前提で、redundant 再保存より
      // hash 入力構造の安定を優先する。将来 mismatch が観測されたら別 STEP で見直す。
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
    // STEP B: WallHittingResult.applicantType（route 側で validate 済み）をそのまま流す。
    // undefined はそのまま undefined のまま保持される。
    applicantType: wallHitting.applicantType,
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

// 再生成判定用の sourceHash を作る。
// 入力 unknown を JSON.stringify(_ ?? null) で文字列化してから lib/hash/djb2 を通す。
// STEP-D で djb2 本体は lib/hash/djb2.ts に集約済み（同入力で hash 値は不変）。
function hashSourceContent(input: unknown): string {
  return djb2(JSON.stringify(input ?? null));
}

// ── valueKeywords ──────────────────────────────────────────────────
//
// 下流が「strengths 全文を毎回 AI に読ませる」のを避けるため、価値観タグだけ抽出して渡す。
// 抽出は deterministic（辞書ベース）。AI は使わない。最初は単純実装で OK。
// STEP-DIVERGENCE-03A: 辞書本体（VALUE_KEYWORD_MAP）は
// lib/contextBuilders/divergence/themeDictionary.ts に lift 済み（import 済み）。
// 本ファイルは presence 抽出ロジックのみ保持する。

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
