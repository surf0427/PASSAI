import { NextResponse } from 'next/server';
import { anthropic } from '@/lib/ai';
import type { Level, LevelEvaluation, InterviewFeedback } from '@/types/interview';
import type { BasicInfo } from '@/types/basicInfo';
import { buildBasicInfoPromptSection } from '@/lib/buildBasicInfoPromptSection';
import { buildInterviewUniversityContext } from '@/lib/buildInterviewUniversityContext';

export type { InterviewFeedback };

// JSON → 既存 improvementSummary 文字列に変換する。
// InterviewHistoryCard の既存パーサー（①〜⑥ の行走査）と互換性を保つ形式にする。
const LEVEL_LABEL: Record<Level, string> = {
  weak: '弱い',
  normal: '普通',
  strong: '強い',
};

const LEVEL_AXES: [keyof LevelEvaluation, string][] = [
  ['logical', '論理性'],
  ['concrete', '具体性'],
  ['consistency', '一貫性'],
  ['originality', '独自性'],
  ['interviewReadiness', '面接完成度'],
];

function levelToNumber(level: Level): number {
  if (level === 'weak') return 0;
  if (level === 'normal') return 1;
  return 2;
}

function formatLevelEvaluation(lv: LevelEvaluation, index: number): string {
  return [
    `【質問${index + 1} レベル評価】`,
    `論理性：${LEVEL_LABEL[lv.logical]}`,
    `具体性：${LEVEL_LABEL[lv.concrete]}`,
    `一貫性：${LEVEL_LABEL[lv.consistency]}`,
    `独自性：${LEVEL_LABEL[lv.originality]}`,
    `面接完成度：${LEVEL_LABEL[lv.interviewReadiness]}`,
  ].join('\n');
}

// 前回フィードバックとの levelEvaluation を index ベースで比較する
function generateComparison(
  current: InterviewFeedback,
  previous: InterviewFeedback,
): string {
  let improved = 0;
  let unchanged = 0;
  let declined = 0;
  const perQBlocks: string[] = [];

  const count = Math.min(
    current.perQuestionFeedback.length,
    previous.perQuestionFeedback.length,
  );

  for (let i = 0; i < count; i++) {
    const currLv = current.perQuestionFeedback[i]?.levelEvaluation;
    const prevLv = previous.perQuestionFeedback[i]?.levelEvaluation;
    // 旧形式（levelEvaluation なし）の記録との比較はスキップ
    if (!currLv || !prevLv) continue;

    const lines: string[] = [`【質問${i + 1} 成長比較】`];
    for (const [key, label] of LEVEL_AXES) {
      const diff = levelToNumber(currLv[key]) - levelToNumber(prevLv[key]);
      const tag = diff > 0 ? '改善' : diff < 0 ? '悪化' : '変化なし';
      if (diff > 0) improved++;
      else if (diff < 0) declined++;
      else unchanged++;
      lines.push(`${label}：${LEVEL_LABEL[prevLv[key]]} → ${LEVEL_LABEL[currLv[key]]}（${tag}）`);
    }
    perQBlocks.push(lines.join('\n'));
  }

  if (perQBlocks.length === 0) return '';

  const summaryLines = [
    '今回の成長まとめ：',
    `・改善：${improved}項目`,
    `・変化なし：${unchanged}項目`,
  ];
  // 悪化は「改善の余地」として表現する
  if (declined > 0) summaryLines.push(`・改善の余地：${declined}項目`);

  return [summaryLines.join('\n'), ...perQBlocks].join('\n\n');
}

// 受験方式に応じた面接フィードバックの方針を生成する。面接機能専用の文言。
// examTypes が複数選択されている場合はそれぞれのルールを併記する。
function buildExamTypeInterviewGuidance(examTypes: string[] | undefined): string {
  const types = examTypes ?? [];
  const rules: string[] = [];

  if (types.includes('総合型選抜（AO入試）')) {
    rules.push('- 総合型選抜（AO）対策として、活動・自己分析・志望理由の一貫性を厳しめにチェックする。');
  }
  if (types.includes('学校推薦型選抜（公募・指定校）')) {
    rules.push('- 学校推薦型選抜対策として、評定平均・学校生活の継続性・推薦理由の妥当性を踏まえてフィードバックする。');
  }
  if (types.includes('一般選抜') || types.includes('共通テスト利用')) {
    rules.push('- 一般選抜（共通テスト利用を含む）も併願しているため、「なぜ一般受験だけでなく推薦・総合型も使うのか」を聞かれる前提で深掘り質問・改善点を出す。');
  }
  if (types.includes('海外大学受験')) {
    rules.push('- 海外大学受験を含むため、語学力・国際経験との接続も評価軸に加える。');
  }
  if (types.includes('まだ決まっていない')) {
    rules.push('- 受験方式が未確定なので、特定方式に偏らず幅広く使えるアドバイスを優先する。');
  }
  if (rules.length === 0) return '';
  return ['【受験方式に応じたフィードバック方針】', ...rules].join('\n');
}

