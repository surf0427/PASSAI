// 志望理由書を書く前の「整理メモ」を作る API。
// 受験生が本文を書く前のスキャフォールドを Claude に作らせる。
// 本文や完成文の代筆はしない。

import { anthropic, extractJson } from '@/lib/ai';
import { checkServerRateLimit } from '@/lib/serverRateLimit';

// ── rate limit 設定 ──────────────────────────────────────────────
// 同一IPあたり 1時間 5回。実装は lib/serverRateLimit.ts 側（暫定メモリ実装）。
// ローカルで429を確認したい場合は、一時的に MAX を 1、WINDOW_MS を 60_000 にすると即超過する。
// ※ コミット前に必ず本番値に戻すこと。
export const STATEMENT_PREPARE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
export const STATEMENT_PREPARE_RATE_LIMIT_MAX = 5;

type RequestBody = {
  interestReason?: unknown;
  memorableExperience?: unknown;
  futureGoal?: unknown;
};

export type StatementPrepareApiResult = {
  impressiveExperience: string;
  feltIssue: string;
  interestInField: string;
  universityLearning: string;
  futureApplication: string;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isStatementPrepareApiResult(
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
function buildStatementPreparePrompt(input: {
  interestReason: string;
  memorableExperience: string;
  futureGoal: string;
}): string {
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

---
【ユーザーの入力（3項目）】
- なぜその分野・学部に興味を持ったか：
${input.interestReason.trim() || '（未入力）'}

- 印象に残った経験：
${input.memorableExperience.trim() || '（未入力）'}

- 将来どんなことをしたいか：
${input.futureGoal.trim() || '（未入力）'}
---

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

// ── route ────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return Response.json(
      { error: 'リクエスト形式が不正です。' },
      { status: 400 },
    );
  }

  const interestReason = asString(body.interestReason);
  const memorableExperience = asString(body.memorableExperience);
  const futureGoal = asString(body.futureGoal);

  if (
    !interestReason.trim() &&
    !memorableExperience.trim() &&
    !futureGoal.trim()
  ) {
    return Response.json(
      { error: 'まずは1つだけでも入力してください' },
      { status: 400 },
    );
  }

  // ── サーバ側 rate limit ──
  // 入力バリデーションを通過した有効リクエストのみカウント対象。
  // 仕様：API 処理に進む場合のみ count が進む（helper 内で同等の挙動）。
  const rateLimit = checkServerRateLimit(req, {
    keyPrefix: 'statement-prepare',
    windowMs: STATEMENT_PREPARE_RATE_LIMIT_WINDOW_MS,
    maxRequests: STATEMENT_PREPARE_RATE_LIMIT_MAX,
  });
  if (!rateLimit.allowed) {
    return Response.json(
      {
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'しばらく時間をおいてからお試しください。',
      },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSec) },
      },
    );
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1100,
      temperature: 0.3,
      messages: [
        {
          role: 'user',
          content: buildStatementPreparePrompt({
            interestReason,
            memorableExperience,
            futureGoal,
          }),
        },
      ],
    });

    const text =
      message.content[0]?.type === 'text' ? message.content[0].text : '';
    const json = extractJson(text);
    const parsed: unknown = JSON.parse(json);

    if (!isStatementPrepareApiResult(parsed)) {
      console.error('statement-prepare API: invalid shape', parsed);
      return Response.json(
        { error: '整理に失敗しました。もう一度お試しください。' },
        { status: 500 },
      );
    }

    return Response.json(parsed);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('statement-prepare API error:', msg);
    return Response.json(
      { error: '整理に失敗しました。もう一度お試しください。' },
      { status: 500 },
    );
  }
}
