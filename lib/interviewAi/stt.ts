import 'server-only';

/**
 * STEP-INTERVIEW-AI-PR6: STT（音声 → transcript）境界。
 *
 * 方針（プラグイン境界 / MVP）:
 *   - 本ファイルは STT の **唯一の入口**。実プロバイダ（Whisper / Deepgram 等）接続は別 PR。
 *   - provider 未設定（env INTERVIEW_AI_STT_PROVIDER なし / 未知値）なら SttUnavailableError を throw。
 *   - 音声バイナリは transcribe のためにメモリ上で扱うだけで、**どこにも保存しない**
 *     （PR6 必須条件 §6 / pr0_design.md §7.1）。
 *
 * 失敗の扱い（PR6 必須条件 §8）:
 *   - STT 失敗（unavailable / failed）は呼び出し側（turn route）で catch し、recordUsage を
 *     呼ばずに明示エラーを返す。STT 成功時のみ課金トリガを起こす。
 */

// provider 未設定 / 未知。voice セッションを構造的に通せない状態。
export class SttUnavailableError extends Error {
  constructor() {
    super('stt-unavailable');
    this.name = 'SttUnavailableError';
  }
}

// provider は設定されているが transcribe に失敗した（API error / 空 transcript 等）。
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

/**
 * 音声を transcript に変換する。成功時のみ transcript を返す。
 *
 * - provider 未設定 → SttUnavailableError。
 * - provider 設定済みだが本 PR では実接続未実装 → SttUnavailableError（実装は別 PR）。
 * - 実装後に transcribe が失敗 / 空 → SttFailedError。
 *
 * 音声は保存しない（引数の ArrayBuffer は transcribe 後に破棄される）。
 */
export async function transcribeAudio(
  input: TranscribeInput,
): Promise<TranscribeOutput> {
  const provider = process.env.INTERVIEW_AI_STT_PROVIDER;
  if (!provider) {
    // provider 未設定: voice 経路は使えない。text fallback は MVP で残す（pr0_design.md §7.2）。
    throw new SttUnavailableError();
  }

  // 実プロバイダ接続（Whisper / Deepgram 等）は別 PR。境界だけ確立し、未配線の間は
  // unavailable として扱う（voice の課金トリガ / 失敗処理は本境界の throw で検証可能）。
  void input;
  throw new SttUnavailableError();
}

// STT 系エラーかどうか（route の catch で recordUsage を抑止する判定に使う）。
export function isSttError(err: unknown): err is SttUnavailableError | SttFailedError {
  return err instanceof SttUnavailableError || err instanceof SttFailedError;
}
