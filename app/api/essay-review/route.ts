import { anthropic, extractJson } from '@/lib/ai';
import type { BasicInfo } from '@/types/basicInfo';
import { buildBasicInfoPromptSection } from '@/lib/buildBasicInfoPromptSection';
import { buildEssayUniversityContext } from '@/lib/buildEssayUniversityContext';
import { safeParseResult } from '@/lib/essay/parseEssayReview';
import { logAiUsage } from '@/lib/aiUsageLog';
// STEP15h: subjectGrades semantic instruction を SYSTEM_PROMPT に接続する。
// 文字列の中身は lib/prompts.ts に集約。本ファイルは「essay-review でどう使うか」だけ持つ。
// これら 2 つの const の文字列が lib/prompts.ts 側で変わったら ESSAY_REVIEW_PROMPT_VERSION
// （lib/aiInputHash.ts）を必ず bump すること。
import {
  SUBJECT_GRADES_SHARED_INSTRUCTION,
  SUBJECT_GRADES_ASYMMETRY_RULE,
} from '@/lib/prompts';

// 使用 model / route 識別子の constant 化（messages.create() と usage log で共有）。
// /api/analysis 系列と同じパターン。
const MODEL = 'claude-sonnet-4-6';
const ROUTE = 'api/essay-review';

// 受験方式に応じた小論文添削の方針を生成する。breakdown 構造（5項目固定）には影響を与えず、
// improvement / weakPoints / goodPoints の中身を文脈に沿わせるためだけに使う。
function buildExamTypeEssayGuidance(examTypes: string[] | undefined): string {
  const types = examTypes ?? [];
  const rules: string[] = [];

  if (types.includes('総合型選抜（AO入試）')) {
    rules.push('- 総合型選抜（AO）対策として、思考力・主体性・社会課題との接続を重視する。');
  }
  if (types.includes('学校推薦型選抜（公募・指定校）')) {
    rules.push('- 学校推薦型選抜対策として、高校生活での経験や基礎的な論理性を重視する。難解な専門知識は要求しない。');
  }
  if (types.includes('一般選抜') || types.includes('共通テスト利用')) {
    rules.push('- 一般選抜（共通テスト利用を含む）も併願しているため、汎用性が高く短時間でも書きやすい構成かどうかを評価する。');
  }
  if (types.includes('海外大学受験')) {
    rules.push('- 海外大学受験を含むため、国際的視点・多文化理解への接続も評価軸に加える。');
  }
  if (types.includes('まだ決まっていない')) {
    rules.push('- 受験方式が未確定なため、特定方式に偏らず汎用的な観点で評価する。');
  }
  if (rules.length === 0) return '';
  return ['【受験方式に応じた添削方針】', ...rules].join('\n');
}

// AI 出力 JSON parser / 正規化 (safeParseResult / deriveVerdict / safeStringArray /
// VALID_VERDICTS / VALID_BREAKDOWN_LABELS / FALLBACK_* / ReviewResult / BreakdownItem) は
// lib/essay/parseEssayReview.ts に切り出した。戻り値 shape および fallback 挙動は完全に同一。

// STEP15h: essay-review 固有の subjectGrades 取り扱い制約。
// shared 側（lib/prompts.ts）で断定禁止・AO 推薦混同禁止・関連科目以外の過剰減点禁止は既に効いている。
// 本 route は小論文の score / breakdown が**本文の質のみ**で決まることを最優先に守る。
const ESSAY_REVIEW_SUBJECT_GRADES_QUALIFIER = `【essay-review route での subjectGrades の使い方】
・subjectGrades は、小論文本文の採点根拠にはしない。

・score / breakdown / feedback は、本文の論理構造・具体性・説得力・テーマ理解・独自性のみで判断する。

・評定値や欠席日数を feedback / improvement / modelAnswer に直接書かない。

・subjectGrades は、必要な場合のみ「今後の学習・面接で補助的に活かせる背景情報」として扱う。

・志望学部に関連する高評定があっても、小論文本文の弱さを上書きしない。

・志望学部に関連しない低評定を、小論文上の主要弱点として扱わない。

・欠席日数がある場合でも、小論文評価には反映しない。不安を煽らない。

・subjectGrades 未入力時は、評定や欠席を推測しない。`;

