// /api/statement-prepare の prompt builder と AI 出力 type guard。
//
// 役割:
//   - buildStatementPreparePrompt: 入力 3 項目（interestReason / memorableExperience /
//     futureGoal）から、整理 5 項目を出力させる「走り書きメモ」用 prompt 文字列を組み立てる。
//   - isStatementPrepareApiResult: AI が返した JSON.parse 結果が StatementPrepareApiResult
//     shape （5 フィールド全てが string）かを検査する type guard。
//   - asString: 受信 body の unknown フィールドを安全に string に変換する小ヘルパ。
//
// 切り出し経緯:
//   元は app/api/statement-prepare/route.ts に同居していたが、route.ts が肥大化していたため
//   切り出した。AI 呼び出し経路 / rate limit / POST handler とは無関係で、純粋関数のみ。
//
// 注意:
//   - prompt 文字列リテラルは 1 文字も変更してはいけない（出力バイトを完全一致させる）。
//   - StatementPrepareApiResult 型本体は route.ts 側で `export type` として残置されている
//     ため、本ファイルでは type-only import で参照する（型再宣言を避け二重定義を防ぐ）。
//   - type guard が narrow する型 identity は route.ts と同一であるため、route.ts の
//     POST handler 側で `Response.json(parsed)` が従来通りそのまま動作する。

import type { StatementPrepareApiResult } from '@/app/api/statement-prepare/route';
import type { NgWordIssue } from '@/lib/detectNgWords';

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// DET-5: deterministic NG 検出結果を AI に "既知" として提示する section。
// 再判定 / 重複指摘を抑えて、分析 / 改善提案 / 整理メモの手がかり提示に token を割かせる目的。
// DET-2（statement-review）と同形・同 byte の helper。issue 数が 0 / undefined のときは空文字を
// 返し section を出さない（NG section 注入前の旧 prompt と意味等価）。phrase + reason のみ載せる
// （suggestion / activityHint / starterHint は AI 側の責務として残す）。
function buildNgIssuesSection(issues: NgWordIssue[] | undefined): string {
  if (!issues || issues.length === 0) return '';
  const lines = issues.map((i) => `- 「${i.phrase}」：${i.reason}`);
  return [
    '【既知のNG指摘候補】',
    '以下は deterministic ルールベース検出器が既に判定済みの NG パターンです。これらを再判定するのではなく、改善提案や深い分析に注力してください。',
    '',
    ...lines,
  ].join('\n');
}

export function isStatementPrepareApiResult(
  value: unknown,
): value is StatementPrepareApiResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.impressiveExperience === 'string' &&
    typeof v.feltIssue === 'string' &&
    typeof v.interestInField === 'string' &&
    typeof v.universityLearning === 'string' &&
    typeof v.futureApplication === 'string'
  );
}

