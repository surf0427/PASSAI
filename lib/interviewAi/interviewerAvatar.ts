// STEP-INTERVIEW-AI-AVATAR: 面接官画像の一元管理。
//
// 方針:
//   - 画像 URL を JSX へベタ書きしない。モード → キャラクター → (表情) → 画像 のマッピングをここに集約し、
//     差し替え（別画像 / 表情差分 / Live2D 化）をこのファイルだけの変更で完結できるようにする。
//   - 既存の面接ロジック（STT / TTS / 課金 / 履歴 / 質問生成 / 評価）には一切依存しない純データモジュール。
//   - 圧迫面接（pressure）のみ女性面接官。それ以外は共通の男性面接官。
//
// 将来拡張の余地:
//   - InterviewerExpression に 'smile' / 'thinking' / 'pressure' を追加し、状態に応じて差し替える。
//   - 口パク・瞬き・TTS 連動アニメ・Live2D 化も、参照側は getInterviewerImage / キャラクター単位で
//     差し替えれば済むようにキャラクターを第一級の概念として持つ。

// 面接官キャラクター。圧迫面接専用の女性面接官と、それ以外共通の男性面接官。
export type InterviewerCharacter = 'male' | 'pressureFemale';

// 表情差分。現状は normal のみ。将来 'smile' / 'thinking' / 'pressure' を追加する想定。
export type InterviewerExpression = 'normal';

// session.interviewType は string 型（DB に CHECK 無し）なので、ここでは緩く string を受ける。
// 判定は 'pressure' との一致のみなので不正値は安全に男性面接官へフォールバックする。
type InterviewModeInput = string | undefined | null;

// モード → キャラクター。圧迫面接のみ女性、それ以外（自己分析 / 志望理由書 / 小論文 / 本番）は男性。
export function getInterviewerCharacter(mode: InterviewModeInput): InterviewerCharacter {
  return mode === 'pressure' ? 'pressureFemale' : 'male';
}

// キャラクター × 表情 → 画像 URL。差し替えはこの定数だけを変更する。
const INTERVIEWER_IMAGES: Record<InterviewerCharacter, Record<InterviewerExpression, string>> = {
  male: {
    normal: '/interviewer/male.png',
  },
  pressureFemale: {
    normal: '/interviewer/pressure-female.png',
  },
};

// モード（＋表情）から面接官画像の URL を取得する。参照側はこの関数だけを使う。
export function getInterviewerImage(
  mode: InterviewModeInput,
  expression: InterviewerExpression = 'normal',
): string {
  const character = getInterviewerCharacter(mode);
  return INTERVIEWER_IMAGES[character][expression];
}

// アクセシビリティ用の alt / aria ラベル。
export const INTERVIEWER_ALT: Record<InterviewerCharacter, string> = {
  male: 'AI面接官',
  pressureFemale: 'AI面接官（圧迫面接）',
};

export function getInterviewerAlt(mode: InterviewModeInput): string {
  return INTERVIEWER_ALT[getInterviewerCharacter(mode)];
}
