import type { WallHittingResult } from '@/types/analysis';
import type { BasicInfo } from '@/types/basicInfo';
import type { UniversityContext } from '@/types/universityContext';
import { buildBasicInfoPromptSection } from '@/lib/buildBasicInfoPromptSection';
import { buildUniversityContextPromptSection } from '@/lib/buildUniversityContext';

// プロンプトに「志望先の文脈で読み解く」共通指示を差し込むための定型文。
// AIに「性格を作り変えるな、相性の良い側面を発見せよ」という制約を伝える。
const STUDENT_FIT_INSTRUCTION = `【志望先の文脈で読み解く】
受験生の志望大学・学部・学科・受験方式が分かる場合は、活動データを「その志望先と相性の良い側面はどこか」という観点で読み解いてください。

注意:
- 志望先に合わせて性格や経歴を作り変えてはいけない
- 受験生が実際に経験した中から、その大学・学部・学科と「自然に接続できる側面」を発見して言語化することが目的
- 学部の特性に合わせた切り口を意識する（例: 国際系→異文化理解・主体性 / 経営系→リーダーシップ・企画力 / 理系→探究性・継続力 / 教育系→他者支援）
- 受験方式に合わせた強調点を意識する（総合型→活動と将来目標の一貫性 / 学校推薦型→学校生活との接続 / 一般併願→汎用性）
- 学年・文理に対して現実的な内容にする`;

// 自己分析API群で共有するオプション型。
// universityContext は basicInfo から派生させた値を受け取ることもあれば、
// 将来 大学DB から enrich された値を受け取ることもある（呼び出し側で構築）。
export type AnalysisPromptContext = {
  basicInfo: BasicInfo | null;
  universityContext: UniversityContext | null;
};

function buildContextPreamble(ctx: AnalysisPromptContext): string {
  const basicInfoSection = buildBasicInfoPromptSection(ctx.basicInfo);
  const uniContextSection = buildUniversityContextPromptSection(ctx.universityContext);
  const sections: string[] = [basicInfoSection];
  if (uniContextSection) sections.push(uniContextSection);
  sections.push(STUDENT_FIT_INSTRUCTION);
  return sections.join('\n\n');
}

export function buildAnalyzePrompt(activityText: string): string {
  return `あなたは総合型選抜・学校推薦型選抜の指導に強いアシスタントです。

目的：
以下の活動データをもとに、自己PRや志望理由書に必要な情報を「不足している項目」に対してのみ質問してください。

重要ルール：
- すでに情報がある項目については質問しない
- 空欄・情報が弱い部分だけを補う質問をする
- 質問は3〜5問に制限する
- 抽象的な質問は禁止（例：「頑張ったことは？」など）
- 具体性を引き出す質問にする

対象の構造（この形に最終的に埋めたい）：
【共通項目】
- 期間
- 役割 / 立場
- 内容（何をしたか）
- 課題
- 行動 / 工夫
- 成果
- 学び
- 将来とのつながり

【活動データ】
${activityText}

【出力ルール（厳守）】
・出力は純粋なJSONのみ
・最初の文字は { でなければならない
・最後の文字は } でなければならない
・\`\`\`json や \`\`\` は絶対に使わない
・前置き・説明文・日本語の文章を一切書かない
・JSON以外の文字を1文字も含めない
・ただし、正しいJSON構造を保つことを最優先とする。JSON構造が壊れるくらいなら正確なJSONを優先すること

【出力形式】
{
  "strengths": ["活動から見える強み（2〜4個）"],
  "interests": ["関心分野（1〜3個）"],
  "gaps": ["不足している項目名（例：行動/工夫、将来とのつながり）"],
  "questions": ["（項目名）具体的な質問文"]
}

questionsの形式例：
- "（課題）〇〇活動で一番うまくいかなかったのはどの場面でしたか？"
- "（行動/工夫）その状況を乗り越えるために、具体的にどんな行動をとりましたか？"
- "（将来とのつながり）この経験は、志望する学部・学科でどう活かせると思いますか？"`;
}

