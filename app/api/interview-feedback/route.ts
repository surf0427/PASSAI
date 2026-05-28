import { NextResponse } from 'next/server';
import { anthropic } from '@/lib/ai';
import type { InterviewFeedback } from '@/types/interview';
import type { BasicInfo } from '@/types/basicInfo';
import type { WallHittingResult } from '@/types/analysis';
import type { StudentProfile } from '@/types/studentProfile';
import { buildBasicInfoPromptSection } from '@/lib/buildBasicInfoPromptSection';
import { buildInterviewUniversityContext } from '@/lib/buildInterviewUniversityContext';
import { getAdmissionFocusContextForUser } from '@/lib/admissionFocus/getAdmissionFocusContextForUser';
import { parseFacultyName } from '@/lib/parseFacultyName';
import { getStudentProfileFromRequest } from '@/lib/getStudentProfileFromRequest';
import { buildInterviewStudentProfileContext } from '@/lib/contextBuilders/interviewContext';
import { feedbackToText } from '@/lib/interview/feedbackToText';
import { fillEchoBackFromInput } from '@/lib/interview/normalizeInterviewFeedback';
import { logAiUsage } from '@/lib/aiUsageLog';
import { createTimeoutSignal } from '@/lib/aiTimeout';
// STEP-LIB-03: SYSTEM_PROMPT を lib/prompts/interviewFeedbackPrompt.ts に lift した。
// 本 route はそれを import して anthropic.messages.create の system に渡すだけ。
// interview-feedback は localStorage cache に PROMPT_VERSION 概念を持たない（cache 自体なし）
// ため bump 対象外。文言改修は PR description で明示する。
import { INTERVIEW_FEEDBACK_SYSTEM_PROMPT } from '@/lib/prompts/interviewFeedbackPrompt';

// 使用 model / route 識別子の constant 化（messages.create() と usage log で共有）。
// /api/analysis 系列と同じパターン。本 route は Opus を使う（他 5 route の Sonnet と異なる）。
const MODEL = 'claude-opus-4-7';
const ROUTE = 'api/interview-feedback';

export type { InterviewFeedback };

// JSON → improvementSummary 文字列変換 (feedbackToText / generateComparison /
// LEVEL_LABEL / LEVEL_AXES / levelToNumber / formatLevelEvaluation) は
// lib/interview/feedbackToText.ts に切り出した。出力フォーマットは完全に同一。

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

// ── STEP2.1: max_tokens の動的計算 ────────────────────────────────
// 質問数 N に応じて出力上限を変える。下記係数の根拠（STEP2 調査より）:
//   MAX_TOKENS_FIXED       : overallEvaluation + goodPoints + improvements + nextPractice の合計目安
//   MAX_TOKENS_PER_QUESTION: evaluation + improvement + betterAnswer + levelEvaluation + followUps の 1 問あたり目安
//   MAX_TOKENS_BUFFER      : JSON 構造・余裕分
//   MAX_TOKENS_MIN         : 最低保証（質問 0–1 でも 1500 確保）
//   MAX_TOKENS_MAX         : 上限ガード（8 問超で truncation を許容しつつ output 量と単価を抑える）
//
// この導入により、N=2–3 では 6000 固定よりも控えめ、N=5 では同程度、N=8 では truncation 直前まで自動拡張される。
//
// STEP2.5: MAX_TOKENS_PER_QUESTION を 1100 → 900 へ再チューニング。
//   STEP2.2 の echo back 削除（question / answer / originalQuestion）で 1 問あたりの
//   実出力が ~1100 → ~720 tokens に縮小したため、過剰になっていた margin を圧縮する。
//   - N=3 で −15%、N=5 で −16% の上限縮小（cap が効く N=8 は不変）
//   - 中央実態 720 に対し +25% margin を確保するため truncation リスクは低い
//   - Sonnet 4-6 切替後も安全圏（Sonnet は経験則で Opus よりやや短文）
const MAX_TOKENS_FIXED = 400;
const MAX_TOKENS_PER_QUESTION = 900;
const MAX_TOKENS_BUFFER = 400;
const MAX_TOKENS_MIN = 1500;
const MAX_TOKENS_MAX = 8000;

function calculateInterviewMaxTokens(questionCount: number): number {
  const computed =
    MAX_TOKENS_FIXED + questionCount * MAX_TOKENS_PER_QUESTION + MAX_TOKENS_BUFFER;
  return Math.min(Math.max(computed, MAX_TOKENS_MIN), MAX_TOKENS_MAX);
}

