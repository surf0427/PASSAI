import 'server-only';

import { devWarn } from '@/lib/devLog';
import type { InterviewType } from '@/lib/interviewAi/interviewTypes';
import { ttsDeliveryFor } from '@/lib/interviewAi/ttsVoice';

/**
 * STEP-INTERVIEW-AI-TTS: TTS（AI 質問テキスト → 音声）境界。
 *
 * 方針:
 *   - 本ファイルは TTS の **唯一の入口**。provider は env で切替（プラグイン境界 / 将来差し替え可能）。
 *   - `INTERVIEW_AI_TTS_PROVIDER=openai` かつ `OPENAI_API_KEY` 設定時のみ OpenAI TTS で音声化。
 *     未設定 / 未知 provider → TtsUnavailableError（呼び出し側はテキスト表示のまま面接を続行）。
 *   - 生成した音声は **どこにも保存しない**（Supabase Storage / DB に保存しない）。
 *     route が audio response として一度返すだけで、サーバ側にもファイルを残さない。
 *
 * 失敗の扱い:
 *   - TTS 失敗（unavailable / failed）時も面接は止めない。AI 質問はテキストで必ず表示済みなので、
 *     呼び出し側（route / client）は音声なしで続行する。**課金は一切発生しない**
 *     （TTS は recordUsage を呼ばない。課金は既存の text answer 保存時のみ）。
 *
 * 音声キャラクター（モード別）:
 *   - voice（声そのもの）は全モード共通（既定 alloy）。env で全体上書き可能。
 *   - 口調・テンポ・間は面接タイプごとに変える（lib/interviewAi/ttsVoice.ts）。
 *     gpt-4o-mini-tts の `instructions`（話し方の system prompt 相当）と `speed` で表現する。
 *     例: 自己分析=優しくゆっくり / 圧迫=低め・短め・間（ただし暴言・侮辱の口調は絶対にしない）。
 *   - `instructions` はステアリング対応モデル（gpt-4o 系）のときだけ付与する。
 *     env で旧モデル（tts-1 等）に固定した場合は instructions を送らない（API エラー回避）。
 *   - model / voice / speed は env で上書き可能（speed の env 指定はモード別既定より優先）。
 */

// provider 未設定 / 未知。音声化経路を通せない状態（→ テキスト表示のまま続行）。
export class TtsUnavailableError extends Error {
  constructor() {
    super('tts-unavailable');
    this.name = 'TtsUnavailableError';
  }
}

// provider は設定済みだが音声化に失敗（API error / 空レスポンス等）。
export class TtsFailedError extends Error {
  constructor(message = 'tts-failed') {
    super(message);
    this.name = 'TtsFailedError';
  }
}

export type SynthesizeInput = {
  text: string;
  // モード別の話し方（口調・テンポ）を切り替えるための面接タイプ。未指定は本番モード相当。
  interviewType?: InterviewType | null;
};

export type SynthesizeOutput = {
  audio: ArrayBuffer;
  contentType: string; // 例: 'audio/mpeg'
};

// MVP の既定値（落ち着いた面接官の声 / 早口すぎない）。env で上書き可能。
const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts';
const DEFAULT_TTS_VOICE = 'alloy'; // 落ち着いた中性的な声。圧迫モードでも声色は変えない。
const DEFAULT_TTS_SPEED = 0.95; // 早口すぎないよう少し遅め。

function parseSpeed(raw: string | undefined): number {
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_TTS_SPEED;
  // OpenAI TTS の許容範囲 [0.25, 4.0] にクランプ。
  return Math.min(4, Math.max(0.25, n));
}

/**
 * AI 質問テキストを音声に変換する。成功時のみ audio（バイナリ）を返す。音声は保存しない。
 * - provider 未設定 / OPENAI_API_KEY 無し → TtsUnavailableError。
 * - API error / 空レスポンス → TtsFailedError。
 */
export async function synthesizeSpeech(
  input: SynthesizeInput,
): Promise<SynthesizeOutput> {
  const provider = process.env.INTERVIEW_AI_TTS_PROVIDER;
  if (provider !== 'openai') {
    // openai 以外は未実装 → unavailable（呼び出し側はテキストのまま続行）。
    throw new TtsUnavailableError();
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new TtsUnavailableError();

  const text = (input.text || '').trim();
  if (!text) throw new TtsFailedError('tts-empty-input');

  const model = process.env.INTERVIEW_AI_TTS_MODEL || DEFAULT_TTS_MODEL;
  const voice = process.env.INTERVIEW_AI_TTS_VOICE || DEFAULT_TTS_VOICE;

  // モード別の話し方（口調・テンポ）。env で speed を明示したらそれを優先（ops 上書き）、
  // 無ければモード別の既定速度を使う。instructions は ステアリング対応モデルのみ付与。
  const delivery = ttsDeliveryFor(input.interviewType);
  const speed =
    process.env.INTERVIEW_AI_TTS_SPEED !== undefined
      ? parseSpeed(process.env.INTERVIEW_AI_TTS_SPEED)
      : delivery.speed;
  const supportsInstructions = model.startsWith('gpt-4o');
  const body: Record<string, unknown> = {
    model,
    voice,
    input: text,
    response_format: 'mp3',
    speed,
  };
  if (supportsInstructions) body.instructions = delivery.instructions;

  // タイムアウト（TTS は数秒）。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    devWarn('[interviewAi/tts] fetch failed', err);
    throw new TtsFailedError('tts-failed');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    devWarn('[interviewAi/tts] provider error', { status: res.status });
    throw new TtsFailedError('tts-failed');
  }

  let audio: ArrayBuffer;
  try {
    audio = await res.arrayBuffer();
  } catch {
    throw new TtsFailedError('tts-failed');
  }
  if (!audio || audio.byteLength === 0) throw new TtsFailedError('tts-empty');

  const contentType = res.headers.get('content-type') || 'audio/mpeg';
  return { audio, contentType };
}

// TTS 系エラーかどうか（route の catch で判定に使う）。
export function isTtsError(err: unknown): err is TtsUnavailableError | TtsFailedError {
  return err instanceof TtsUnavailableError || err instanceof TtsFailedError;
}
