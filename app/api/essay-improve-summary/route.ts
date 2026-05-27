// 改善ワークの「方針整理」を AI に依頼する route（essay STEP F 新規、UX 修正で multi-issue 化）。
//
// 役割:
//   生徒が複数の改善点（works）に対する深掘り回答を、AI が「改善方針」として統合整理する。
//   本文ドラフトを書かない。完成文・段落例・「こう書きましょう」を一切返さない。
//
// 入力（v2 契約: multi-issue）:
//   - works[]             : 各改善点の Q&A 集合
//     - issueText         : 取り組む改善点の文言
//     - axis              : 推定された軸
//     - deepQuestions     : 質問 snapshot
//     - answers           : 生徒の回答
//   - currentEssayBody    : 書き直し対象の本文
//   - theme               : テーマ（文脈）
//   - mini                : ミニ思考欄（結論 / 理由 1 / 理由 2）
//   - basicInfo           : 志望校・学部（文脈）
//
// 出力（ImprovementSummary）:
//   - summary             : 改善方針の全体像（1〜2 文）
//   - focusPoints         : 強化すべきポイント（最大 3 件、箇条書き）
//   - suggestedDirections : 書き直し方向性（最大 3 件、本文例ではない）
//
// 不変条件:
//   - 本文段落・完成文・例文を出さない（ai_policy 厳守）
//   - PROMPT_VERSION bump は lib/aiInputHash.ts の ESSAY_IMPROVE_SUMMARY_PROMPT_VERSION で集約
//   - sonnet-4-6 を使用（essay-review と同モデルで一貫性確保）
//
// cache:
//   client 側で essayImproveSummaryInputHash cache を使って AI call を dedupe する。
//   route 自体には cache を入れない（既存 essay-review / interview-questions と同方針）。

import { anthropic, extractJson } from '@/lib/ai';
import { safeParseImproveSummary } from '@/lib/essay/parseImproveSummary';
import { buildBasicInfoPromptSection } from '@/lib/buildBasicInfoPromptSection';
import { logAiUsage } from '@/lib/aiUsageLog';
import type { BasicInfo } from '@/types/basicInfo';

const MODEL = 'claude-sonnet-4-6';
const ROUTE = 'api/essay-improve-summary';

// SYSTEM_PROMPT を module-level export const に lift（aiInputHash の PROMPT_VERSION と
// 紐づくため、変更時は lib/aiInputHash.ts の ESSAY_IMPROVE_SUMMARY_PROMPT_VERSION を bump）。
export const ESSAY_IMPROVE_SUMMARY_SYSTEM_PROMPT = `あなたは高校生・大学受験生の小論文を改善するための「思考整理アシスタント」です。
生徒が **複数の改善点** に対して深掘り質問に答えた内容を読み、それらを統合した「どんな方針で書き直すと良いか」を整理します。

【絶対にやってはいけないこと】
- 小論文の本文・完成文・段落例を書くこと
- 「以下のように書きましょう」「次のように書き直してください」のような完成文を出すこと
- そのまま本文に貼り付けられる文を出すこと
- 「〜と書ける」「〜と表現できる」のような文例を出すこと
- 生徒の回答をそのまま引用して文章化すること

【あなたがやること】
- 入力された **複数の改善点（works）** をすべて読み、共通テーマ・優先順位を踏まえた統合改善方針を整理する
- 「どこを強化すべきか」「どんな観点で書き直すか」を箇条書きで提示する
- AI が代わりに書くのではなく、生徒が自分の言葉で書き直せるようガイドする
- works が 1 個でも複数でも同じ JSON schema で返す（呼び出し側は配列長に依存しない）

【出力ルール】
- 返答は必ず 1 つの JSON オブジェクトのみ
- JSON の前後に説明文・コメント・挨拶を書かないこと
- Markdown コードブロック（\`\`\`json や \`\`\`）を使わないこと
- すべてのキーをダブルクォートで囲むこと
- すべての文字列値をダブルクォートで囲むこと
- 出力の 1 文字目が { であること
- 出力の最後の文字が } であること

【出力 schema】
{
  "summary": "改善方針の全体像を 1〜2 文で説明する（120 字以内）",
  "focusPoints": [
    "強化すべきポイント 1（行動レベル、60〜100 字）",
    "強化すべきポイント 2",
    "強化すべきポイント 3"
  ],
  "suggestedDirections": [
    "書き直しの方向性 1（『どこに何を加える』レベルの観点。本文例ではない、60〜100 字）",
    "書き直しの方向性 2",
    "書き直しの方向性 3"
  ]
}

【トーンと文体】
- 「次に何をすればいいか」が伝わることを最優先
- 抽象的な称賛（「素晴らしい」等）を使わない
- 1 文は短く（目安 60〜100 字）
- 説教調・精神論を避ける
- focusPoints / suggestedDirections は **観点・方針** のみ（本文の文例は禁止）

【自問チェック（出力前に必ず通すこと）】
- summary / focusPoints / suggestedDirections のどれかに「本文ドラフト」や「完成文」が含まれていないか？
- 生徒の回答を引用してそのまま文章化していないか？
- 観点・方針ではなく完成文を出していないか？

ひとつでも YES があれば、その箇所を書き直す（本文を含めずに方針だけで再構成する）。`;

