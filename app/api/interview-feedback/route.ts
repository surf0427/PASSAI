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
import { toStudentProfile } from '@/lib/studentProfile';
import { isStudentProfile } from '@/lib/studentProfileStorage';
import { buildInterviewStudentProfileContext } from '@/lib/contextBuilders/interviewContext';
import { feedbackToText } from '@/lib/interview/feedbackToText';
import { fillEchoBackFromInput } from '@/lib/interview/normalizeInterviewFeedback';
import { logAiUsage } from '@/lib/aiUsageLog';
// STEP15e: subjectGrades semantic instruction を SYSTEM_PROMPT に接続する。
// 文字列の中身は lib/prompts.ts に集約。本ファイルは「interview-feedback でどう使うか」だけ持つ。
// これら 2 つの const の文字列が lib/prompts.ts 側で変わった場合、本 route には PROMPT_VERSION
// 概念が無い（interview-feedback は cache を持たない）ため bump 対象外。ただし PR 上で改修を明示すること。
import {
  SUBJECT_GRADES_SHARED_INSTRUCTION,
  SUBJECT_GRADES_ASYMMETRY_RULE,
} from '@/lib/prompts';

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

// ── STEP2.1: static rule を system パラメータへ切り出し ──────────
// 「毎回変わらない指示」（役割宣言・出力スキーマ・各種ルール）を SYSTEM_PROMPT に固定し、
// user 側には「今回の入力データ」だけを渡す。これにより:
//   1. user prompt のサイズが大幅に縮小し、毎回送る token を削減
//   2. 将来 prompt caching（cache_control）を system 部にかけられる構造になる
// 現状 prompt caching 自体は未実装（STEP2.4 以降の準備として構造のみ整理）。
//
// STEP15e: subjectGrades semantic instruction を SYSTEM_PROMPT に接続する。
//   - shared 2 つ（SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE）を import
//   - route 固有の field-level 制約（levelEvaluation 不可侵 / betterAnswer 数値直書き禁止 等）は
//     下記 INTERVIEW_FEEDBACK_SUBJECT_GRADES_QUALIFIER に書く。route 内 const のため非 export。
//   - 挿入位置は役割宣言と JSON 出力指示の直後・既存 JSON schema の前。
//   - user prompt（POST handler 内の userPrompt 組み立て）は本 STEP では 1 文字も変えない。
//   - interview-feedback は localStorage cache に PROMPT_VERSION 概念を持たない（cache 自体なし）。
//     そのため bump 対象外。文言改修は PR description で明示する。

// interview-feedback 固有の subjectGrades 取り扱い制約。
// levelEvaluation の 5 軸（logical / concrete / consistency / originality / interviewReadiness）
// には絶対に subjectGrades を反映させない。betterAnswer も評定値・欠席日数を直書き禁止。
// improvements / nextPractice 配列の先頭は面接回答そのものの最重要改善点を優先する。
// shared 側（lib/prompts.ts）で断定禁止・AO 推薦混同禁止・関連科目以外の過剰減点禁止は既に効いている。
const INTERVIEW_FEEDBACK_SUBJECT_GRADES_QUALIFIER = `【interview-feedback route での subjectGrades の使い方】
・subjectGrades は、面接回答の評価点そのものではなく、次回の回答準備・説明準備の補助文脈としてのみ使う。

・levelEvaluation の各項目（logical / concrete / consistency / originality / interviewReadiness）には subjectGrades を絶対に反映しない。評価は実際の面接回答の質のみで行う。

・betterAnswer に評定値（"英語4.8"等）や欠席日数の値（"18日"等）を直接書かない。betterAnswer は受験生本人の回答改善例であり、成績表の引用欄ではない。

・improvements[0] / nextPractice[0] は、面接回答そのものの最重要改善点を優先する。subjectGrades 由来の助言を配列の先頭に置かない。

・志望学部に関連する科目の高評定は、必要な場合のみ「面接で補強材料として語れる可能性がある」程度に留めて improvements / nextPractice の後半に書く。

・志望学部に関連しない科目の低評定を、面接上の主要弱点として扱わない。

・欠席日数がある場合は、「背景を簡潔に説明できるよう準備する」方向で扱う。「不利」「不適格」「推薦に不向き」等の断定をしない。

・subjectGrades 未入力時は、評定や欠席に関する改善提案を作らない。`;

