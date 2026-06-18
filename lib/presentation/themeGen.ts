import 'server-only';

import { anthropic, extractJson } from '@/lib/ai';
import { logAiUsage } from '@/lib/aiUsageLog';
import {
  PRESENTATION_EVAL_MODEL,
  PRESENTATION_THEME_ANGLES,
  PRESENTATION_THEME_CONDITIONS_MAX,
  PRESENTATION_THEME_CONDITIONS_MIN,
  PRESENTATION_THEME_LOG_ROUTE,
  PRESENTATION_THEME_MAX_TOKENS,
  PRESENTATION_THEME_QUESTIONS_MAX,
  PRESENTATION_THEME_QUESTIONS_MIN,
  PRESENTATION_THEME_TEMPERATURE,
} from './constants';
import type { GeneratedTheme } from './universitySelection';

// angle key → 候補（label / guidance 参照用）。
const ANGLE_BY_KEY = new Map(PRESENTATION_THEME_ANGLES.map((a) => [a.key, a]));

// 既出 angle を避けて 1 つ選ぶ（多様性の主機構）。全て既出なら全候補から選ぶ。
function pickAngle(
  excludeAngles: string[],
): { key: string; label: string; guidance: string } {
  const excluded = new Set(excludeAngles);
  const fresh = PRESENTATION_THEME_ANGLES.filter((a) => !excluded.has(a.key));
  const pool = fresh.length > 0 ? fresh : PRESENTATION_THEME_ANGLES;
  // route 実行（非 Workflow）なので Math.random は使用可。回転で方向を散らす。
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx] ?? PRESENTATION_THEME_ANGLES[0];
}

/**
 * STEP-PRESENTATION-THEME-MODE: AI 即興テーマ生成。
 *
 * 大学選択画面の手入力情報のみを使い、総合型選抜・学校推薦型選抜を意識した
 * 発表テーマ・発表条件・想定質問を生成する。外部検索はしない。
 *
 * 重要: logAiUsage のみ。recordUsage は呼ばない（課金は evaluate 初回成功時のみ）。
 */

export class ThemeGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThemeGenerationError';
  }
}

export type ThemeGenInput = {
  universityName: string;
  facultyName: string;
  departmentName: string;
  admissionType: string;
  presentationFormat: string;
  limitMinutes: string;
  notes: string;
  excludeThemes: string[];
  // 直近で出た「切り口（angle）」key。server が回転で避けて多様性を担保する。
  excludeAngles: string[];
};

// angle key の一覧（system prompt に列挙して AI に echo させる）。
const ANGLE_KEYS = PRESENTATION_THEME_ANGLES.map((a) => a.key).join(' / ');

const SYSTEM_PROMPT = [
  'あなたは大学入試（総合型選抜・学校推薦型選抜）のプレゼン課題を作問する専門家です。',
  '受験生の志望情報をもとに、本番の総合型・推薦入試で実際に出題されうるプレゼンテーマを1つ作ってください。',
  '出力は次の JSON オブジェクト **のみ**（前後の説明文・コードフェンスなし）:',
  '{',
  '  "theme": string,            // プレゼンテーマ（1 文。具体的で議論の余地があるもの）',
  `  "angle": string,            // 指定された切り口の key をそのまま echo（候補: ${ANGLE_KEYS}）`,
  `  "conditions": string[],     // 発表条件（${PRESENTATION_THEME_CONDITIONS_MIN}〜${PRESENTATION_THEME_CONDITIONS_MAX}個。例: 「5分で発表」「具体例を1つ」「課題→原因→提案→効果の順」）`,
  `  "questions": string[]       // 発表後の想定質問（${PRESENTATION_THEME_QUESTIONS_MIN}〜${PRESENTATION_THEME_QUESTIONS_MAX}個。深掘り質問）`,
  '}',
  '【テーマの方針（厳守）】',
  '- 指定された「今回の切り口」を必ず反映し、その方向のテーマにする。出力の angle にはその切り口 key を入れる。',
  '- 志望学部・学科・入試方式の特徴を反映し、その分野の受験生が論じやすいテーマにする。学部との接続は不自然にこじつけず自然に行う。',
  '- 必ず具体的な「対象・課題・論点」を含める。抽象的すぎるテーマ・スローガン的なテーマは禁止。',
  '- 発表者が賛否の立場や具体的な提案を語れるテーマにする（事実紹介だけで終わらないもの）。',
  '- 高校生が5〜7分で発表できる粒度にする（壮大すぎず、狭すぎない）。',
  '- 大学名をテーマ名に無理に入れない。',
  '【多様性（厳守）】',
  '- 「SNS活用」「地域活性化」など特定の定番に寄りすぎない。',
  '- 既出テーマと、語尾・問題設定・対象者・解決策・取り上げる業界/分野・多用キーワードのいずれも重ねない。言い換えただけの実質同一テーマは禁止。',
  '- 例: 前回「地域商店街が若者客を増やすためにSNSをどう活用すべきか」→ NG「商店街がSNSで集客する方法」/ OK「観光地のオーバーツーリズムに対し地域経済と住民生活をどう両立させるか」。',
  '【安全性（厳守）】',
  '- 外部の最新情報は参照しない。実在しない入試情報・募集要項の内容を事実として断定しない。',
  '- 政治的・宗教的に極端に偏ったテーマ、差別的・過激・炎上を招きやすいテーマは禁止。',
  '- 医療・法律・投資など、専門家の判断を要する個別的な是非をユーザーに求めるテーマは禁止。',
  '- 条件・質問は実際の発表内容に踏み込んだ具体的なものにし、一般論の羅列にしない。空配列・空文字は禁止。',
].join('\n');

