import 'server-only';

/**
 * STEP-INTERVIEW-AI-TTS-VOICE: モード別の読み上げ（TTS）デリバリ方針。
 *
 * 役割:
 *   - 5 つの面接モードごとに「どの声で・どんな話し方で読み上げるか」を 1 か所に集約する。
 *   - `voice`（声そのもの）をモードのキャラクターに合わせて選ぶ。**面接官画像と性別を一致させる**
 *     （male.png を使う 4 モード = 男性/中性ボイス、pressure = 女性ボイス。interviewerAvatar.ts と整合）。
 *   - `instructions`（gpt-4o-mini-tts の話し方 system prompt 相当）で口調・テンポ・間を指示し、
 *     `speed`（再生速度）を補助的に変える。
 *   - voice / speed は env（INTERVIEW_AI_TTS_VOICE / _SPEED）で全体上書き可能（ops 優先）。
 *
 * 安全ガード（最優先・全モード共通）:
 *   - 圧迫面接モードでも、人格否定・暴言・侮辱・嘲笑・叫び・脅しの口調にはしない。
 *     厳しさは「回答の弱さ・論理の甘さへの指摘」に限り、声を荒げない（質問文側の厳しさ方針と整合）。
 *   - 読み上げはあくまで AI 質問テキストの代読。テキストに無い内容を足して喋らせない。
 *
 * 失敗時:
 *   - instructions は gpt-4o-mini 系（=ステアリング対応モデル）のときだけ付与する。
 *     旧モデル（tts-1 等）を env で固定した場合は instructions を送らない（API エラー回避）。
 *   - voice は OpenAI が許容する既知の値のみを使う（不明な voice は API エラーの原因になるため）。
 */

import type { InterviewType } from '@/lib/interviewAi/interviewTypes';

export type TtsDelivery = {
  // OpenAI TTS の voice。モードのキャラクター（性別・印象）に合わせる。画像の性別と一致させること。
  voice: string;
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
// voice は male.png（self_analysis / statement / essay / free）には男性〜中性ボイス、
// pressure（pressure-female.png）には可愛い女性ボイスを割り当てる（画像と性別を一致させる）。
const DELIVERY: Record<InterviewType, TtsDelivery> = {
  // ① 自己分析ベース：優しい先輩メンター。穏やかで温かく、安心感を与え、少しゆっくり。
  self_analysis: {
    voice: 'echo', // 穏やかで温かみのある男性ボイス。
    speed: 0.92,
    instructions:
      `${COMMON} 役柄は優しい先輩メンター。穏やかで温かい口調で受験生に寄り添い、` +
      '安心感を与えるように少しゆっくり丁寧に話す。受験生を否定せず、回答しやすい空気を作る。急かさない。',
  },
  // ② 志望理由書ベース：落ち着いた大学教員。丁寧・少し知的・早すぎない。
  statement: {
    voice: 'ash', // 明瞭で理知的な男性ボイス。
    speed: 0.95,
    instructions:
      `${COMMON} 役柄は落ち着いた大学の教員。丁寧で少し知的、早すぎないテンポ。` +
      '志望理由の一貫性を自然に確認するように、圧をかけず言葉を選びながら深掘りする。',
  },
  // ③ 小論文ベース：口頭試問の先生。論理的・やや硬め・冷静・知的。
  essay: {
    voice: 'onyx', // 落ち着いた低めの男性ボイス（冷静・知的）。
    speed: 1.0,
    instructions:
      `${COMMON} 役柄は口頭試問の先生。論理的でやや硬め、冷静で知的な口調。` +
      '主張と根拠を確認し、抽象的な回答には具体化を促す。ただし圧迫にはしない。',
  },
  // ④ 本番モード：実際の大学面接官。標準的・丁寧・落ち着き・程よい緊張感。
  free: {
    voice: 'alloy', // 標準的で中性的な落ち着いたボイス。
    speed: 1.0,
    instructions:
      `${COMMON} 役柄は本番の大学面接官。標準的で丁寧、落ち着いた口調。褒めすぎず淡々と、` +
      '本番らしい程よい緊張感を保ち、普通のテンポで次の質問に進む。',
  },
  // ⑤ 圧迫面接モード：可愛いが少し冷たさのある女性面接官。ややテンポ速め・少しSっ気（暴言・侮辱は厳禁）。
  pressure: {
    voice: 'shimmer', // 明るく可愛らしい女性ボイス（pressure-female.png と一致）。
    speed: 1.05,
    instructions:
      `${COMMON} 役柄は可愛らしいが少し冷たさのある女性面接官。ややテンポは速め、` +
      '少しSっ気のある軽い口調。回答の弱さ・論理の甘さ・具体性の不足には厳しめに踏み込む。' +
      'ただし人格否定・暴言・侮辱・嘲笑・脅し・受験生を傷つける表現は絶対にしない' +
      '（厳しさは「回答内容への指摘」に限る）。',
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
