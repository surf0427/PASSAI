/**
 * STEP-INTERVIEW-AI: 面接の進行上限（client / server 共通）。
 *
 * `lib/interviewAi/constants.ts` は 'server-only' のため client から import できない。
 * 質問数 / 残り質問数の UI 表示（client）でも同じ上限値を使う必要があるため、
 * 上限だけをここ（server-only を付けない単独モジュール）に切り出す。
 * server 側（turn / state route / constants.ts）はこの値を re-export して使う（単一情報源）。
 */

// MVP のターン上限（PR6 必須条件 §7。3〜5）。role='answer' の件数でカウントする。
// answer がこの件数に達したら followup を生成しない＝面接終了。質問は最大この数だけ出る。
export const INTERVIEW_AI_MAX_ANSWER_TURNS = 5;
