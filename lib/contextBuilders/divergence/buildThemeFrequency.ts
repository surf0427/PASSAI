// ThemeFrequency Builder（Divergence Layer / ThemeFrequency v1 / Statement Review 用）。
//
// 役割:
//   ユーザーが繰り返し使っているテーマ（主体性 / 挑戦 / 国際性 …）の偏りを、
//   activityData + StudentProfile から決定論的に集計する。出力収束（同じテーマへの偏り）を
//   可視化し、まだ薄い／未探索テーマの観点も改善提案で検討できるようにするための素材。
//
// PreviousOutputSummary との責務境界（厳守）:
//   - source は activityData + StudentProfile（ユーザー記述 / canonical persona）のみ。
//     AI review 出力（statementReviewHistory 等）は **絶対に集計しない**
//     （PreviousOutputSummary の source と分離し二重計上を防ぐ）。
//
// 設計方針（厳守）:
//   - pure 関数。throw しない。AI / fetch / localStorage / Supabase / Date / Math.random なし。
//   - 入力は unknown で受け、内部で defensive に shape guard する。
//   - count は document-frequency（1 document あたり theme は最大 +1）。term-frequency にしない
//     （長文の語反復による偏り増幅を避ける）。
//   - 全 theme（VALUE_KEYWORD_MAP 全件）を count 0 含めて保持する（未探索テーマこそが探索 signal）。
//
// 辞書: lib/contextBuilders/divergence/themeDictionary.ts（valueKeywords と同一・single source）。
// 関連: types/divergence.ts (ThemeFrequency) / themeFrequencySection.ts (consumer)

import type { ThemeFrequency } from '@/types/divergence';
import { VALUE_KEYWORD_MAP } from '@/lib/contextBuilders/divergence/themeDictionary';

// underused に載せる最大件数（token / noise 抑制）。
const MAX_UNDERUSED = 5;

// ── shape guard ──────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

// 任意の値から string leaf を再帰収集する（unknown-safe）。
// document の haystack を作るために使う。キー名は拾わない（値のみ）ので、
// field 名由来の誤マッチ（"description" 等）は起きない。
function collectStrings(value: unknown, acc: string[]): void {
  if (typeof value === 'string') {
    const t = value.trim();
    if (t !== '') acc.push(t);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, acc);
    return;
  }
  const rec = asRecord(value);
  if (rec) {
    for (const v of Object.values(rec)) collectStrings(v, acc);
  }
}

// ── document 収集 ────────────────────────────────────────────────
//
// document = 「ユーザーが書いた / 人物を表す 1 単位」。各 document を 1 本の haystack 文字列にする。
//   - StudentProfile.summary            → 1 document
//   - StudentProfile.strengths[i]       → 各 1 document
//   - StudentProfile.futureConnections[i] → 各 1 document
//   - activityData の各活動              → 各 1 document（その活動の全 string leaf を連結）

function collectDocuments(activityData: unknown, studentProfile: unknown): string[] {
  const documents: string[] = [];

  // StudentProfile 側（canonical persona）
  const profile = asRecord(studentProfile);
  if (profile) {
    if (typeof profile.summary === 'string' && profile.summary.trim() !== '') {
      documents.push(profile.summary.trim());
    }
    for (const key of ['strengths', 'futureConnections'] as const) {
      const arr = profile[key];
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (typeof item === 'string' && item.trim() !== '') documents.push(item.trim());
        }
      }
    }
  }

  // activityData 側（ユーザー記述）: 各カテゴリ配列の各要素を 1 document にする。
  const activities = asRecord(activityData);
  if (activities) {
    for (const value of Object.values(activities)) {
      if (!Array.isArray(value)) continue;
      for (const activity of value) {
        const leaves: string[] = [];
        collectStrings(activity, leaves);
        if (leaves.length > 0) documents.push(leaves.join('\n'));
      }
    }
  }

  return documents;
}

// ── 主 entry ─────────────────────────────────────────────────────

export function buildThemeFrequency(
  input: { activityData?: unknown; studentProfile?: unknown },
): ThemeFrequency {
  const documents = collectDocuments(input?.activityData, input?.studentProfile);
  const documentsConsidered = documents.length;

  // 各 theme の document-frequency を数える（1 document あたり最大 +1）。
  const counts: { theme: string; count: number }[] = VALUE_KEYWORD_MAP.map(
    ({ tag, patterns }) => {
      let count = 0;
      for (const doc of documents) {
        if (patterns.some((p) => doc.includes(p))) count += 1; // document-frequency
      }
      return { theme: tag, count };
    },
  );

  // count 降順。同 count は VALUE_KEYWORD_MAP の元順を保つ（決定論）。
  const order = new Map(VALUE_KEYWORD_MAP.map((e, i) => [e.tag, i]));
  const themes = [...counts].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return (order.get(a.theme) ?? 0) - (order.get(b.theme) ?? 0);
  });

  // underused: count 0 の theme を優先。無ければ下位（count 昇順）から補完。
  const zero = themes.filter((t) => t.count === 0).map((t) => t.theme);
  const underused =
    zero.length > 0
      ? zero.slice(0, MAX_UNDERUSED)
      : [...themes]
          .reverse()
          .slice(0, MAX_UNDERUSED)
          .map((t) => t.theme);

  return {
    themes,
    underused,
    basis: { documentsConsidered },
  };
}