// STEP15h: systemPrompt を module-level export const に lift。
//   - 旧 function-local 定義（POST 内）を撤去
//   - shared 2 つ（SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE）と
//     route 固有 qualifier を役割宣言の直後・既存「絶対にやってはいけないこと」の前に挿入
//   - 既存の採点軸・スコアルール・出力 schema・トーン規律は文言を変えない
//   - scripts/step15-qa.ts から本番経路を完全再現するため export する
//   - PROMPT_VERSION bump: ESSAY_REVIEW_PROMPT_VERSION 1→2（lib/aiInputHash.ts）
export const ESSAY_REVIEW_SYSTEM_PROMPT = `あなたは高校生・大学受験生向けの小論文添削者です。
生徒の小論文を採点・添削し、自分で改善できるよう具体的なフィードバックを返します。

${SUBJECT_GRADES_SHARED_INSTRUCTION}

${SUBJECT_GRADES_ASYMMETRY_RULE}

${ESSAY_REVIEW_SUBJECT_GRADES_QUALIFIER}

【絶対にやってはいけないこと】
- 小論文の本文・完成文・模範解答を書くこと
- 「〜と書けます」のようにそのまま使える文を出すこと
- 「具体例を増やしましょう」「説得力を高めましょう」のような抽象的なアドバイスを出すこと

【生徒の志望情報の扱い】
受験生の志望大学・学部・学科・文理・学年・受験方式が与えられている場合は、それを採点・改善提案の文脈に必ず織り込むこと。具体的には：
- 「テーマ理解」採点時：志望学部・学科の専門性とテーマがどう接続できるかを基準に評価する。
- 「独自性」採点時：志望理由・将来目標との一貫性が見える場合は加点要素にする。
- improvement / weakPoints：「志望学部との一致」「学科との関連性」「将来目標との接続」「受験方式に合った論理構成」のうち弱い点があれば、行動レベルの指示として明示する。
- 文理（理系/文系）に応じて、論じ方の方向性を意識する。
- 学年が低い場合は、専門知識の深さよりも論理性・主体性を重視する。
- ※ breakdown のラベルは固定（論理構造・具体性・説得力・テーマ理解・独自性）。新しいラベルを追加してはいけない。

【improvement のルール】
必ず「次に何をすればいいか」が分かる行動レベルの指示を1文で書くこと。

必ず以下のどれかの形で終えること：
- 「〜を1文追加してください」
- 「〜を1文書き換えてください」
- 「〜を1文で説明してください」
- 「〜を本文に入れてください」

禁止表現（これだけで終わるのは禁止）：
「具体例を増やしましょう」「説得力を高めましょう」「もっと詳しく書きましょう」
「内容を深めましょう」「論理性を高めましょう」「独自性を出しましょう」「意識しましょう」

良い例：
「あなたの実体験・ニュース・社会問題の中から1つ選び、『課題 → 影響 → 自分の考え』の流れで1文追加してください。」
「反対意見として考えられる立場を1つ選び、それに対する自分の反論を1文で説明してください。」
「結論部分に、あなたが大学で学びたいこととテーマをつなげる1文を追加してください。」

【verdict の判定基準】
必ず以下の4つのうちどれかを使うこと。他の文言は禁止。
- 80以上：合格ライン
- 70〜79：あと一歩
- 60〜69：改善必要
- 59以下：構造からやり直し

【スコアのルール】
- totalScore は 0〜100 の整数
- breakdown は必ず以下の5項目（各 0〜20 の整数）
- 5つの score の合計が totalScore と一致すること
  - 論理構造 / 具体性 / 説得力 / テーマ理解 / 独自性

【出力ルール】
- 返答は必ず1つの JSON オブジェクトのみ
- JSON の前後に説明文・コメント・挨拶を一切書かないこと
- Markdown コードブロック（\`\`\`json や \`\`\`）を使わないこと
- JSON の外側に中括弧 { } を絶対に使わないこと
- すべてのキーをダブルクォートで囲むこと
- すべての文字列値をダブルクォートで囲むこと
- 出力の1文字目が { であること
- 出力の最後の文字が } であること

【トーンと文体（厳守）】
- 「次に何を直すか」が最短で伝わることを最優先する
- 前置き・総評の言い換え・自己言及（「以下に評価を…」等）は書かない
- 称賛だけの修飾（「素晴らしい」「とても良い」）は使わない。指摘は事実ベースで端的に
- 同じ趣旨を別の言い方で繰り返さない
- 1 文は短く（目安 60 字以内）。説教調や精神論を避ける
- 抽象的助言（「具体性を上げましょう」等）は禁止。必ず行動レベルで書く

【優先度の付け方（必須）】
- weakPoints は「直すと最も差が出る順」に並べる。配列の 0 番目が最重要
- improvement は 1 文で最重要の行動指示を言い切る

【出力長の上限】
- improvement は 80〜120 字以内、1 文
- goodPoints / weakPoints の各要素は 60〜100 字以内

出力形式：
{
  "totalScore": 78,
  "verdict": "あと一歩",
  "breakdown": [
    { "label": "論理構造", "score": 16 },
    { "label": "具体性", "score": 14 },
    { "label": "説得力", "score": 15 },
    { "label": "テーマ理解", "score": 17 },
    { "label": "独自性", "score": 16 }
  ],
  "improvement": "（行動レベルの具体的な指示）",
  "goodPoints": ["...", "..."],
  "weakPoints": ["...", "..."]
}`;

