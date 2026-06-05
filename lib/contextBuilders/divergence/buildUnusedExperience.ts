// UnusedExperience Builder（Divergence Layer / UnusedExperience v1 / Self PR 用）。
//
// 役割:
//   activityData の「活動カード」単位で、ユーザーがまだ application 成果物で触れていない可能性の
//   ある経験を deterministic に検出する。同じ経験ばかり使い回す収束を抑え、まだ活用できる経験を
//   探索 suggestion として提示するための素材。
//
// ThemeFrequency との責務境界（厳守）:
//   - ThemeFrequency は「テーマ（抽象的資質）の偏り」。本 builder は「経験（具体的活動カード）の偏り」。
//     単位も判定方法も別（テーマ頻度 vs 経験の使用/未使用）。
//
// 設計方針（厳守）:
//   - pure 関数。throw しない。AI / fetch / localStorage / Supabase / Date / Math.random なし。
//   - 入力は unknown で受け、内部で defensive に shape guard する。
//   - feature 非依存: 入力は { activityData, usedText }。usedText（使用面の連結文字列）の組み立ては
//     呼び出し側（caller）が担う。AI 出力を usedText に含めないのは caller の責務。
//   - 使用判定は distinctive identifier の substring 一致（AI 不使用）。複数 identifier は OR 判定。
//   - false-unused（言い換え参照で identifier が literal に出ない）を完全には防げない前提で設計する
//     → 出力は「未使用」断定ではなく探索 suggestion（section / prompt 側で框組み）。
//
// 関連: types/divergence.ts (UnusedExperience) / unusedExperienceSection.ts (consumer)

import type { UnusedExperience } from '@/types/divergence';

// 上位 N 件 cap（token 抑制）。
const MAX_UNUSED = 5;
// identifier の最小長。短すぎる generic 語の trivial 一致を避ける。
const MIN_IDENTIFIER_LENGTH = 2;

// activityData の各カテゴリ key → 表示ラベル / distinctive identifier 候補 / title field。
// identifierFields は OR 判定（どれか 1 つでも usedText に一致すれば used）。
// 先頭ほど distinctive（proper-noun 寄り）。volunteer / partTimeJob は generic 寄りで低信頼。
type CategorySpec = { label: string; identifierFields: string[]; titleField: string };
const CATEGORY_SPECS: Record<string, CategorySpec> = {
  clubActivities:        { label: '部活動',       identifierFields: ['clubName', 'sport'],          titleField: 'clubName' },
  volunteerActivities:   { label: 'ボランティア', identifierFields: ['activityContent', 'target'],  titleField: 'activityContent' },
  studyAbroadActivities: { label: '留学',         identifierFields: ['destination', 'programContent'], titleField: 'destination' },
  researchActivities:    { label: '探究',         identifierFields: ['theme', 'trigger'],           titleField: 'theme' },
  partTimeJobActivities: { label: 'アルバイト',   identifierFields: ['industry', 'jobContent'],     titleField: 'industry' },
  certificationActivities: { label: '資格',       identifierFields: ['certificationName'],          titleField: 'certificationName' },
  contestActivities:     { label: 'コンテスト',   identifierFields: ['contestName', 'field'],       titleField: 'contestName' },
  readingActivities:     { label: '読書',         identifierFields: ['favoriteBook', 'genre'],      titleField: 'favoriteBook' },
  hobbyActivities:       { label: '趣味',         identifierFields: ['hobbyContent'],               titleField: 'hobbyContent' },
  otherActivities:       { label: 'その他',       identifierFields: ['activityName'],               titleField: 'activityName' },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildUnusedExperience(
  input: { activityData?: unknown; usedText?: unknown },
): UnusedExperience {
  const usedText = typeof input?.usedText === 'string' ? input.usedText : '';
  const activities = asRecord(input?.activityData);

  const unused: { id: string; title: string; category: string }[] = [];
  const seenIds = new Set<string>();
  let totalExperiences = 0;
  let usedExperiences = 0;

  if (activities) {
    for (const [key, spec] of Object.entries(CATEGORY_SPECS)) {
      const arr = activities[key];
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        const rec = asRecord(item);
        if (!rec) continue;

        // distinctive identifier を抽出（trim・string 以外除外・短すぎる generic 語除外）。
        const identifiers = spec.identifierFields
          .map((f) => toTrimmedString(rec[f]))
          .filter((s) => s.length >= MIN_IDENTIFIER_LENGTH);
        // 判定可能な identifier が無いカードは used/unused どちらにも数えない（誤提案を避ける）。
        if (identifiers.length === 0) continue;

        totalExperiences += 1;

        // OR 判定: どれか 1 つでも usedText に出れば used。
        const isUsed = identifiers.some((id) => usedText.includes(id));
        if (isUsed) {
          usedExperiences += 1;
          continue;
        }

        const titleRaw = toTrimmedString(rec[spec.titleField]);
        const title = titleRaw.length >= MIN_IDENTIFIER_LENGTH ? titleRaw : identifiers[0];
        const id = `${key}:${title}`;
        if (seenIds.has(id)) continue; // 同一 id（同名活動）の重複提案を避ける
        seenIds.add(id);
        unused.push({ id, title, category: spec.label });
      }
    }
  }

  return {
    unused: unused.slice(0, MAX_UNUSED),
    basis: { totalExperiences, usedExperiences },
  };
}
