'use client';

/**
 * STEP-INTERVIEW-AI-REALTIME-PR4: OpenAI Realtime の data channel イベントを
 * UI 表示用に正規化する純パーサ（React 非依存・テスト容易）。
 *
 * スコープ（STEP4）: transcript（AI 発話 / ユーザー発話）と主要質問完了 tool の取得のみ。
 *   turn 保存 / 課金 / complete は STEP5+。
 *
 * 注意:
 *   - イベント名は GA/プレビューで揺れがあるため、接尾辞一致で寛容に判定する
 *     （response.audio_transcript.* と response.output_audio_transcript.* の両方を拾う）。
 *   - tool は本機能で 1 つ（mark_main_question_complete）しか登録しないため、
 *     function_call の name 欠落時もこれと見なす。
 */

export type RealtimeEvent =
  | { kind: 'assistant-delta'; text: string }
  | { kind: 'assistant-done'; text: string | null }
  | { kind: 'user-final'; text: string }
  | { kind: 'question-complete'; questionNumber: number | null }
  | { kind: 'other' };

export function parseRealtimeEvent(raw: string): RealtimeEvent {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { kind: 'other' };
  }
  const type = typeof obj.type === 'string' ? obj.type : '';
  if (!type) return { kind: 'other' };

  // ユーザー音声の文字起こし（確定）。
  if (type.endsWith('input_audio_transcription.completed')) {
    const text = typeof obj.transcript === 'string' ? obj.transcript.trim() : '';
    return text ? { kind: 'user-final', text } : { kind: 'other' };
  }

  // AI 発話の文字起こし（delta / done）。audio_transcript / output_audio_transcript 両対応。
  if (type.endsWith('audio_transcript.delta')) {
    const text = typeof obj.delta === 'string' ? obj.delta : '';
    return text ? { kind: 'assistant-delta', text } : { kind: 'other' };
  }
  if (type.endsWith('audio_transcript.done')) {
    const text = typeof obj.transcript === 'string' ? obj.transcript : null;
    return { kind: 'assistant-done', text };
  }

  // tool 呼び出し（主要質問完了）。
  if (type.endsWith('function_call_arguments.done')) {
    const name = typeof obj.name === 'string' ? obj.name : '';
    const isOurTool = name === '' || name === 'mark_main_question_complete';
    if (!isOurTool) return { kind: 'other' };
    let questionNumber: number | null = null;
    try {
      const args =
        typeof obj.arguments === 'string'
          ? (JSON.parse(obj.arguments) as Record<string, unknown>)
          : (obj.arguments as Record<string, unknown> | undefined);
      if (args && typeof args.questionNumber === 'number') {
        questionNumber = args.questionNumber;
      }
    } catch {
      /* arguments 欠落/不正は questionNumber=null で扱う */
    }
    return { kind: 'question-complete', questionNumber };
  }

  return { kind: 'other' };
}