// ── prompt builder ───────────────────────────────────────────────
// 入力3項目（interestReason / memorableExperience / futureGoal）を、
// 整理5項目（impressiveExperience / feltIssue / interestInField /
// universityLearning / futureApplication）にマップさせる。
// 完成文を書かせず、走り書きメモにとどめる制約を強く付ける。
export function buildStatementPreparePrompt(input: {
  interestReason: string;
  memorableExperience: string;
  futureGoal: string;
  // DET-5: NG 指摘候補（deterministic 検出済）。route.ts 側で detectNgWords() を AI call 前に
  // 走らせて渡す。AI は同じ phrase を再判定せず、分析 / 改善提案 / 整理メモの手がかり提示に
  // 注力する。空配列 / 未指定なら【既知のNG指摘候補】section をプロンプトに含めない（NG 注入前の
  // 旧 prompt と意味等価）。NG 検出は 3 入力 field から deterministic に派生する（statement-prepare
  // route には hash / cache 機構が無いため cache identity drift の議論は対象外）。
  ngIssues?: NgWordIssue[];
  // DET-8: 志望大学 DB 情報（deterministic 取得済）。route.ts 側で buildStatementUniversityContext()
  // を AI call 前に走らせて渡す。AI は admission policy / 評価観点 / 入試方式 などを **参考情報**
  // として軽く参照する（採点基準ではない）。空文字 / 未指定なら【志望大学DB情報】section を
  // プロンプトに含めない（DB 注入前の旧 prompt と意味等価）。lib/universities.ts の単一境界を
  // 経由し、固有の教員名・カリキュラム名は AI に作らせない既存禁止事項を優先する。
  universityContext?: string;
}): string {
  const ngIssuesSection = buildNgIssuesSection(input.ngIssues);
  // DET-8: 大学 DB context は buildStatementUniversityContext() の戻り値をそのまま使う。
  // 既存の【志望大学DB情報】ヘッダ + bullet sections の format を温存し、statement-review と
  // 共通の helper を流用する（lib/universities.ts の責務変更なし）。
  const universitySection = (input.universityContext ?? '').trim();
  return `あなたは総合型選抜・学校推薦型選抜の指導に精通したアドバイザーです。

【あなたの役割】
受験生が志望理由書を「書く前」に頭を整理するための、短い"走り書きメモ"を作ります。
本文の代筆ではありません。文章の完成度よりも材料整理が目的です。
受験生本人がこのメモを見ながら、自分の言葉で下書きを書きます。

【絶対に書いてはいけないもの（禁止事項）】
- 志望理由書の本文・完成文（「私は〜です」「〜したいです」「貴学で〜」のような本文調・敬体は全面禁止）
- 入力に書かれていない事実の創作（経験・大学名・学部名・授業名・教員名・研究室名・数字・固有名詞）
- 受験生が書いていない強み・成果・人物像の断定（「リーダーシップを発揮」「努力家」など）
- 合格しそうに見せるための誇張・装飾・美化
- markdown 記法（**太字**、見出し記号 # など）
- コードブロック（\`\`\` など）
- 解説文・前置き・後書き・「以下に整理しました：」のような前段
- 5つのキー以外のフィールド

【書くべきもの】
- 入力にあった内容を「整理」したメモ（reformulate しすぎず本人の言葉を尊重）
- 入力にない部分は「未整理」「追加で考える余地あり」と分かる短いメモ
- 受験生が次に何を考えればよいか分かる小さな手がかり

【書き方のスタイル】
- 各項目 80〜140字以内
- メモ調・体言止め可・常体（「〜だ」「〜である」より「〜する」「〜する余地あり」のような走り書き）
- 断定しすぎず、本人が考える余白を残す
- 美しい完成文にしない
- 日本語

【入力が空欄・極端に短い場合の扱い】
- 内容を創作して補完してはいけない
- 「未整理」「まだ具体例が少ない」と素直に認めるメモを書く
- ただし、受験生の頭が動くよう「次に何を考えると良いか」の手がかりは短く添えてよい
- 質問文だけを返さない（「どんな経験がありますか？」のような疑問文単体は禁止）。整理メモとして書く

【良い出力例】
- impressiveExperience（経験が空欄の場合）：
  "メモ：印象に残った経験はまだ未整理。部活・探究・読書・日常の出来事から、思い出した順に1つだけ挙げてみる余地あり。"
- futureApplication（将来像が空欄の場合）：
  "メモ：将来像は未整理。職業名で決めずに、興味のある社会課題や「誰の・何の役に立ちたいか」から考える余地あり。"
- universityLearning（興味のきっかけのみ入力）：
  "「○○」というきっかけを、大学では理論・データ・現場のどの方向で深めるかを一言で書き残す余地あり。具体的な授業名・教員名は本人が大学公式情報を見て書く。"

【避けるべき出力例】
- NG（入力にない経験を創作している）：
  "高校2年の文化祭でリーダーを務め、クラスをまとめて優勝に導いた経験。"
- NG（志望理由書の本文体になっている）：
  "私が印象に残っている経験は、地域の商店街でインタビューを行ったことです。"
- NG（架空の固有名詞を作っている）：
  "貴学の○○教授のゼミで、地域経済の実証研究を深めたい。"
- NG（疑問文だけを返している）：
  "どんな経験が印象に残っていますか？"

【既知のNG指摘候補について】
- ユーザー入力の直後に【既知のNG指摘候補】section が含まれている場合、それは deterministic ルールベース検出器が既に判定済みの NG パターンです。
- 同じ phrase に対して再判定や同じ趣旨の指摘を繰り返さないでください。整理メモにこれらの phrase を機械的に置き換えるのではなく、検出済みの NG を踏まえて受験生が次に考えるべき手がかりを添えることに集中してください。
- 5 つの整理メモ（impressiveExperience / feltIssue / interestInField / universityLearning / futureApplication）の出力 schema / 各 80〜140 字以内の文字数規律 / 走り書きメモのスタイルは変更しないでください。
- section が含まれていない場合は、本ルールを適用せず従来通りすべて自前で判断してください。

【志望大学DB情報について】
- ユーザー入力の直後に【志望大学DB情報】section が含まれている場合、それは志望大学・学部の admission policy / 評価観点 / 入試方式 / 選考方法 などの **参考情報** です（大学 DB から deterministic に取得）。
- これは **採点基準ではありません**。整理メモ生成の補助として軽く参照してください。
- 大学コンテキストの文をそのまま整理メモにコピーしないでください。受験生本人の経験 / 言葉 / 関心を最優先し、コンテキストは "この大学はこういう観点を見るので、こういう方向で整理できる" 程度の文脈材料として使ってください。
- universityLearning と futureApplication の整理メモは、大学の評価観点や AI 対策メモと接続させると質が上がります。ただし **固有の教員名・カリキュラム名・授業名は AI が作らない** ことを優先してください（既存の禁止事項「架空の固有名詞を作っている」を最優先）。
- 5 つの整理メモの出力 schema / 各 80〜140 字以内の文字数規律 / 走り書きメモのスタイルは変更しないでください。
- 大学コンテキストが含まれていない場合は、本ルールを適用せず従来通り受験生入力のみで判断してください。

---
【ユーザーの入力（3項目）】
- なぜその分野・学部に興味を持ったか：
${input.interestReason.trim() || '（未入力）'}

- 印象に残った経験：
${input.memorableExperience.trim() || '（未入力）'}

- 将来どんなことをしたいか：
${input.futureGoal.trim() || '（未入力）'}

${ngIssuesSection ? `${ngIssuesSection}\n\n` : ''}${universitySection ? `${universitySection}\n\n` : ''}---

【出力する整理メモ5項目】
1. impressiveExperience  — 印象に残った経験。
   入力 memorableExperience を本人の言葉で短く整理する。未入力なら「未整理」と認め、次に考える手がかりを添える。

2. feltIssue             — その経験から感じたこと・問題意識。
   入力された経験から生まれた違和感・気づき・問いを一言メモにする。経験が空欄なら、感じたこと・問題意識をどう書き出すかの手がかりにとどめる。

3. interestInField       — なぜその分野・学部に興味を持ったか。
   入力された interestReason を整理。固有の大学名・学部名・授業名は作らない。空欄なら「きっかけが未整理。授業・本・ニュース・出会いから1つ挙げる余地あり」のような表現にする。

4. universityLearning    — 大学で深めたいこと。
   興味を「理論／データ／現場」のどの方向で深めたいか、方向性ヒントだけ。具体的な授業名・教員名・研究室名は受験生本人が大学公式情報を見て書くので絶対に作らない。空欄なら「方向性が未整理。どの軸で深めるか考える余地あり」のような表現にする。

5. futureApplication     — 将来どう活かしたいか。
   futureGoal を整理。職業名で断定しない。「誰の・何の役に立ちたいか」のレベル。空欄なら「将来像は未整理。興味のある社会課題や働き方から考える余地あり」のような表現にする。

【入力 → 出力 のマッピング目安】
- memorableExperience → impressiveExperience（直接反映）／ feltIssue（そこから生まれた気づきとして反映）
- interestReason      → interestInField（直接反映）／ universityLearning（深める方向性として展開）
- futureGoal          → futureApplication（直接反映）

【出力形式の最終確認】
- JSON オブジェクトのみ。前後に文字を一切付けない
- 5つのキーをすべて含める（impressiveExperience / feltIssue / interestInField / universityLearning / futureApplication）
- 各値は 80〜140字以内の文字列
- 本文調・完成文体・markdown・コードブロックは禁止

出力（JSON オブジェクトのみ）：
{
  "impressiveExperience": "...",
  "feltIssue": "...",
  "interestInField": "...",
  "universityLearning": "...",
  "futureApplication": "..."
}`;
}
