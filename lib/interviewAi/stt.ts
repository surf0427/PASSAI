import 'server-only';

import { devWarn } from '@/lib/devLog';

/**
 * STEP-INTERVIEW-AI-VOICE: STT（音声 → transcript）境界。
 *
 * 方針:
 *   - 本ファイルは STT の **唯一の入口**。provider は env で切替（プラグイン境界）。
 *   - `INTERVIEW_AI_STT_PROVIDER=openai` かつ `OPENAI_API_KEY` 設定時のみ OpenAI Whisper で文字起こし。
 *     未設定 / 未知 provider → SttUnavailableError（呼び出し側はテキスト入力にフォールバック）。
 *   - 音声バイナリは transcribe のためにメモリ上で扱うだけで **どこにも保存しない**
 *     （Supabase Storage / DB に保存しない。処理後に破棄）。
 *
 * 失敗の扱い:
 *   - STT 失敗（unavailable / failed）時は **回答を保存しない / 課金しない**（呼び出し側 STT route は
 *     何も保存せず、課金は既存の text answer 保存時にのみ発生する）。
 */

// provider 未設定 / 未知。音声経路を通せない状態（→ テキスト入力にフォールバック）。
export class SttUnavailableError extends Error {
  constructor() {
    super('stt-unavailable');
    this.name = 'SttUnavailableError';
  }
}

// provider は設定済みだが transcribe に失敗（API error / 空 transcript 等）。
export class SttFailedError extends Error {
  constructor(message = 'stt-failed') {
    super(message);
    this.name = 'SttFailedError';
  }
}

export type TranscribeInput = {
  audio: ArrayBuffer;
  mimeType: string;
};

export type TranscribeOutput = {
  transcript: string;
};

// MediaRecorder の出力 mimeType → OpenAI が拡張子で形式判定するためのファイル拡張子。
// Safari/iOS は audio/mp4、Chrome は audio/webm を出すため決め打ちしない。
const MIME_EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mpga': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

function extFromMime(mime: string): string {
  const base = (mime || '').split(';')[0].trim().toLowerCase();
  return MIME_EXT[base] ?? 'webm';
}

/**
 * 音声を transcript に変換する。成功時のみ transcript を返す。音声は保存しない。
 * - provider 未設定 / OPENAI_API_KEY 無し → SttUnavailableError。
 * - API error / 空 transcript → SttFailedError。
 */
export async function transcribeAudio(
  input: TranscribeInput,
): Promise<TranscribeOutput> {
  const provider = process.env.INTERVIEW_AI_STT_PROVIDER;
  if (provider !== 'openai') {
    // openai 以外は未実装 → unavailable（呼び出し側でテキスト入力に誘導）。
    throw new SttUnavailableError();
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new SttUnavailableError();

  const model = process.env.INTERVIEW_AI_STT_MODEL || 'whisper-1';
  const blob = new Blob([input.audio], {
    type: input.mimeType || 'application/octet-stream',
  });
  const form = new FormData();
  form.append('file', blob, `audio.${extFromMime(input.mimeType)}`);
  form.append('model', model);
  form.append('language', 'ja');

  // タイムアウト（STT は数秒）。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    devWarn('[interviewAi/stt] fetch failed', err);
    throw new SttFailedError('stt-failed');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    devWarn('[interviewAi/stt] provider error', { status: res.status });
    throw new SttFailedError('stt-failed');
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new SttFailedError('stt-failed');
  }
  const text =
    json && typeof (json as { text?: unknown }).text === 'string'
      ? ((json as { text: string }).text.trim())
      : '';
  if (!text) throw new SttFailedError('stt-empty');
  return { transcript: text };
}

// STT 系エラーかどうか（route の catch で判定に使う）。
export function isSttError(err: unknown): err is SttUnavailableError | SttFailedError {
  return err instanceof SttUnavailableError || err instanceof SttFailedError;
}
