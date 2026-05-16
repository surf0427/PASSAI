// AdmissionFocusInference を AI prompt 用 plain text に変換する pure function（STEP1c）。
//
// 責務:
// - inference を string に整形するだけ。DB アクセス・I/O・AI 呼び出しなし。
// - 出力は feature 横断で再利用可能な汎用フォーマット。prompt builder には依存しない。
//
// 設計方針:
// - scores は context に出さない（「点数診断サービス化したくない」方針）。
//   public 型に scores が無いので型レベルで保証されているが、
//   このファイル内でも scores という名前自体を扱わない。
// - 「断定」を避けるため、見出しは「推定」「重視されやすい」「危険視されやすい」を使用。
// - 3 つの state を区別する:
//     state A: primaryType === 'unknown' かつ signals が全部 false   → 空文字
//     state B: primaryType === 'unknown' だが signals に何かある    → fallback context
//     state C: primaryType !== 'unknown'                           → 通常 context
// - emphasis / risks は primary + secondary を merge し、重複排除して上限で truncate。
//
// 関連: lib/admissionFocus/types.ts / lib/admissionFocus/admissionFocusDefinitions.ts

import type {
  AdmissionFocusInference,
  AdmissionFocusSignals,
  AdmissionFocusType,
} from '@/lib/admissionFocus/types';
import { admissionFocusDefinitions } from '@/lib/admissionFocus/admissionFocusDefinitions';

const MAX_EMPHASIS = 6;
const MAX_RISKS = 5;
const MAX_REASONS = 5;
const MAX_SECONDARY_DISPLAY = 2;

// ── 共通 helper ──────────────────────────────────────────────────

function hasAnySignal(s: AdmissionFocusSignals): boolean {
  return (
    s.hasEssay ||
    s.interviewCount > 0 ||
    s.hasPresentation ||
    s.hasActivityReport ||
    s.hasAcademicCondition ||
    s.hasLanguageRequirement ||
    s.hasQualificationRequirement
  );
}

// signals → 人間向け文言。state B fallback と reason 補助に共用する内部 helper。
// inferAdmissionFocusType.ts の reasons 生成と語彙を意図的に揃えている。
function buildSignalReasonLines(s: AdmissionFocusSignals): string[] {
  const lines: string[] = [];
  if (s.hasEssay) lines.push('小論文系の選考が確認できる');
  if (s.interviewCount >= 2) {
    lines.push(`面接が複数回設定されている（${s.interviewCount}回）`);
  } else if (s.interviewCount === 1) {
    lines.push('面接が設定されている');
  }
  if (s.hasPresentation) lines.push('プレゼン・発表系の選考が確認できる');
  if (s.hasActivityReport) lines.push('活動報告・活動実績に関する記述がある');
  if (s.hasLanguageRequirement) lines.push('英語・語学系の資格条件が確認できる');
  if (s.hasAcademicCondition) lines.push('評定など学力面の条件が設定されている');
  if (s.hasQualificationRequirement && !s.hasLanguageRequirement) {
    lines.push('資格・条件付きの出願要件がある');
  }
  return lines;
}

