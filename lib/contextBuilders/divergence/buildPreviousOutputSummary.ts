// PreviousOutputSummary Builder（Divergence Layer v1 / Statement Review 用）。
//
// 役割:
//   志望理由書添削の保存履歴（statementReviewHistory）の compact projection を受け取り、
//   「過去に繰り返し提示済みの助言・論点」を決定論的に抽出する。出力収束（毎回同じ弱点・
//   同じ改善アクション・同じ論点）を抑えるための divergence context の素材になる。
//
// 設計方針（厳守）:
//   - pure 関数。throw しない。
//   - AI 呼び出し / fetch / localStorage 直接参照 / Supabase 参照なし。
//   - Date / Math.random を使わない（同入力 → 同出力。input hash の安定性を保つため）。
//   - 入力は unknown で受け、内部で defensive に shape guard する
//     （client から JSON 越しに渡る生データのため）。
//   - 本文・スコア・大学名・日付などは一切読まない。caller 側の projection が
//     weaknesses / actions / strengths の短文だけを載せている前提だが、builder 側でも
//     その 3 field しか参照しない。
//
// 抽出ルール:
//   - repeatedAdvice ← weaknesses[] + actions[] の出現頻度上位
//   - repeatedThemes ← strengths[] の出現頻度上位
//   - recordsConsidered < 2 なら反復が定義できないので両配列とも空で返す
//   - 出現回数の多い順（=反復しているもの）を優先し、cap 件数まで採る
//
// 関連:
//   - types/divergence.ts (PreviousOutputSummary)
//   - lib/statement/review/statementPrompt.ts (buildPreviousOutputSummarySection / consumer)
//   - app/statement/edit/page.tsx (projection を作って本 builder を呼ぶ caller)

import type { PreviousOutputSummary } from '@/types/divergence';

// ── 定数 ─────────────────────────────────────────────────────────
// 反復が定義できる最小レコード数。これ未満なら空で返す。
const MIN_RECORDS = 2;
// 1 項目あたりの最大文字数（超過は切り詰め）。
const MAX_ITEM_LENGTH = 50;
// 各配列の最大件数。
const MAX_ADVICE = 4;
const MAX_THEMES = 3;
// 出力全体（repeatedAdvice + repeatedThemes を連結した）文字数の上限。
// 超えた分は末尾の項目から落とす（prompt 肥大化の最終ガード）。
const MAX_TOTAL_LENGTH = 400;

// ── shape guard（tutorStudentContext と同方式）─────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

// string 配列として安全に読む。string 以外を除外し、trim して空文字を落とす。
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

// 文字列群を「出現頻度降順（多い=反復しているものを優先）」に並べ替えて dedup する。
// 同頻度は初出順を保つ（決定論）。各項目は truncate 済みのキーで集計する。
function rankByFrequency(items: string[], maxCount: number): string[] {
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let order = 0;
  for (const raw of items) {
    const key = truncate(raw, MAX_ITEM_LENGTH);
    if (key === '') continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!firstSeen.has(key)) {
      firstSeen.set(key, order);
      order += 1;
    }
  }

  return Array.from(counts.keys())
    .sort((a, b) => {
      const diff = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
      if (diff !== 0) return diff; // 頻度降順（反復しているものを優先）
      return (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0); // 同頻度は初出順
    })
    .slice(0, maxCount);
}

// repeatedAdvice + repeatedThemes の合計文字数が cap を超えたら、末尾項目から落とす。
// advice を theme より優先して残す（advice の方が divergence 効果が高いため）。
function enforceTotalCap(
  advice: string[],
  themes: string[],
): { repeatedAdvice: string[]; repeatedThemes: string[] } {
  let budget = MAX_TOTAL_LENGTH;
  const keptAdvice: string[] = [];
  for (const item of advice) {
    if (budget - item.length < 0) break;
    keptAdvice.push(item);
    budget -= item.length;
  }
  const keptThemes: string[] = [];
  for (const item of themes) {
    if (budget - item.length < 0) break;
    keptThemes.push(item);
    budget -= item.length;
  }
  return { repeatedAdvice: keptAdvice, repeatedThemes: keptThemes };
}

// ── 主 entry ─────────────────────────────────────────────────────

// input: statementReviewHistory の compact projection（配列）を想定。
//   各要素は { weaknesses?: string[]; actions?: string[]; strengths?: string[] } 形。
//   それ以外の形 / null / 壊れたデータは defensive に skip する。
export function buildPreviousOutputSummary(input: unknown): PreviousOutputSummary {
  const empty = (recordsConsidered: number): PreviousOutputSummary => ({
    repeatedAdvice: [],
    repeatedThemes: [],
    basis: { recordsConsidered },
  });

  if (!Array.isArray(input)) return empty(0);

  // 有効な record（object）だけを「考慮したレコード」として数える。
  const records: Record<string, unknown>[] = [];
  for (const item of input) {
    const rec = asRecord(item);
    if (rec) records.push(rec);
  }

  // 反復は 2 件以上で初めて定義できる。1 件以下なら空（履歴 0 / 1 件 → section なし）。
  if (records.length < MIN_RECORDS) return empty(records.length);

  const adviceItems: string[] = [];
  const themeItems: string[] = [];
  for (const rec of records) {
    adviceItems.push(...toStringArray(rec.weaknesses));
    adviceItems.push(...toStringArray(rec.actions));
    themeItems.push(...toStringArray(rec.strengths));
  }

  const repeatedAdvice = rankByFrequency(adviceItems, MAX_ADVICE);
  const repeatedThemes = rankByFrequency(themeItems, MAX_THEMES);
  const capped = enforceTotalCap(repeatedAdvice, repeatedThemes);

  return {
    repeatedAdvice: capped.repeatedAdvice,
    repeatedThemes: capped.repeatedThemes,
    basis: { recordsConsidered: records.length },
  };
}
