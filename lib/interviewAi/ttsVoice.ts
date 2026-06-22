import 'server-only';

/**
 * STEP-INTERVIEW-AI-TTS-VOICE: モード別の読み上げ（TTS）デリバリ方針。
 *
 * 役割:
 *   - 5 つの面接モードごとに「どんな話し方で読み上げるか」を 1 か所に集約する。
 *   - gpt-4o-mini-tts の `instructions`（話し方の system prompt 相当）で口調・テンポ・間を指示し、
 *     `speed`（再生速度）を補助的に変える。**voice（声そのもの）はモードで変えない**
 *     （声の妥当性リスクを避け、人格表現は instructions に寄せる。voice は env で全体上書き可能）。
 *
 * 安全ガード（最優先・全モード共通）:
 *   - 圧迫面接モードでも、人格否定・暴言・侮辱・嘲笑・叫び・脅しの口調にはしない。
 *     威圧感は「低め・短め・間を置く」程度に留め、声を荒げない（質問文側で厳しさを表現する方針と整合）。
 *   - 読み上げはあくまで AI 質問テキストの代読。テキストに無い内容を足して喋らせない。
 *
 * 失敗時:
 *   - instructions は gpt-4o-mini 系（=ステアリング対応モデル）のときだけ付与する。
 *     旧モデル（tts-1 等）を env で固定した場合は instructions を送らない（API エラー回避）。
 */

import type { InterviewType } from '@/lib/interviewAi/interviewTypes';

export type TtsDelivery = {
  // 再生速度。OpenAI TTS の許容範囲 [0.25, 4.0]。早口すぎない範囲で微調整する。
  speed: number;
  // gpt-4o-mini-tts の話し方指示（口調・テンポ・間・感情）。日本語で簡潔に。
  instructions: string;
};

// 全モード共通の土台。面接官として落ち着いて明瞭に、ニュースキャスターのように整った発話。
const COMMON =
  '日本語で、日本の大学入試の面接官として話す。明瞭で聞き取りやすく、自然な抑揚をつける。' +
  '叫ばない・早口にしない・棒読みにしない。質問文だけを読み上げ、余計な言葉を足さない。';

// モード別の話し方（ユーザー要件のキャラクター定義に対応）。
const DELIVERY: Record<InterviewType, TtsDelivery> = {
  // ① 自己分析ベース：優しいキャリアアドバイザー。落ち着いて寄り添い、安心感を与え、ゆっくり話す。
  self_analysis: {
    speed: 0.92,
    instructions:
      `${COMMON} 役柄は優しいキャリアアドバイザー。穏やかで温かい口調。受験生に寄り添い、` +
      '安心感を与えるように、ゆっくりと丁寧に話す。急かさない。',
  },
  // ② 志望理由書ベース：大学教員。論理的・丁寧・少しフォーマル。
  statement: {
    speed: 0.95,
    instructions:
      `${COMMON} 役柄は大学の教員。論理的で丁寧、少しフォーマルな口調。落ち着いて理知的に、` +
      '言葉を選びながら話す。',
  },
  // ③ 小論文ベース：口頭試問の先生。知的で少しテンポ速め、思考を促す。
  essay: {
    speed: 1.0,
    instructions:
      `${COMMON} 役柄は口頭試問の先生。知的で歯切れがよく、ややテンポは速め。` +
      '受験生に考えを促すように、問いかけを明確に話す。',
  },
  // ④ 本番モード：実際の大学面接官。自然・少し緊張感・テンポ普通。
  free: {
    speed: 1.0,
    instructions:
      `${COMMON} 役柄は本番の大学面接官。自然で落ち着いた口調。過度に優しくも厳しくもせず、` +
      '本番らしい程よい緊張感を保ち、普通のテンポで丁寧に話す。',
  },
  // ⑤ 圧迫面接モード：厳しい面接官。低め・短文・間を作る。ただし威圧しすぎない（暴言・侮辱は厳禁）。
  pressure: {
    speed: 0.95,
    instructions:
      `${COMMON} 役柄は少し厳しい面接官。トーンはやや低め、口調は淡々として短く、` +
      '所々で軽く間を置く。冷静で淡々とした厳しさに留め、声を荒げない。' +
      '人格否定・暴言・侮辱・嘲笑・脅しの口調は絶対にしない（厳しさは控えめな低い声と間で表現する）。',
  },
};

/**
 * 面接タイプに対応する読み上げデリバリ（速度 + 話し方指示）を返す。
 * 未知 / 未指定は本番モード（free）の自然な口調にフォールバックする。
 */
export function ttsDeliveryFor(type: InterviewType | null | undefined): TtsDelivery {
  if (type && type in DELIVERY) return DELIVERY[type];
  return DELIVERY.free;
}