function feedbackToText(
  feedback: InterviewFeedback,
  previousFeedback?: InterviewFeedback,
): string {
  const bullets = (items: string[]) => items.map((item) => `・${item}`).join('\n');

  const perQLines = feedback.perQuestionFeedback
    .map((q, i) =>
      [
        `【質問${i + 1}】\n質問：${q.question}\n回答：${q.answer}\n評価：${q.evaluation}\n改善点：${q.improvement}\nより良い回答例：${q.betterAnswer}`,
        formatLevelEvaluation(q.levelEvaluation, i),
      ].join('\n\n'),
    )
    .join('\n\n');

  const followUpLines = feedback.followUpQuestions
    .map(
      (f) =>
        `【質問${f.questionNumber}】\n元の質問：${f.originalQuestion}\n${f.followUps.map((q) => `・${q}`).join('\n')}`,
    )
    .join('\n\n');

  const sections = [
    `① 全体評価\n${feedback.overallEvaluation}`,
    `② 良い点\n${bullets(feedback.goodPoints)}`,
    `③ 改善点\n${bullets(feedback.improvements)}`,
    `④ 質問ごとのフィードバック\n${perQLines}`,
    `⑤ 深掘りされそうな追加質問\n${followUpLines}`,
    `⑥ 次に練習すべきこと\n${bullets(feedback.nextPractice)}`,
  ];

  if (previousFeedback) {
    const comparison = generateComparison(feedback, previousFeedback);
    if (comparison) sections.push(`⑦ 成長比較（前回との比較）\n${comparison}`);
  }

  return sections.join('\n\n');
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      universityName,
      facultyName,
      motivation = '',
      // Deprecated: questionsAsked / myAnswers は旧形式フォールバック用。
      // 新規クライアントは questionsAndAnswers を送信する。
      // 削除できる条件: StoredInterviewRecord への questionsAndAnswers 移行完了後。
      questionsAsked,
      myAnswers,
      previousFeedback,
    } = body as {
      universityName: string;
      facultyName: string;
      motivation?: string;
      questionsAsked: string;
      myAnswers: string;
      previousFeedback?: InterviewFeedback;
    };

    // basicInfo は任意。未送信や形が不正でも null として扱い、プロンプト側でフォールバックする。
    const basicInfo: BasicInfo | null = body.basicInfo ?? null;

    // 不正データを弾いたうえで正規化する
    const rawQuestionsAndAnswers = body.questionsAndAnswers;
    const questionsAndAnswers: { question: string; answer: string }[] = Array.isArray(rawQuestionsAndAnswers)
      ? rawQuestionsAndAnswers
          .map((item: unknown) => ({
            question: typeof (item as { question?: unknown }).question === 'string'
              ? (item as { question: string }).question.trim()
              : '',
            answer: typeof (item as { answer?: unknown }).answer === 'string'
              ? (item as { answer: string }).answer.trim()
              : '',
          }))
          .filter((item) => item.question !== '' && item.answer !== '')
      : [];

    // questionsAndAnswers が1件以上あれば新形式（ペア）を使用。
    // ない場合は旧形式（questionsAsked / myAnswers）にフォールバック。
    const qaText =
      questionsAndAnswers.length > 0
        ? questionsAndAnswers
            .map(
              (item, index) =>
                `${index + 1}.\n質問：${item.question}\n回答：${item.answer}`,
            )
            .join('\n\n')
        : `質問一覧：\n${questionsAsked || '未入力'}\n\n回答内容：\n${myAnswers || '未入力'}`;

    const basicInfoSection = buildBasicInfoPromptSection(basicInfo);
    const examTypeGuidance = buildExamTypeInterviewGuidance(basicInfo?.examTypes);
    const interviewUniversityContext = buildInterviewUniversityContext({
      university: universityName,
      facultyName,
    });

    const prompt = `あなたは大学の総合型選抜・学校推薦型選抜に詳しい面接指導者です。
受験生の「質問と回答のペア」を分析し、必ず以下のJSON形式だけで返してください。JSON以外のテキストは一切含めないでください。

{
  "overallEvaluation": "面接全体の評価（2〜3文）",
  "goodPoints": ["回答全体で良かった点1（なぜ良いかをセットで）", "良かった点2"],
  "improvements": ["全体的に直すべき点1（なぜ弱いか・どう直すかをセットで）", "直すべき点2"],
  "perQuestionFeedback": [
    {
      "question": "質問文をそのまま記載",
      "answer": "回答文をそのまま記載",
      "evaluation": "この回答の評価（1〜2文）",
      "improvement": "この回答の具体的な改善点（なぜ弱いか・どう直すかをセットで）",
      "betterAnswer": "より良い回答例（そのまま面接で使えるレベルで全文書く）",
      "levelEvaluation": {
        "logical": "weak | normal | strong",
        "concrete": "weak | normal | strong",
        "consistency": "weak | normal | strong",
        "originality": "weak | normal | strong",
        "interviewReadiness": "weak | normal | strong"
      }
    }
  ],
  "followUpQuestions": [
    {
      "questionNumber": 1,
      "originalQuestion": "元の質問文をそのまま記載",
      "followUps": [
        "回答内容をもとにした深掘り質問1（回答中の具体語を使うこと）",
        "回答内容をもとにした深掘り質問2（不足情報・曖昧点を突く）"
      ]
    }
  ],
  "nextPractice": ["次回改善すべき具体的アクション1", "アクション2"]
}

---

${basicInfoSection}

【受験情報（今回の練習で対象とした内容）】
大学名：${universityName}
学部・学科：${facultyName}
志望理由：${motivation || '（未入力）'}
${examTypeGuidance ? `\n${examTypeGuidance}\n` : ''}
${interviewUniversityContext ? `${interviewUniversityContext}\n\n` : ''}【質問と回答】
${qaText}

---

【重要ルール】
・perQuestionFeedback は、送られた質問と回答のペア数と必ず同じ件数にすること
・followUpQuestions も、送られた質問と回答のペア数と必ず同じ件数にすること
・perQuestionFeedback と followUpQuestions の questionNumber を一致させること
・質問と回答の対応関係を絶対に崩さないこと
・質問ごとのフィードバックを省略しないこと
・回答が短い場合でも、責めるのではなく改善しやすい形で返すこと
・総合型選抜・学校推薦型選抜の面接対策として自然な助言にすること
・高校生にも伝わる日本語で書く
・優しすぎず、少し厳しめのトーンにする
・人格否定の表現は使わない
・改善点は「なぜ弱いか」「どうすれば改善できるか」を必ずセットで説明する
・NG：「もう少し具体的にしましょう」だけで終わらせない

【followUpQuestions の生成ルール】
・各 followUps は最低2個生成すること
・元の質問と回答を必ず読んだうえで、その内容に基づいて生成すること
・回答の中に出てきた具体的な語句・エピソードをできるだけ使うこと
・どの受験生にも使える一般論の質問にしないこと
・以下の観点からバランスよく生成すること
  - 回答が抽象的な部分を具体化させる質問
  - 行動の理由・動機を聞く質問
  - 困難・失敗・葛藤を聞く質問
  - その経験から何を学んだか聞く質問
  - 志望大学・学部との接続を聞く質問
  - 将来目標とのつながりを聞く質問
  - 面接官が確認したくなる弱点・曖昧点を突く質問
・短い回答の場合は、不足している情報を引き出す質問にすること
・圧迫面接ではなく、総合型選抜・学校推薦型選抜で自然に聞かれる質問にすること
・受験生が次の答えを準備しやすい形の質問にすること

【levelEvaluation の評価ルール】
各質問ペアの回答を以下の5軸で評価し、必ず weak / normal / strong のいずれかを返すこと。
・logical（論理性）：結論→理由→具体例の構造になっているか
・concrete（具体性）：抽象的すぎず、エピソードや事実が入っているか
・consistency（一貫性）：志望理由・志望学部とつながっているか
・originality（独自性）：他の受験生と差別化できる視点があるか
・interviewReadiness（面接完成度）：そのまま面接で話せる完成度か
・数値スコアは使わない。weak は「改善余地あり」、strong は「十分に伝わっている」という意味で使う
・甘くしすぎない。回答が短いまたは抽象的な場合は weak を積極的に使う
・受験生が萎えないよう、評価は断定的にしすぎない

【最重要ルール：各質問ペアの followUps の構成】
各質問ペアに対して、必ず以下の構成にすること。

1問目（必須）：「この回答の一番弱い部分・曖昧な部分」を1つ特定し、それを深掘りする質問
  - 回答が抽象的 → 「具体的に何をしたのか？」
  - 他人主体に見える → 「あなた自身の役割は？」
  - 動機が弱い → 「なぜそれを選んだのか？」
  - 学びが浅い → 「その経験は他の場面でどう活かせるのか？」

2問目（必須）：以下のいずれか1つ
  - 大学との接続（この学部・ゼミ・カリキュラムとどうつながるか）
  - 将来との接続（将来の目標とどうつながるか）
  - 再現性（その姿勢・能力は他の場面でも通用するか）`;

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const rawText = textBlock?.type === 'text' ? textBlock.text.trim() : '';

    // JSON parse を試みる。成功すれば feedback と互換文字列の両方を返す。
    // 失敗した場合は rawText をそのまま improvementSummary として返す（既存互換）。
    try {
      const feedback = JSON.parse(rawText) as InterviewFeedback;
      const improvementSummary = feedbackToText(feedback, previousFeedback);
      return NextResponse.json({ feedback, improvementSummary });
    } catch {
      return NextResponse.json({ improvementSummary: rawText });
    }
  } catch (error) {
    console.error('Interview feedback generation error:', error);
    return NextResponse.json(
      { error: 'AIフィードバックの生成に失敗しました。' },
      { status: 500 }
    );
  }
}