export type BuildWallHittingOptions = {
  activityText: string;
} & AnalysisPromptContext;

export function buildWallHittingPrompt(opts: BuildWallHittingOptions): string {
  const preamble = buildContextPreamble(opts);
  return `あなたは総合型選抜・学校推薦型選抜の受験指導のプロです。
以下の活動データをもとに、受験生の自己分析を深める総合分析を行ってください。

【あなたの役割】
・受験生が気づいていない「自分の強み」を言語化する
・活動の表面ではなく、その裏にある「思考パターン・価値観」を見抜く
・AO・推薦面接で実際に問われる観点で分析する
・志望先の文脈と相性の良い側面を発見する（性格を作り変えない）

${preamble}

【活動データ】
${opts.activityText}

【出力内容の指針】

1. 活動の要約（ストーリー化）
   - 複数の活動を「一人の人間の物語」として100〜150字でまとめる
   - 「何に興味を持ち、どう行動してきたか」が伝わるように

2. 強み（3〜5個）
   - 活動から読み取れる具体的な強み
   - 「継続力」「協調性」などの抽象語のみは禁止。活動の事実とセットで書く
   - 例：「試行錯誤を繰り返しながら仮説を立て直す粘り強さ（探究活動での取り組みより）」

3. 弱み・補強ポイント（2〜3個）
   - 書類・面接で「突っ込まれそうな点」や「薄い部分」
   - 責めるのではなく、「ここを掘り下げると更に強くなる」という視点で

4. 将来とのつながり（2〜3点）
   - この活動が「なぜ志望学部・将来像につながるか」の仮説
   - 受験生が言語化できていない「点と点を繋ぐ視点」を提示する

5. 深掘り質問（5〜8問）
   - AO面接・志望理由書のために必要な情報を引き出す質問
   - 各質問に【カテゴリ】を付ける（例：【動機】【課題】【行動】【成果】【将来】）
   - 「なぜ」「どのように」「その経験から何を得たか」を問う具体的な質問

【出力ルール（厳守）】
・出力は純粋なJSONのみ
・最初の文字は { でなければならない
・最後の文字は } でなければならない
・\`\`\`json や \`\`\` は絶対に使わない
・前置き・説明文・日本語の文章を一切書かない
・JSON以外の文字を1文字も含めない
・ただし、正しいJSON構造を保つことを最優先とする。JSON構造が壊れるくらいなら正確なJSONを優先すること

【出力形式】
{
  "summary": "活動の要約（100〜150字）",
  "strengths": [
    "具体的な強み（活動の事実とセット）"
  ],
  "weaknesses": [
    "補強が必要な点"
  ],
  "futureConnections": [
    "活動と将来をつなぐ仮説"
  ],
  "questions": [
    "【カテゴリ】具体的な質問文"
  ]
}`;
}

export type BuildSummarizeOptions = {
  activityText: string;
  analysis: WallHittingResult;
  answers: string[];
} & AnalysisPromptContext;

export function buildSummarizePrompt(opts: BuildSummarizeOptions): string {
  const { activityText, analysis, answers } = opts;
  const preamble = buildContextPreamble(opts);
  const qa = analysis.questions
    .map((q, i) => `Q${i + 1}: ${q}\nA${i + 1}: ${answers[i]?.trim() || '（未回答）'}`)
    .join('\n\n');

  return `あなたは総合型選抜の受験指導の専門家です。
以下の情報をもとに学生の活動まとめを作成し、指定のJSON形式のみで回答してください。

${preamble}

selfPRDraft と interviewPoints は、上記の志望先の文脈を踏まえて
「この志望大学・学部・学科に響く切り口」で書くこと。
ただし学生の実体験を歪めず、相性の良い側面を強調するだけにとどめる。

【活動情報】
${activityText}

【AI分析】
活動の要約: ${analysis.summary}
強み: ${analysis.strengths.join('・')}
弱み・補強ポイント: ${analysis.weaknesses.join('・')}
将来とのつながり: ${analysis.futureConnections.join('・')}

【深掘り質問と回答】
${qa}

【出力ルール（厳守）】
・出力は純粋なJSONのみ
・最初の文字は { でなければならない
・最後の文字は } でなければならない
・\`\`\`json や \`\`\` は絶対に使わない
・前置き・説明文・日本語の文章を一切書かない
・JSON以外の文字を1文字も含めない
・ただし、正しいJSON構造を保つことを最優先とする。JSON構造が壊れるくらいなら正確なJSONを優先すること

【出力形式】
{
  "activitySummary": "活動の要約（100字程度）",
  "strengths": "見える強み（2〜3文）",
  "appealPoints": "アピールポイント（2〜3文）",
  "selfPRDraft": "自己PRのたたき台（200字程度）",
  "interviewPoints": ["面接で話せる要点（3〜5個）"]
}`;
}

