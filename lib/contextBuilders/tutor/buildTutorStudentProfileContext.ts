// 受験チューターAI 用 StudentProfile の compact section を作る純粋関数。
//
// 含める:
//   - summary（1 段落そのまま）
//   - strengths か weaknesses のどちらか 1 件（両方同時には出さない）
//   - futureConnections（intent='general' または 'statement' 時のみ 1 件）
//   - valueKeywords（上位 3 件 optional）
// 含めない:
//   - generatedAt / sourceHash / version（メタデータ）
//   - signatureEpisodes（重い、tutor 用途では不要）
//   - applicantType ラベル名（「活動実績型」等、SYSTEM PROMPT 規約により出力禁止）
//   - 配列インデックス・日付・数値（監視感防止）
//
// preferredProfileField がある場合はそれを優先、無ければ default は 'strengths'。
// 指定 field が空配列なら、もう一方を fallback として 1 件試す（両方同時には出さない）。
// intent='stabilize' のとき: summary のみ。strengths/weaknesses/futureConnections/valueKeywords を出さない。
//
// 入力欠損・型不一致時は throw せず空文字を返す。
//
// 関連: [types/studentProfile.ts](../../../types/studentProfile.ts)（canonical 型）
//       [lib/tutor/types.ts](../../tutor/types.ts)（PreferredProfileField）

import type { TutorIntent, PreferredProfileField } from '@/lib/tutor/types';
import {
  MAX_PROFILE_ITEM_LENGTH,
  MAX_FUTURE_CONNECTION_LENGTH,
  MAX_VALUE_KEYWORDS,
  MAX_SIGNATURE_EPISODES,
  MAX_SIGNATURE_EPISODE_TITLE_LENGTH,
} from './types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed === '') continue;
    out.push(trimmed);
  }
  return out;
}

// v1.1 STEP17: signatureEpisodes の title のみを安全に取り出す helper。
// canonical SignatureEpisode は { title, summary, relatedStrengthIdx } を持つが、
// 本層では **title のみ** を context に出す（summary は監視感が高すぎる）。
// 配列でない / object でない / title が string でない場合は defensive に scope 外。
function safeSignatureEpisodeTitles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const title = (item as { title?: unknown }).title;
    if (typeof title !== 'string') continue;
    const trimmed = title.trim();
    if (trimmed === '') continue;
    out.push(trimmed);
  }
  return out;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

export function buildTutorStudentProfileContext(
  profile: unknown,
  options: { intent: TutorIntent; preferredProfileField?: PreferredProfileField },
): string {
  if (!isPlainObject(profile)) return '';

  const summary = safeString(profile.summary);

  // stabilize は summary のみ（分析材料を渡さない）
  if (options.intent === 'stabilize') {
    if (!summary) return '';
    return ['【自己分析サマリー】', summary].join('\n');
  }

  const strengths = safeStringArray(profile.strengths);
  const weaknesses = safeStringArray(profile.weaknesses);
  const futureConnections = safeStringArray(profile.futureConnections);
  const valueKeywords = safeStringArray(profile.valueKeywords);

  const lines: string[] = [];
  if (summary) lines.push(summary);

  // strengths / weaknesses のどちらか 1 件
  // preferredProfileField 指定があればそれを優先、指定 field が空なら他方を fallback
  const preferred = options.preferredProfileField ?? 'strengths';
  let pickedLine = '';
  if (preferred === 'weaknesses') {
    if (weaknesses.length > 0) {
      pickedLine = `弱み: ${truncate(weaknesses[0], MAX_PROFILE_ITEM_LENGTH)}`;
    } else if (strengths.length > 0) {
      pickedLine = `強み: ${truncate(strengths[0], MAX_PROFILE_ITEM_LENGTH)}`;
    }
  } else {
    // preferred === 'strengths'（undefined 既定値も含む）
    if (strengths.length > 0) {
      pickedLine = `強み: ${truncate(strengths[0], MAX_PROFILE_ITEM_LENGTH)}`;
    } else if (weaknesses.length > 0) {
      pickedLine = `弱み: ${truncate(weaknesses[0], MAX_PROFILE_ITEM_LENGTH)}`;
    }
  }
  if (pickedLine) lines.push(pickedLine);

  // futureConnections は general / statement 時のみ 1 件
  if (
    (options.intent === 'general' || options.intent === 'statement') &&
    futureConnections.length > 0
  ) {
    lines.push(`将来の方向: ${truncate(futureConnections[0], MAX_FUTURE_CONNECTION_LENGTH)}`);
  }

  // valueKeywords は上位 3 件まで（全 intent で許容、optional）
  if (valueKeywords.length > 0) {
    lines.push(`価値観キーワード: ${valueKeywords.slice(0, MAX_VALUE_KEYWORDS).join(' / ')}`);
  }

  // v1.1 STEP17 追加: signatureEpisodes の title を 1 件だけ inline で出力する。
  // 「経験テーマ: <title>」形式で、summary / detail / 関連 idx は出さない設計。
  // 監視感を最小化するため:
  //   - MAX_SIGNATURE_EPISODES=1 で 1 件のみ
  //   - title は 20 字以内に truncate（builder 側 defense）
  //   - 「以前」「前回」「あなたは〜していた」型を AI 側で SYSTEM PROMPT が抑制
  const signatureEpisodeTitles = safeSignatureEpisodeTitles(profile.signatureEpisodes);
  if (signatureEpisodeTitles.length > 0) {
    lines.push(
      `経験テーマ: ${truncate(signatureEpisodeTitles[0], MAX_SIGNATURE_EPISODE_TITLE_LENGTH)}`,
    );
    // MAX_SIGNATURE_EPISODES の export を保持しつつ、現在は使用箇所が slice の上限
    // としては不要（最初の 1 件のみ採用）。type level 制限の root にあたる定数として
    // types.ts に置いてあり、将来 N 件以上に拡張する STEP がある場合に slice を導入する。
    void MAX_SIGNATURE_EPISODES;
  }

  if (lines.length === 0) return '';

  return ['【自己分析サマリー】', ...lines].join('\n');
}