// SYSTEM_PROMPT（INTERVIEW_FEEDBACK_SYSTEM_PROMPT）は lib/prompts/interviewFeedbackPrompt.ts に lift 済み（STEP-LIB-03）。
// 役割（不変）: 役割宣言 / 出力 JSON schema / 各種ルール（重要・followUp・levelEvaluation・トーン・優先度・長さ・betterAnswer）の static 部。
// 切り出し動機は「毎回不変の指示を system に固定し、user 側には今回の入力データだけを渡す」STEP2.1 の構造。
// 本 route は SYSTEM_PROMPT を import して anthropic.messages.create の system に渡すだけ。
// user prompt（可変部）は下記 POST handler 内で組み立てる。

// AI 出力 JSON normalize (fillEchoBackFromInput / sanitizeStringArray /
// normalizeLevelEvaluation / lookupPair) は lib/interview/normalizeInterviewFeedback.ts に
// 切り出した。戻り値 InterviewFeedback shape および defensive guard 挙動は完全に同一。

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

    // 自己分析の壁打ち結果（任意）。直接 prompt に埋め込まないのが重要：
    // WallHittingResult は questions / answers などのフロー内部の作業状態を含み得るため、
    // 必ず StudentProfile 経由にする。
    //   1. body.studentProfile（クライアントが localStorage の canonical artifact から送ったもの）を最優先
    //   2. 無ければ body.wallHittingResult から toStudentProfile() で派生（後方互換）
    //   3. どちらも無ければ null（自己分析セクションは prompt に含まれない）
    // TODO: クライアント側（InterviewRecordForm）も getStudentProfileForFeature 経由で
    //   studentProfile を送る形に移行する。今は server-side 受け口だけ先行整備。
    const wallHittingResult: WallHittingResult | null = body.wallHittingResult ?? null;
    const studentProfile: StudentProfile | null = getStudentProfileFromRequest({
      body,
      fallbackSource: wallHittingResult,
    });

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
    // STEP2c: 入試方式の型タグ context を「大学側情報」クラスタに並べる。
    // faculty が解決できない場合は wrapper を呼ばない（学部・学科未指定で大学全体の
    // entries が合算されると「面接10回」のような誤った集約値が AI に渡るため）。
    // dry-run の CASE I で確認済みのガード。
    //
    // PR8b / H1 marker:
    //   admissionFocusContext は state C で末尾に STATE_C_AI_NOTE
    //   （「型名そのものをフィードバック文中で強調せず観点として活用する」）を含む。
    //   ただし現状この note は **user prompt の末尾** に乗っており、SYSTEM_PROMPT
    //   への lift (future trigger T2、incremental_refactor_policy.md 既登録) が
    //   未施行のため、AI に対する strong signal にならない可能性がある。
    //   feedback 文中に「面接重視型」「活動アピール型」等の type label が literal
    //   引用されていないことは **manual QA で必ず確認**する。発生していたら T2 で
    //   SYSTEM_PROMPT lift を実施し、prompt caching の対象に格上げする。
    //
    // PR8b / H4 marker:
    //   admissionFocusContext (~400-600 chars) が userPrompt に毎回乗ることで
    //   prompt token が約 +10-15% 増加する（state A の空文字経路を除く）。
    //   interview-feedback は Opus model (claude-opus-4-7) を使うためコスト影響が
    //   小さくない。これは **intentional tradeoff**: 大学側の評価軸を踏まえた
    //   feedback 品質向上を優先する判断（PR9d audit の決定）。token compression
    //   (admissionFocusContext と statement / studentProfile の情報重複削減) や
    //   Opus → Sonnet downgrade は別 STEP で評価する。
    const { faculty, department } = parseFacultyName(facultyName);
    const admissionFocusContext = faculty
      ? getAdmissionFocusContextForUser({
          university: universityName,
          faculty,
          department,
          examTypes: basicInfo?.examTypes,
        })
      : '';
    // 面接向けに絞った StudentProfile セクション。null なら空文字。
    const studentProfileSection = buildInterviewStudentProfileContext(studentProfile);

    // STEP2.1: 旧 const prompt は static rule（役割宣言・出力スキーマ・各種ルール）と
    // 動的入力（basicInfo / 受験情報 / context / 質問回答）を 1 本に結合していたため、
    // 毎回 8000 字超の user 入力を Claude に送っていた。
    // 切り出し後:
    //   - INTERVIEW_FEEDBACK_SYSTEM_PROMPT (固定): lib/prompts/interviewFeedbackPrompt.ts に lift 済み（STEP-LIB-03）
    //   - userPrompt (可変): 「今回の入力データ」のみ
    // 構造は将来の prompt caching（cache_control）導入の足場でもある。
    const userPrompt = `${basicInfoSection}

【受験情報（今回の練習で対象とした内容）】
大学名：${universityName}
学部・学科：${facultyName}
志望理由：${motivation || '（未入力）'}
${examTypeGuidance ? `\n${examTypeGuidance}\n` : ''}
${interviewUniversityContext ? `${interviewUniversityContext}\n\n` : ''}${admissionFocusContext ? `${admissionFocusContext}\n\n` : ''}${studentProfileSection ? `${studentProfileSection}\n\n` : ''}【質問と回答】
${qaText}`;

    // STEP2.1: max_tokens を質問数ベースで動的化する。
    // 新形式 questionsAndAnswers の件数を優先、空（legacy フォールバック経路）の場合は 5 を仮定。
    // N=8 超でも MAX_TOKENS_MAX (8000) で打ち切るため Anthropic 上限と output コストを抑えられる。
    const questionCount = questionsAndAnswers.length > 0 ? questionsAndAnswers.length : 5;
    const maxTokens = calculateInterviewMaxTokens(questionCount);

    // STEP2.4: Anthropic prompt caching を system 部にのみ適用する。
    //   - SYSTEM_PROMPT は毎回不変（役割宣言・出力スキーマ・各種ルールの static 部）
    //   - userPrompt は毎回変化する (qaText / StudentProfile / basicInfo / previousFeedback 経由の値)
    //   → system のみキャッシュ対象とすることで、5 分以内の連続呼び出しで input 単価を
    //     ~90% 割引にできる（Anthropic prompt caching 仕様）。
    //   string 形式から TextBlockParam[] 形式に変えるだけで、SYSTEM_PROMPT の中身・出力 schema・
    //   model パラメータ・max_tokens formula は不変。
    //   SDK: @anthropic-ai/sdk@0.91.1 で cache_control: { type: 'ephemeral' } を型安全に指定可能。
    // 本 route は Opus 4-7 を使い max_tokens が動的に最大 8000 まで膨らむ（質問数依存）。
    // Sonnet 系よりも 1 トークンあたりの生成時間が長く、長尺出力で 60 秒に迫る可能性があるため
    // timeout を 90 秒に延長する（STEP-API-TIMEOUT-01）。
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: [
        {
          type: 'text',
          text: INTERVIEW_FEEDBACK_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    }, { signal: createTimeoutSignal(90_000) });

    const textBlock = response.content.find((b) => b.type === 'text');
    const rawText = textBlock?.type === 'text' ? textBlock.text.trim() : '';

    // max_tokens で途中終了した出力は JSON が壊れているため、parse 前に明示エラーで弾く。
    // rawText をそのままユーザーに見せると「この改」のような途中文字列が画面に出てしまう。
    if (response.stop_reason === 'max_tokens') {
      console.error('interview-feedback truncated', {
        stopReason: response.stop_reason,
        rawTextTail: rawText.slice(-200),
      });
      logAiUsage({ route: ROUTE, model: MODEL, status: 'truncated', usage: response.usage });
      return NextResponse.json(
        {
          error: 'AI_FEEDBACK_TRUNCATED',
          message: 'AIの出力が途中で終了しました。もう一度お試しください。',
        },
        { status: 502 },
      );
    }

    // JSON parse を試みる。失敗時は rawText を露出させず構造化エラーで返す。
    try {
      // STEP2.2: AI 出力には question / answer / originalQuestion を含めない schema にしたため、
      // unknown として parse し、fillEchoBackFromInput で input qaPairs から補完して
      // InterviewFeedback を確定する。出力 shape は不変。
      const rawFeedback: unknown = JSON.parse(rawText);
      const feedback = fillEchoBackFromInput(rawFeedback, questionsAndAnswers);
      const improvementSummary = feedbackToText(feedback, previousFeedback);
      logAiUsage({ route: ROUTE, model: MODEL, status: 'success', usage: response.usage });
      return NextResponse.json({ feedback, improvementSummary });
    } catch {
      console.error('interview-feedback parse failed', {
        stopReason: response.stop_reason,
        rawTextTail: rawText.slice(-200),
      });
      logAiUsage({ route: ROUTE, model: MODEL, status: 'parse_failed', usage: response.usage });
      return NextResponse.json(
        {
          error: 'AI_FEEDBACK_PARSE_FAILED',
          message: 'AIの出力を正しく読み取れませんでした。もう一度お試しください。',
        },
        { status: 502 },
      );
    }
  } catch (error) {
    console.error('Interview feedback generation error:', error);
    // 例外経路: messages.create() / request.json() が throw した時点で response が無いため
    // usage は取れない。status のみログして「失敗回数」を集計できる状態にする。
    logAiUsage({ route: ROUTE, model: MODEL, status: 'failed' });
    return NextResponse.json(
      { error: 'AIフィードバックの生成に失敗しました。' },
      { status: 500 }
    );
  }
}