function buildUserPrompt(
  input: ThemeGenInput,
  angle: { key: string; label: string; guidance: string },
): string {
  const parts = [
    input.universityName.trim() && `大学名: ${input.universityName.trim()}`,
    input.facultyName.trim() && `学部名: ${input.facultyName.trim()}`,
    input.departmentName.trim() && `学科名: ${input.departmentName.trim()}`,
    input.admissionType.trim() && `入試方式: ${input.admissionType.trim()}`,
    input.presentationFormat.trim() && `プレゼン形式: ${input.presentationFormat.trim()}`,
    input.limitMinutes.trim() && `制限時間: ${input.limitMinutes.trim()} 分`,
    input.notes.trim() && `備考: ${input.notes.trim()}`,
  ].filter(Boolean);

  const angleInstruction = `\n\n今回の切り口（必ずこの方向で作る。出力 angle にはこの key を入れる）:\n- key: ${angle.key}\n- 方向: ${angle.label} … ${angle.guidance}`;

  const exclude =
    input.excludeThemes.length > 0
      ? `\n\n既に提示したテーマ（語尾・問題設定・対象者・解決策・業界・キーワードのいずれも重ねず、明確に異なるテーマにする）:\n${input.excludeThemes
          .map((t, i) => `${i + 1}. ${t}`)
          .join('\n')}`
      : '';

  return (
    `志望情報:\n${parts.join('\n') || '（情報が少ないため、汎用的だが総合型選抜らしいテーマにする）'}` +
    angleInstruction +
    exclude +
    `\n\n上記をもとにプレゼンテーマ JSON を出力してください。`
  );
}

function cleanList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const t = item.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export async function generatePresentationTheme(
  input: ThemeGenInput,
): Promise<GeneratedTheme> {
  // 既出 angle を避けて今回の切り口を選ぶ（多様性の主機構）。
  const chosenAngle = pickAngle(input.excludeAngles);

  let response;
  try {
    response = await anthropic.messages.create({
      model: PRESENTATION_EVAL_MODEL,
      max_tokens: PRESENTATION_THEME_MAX_TOKENS,
      // 多様性優先。JSON 安定性は厳格 prompt + angle 回転で担保し top_p は既定のまま。
      temperature: PRESENTATION_THEME_TEMPERATURE,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(input, chosenAngle) }],
    });
  } catch {
    logAiUsage({ route: PRESENTATION_THEME_LOG_ROUTE, model: PRESENTATION_EVAL_MODEL, status: 'failed' });
    throw new ThemeGenerationError('theme-generation-failed');
  }

  if (response.stop_reason === 'max_tokens') {
    logAiUsage({
      route: PRESENTATION_THEME_LOG_ROUTE,
      model: PRESENTATION_EVAL_MODEL,
      status: 'truncated',
      usage: response.usage,
    });
    throw new ThemeGenerationError('theme-truncated');
  }

  const text = (response.content as Array<{ type: string; text?: string }>)
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    logAiUsage({
      route: PRESENTATION_THEME_LOG_ROUTE,
      model: PRESENTATION_EVAL_MODEL,
      status: 'parse_failed',
      usage: response.usage,
    });
    throw new ThemeGenerationError('theme-parse-failed');
  }

  const obj = (parsed ?? {}) as Record<string, unknown>;
  const theme = typeof obj.theme === 'string' ? obj.theme.trim() : '';
  const conditions = cleanList(obj.conditions, PRESENTATION_THEME_CONDITIONS_MAX);
  const questions = cleanList(obj.questions, PRESENTATION_THEME_QUESTIONS_MAX);
  if (
    !theme ||
    conditions.length < PRESENTATION_THEME_CONDITIONS_MIN ||
    questions.length < PRESENTATION_THEME_QUESTIONS_MIN
  ) {
    logAiUsage({
      route: PRESENTATION_THEME_LOG_ROUTE,
      model: PRESENTATION_EVAL_MODEL,
      status: 'parse_failed',
      usage: response.usage,
    });
    throw new ThemeGenerationError('theme-quality-failed');
  }

  // angle 解決: AI が有効な key を echo していればそれを採用、なければ server 選択値に倒す。
  const aiAngle = typeof obj.angle === 'string' ? obj.angle.trim() : '';
  const resolvedKey = ANGLE_BY_KEY.has(aiAngle) ? aiAngle : chosenAngle.key;
  const angleLabel = ANGLE_BY_KEY.get(resolvedKey)?.label ?? chosenAngle.label;

  logAiUsage({
    route: PRESENTATION_THEME_LOG_ROUTE,
    model: PRESENTATION_EVAL_MODEL,
    status: 'success',
    usage: response.usage,
  });
  // selectedAngleKey は「サーバが実際に選んだ切り口」。AI の echo（resolvedKey）とズレても、
  // client が両方を除外に積めるよう別フィールドで返す（次回の回転精度を上げる）。
  return {
    theme,
    conditions,
    questions,
    angle: resolvedKey,
    selectedAngleKey: chosenAngle.key,
    angleLabel,
  };
}