function uniqueMerge(
  ...lists: readonly (readonly string[])[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const item of list) {
      const trimmed = item.trim();
      if (trimmed === '' || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

function buildBulletList(items: readonly string[], max: number): string {
  return items.slice(0, max).map((s) => `- ${s}`).join('\n');
}

function pickSecondaryTypesForDisplay(
  inference: AdmissionFocusInference,
): AdmissionFocusType[] {
  return inference.secondaryTypes
    .filter((t) => t !== 'unknown' && t !== inference.primaryType)
    .slice(0, MAX_SECONDARY_DISPLAY);
}

// ── state C (normal) のセクション組み立て ───────────────────────

function formatPrimaryHeader(inference: AdmissionFocusInference): string {
  const primaryLabel = admissionFocusDefinitions[inference.primaryType].label;
  const lines: string[] = ['【この入試の推定タイプ】', `主タイプ: ${primaryLabel}`];

  const secondaryLabels = pickSecondaryTypesForDisplay(inference).map(
    (t) => admissionFocusDefinitions[t].label,
  );
  if (secondaryLabels.length > 0) {
    lines.push(`副タイプ: ${secondaryLabels.join(' / ')}`);
  }
  return lines.join('\n');
}

function formatEmphasisBlock(inference: AdmissionFocusInference): string {
  const primaryEm = admissionFocusDefinitions[inference.primaryType].emphasis;
  const secondaryEms = pickSecondaryTypesForDisplay(inference).map(
    (t) => admissionFocusDefinitions[t].emphasis,
  );
  const merged = uniqueMerge(primaryEm, ...secondaryEms);
  if (merged.length === 0) return '';
  return ['【重視されやすい観点】', buildBulletList(merged, MAX_EMPHASIS)].join('\n');
}

function formatRisksBlock(inference: AdmissionFocusInference): string {
  const primaryRisks = admissionFocusDefinitions[inference.primaryType].risks;
  const secondaryRisks = pickSecondaryTypesForDisplay(inference).map(
    (t) => admissionFocusDefinitions[t].risks,
  );
  const merged = uniqueMerge(primaryRisks, ...secondaryRisks);
  if (merged.length === 0) return '';
  return ['【危険視されやすい点】', buildBulletList(merged, MAX_RISKS)].join('\n');
}

function formatReasonsBlock(inference: AdmissionFocusInference): string {
  if (inference.reasons.length === 0) {
    return ['【推定根拠】', '推定根拠は限定的です。'].join('\n');
  }
  return ['【推定根拠】', buildBulletList(inference.reasons, MAX_REASONS)].join('\n');
}

// ── state B (fallback) ──────────────────────────────────────────

function buildFallbackContext(signals: AdmissionFocusSignals): string {
  const reasonLines = buildSignalReasonLines(signals);
  // state B 前提では reasonLines は必ず 1 件以上ある（呼び出し側で hasAnySignal を確認済み）。
  // 防御的に 0 件なら空文字を返す。
  if (reasonLines.length === 0) return '';

  return [
    '【この入試の特徴】\n明確な型は推定できませんでした。',
    `ただし、以下の要素が確認できます：\n${buildBulletList(reasonLines, MAX_REASONS)}`,
    '【AIが注意すべきこと】\n断定的に「活動型」「小論文型」などと扱わず、\n確認できた選考要素に基づいて評価してください。',
  ].join('\n\n');
}

// state C 末尾に置く AI への注意文。STEP2f で追加。
// 目的: STEP2e で「小論文重視型」「国際型」等の型ラベルが AI 出力に literal 引用される
//       ケースが見られたため、型名そのものを引用せず観点として活用するよう促す。
// トーン: 強すぎないよう「強調せず」「自然に」と緩めに表現する。
// 長さ: 2 行（ヘッダ + 1 文）。context 全体への影響は最小限。
// state B fallback には既に【AIが注意すべきこと】があるため重複させない。
const STATE_C_AI_NOTE = `【AIへの注意】
型名そのものをフィードバック文中で強調せず、上記の観点を自然に評価へ反映してください。`;

// ── main ─────────────────────────────────────────────────────────

export function buildAdmissionFocusContext(
  inference: AdmissionFocusInference,
): string {
  if (inference.primaryType === 'unknown') {
    // state A: signals 全 false  → 空文字（DB 状態を AI に正直に伝える）
    // state B: signals に何かある → fallback context
    return hasAnySignal(inference.signals)
      ? buildFallbackContext(inference.signals)
      : '';
  }

  // state C: 通常 context
  const blocks: string[] = [formatPrimaryHeader(inference)];

  const emphasis = formatEmphasisBlock(inference);
  if (emphasis) blocks.push(emphasis);

  const risks = formatRisksBlock(inference);
  if (risks) blocks.push(risks);

  blocks.push(formatReasonsBlock(inference));
  blocks.push(STATE_C_AI_NOTE);

  return blocks.join('\n\n');
}
