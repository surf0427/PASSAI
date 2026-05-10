import { anthropic } from '@/lib/ai';
import type { BasicInfo } from '@/types/basicInfo';
import { buildBasicInfoPromptSection } from '@/lib/buildBasicInfoPromptSection';
import { buildEssayUniversityContext } from '@/lib/buildEssayUniversityContext';

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

  const systemPrompt = `あなたは高校生・大学受験生向けの小論文指導者です。
生徒が自分の力で考え、自分の言葉で書けるよう、思考を促す役割だけを担います。

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
      model: 'claude-sonnet-4-6',
      max_tokens: 120,
      temperature: 0.3,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userMessage,
        },
      ],
    });

    const reply = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    return Response.json({ reply });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('essay-chat API error:', msg);
    return Response.json({ error: 'AIの処理に失敗しました。時間をおいてお試しください。' }, { status: 500 });
  }
}
