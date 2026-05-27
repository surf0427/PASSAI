// 壁打ち（思考整理）の固定質問テンプレート（Phase 2 STEP J 新規）。
//
// 役割:
//   /essay/structure/[wid]/sparring で表示する 5 問のテンプレを提供する。
//   placeholder（{themeText} / {conclusion} / {faculty} / {university}）を
//   workspace の現在値で置換した「resolved な質問配列」を返す。
//
// 設計原則:
//   - **AI を使わない**（API コスト 0、PASSAI 思想準拠）
//   - 質問は固定。順序も固定（user に予測可能性を提供）
//   - placeholder 未指定の場合は「（〇〇未設定）」で埋めて crash しない
//
// snapshot 思想:
//   開始時に置換結果を workspace.sparring.questions へ snapshot 保存することで、
//   後でテンプレ文言を変えても進行中セッションの質問は変わらない（drift 対策）。
//
// version bump:
//   テンプレ文言・順序・placeholder セットを変えたら SPARRING_TEMPLATE_VERSION を bump。
//   進行中セッションの templateVersion field と比較してデバッグできる状態にしておく。
//
// 関連:
//   - 保存先: types/essay.ts の SparringSession
//   - workspaceOps.startSparring が呼び出し側で buildSparringQuestions を使う想定

export const SPARRING_TEMPLATE_VERSION = 1;

// 置換に使う context。すべて optional 表記だが「未指定」を許容するよう
// build 側で fallback テキストに倒す。
export type SparringContext = {
  themeText: string;
  conclusion: string;
  faculty: string;
  university: string;
};

// テンプレ本体。{xxx} 形式の placeholder を含む。
// 5 問固定（Phase 2 STEP J の仕様）。
const SPARRING_TEMPLATES: string[] = [
  'テーマ「{themeText}」を聞いて、最初に思いついた立場・意見を 1 文で書いてください。',
  'あなたの結論「{conclusion}」を選んだ、いちばん大事な理由を 1 文で書いてください。',
  'その理由に対して、誰かが反対するとしたら、どんなことを言いそうですか？',
  'その反対意見に対するあなたの応答を 1 文で書いてください。',
  '志望する「{faculty}」では、このテーマをどんな視点で扱いそうですか？ 想像で OK です。',
];

// placeholder 置換。trim 後に空なら「（未設定）」表記で穴埋めし、
// 質問文として意味が通る状態に保つ。
function substitute(template: string, ctx: SparringContext): string {
  return template
    .replace('{themeText}', ctx.themeText.trim() || '（テーマ未設定）')
    .replace('{conclusion}', ctx.conclusion.trim() || '（結論未設定）')
    .replace('{faculty}', ctx.faculty.trim() || '（学部未設定）')
    .replace('{university}', ctx.university.trim() || '（大学未設定）');
}

// 開始時に呼び出して、placeholder 置換済みの 5 問を返す。
// 戻り値をそのまま workspace.sparring.questions に保存する（snapshot）。
export function buildSparringQuestions(ctx: SparringContext): string[] {
  return SPARRING_TEMPLATES.map((t) => substitute(t, ctx));
}