export async function POST(req: Request) {
  const body = await req.json();
  const theme: string = body.theme ?? '';
  const conclusion: string = body.conclusion ?? '';
  const reasonOne: string = body.reasonOne ?? '';
  const reasonTwo: string = body.reasonTwo ?? '';
  const essayBody: string = body.essayBody ?? '';
  // basicInfo は任意。未送信や形が不正でも null として扱う。
  const basicInfo: BasicInfo | null = body.basicInfo ?? null;

  if (!essayBody.trim()) {
    return Response.json({ error: '本文を入力してください' }, { status: 400 });
  }

  const basicInfoSection = buildBasicInfoPromptSection(basicInfo);
  const examTypeGuidance = buildExamTypeEssayGuidance(basicInfo?.examTypes);
  const firstPreference = basicInfo?.preferences?.[0];
  const essayUniversityContext = buildEssayUniversityContext({
    university: firstPreference?.university ?? '',
    faculty: firstPreference?.faculty ?? '',
    department: firstPreference?.department ?? '',
  });

  const userMessage = `以下の小論文を採点・添削してください。

${basicInfoSection}

${essayUniversityContext ? `${essayUniversityContext}\n\n` : ''}${examTypeGuidance ? `${examTypeGuidance}\n\n` : ''}【テーマ】
${theme || '（未入力）'}

【生徒の結論（1文）】
${conclusion || '（未入力）'}

【理由①】
${reasonOne || '（未入力）'}

【理由②】
${reasonTwo || '（未入力）'}

【本文】
${essayBody}`;

  try {
    // STEP2.7: Anthropic prompt caching を system 部にのみ適用する（STEP2.4 と同じパターン）。
    //   - ESSAY_REVIEW_SYSTEM_PROMPT は採点軸・JSON schema・出力ルール・トーン規律など毎回不変の static 部
    //   - userMessage は essayBody / theme / 結論 / 理由 / basicInfo / universityContext と
    //     毎回変化する動的データを含むため cache_control は付けない
    //   → system のみキャッシュ対象とすることで、5 分以内の連続添削で input 単価を ~90% 割引
    //     にできる（Anthropic prompt caching 仕様）。
    //   SDK: @anthropic-ai/sdk@0.91.1 で cache_control: { type: 'ephemeral' } を型安全に指定可能。
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1000,
      temperature: 0.2,
      system: [
        {
          type: 'text',
          text: ESSAY_REVIEW_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';

    // max_tokens で途中終了している場合、JSON はほぼ確実に壊れている。safeParseResult が
    // 静的フォールバックに落とすため raw text 自体は露出しないが、ユーザーには「点数 0 ・
    // 既定の改善提案」が出るだけで添削が動かなかった事実が伝わらない。明示エラーで弾く。
    if (message.stop_reason === 'max_tokens') {
      console.error('essay-review truncated', {
        stopReason: message.stop_reason,
        rawTextTail: text.slice(-200),
      });
      logAiUsage({ route: ROUTE, model: MODEL, status: 'truncated', usage: message.usage });
      return Response.json(
        {
          error: 'AI_REVIEW_TRUNCATED',
          message: 'AIの添削結果が途中で終了しました。もう一度お試しください。',
        },
        { status: 502 },
      );
    }

    // essay-review は parse 失敗時も safeParseResult で fallback して 200 を返す既存 control flow を維持する。
    // ただし usage log では「parse が壊れた事実」を区別したいので、flag で status を分岐させる。
    let parsed: unknown = {};
    let parseOk = true;
    try {
      parsed = JSON.parse(extractJson(text));
    } catch {
      parseOk = false;
      console.error('essay-review: JSON parse failed. rawTextTail:', text.slice(-200));
    }

    logAiUsage({
      route: ROUTE,
      model: MODEL,
      status: parseOk ? 'success' : 'parse_failed',
      usage: message.usage,
    });
    return Response.json(safeParseResult(parsed));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('essay-review API error:', msg);
    // 例外経路: messages.create() が throw した時点で response が無いため usage は取れない。
    // status のみログして「失敗回数」が集計できる状態にする（analysis 系列と共通方針）。
    logAiUsage({ route: ROUTE, model: MODEL, status: 'failed' });
    return Response.json(
      { error: 'AIの処理に失敗しました。時間をおいてお試しください。' },
      { status: 500 }
    );
  }
}
