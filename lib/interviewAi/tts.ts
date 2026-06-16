import 'server-only';

import { devWarn } from '@/lib/devLog';

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
 * 音声キャラクター（MVP 固定）:
 *   - 面接官らしい落ち着いた声。圧迫面接モードでも声色自体は落ち着いたままにする
 *     （威圧感は質問文側で表現し、TTS の声・速度は変えない）。
 *   - voice / model / speed は env で上書き可能だが、既定は落ち着いた・早口すぎない設定。
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
  const speed = parseSpeed(process.env.INTERVIEW_AI_TTS_SPEED);

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
      body: JSON.stringify({
        model,
        voice,
        input: text,
        response_format: 'mp3',
        speed,
      }),
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