export type BuildAdditionalQuestionsOptions = {
  activityText: string;
  existingQuestions: string[];
} & AnalysisPromptContext;

export function buildAdditionalQuestionsPrompt(opts: BuildAdditionalQuestionsOptions): string {
  const { activityText, existingQuestions } = opts;
  const preamble = buildContextPreamble(opts);
  const existingQuestionsText = existingQuestions
    .map((q, i) => `${i + 1}. ${q}`)
    .join('\n');

  return `あなたは総合型選抜・学校推薦型選抜の受験指導のプロです。
以下の活動データをもとに、深掘り質問を2問だけ追加生成してください。

${preamble}

追加質問は、上記の志望大学・学部・学科の特性に踏み込む内容にすること。
学部のカリキュラム適合性、学科の専門性、受験方式に応じた観点を意識する。

【活動データ】
${activityText}

【すでに出している質問（重複禁止）】
${existingQuestionsText}

【制約】
・questions は必ず2問だけ生成する
・上記の既存質問と重複しないこと
・AO面接・志望理由書で役立つ具体的な質問にする
・各質問には【カテゴリ】を付ける（例：【動機】【課題】【行動】【成果】【将来】）

【出力ルール（厳守）】
・出力は純粋なJSONのみ
・最初の文字は { でなければならない
・最後の文字は } でなければならない
・\`\`\`json や \`\`\` は絶対に使わない
・前置き・説明文・日本語の文章を一切書かない
・JSON以外の文字を1文字も含めない
・ただし、正しいJSON構造を保つことを最優先とする。JSON構造が壊れるくらいなら正確なJSONを優先すること

【出力形式】
{
  "questions": [
    "【カテゴリ】具体的な質問文",
    "【カテゴリ】具体的な質問文"
  ]
}`;
}

export function buildReasonPrompt(text: string): string {
  return `あなたは総合型選抜・学校推薦型選抜の受験指導のプロです。
以下の自己PRを添削し、改善版と不足情報をフィードバックしてください。

【自己PR】
${text}

【出力の構成】

まず「添削後の自己PR」を書いてください。
・元の内容を活かしつつ、伝わりやすい文章に整える
・志望理由や将来像とのつながりを意識した表現にする
・不足している情報がある場合は「（ここに◯◯を補足してください）」と角括弧で示す

次に、情報が不足していて完全な添削ができない場合は以下の形式で書いてください。

---

ただし、正直に申し上げます。
この改善版はまだ仮版です。

なぜかというと、まだ以下の情報が不足しているからです。

不足している情報：
・（不足している点を1つずつ箇条書きで書く）
・（なぜその情報が必要かも一言添える）

次に答えてほしい質問：
1. （具体的な質問を番号付きで書く）
2. （AO面接で実際に問われる観点で質問する）
3. （答えやすい、具体的な問いかけにする）

---

【禁止事項】
・Markdownの表形式（「|」や「---」を使った表）は絶対に使わない
・箇条書きは「・」か「-」を使う
・番号付きリストは「1.」「2.」の形式を使う
・JSON形式での出力はしない
・専門用語の羅列はしない`;
}
