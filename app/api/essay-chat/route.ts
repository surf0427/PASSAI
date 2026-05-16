import { anthropic } from '@/lib/ai';
import type { BasicInfo } from '@/types/basicInfo';
import { buildBasicInfoPromptSection } from '@/lib/buildBasicInfoPromptSection';
import { buildEssayUniversityContext } from '@/lib/buildEssayUniversityContext';
import { logAiUsage } from '@/lib/aiUsageLog';
// STEP15h: subjectGrades semantic instruction を SYSTEM_PROMPT に接続する。
// essay-chat は cache を持たないため PROMPT_VERSION bump 対象外。
// 文言改修は PR description で明示する。
import {
  SUBJECT_GRADES_SHARED_INSTRUCTION,
  SUBJECT_GRADES_ASYMMETRY_RULE,
} from '@/lib/prompts';

// 使用 model / route 識別子の constant 化（messages.create() と usage log で共有）。
// /api/analysis 系列と同じパターン。
// 本 route は plain text 応答（JSON parse なし）のため parse_failed は発生しない。
const MODEL = 'claude-sonnet-4-6';
const ROUTE = 'api/essay-chat';

// STEP15h: essay-chat 固有の subjectGrades 取り扱い制約。
// shared 側（lib/prompts.ts）で断定禁止・AO 推薦混同禁止・関連科目以外の過剰減点禁止は既に効いている。
// 本 route は plain text 応答で「次の問いかけ 1〜2 文」を返す軽量チャット。
// subjectGrades は問いかけ生成の文脈補助としてのみ使い、本筋の論点整理・構成・根拠深掘りを優先する。
const ESSAY_CHAT_SUBJECT_GRADES_QUALIFIER = `【essay-chat route での subjectGrades の使い方】
・subjectGrades は、チャット内で小論文の考え方を補助する文脈としてのみ使う。

・評定値や欠席日数を直接引用しない。

・ユーザーに返す助言は、小論文テーマ・論点整理・構成・根拠の深掘りを主軸にする。

・志望学部に関連しない低評定を、学習力や小論文力の弱点として扱わない。

・欠席日数がある場合でも、不利・不適格のような断定をしない。

・subjectGrades 未入力時は、評定や欠席を推測しない。`;

// STEP15h: systemPrompt を module-level export const に lift。
//   - shared 2 つ（SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE）と
//     route 固有 qualifier を役割宣言の直後・既存「絶対にやってはいけないこと」の前に挿入
//   - 既存の役割宣言・出力ルール・トーンは文言を変えない
//   - scripts/step15-qa.ts から本番経路を完全再現するため export する
//   - essay-chat は cache を持たないため PROMPT_VERSION bump 対象外
export const ESSAY_CHAT_SYSTEM_PROMPT = `あなたは高校生・大学受験生向けの小論文指導者です。
生徒が自分の力で考え、自分の言葉で書けるよう、思考を促す役割だけを担います。

${SUBJECT_GRADES_SHARED_INSTRUCTION}

${SUBJECT_GRADES_ASYMMETRY_RULE}

${ESSAY_CHAT_SUBJECT_GRADES_QUALIFIER}

【絶対にやってはいけないこと】
- 小論文の本文・完成文・模範解答を書くこと
- 「〜と書けます」「〜という文を入れましょう」のように、そのまま使える文を出すこと
- 長文で説明すること
- 答えを直接与えること

【あなたがやること】
次のうち1つだけ行い、必ず問いかけ・質問で締めること。
- 論理の弱点や飛躍を1つ具体的に指摘する
- 生徒が見落としている視点を1つ提示する
- 反対意見を1つ挙げ、どう反論するか考えさせる
- 具体例を自分で探すための質問をする

【生徒の志望情報を踏まえる】
受験生の志望大学・学部・学科・文理・受験方式が与えられている場合、その文脈で
「より説得力のある問い」を投げかけること。例：
- 文理が理系なら、データ・実験・科学的根拠で考えさせる
- 文理が文系なら、社会的影響・歴史的経緯で考えさせる
- 学科が指定されていれば、その専門領域に引き寄せて考えさせる

【出力ルール】
- 1〜2文のみ（最大120字程度）
- 必ず質問または問いかけで終える
- 具体的・簡潔・丁寧に
- 完成文は絶対に出さない`;

export async function POST(req: Request) {
  const body = await req.json();
  const theme: string = body.theme ?? '';
  const conclusion: string = body.conclusion ?? '';
  const reasonOne: string = body.reasonOne ?? '';
  const reasonTwo: string = body.reasonTwo ?? '';
  const essayBody: string = body.essayBody ?? '';
  const userQuestion: string = body.userQuestion ?? '';
  // basicInfo は任意。未送信や形が不正でも null として扱う。
  const basicInfo: BasicInfo | null = body.basicInfo ?? null;

  if (!userQuestion.trim()) {
    return Response.json({ error: '質問を入力してください' }, { status: 400 });
  }

  const basicInfoSection = buildBasicInfoPromptSection(basicInfo);
  const firstPreference = basicInfo?.preferences?.[0];
  const essayUniversityContext = buildEssayUniversityContext({
    university: firstPreference?.university ?? '',
    faculty: firstPreference?.faculty ?? '',
    department: firstPreference?.department ?? '',
  });

  const userMessage = `${basicInfoSection}

${essayUniversityContext ? `${essayUniversityContext}\n\n` : ''}【テーマ】
${theme}

【生徒の結論（1文）】
${conclusion || '（未記入）'}

【生徒の理由①】
${reasonOne || '（未記入）'}

【生徒の理由②】
${reasonTwo || '（未記入）'}

【生徒の本文】
${essayBody || '（未記入）'}

【生徒の相談内容】
${userQuestion}`;

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      // 暫定: 120 だと日本語で 1〜2 文を出し切る前に max_tokens で切れて単語の途中で
      // 終わる事故が出ていた。400 に引き上げ、加えて下の stop_reason ガードで途中切れを弾く。
      // 長期的にはプロンプトで字数を絞ったうえで再度下げる余地あり。
      max_tokens: 400,
      temperature: 0.3,
      system: ESSAY_CHAT_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: userMessage,
        },
      ],
    });

    // max_tokens で途中終了した reply はそのままだと単語の途中で切れて表示されるため、
    // 文字列として返さずに 502 + ユーザー向けメッセージで弾く。
    if (message.stop_reason === 'max_tokens') {
      const rawTail = message.content[0].type === 'text' ? message.content[0].text.slice(-200) : '';
      console.error('essay-chat truncated', { stopReason: message.stop_reason, rawTextTail: rawTail });
      logAiUsage({ route: ROUTE, model: MODEL, status: 'truncated', usage: message.usage });
      return Response.json(
        {
          error: 'AI_REPLY_TRUNCATED',
          message: 'AIの返答が途中で終了しました。もう一度お試しください。',
        },
        { status: 502 },
      );
    }

    const reply = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    logAiUsage({ route: ROUTE, model: MODEL, status: 'success', usage: message.usage });
    return Response.json({ reply });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('essay-chat API error:', msg);
    // 例外経路: messages.create() が throw した時点で response が無いため usage は取れない。
    // status のみログして「失敗回数」を集計できる状態にする（analysis 系列と共通方針）。
    logAiUsage({ route: ROUTE, model: MODEL, status: 'failed' });
    return Response.json({ error: 'AIの処理に失敗しました。時間をおいてお試しください。' }, { status: 500 });
  }
}
