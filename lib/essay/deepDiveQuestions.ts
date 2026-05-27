// 改善ワークの深掘り質問テンプレート（STEP E 新規）。
//
// 役割:
//   - axis 別の固定 3〜5 問テンプレを提供
//   - issue text から axis を推定する fallback inference
//   - templateVersion を export して開始時の snapshot に記録できるようにする
//
// 設計原則:
//   - **AI を呼ばない**。質問は静的テンプレからのみ取り出す
//   - **本文ドラフトを書かせない**質問設計（ai_policy 準拠）。
//     深掘り = 「考えを引き出す」質問にとどめる
//   - axis 推定は keyword regex の簡易マッチ。失敗時は '具体性' に default
//
// 関連:
//   - 型: types/essay.ts の BreakdownAxis
//   - 使用箇所: app/essay/improve/[wid]/deep/[issueId]/page.tsx
//   - 将来: weakPoint contract に axis フィールドを追加した場合（STEP E++）、
//     本ファイルの inferAxis は「fallback inference」として残る前提

import type { BreakdownAxis } from '@/types/essay';

// テンプレート版。本テンプレを変更したら bump する。
// 開始時に improvementInProgress.templateVersion に snapshot される（drift 対策）。
export const DEEP_DIVE_TEMPLATE_VERSION = 1;

const DEEP_DIVE_TEMPLATES: Record<BreakdownAxis, string[]> = {
  具体性: [
    'あなたが本文に入れたい具体例を 1 つ書いてください。実体験・ニュース・社会問題のどれでも OK です。',
    'その具体例の中で、特に印象に残った場面・データを 1 つ書いてください。',
    'その出来事から、あなた自身が感じた・考えたことを 1 文で書いてください。',
    'なぜその具体例が、テーマに対する自分の主張を補強すると思いますか？',
  ],
  論理構造: [
    'あなたの結論を 1 文で言い切ってください。',
    'なぜそう言えるのか、根拠を 1〜2 個書いてください。',
    '反対の立場から見たとき、自分の論にどんな弱さがあると思いますか？',
    'その弱さに対する応答を 1 文で書いてください。',
  ],
  説得力: [
    'あなたの主張に「反対意見」があるとすれば、どんな立場の人が持ちそうですか？',
    'その反対意見の根拠は何だと思いますか？',
    'それでもあなたが今の主張を選ぶ理由を 1 文で書いてください。',
    '自分の主張を裏付けるデータ・経験・事実を 1 つ書いてください。',
  ],
  テーマ理解: [
    'このテーマは、どんな社会問題・学問領域と関係していますか？',
    'このテーマに対して、志望する学部・学科ではどんな研究・学びがありますか？',
    'テーマに含まれる「キーワード」を 1 つ選び、自分なりに定義してください。',
    'そのキーワードを使って、テーマに対する自分の関心を 1 文で書いてください。',
  ],
  独自性: [
    'このテーマに関するよくある一般論を 1 つ挙げてください。',
    'その一般論に対して、あなたが新しく加えたい視点は何ですか？',
    'その視点があなた自身の経験・関心から来ている理由を 1 文で書いてください。',
    '同じテーマで誰も書いていなさそうな具体例があれば 1 つ書いてください。',
  ],
  improvement: [
    'review が指摘した改善点を、あなたなりに言い換えてみてください（理解の確認）。',
    '改善点に対して、本文の「どの部分」を書き直そうと思いますか？',
    '書き直す方向性として、何を 1 文足す / 書き換える予定ですか？',
    'その変更で、テーマに対する自分の主張がどう強くなりますか？',
  ],
};

// axis を渡して固定質問テンプレ（3〜5 問）を返す。
// snapshot 用途のため、呼び出し側は戻り値をそのまま
// improvementInProgress.deepQuestions に保存する想定。
export function getDeepDiveQuestions(axis: BreakdownAxis): string[] {
  return DEEP_DIVE_TEMPLATES[axis] ?? DEEP_DIVE_TEMPLATES['具体性'];
}

// issue text から軸を推定する。
//
// 注意:
//   - 本関数は「fallback inference」。将来 review contract に axis field が
//     追加されたら、構造化された axis を優先する（B 案 / STEP E++）
//   - keyword regex は意図的に簡素にしている。誤判定の最終 fallback は '具体性'
//     （最頻出弱点でかつ深掘り質問が万能なため）
//   - 大文字小文字や記号差は気にしない。完全一致ではなく部分一致
export function inferAxis(issueText: string): BreakdownAxis {
  if (/具体例|事例|エピソード|経験|データ|実例/.test(issueText)) return '具体性';
  if (/論理|構造|展開|流れ|順序|つながり/.test(issueText)) return '論理構造';
  if (/反対|根拠|裏付け|説得|データ不足/.test(issueText)) return '説得力';
  if (/学部|学科|テーマ|問い|分野|専門/.test(issueText)) return 'テーマ理解';
  if (/独自|視点|オリジナル|新しい|発想/.test(issueText)) return '独自性';
  return '具体性';
}