// 本 const は scripts/step15-qa.ts から再利用するため export する。
// 非 export だとテストハーネスから本番経路を完全再現できず QA 価値が落ちる。
export const INTERVIEW_FEEDBACK_SYSTEM_PROMPT = `あなたは大学の総合型選抜・学校推薦型選抜に詳しい面接指導者です。
受験生の「質問と回答のペア」を分析し、必ず以下のJSON形式だけで返してください。JSON以外のテキストは一切含めないでください。

${SUBJECT_GRADES_SHARED_INSTRUCTION}

${SUBJECT_GRADES_ASYMMETRY_RULE}

${INTERVIEW_FEEDBACK_SUBJECT_GRADES_QUALIFIER}

{
  "overallEvaluation": "面接全体の評価（2〜3文）",
  "goodPoints": ["回答全体で良かった点1（なぜ良いかをセットで）", "良かった点2"],
  "improvements": ["全体的に直すべき点1（なぜ弱いか・どう直すかをセットで）", "直すべき点2"],
  "perQuestionFeedback": [
    {
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
      "followUps": [
        "回答内容をもとにした深掘り質問1（回答中の具体語を使うこと）",
        "回答内容をもとにした深掘り質問2（不足情報・曖昧点を突く）"
      ]
    }
  ],
  "nextPractice": ["次回改善すべき具体的アクション1", "アクション2"]
}

※ perQuestionFeedback の質問文・回答文、および followUpQuestions の元質問文は出力しないこと。これらはサーバ側で元入力から補完される。AI は評価と提案だけに集中すること。

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
  - 再現性（その姿勢・能力は他の場面でも通用するか）

【トーンと文体（厳守）】
・受験生が「次に何を直すか」を最短で掴めることを最優先する
・前置き・挨拶・総評の言い換え・自己言及（「以下に評価を…」等）を書かない
・「素晴らしい」「とても良い」など称賛だけの修飾は使わない。指摘は事実ベースで端的に
・同じ趣旨を別の言い方で繰り返さない
・1 文は短く（目安 60 字以内）。改行・読点で区切って読みやすくする
・説教調や精神論を避け、行動レベルの指示にする

【優先度の付け方（必須）】
・improvements は「直すと最も差が出る順」に並べる。配列の 0 番目が最重要
・perQuestionFeedback[].improvement も「最初の 1 文で最重要点」を言い切る
・nextPractice は「明日からやれる順」で並べる。配列の 0 番目が最初にやること

【出力長の上限（途中切れと冗長化を防ぐため必ず守ること）】
・overallEvaluation は 300〜400 字以内（前置きなし、結論から書く）
・goodPoints / improvements の各要素は 80〜120 字以内
・perQuestionFeedback[].evaluation / improvement は各 80〜120 字以内
・perQuestionFeedback[].betterAnswer は 180〜220 字以内
・nextPractice の各要素は 80 字以内
・followUps の各要素は 60 字以内

【betterAnswer の作り方】
・面接で実際に話す音声を想定し、30〜45 秒で言い切れる長さにする
・暗記文・テンプレ文に見えないよう、1 文を短く区切る
・「私は」「と考えます」を多用しない。語尾は自然にばらす
・抽象語（成長した・頑張った 等）は最小限にし、具体的な行動・結果を 1 つは入れる
・【自己分析サマリー】の強み・代表エピソードを「そのまま読み上げる」のは禁止。
  自分の言葉に置き換え、行動・結果の中に滲ませる
・【自己分析サマリー】の価値観タグは精神論として羅列せず、
  「行動 → 結果」の文脈の中に 1〜2 個だけ自然に織り込む`;

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
    const studentProfileFromBody: StudentProfile | null = isStudentProfile(body.studentProfile)
      ? body.studentProfile
      : null;
    const studentProfile: StudentProfile | null =
      studentProfileFromBody ?? (wallHittingResult ? toStudentProfile(wallHittingResult) : null);

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
    //   - INTERVIEW_FEEDBACK_SYSTEM_PROMPT (固定): 上で宣言済み
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
    });

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