type WorkPayload = {
  issueText?: string;
  axis?: string;
  deepQuestions?: string[];
  answers?: string[];
};

type Body = {
  works?: WorkPayload[];
  currentEssayBody?: string;
  theme?: string;
  mini?: { conclusion?: string; reasonOne?: string; reasonTwo?: string };
  basicInfo?: BasicInfo | null;
};

function buildUserMessage(b: Body): string {
  const basicInfoSection = buildBasicInfoPromptSection(b.basicInfo ?? null);

  const works = b.works ?? [];
  const worksSection = works
    .map((w, idx) => {
      const issueText = w.issueText?.trim() || '（未指定）';
      const axis = w.axis ?? '（未指定）';
      const qa = (w.deepQuestions ?? [])
        .map((q, i) => {
          const a = w.answers?.[i]?.trim() ?? '';
          return `  Q${i + 1}. ${q}\n  A. ${a || '（未回答）'}`;
        })
        .join('\n\n');
      return [
        `[改善点 ${idx + 1}]`,
        `内容: ${issueText}`,
        `軸: ${axis}`,
        qa ? `深掘り Q&A:\n${qa}` : '深掘り Q&A: （なし）',
      ].join('\n');
    })
    .join('\n\n---\n\n');

  const mini = b.mini ?? {};
  const miniLines: string[] = [];
  if (mini.conclusion?.trim()) miniLines.push(`結論: ${mini.conclusion.trim()}`);
  if (mini.reasonOne?.trim()) miniLines.push(`理由①: ${mini.reasonOne.trim()}`);
  if (mini.reasonTwo?.trim()) miniLines.push(`理由②: ${mini.reasonTwo.trim()}`);
  const miniSection =
    miniLines.length > 0 ? `【ミニ思考欄】\n${miniLines.join('\n')}` : '';

  const bodySection = b.currentEssayBody?.trim()
    ? `【現在の本文】\n${b.currentEssayBody.trim()}`
    : '【現在の本文】\n（空）';

  return [
    '生徒が複数の改善点に対して深掘り質問に答えた内容を読み、統合した改善方針を JSON で整理してください。',
    '',
    basicInfoSection,
    '',
    `【テーマ】\n${b.theme?.trim() || '（未指定）'}`,
    '',
    miniSection,
    '',
    bodySection,
    '',
    `【取り組む改善点と深掘り Q&A（${works.length} 件）】\n${worksSection || '（なし）'}`,
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

export async function POST(req: Request) {
  const body = (await req.json()) as Body;

  // 最低限の必須入力チェック。
  if (!Array.isArray(body.works) || body.works.length === 0) {
    return Response.json(
      { error: '改善点が指定されていません（works 配列が空です）' },
      { status: 400 },
    );
  }
  // 少なくとも 1 件の work に issueText / deepQuestions があれば許容。
  const hasValidWork = body.works.some(
    (w) =>
      typeof w.issueText === 'string' &&
      w.issueText.trim() !== '' &&
      Array.isArray(w.deepQuestions) &&
      w.deepQuestions.length > 0,
  );
  if (!hasValidWork) {
    return Response.json(
      { error: '改善点の内容または深掘り質問が空です' },
      { status: 400 },
    );
  }

  const userMessage = buildUserMessage(body);

  try {
    // SYSTEM_PROMPT は不変なので cache_control: 'ephemeral' で
    // 5 分以内の連続生成を input 単価大幅割引にする（既存 essay-review と同パターン）。
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 800,
      temperature: 0.2,
      system: [
        {
          type: 'text',
          text: ESSAY_IMPROVE_SUMMARY_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    });

    const text =
      message.content[0]?.type === 'text' ? message.content[0].text : '';

    if (message.stop_reason === 'max_tokens') {
      console.error('essay-improve-summary truncated', {
        stopReason: message.stop_reason,
        rawTextTail: text.slice(-200),
      });
      logAiUsage({
        route: ROUTE,
        model: MODEL,
        status: 'truncated',
        usage: message.usage,
      });
      return Response.json(
        {
          error: 'AI_SUMMARY_TRUNCATED',
          message:
            'AI のまとめ生成が途中で終了しました。もう一度お試しください。',
        },
        { status: 502 },
      );
    }

    let parsed: unknown = {};
    let parseOk = true;
    try {
      parsed = JSON.parse(extractJson(text));
    } catch {
      parseOk = false;
      console.error(
        'essay-improve-summary: JSON parse failed. rawTextTail:',
        text.slice(-200),
      );
    }

    logAiUsage({
      route: ROUTE,
      model: MODEL,
      status: parseOk ? 'success' : 'parse_failed',
      usage: message.usage,
    });

    return Response.json(safeParseImproveSummary(parsed));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('essay-improve-summary API error:', msg);
    logAiUsage({ route: ROUTE, model: MODEL, status: 'failed' });
    return Response.json(
      { error: 'AIの処理に失敗しました。時間をおいてお試しください。' },
      { status: 500 },
    );
  }
}
