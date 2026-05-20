// 面接質問生成 AI 用の prompt builder。
//
// 責務分離:
//   - system prompt（固定ルール・出力 schema・件数ルール・許可値）→ 本ファイルの const
//   - user prompt（毎回変わる素材）→ 本ファイルの builder
//   - 素材の trim / 正規化 / 圧縮 → lib/interview/buildInterviewQuestionMaterials.ts（別レーン）
//   - 大学DB context → lib/buildInterviewUniversityContext.ts（別レーン）
//   - 受験方式 guidance → 呼び出し側で用意して渡す（別レーン）
//   - Anthropic API 呼び出し → 将来の app/api/interview-questions/route.ts（未実装）
//
// 本ファイル単体では AI を呼ばない・storage を読まない・fetch しない純粋関数。
//
// 関連: types/interviewQuestions.ts / lib/interview/buildInterviewQuestionMaterials.ts

import type { InterviewQuestionMaterials } from '@/lib/interview/buildInterviewQuestionMaterials';
// STEP15c: subjectGrades semantic instruction（shared）を SYSTEM_PROMPT に接続する。
// 文字列の中身は lib/prompts.ts に集約。本ファイルは「interview-questions でどう使うか」だけ持つ。
// これら 2 つの const の文字列が lib/prompts.ts 側で変わったら INTERVIEW_QUESTIONS_PROMPT_VERSION
// （lib/aiInputHash.ts）を必ず bump すること。
import {
  SUBJECT_GRADES_SHARED_INSTRUCTION,
  SUBJECT_GRADES_ASYMMETRY_RULE,
} from '@/lib/prompts';
// STEP E: applicantType（5 種）由来の「傾向」1 行 helper。
// SYSTEM_PROMPT は本 STEP では 1 文字も変えない。user prompt 内の【自己分析サマリー】
// セクション末尾に optional 注入する。
import { formatInterviewApplicantTypeHint } from '@/lib/interview/applicantTypeHint';

// 出力 JSON schema と件数ルール・許可値を固定化する system prompt。
// 毎回不変なので将来 Anthropic prompt caching の cache_control 対象にできる構造に合わせる。
//
// IMPORTANT: この文字列を変更したら、lib/aiInputHash.ts の
// INTERVIEW_QUESTIONS_PROMPT_VERSION を必ず +1 すること。
// bump しないと既存の `interviewQuestionsCache` が古い prompt の出力を hit 扱いで
// 返し続け、prompt 改訂が end-user に届かない（stale cache）。
// route 側の MODEL を変更した場合は INTERVIEW_QUESTIONS_MODEL も同時に揃える。
//
// STEP15c: subjectGrades semantic instruction を SYSTEM_PROMPT に接続する。
//   - shared 2 つ（SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE）を import
//   - route 固有の field-level 制約（personalized 限定 / 数値直書き禁止 / personalized[0] の優先順位 等）は
//     下記 INTERVIEW_QUESTIONS_SUBJECT_GRADES_QUALIFIER に書く。route 内 const のため非 export。
//   - 挿入位置は役割宣言の直後・既存 JSON 出力指示の前。
//   - user prompt（buildInterviewQuestionUserPrompt / buildInterviewQuestionMaterials の戻り値）は
//     本 STEP では 1 文字も変えない。

// interview-questions 固有の subjectGrades 取り扱い制約。
// personalized 質問の観点としてのみ扱う / 質問文への数値直書き禁止 / personalized[0] の優先順位 /
// 欠席質問の文言誘導 など、field-level の制約をここで縛る。shared 側（lib/prompts.ts）で
// 断定禁止・AO/推薦混同禁止・関連科目以外の過剰減点禁止は既に効いている。
const INTERVIEW_QUESTIONS_SUBJECT_GRADES_QUALIFIER = `【本 route での subjectGrades の使い方】
・subjectGrades は personalized 質問の観点として扱う。general 質問には subjectGrades 由来の質問を入れない。

・質問文に評定数値（"4.8" "3.3" 等）や欠席日数の値（"18日" 等）を直接書かない。観点として使い、本人の言葉で語らせる質問にする。

・subjectGrades があり、志望学部に関連する科目に強い偏りが見える場合、その観点で personalized 質問を 1 問入れてよい。無理に評定主題の質問を作らない。

・強い偏りの目安は、関連科目の評定が 4.5 以上、関連科目の評定が 3.0 以下、または欠席日数が 10 日以上の場合とする。ただし機械的に断定せず、活動・志望理由との接続を優先する。

・欠席日数が値として与えられている場合、面接で説明準備を促す観点の personalized 質問を 1 問入れてよい。文言は「本人が背景を整理して語れるか」を確かめる方向にする。

・欠席質問の禁止文言例：「欠席が多いと推薦に不利では？」「出席日数が足りないので受からないのでは？」のように不安を煽る形にしない。

・志望学部に関連しない科目の低評定を質問の主題にしない。personalized[0] にも personalized 全体にも置かない。

・personalized[0] は「活動 × 志望理由」「自己分析 × 志望理由」など、2領域を橋渡しする質問を優先する。subjectGrades 由来の質問は personalized[1] 以降に置く。

・subjectGrades が未入力の場合、評定や欠席を主題にした質問を作らない。`;

export const INTERVIEW_QUESTION_SYSTEM_PROMPT = `あなたは大学の総合型選抜・学校推薦型選抜に詳しい面接指導の専門家です。
受験生の志望理由書・活動内容・自己分析・大学情報をもとに、面接で問われる質問を「一般質問」と「個別深掘り質問」の 2 層に分けて生成してください。

${SUBJECT_GRADES_SHARED_INSTRUCTION}

${SUBJECT_GRADES_ASYMMETRY_RULE}

${INTERVIEW_QUESTIONS_SUBJECT_GRADES_QUALIFIER}

必ず以下の JSON 形式だけで返してください。JSON 以外のテキスト・前置き・解説・markdown のコードフェンスは一切含めないでください。

{
  "general": [
    {
      "type": "general",
      "category": "motivation",
      "question": "string",
      "answerTip": "string"
    }
  ],
  "personalized": [
    {
      "type": "personalized",
      "category": "activity",
      "question": "string",
      "answerTip": "string",
      "sourceHint": "statement",
      "intent": "string"
    }
  ]
}

【件数ルール】
・general は必ず 5 問
・personalized は必ず 5 問
・件数を満たせない場合でも、捏造で水増ししないこと。受験生情報から正当に出せる範囲で生成する

【PASSAI の繋がり原則（最重要）】
本ツールは「活動 → 自己分析 → 志望理由書 → 面接」を一貫した物語として育てる支援が目的です。
personalized 質問は、できる限り 2 領域以上を橋渡しする観点で作ること:
・活動 × 志望理由（その活動経験は志望動機にどう繋がるのか）
・自己分析 × 志望理由（書類の強みは活動のどの瞬間に表れていたか）
・活動 × 将来目標（その活動から将来像に至るまでの中間ステップは何か）
・大学情報 × 志望理由（カリキュラム / AP のどこに自分の関心が結びつくのか）
1 領域だけで完結する単純な質問は personalized に置かない（それは general 側に近い）。

【general の方針】
・誰にでも聞かれる定番質問にする
・大学名・学部名・学科名が与えられている場合は自然に文中に反映してよい
・受験生個別の事情には踏み込みすぎない（個別事情は personalized 側で扱う）

【personalized の方針】
・志望理由書サマリー / 活動サマリー / 自己分析 / 大学DB情報 を根拠にした個別深掘りにする
・以下の観点を最低 1 問ずつ含める:
  - 志望理由書の本人性確認（authenticity_check）
  - 活動と志望理由の接続確認（consistency_check）
  - 大学理解の確認（university_fit）
  - 将来目標の具体性確認（future_goal）
  - 自己分析の浅さ・矛盾を突く質問（self_analysis / consistency_check）
・志望理由書本文をそのまま借りた質問にしない。語句を直接コピーせず、観点として抽象化する
・素材が無い領域については無理に質問を作らない（捏造より省略）
・「誰にでも当てはまる」質問は personalized に入れない。受験生の具体的な素材から導かれる質問にする

【category の許可値（必ずこの中から選ぶ）】
motivation / activity / self_analysis / university_fit / future_goal / consistency_check / authenticity_check

【sourceHint の許可値（personalized のみ任意で付与）】
statement / activity / self_analysis / university_db / admission_policy / selection_steps

【answerTip の作り方（厳守）】
・答え方の「観点」だけを書く（例: 結論→具体→学びの順で、行動と判断を 1 つ入れる）
・60〜120 字程度

【answerTip の禁止事項】
・模範回答・回答例・「こう答えると良い」のような代筆は禁止
・「〜と答えると評価される」「面接官は〜を見ている」のような評価予測を書かない
・「以下のように答える」「次のように答える」のような誘導文を書かない
・回答の構文（「私は◯◯です。なぜなら…」等の型）を提示しない
・志望理由書本文の語句を抜粋して回答例として再利用しない
・抽象的な精神論（しっかり・きちんと・頑張る 等）で終わらせない

【authenticity_check の作り方】
・志望理由書の表現が本人由来かを確かめる観点で作る
・以下のパターンを優先する:
  - 本文の抽象表現（学び・成長・気づき 等）を、実際にあった瞬間として具体エピソードで語らせる
  - 本文で選んだ選択（その活動・その大学・その学部）について、他に検討した選択肢と捨てた理由を語らせる
  - 本文の固有名詞・出来事名を、本文に書いていない別の言葉で説明させる
  - 本文には書かれていない裏側の事実（迷い・失敗・周囲との衝突 等）を引き出す
・本文の語句をそのまま AI が補完してそれを尋ねる形にしない（本人がもう一度書き写すだけになる）

【代筆禁止の最重要ルール】
・本ツールの教育目的は「受験生本人が自分の言葉で答えられるようになること」
・question / answerTip いずれにも、回答そのものを書かない
・「次のように答えるとよい」「以下のように…」「〜と答える」のような誘導文は禁止

【intent フィールドのルール（personalized 用）】
・intent は「この質問で何を引き出したいか」を 30 字以内で書く（例: 活動と志望理由の接続を確認 / 抽象表現の具体化 / 大学選定の必然性確認）
・受験生本人に見せる短いラベルとして使う前提。観点名 1〜2 語程度で完結させる
・長い説明文・主語付きの文章は禁止

【出力ルール】
・JSON 以外を一切出力しない（前置き・末尾の説明・markdown フェンス禁止）
・schema に無いフィールドを足さない
・category / sourceHint は許可値以外を使わない`;

// user prompt は可変情報のみを書く。
// 情報が無いセクションは「○○なし」と明示し、AI に「ない」ことを伝える。
// AI が空欄を勝手に補完しない方針（代筆防止・creator 創作防止）。
export function buildInterviewQuestionUserPrompt(input: {
  materials: InterviewQuestionMaterials;
  universityContext?: string | null;
  examTypeGuidance?: string | null;
  // 日次バリエーション seed（'YYYY-MM-DD'）。
  // 与えられた場合のみ末尾に【出題バリエーション指示】section を 1 つ追加する。
  // 未指定（undefined / null / 空）の場合は section を出さず、legacy prompt と byte-identical。
  // PROMPT_VERSION v5（lib/aiInputHash.ts）と紐づく。文言を変えたら同 file の bump 履歴を更新する。
  // v5 では section 内を 4 ブロック構造（固定重要枠 / 日替わり深掘り枠 / 接続確認枠 /
  // 偏りと喪失の禁止）に拡張し、最重要エピソード保護ルールを明文化している。
  dailySeed?: string | null;
}): string {
  const { materials, universityContext, examTypeGuidance, dailySeed } = input;

  const sections: string[] = [];

  // ── 受験生プロフィール（大学・学部・学科・受験方式） ─────────────
  sections.push(
    [
      '【受験生情報】',
      `大学：${materials.university ?? 'なし'}`,
      `学部：${materials.faculty ?? 'なし'}`,
      `学科：${materials.department ?? 'なし'}`,
      `受験方式：${
        materials.examTypes.length > 0 ? materials.examTypes.join(' / ') : 'なし'
      }`,
    ].join('\n'),
  );

  // ── 科目別評定・出席状況（任意・未入力時は section ごと出さない）─
  // STEP14: subjectGrades が入力されている時のみ追加。未入力ユーザーの prompt は
  // section が増えないため byte-identical に保たれる（hash 互換維持）。
  if (materials.subjectGradesLines.length > 0) {
    sections.push(materials.subjectGradesLines.join('\n'));
  }

  // ── 志望理由書サマリー ────────────────────────────────────────
  sections.push(
    [
      '【志望理由書サマリー】',
      materials.statementSummary ?? '志望理由書本文なし',
    ].join('\n'),
  );

  // ── 活動サマリー ─────────────────────────────────────────────
  sections.push(
    ['【活動サマリー】', materials.activitySummary ?? '活動サマリーなし'].join(
      '\n',
    ),
  );

  // ── 自己分析サマリー ─────────────────────────────────────────
  sections.push(buildSelfAnalysisSection(materials));

  // ── 大学DB情報 ───────────────────────────────────────────────
  const trimmedUnivContext = (universityContext ?? '').trim();
  sections.push(
    [
      '【大学DB情報】',
      trimmedUnivContext === '' ? '大学DB情報なし' : trimmedUnivContext,
    ].join('\n'),
  );

  // ── 受験方式ガイダンス ───────────────────────────────────────
  const trimmedGuidance = (examTypeGuidance ?? '').trim();
  sections.push(
    [
      '【受験方式に関するガイダンス】',
      trimmedGuidance === '' ? '受験方式ガイダンスなし' : trimmedGuidance,
    ].join('\n'),
  );

  // ── 出題バリエーション指示（v5: 固定/日替わり/接続/禁止 の 4 ブロック）───────
  // dailySeed が与えられた日のみ末尾に 1 section 追加。
  // 「personalized 5 問の主題と切り口」をどう動かす / どう動かさないかだけを語り、
  // system prompt 側で確定済みの構造（件数・許可値・必須 category・代筆禁止・
  // authenticity_check の作り方）には踏み込まない。
  const trimmedSeed = typeof dailySeed === 'string' ? dailySeed.trim() : '';
  if (trimmedSeed !== '') {
    sections.push(
      [
        '【出題バリエーション指示（personalized の主題選び）】',
        `本日の出題シード：${trimmedSeed}`,
        '本指示は personalized 5 問の「主題の選び方」と「切り口」だけを seed に応じて少しずらすためのもの。【件数ルール】【personalized の方針（観点最低 1 問ずつ）】【category / sourceHint の許可値】【authenticity_check の作り方】【代筆禁止の最重要ルール】は完全に維持する。',
        '',
        '【固定重要枠（seed に依らず毎回必ず含める）】',
        '・志望理由 / 大学理解 / 将来像（既に personalized の必須 category として確定済み）。',
        '・「最重要エピソード」を主題にした質問を最低 1 問。',
        '  - 最重要エピソードの判定: 志望理由書サマリー / 活動サマリー / 自己分析サマリー の 2 つ以上で繰り返し参照される、または最も詳細に語られている本人エピソードのこと。',
        '  - 明確に特定できない場合は、「最も志望理由と接続度が高い本人エピソード」を代替指定とする。',
        '',
        '【日替わり深掘り枠（seed に応じて主題を少し動かす）】',
        '・本人材料に複数のエピソード（部活 / 留学 / 探究活動 / ボランティア / 資格 / 課外活動 / 失敗経験 等）がある場合、seed をハッシュ的に解釈してその日の主要 deep-dive 対象を 1 つ選ぶ。',
        '・activity / consistency_check / self_analysis 系の personalized 質問の anchor を、当日 deep-dive 対象寄りに調整する。',
        '・同じエピソードでも日によって angle を変える: 時系列 / 判断軸 / 失敗と修正 / 他者との衝突 / 動機の変化 / 学びと現在への接続 など。',
        '',
        '【接続確認枠（毎回必ず含める）】',
        '・当日 deep-dive 対象として扱った経験を、志望理由 / 学部適性 / 将来像 のいずれかに接続させる consistency_check 質問を最低 1 問。',
        '',
        '【偏りと喪失の禁止】',
        '・personalized 5 問のうち、単一活動だけを扱う質問が 3 問を超えてはならない（「今日は部活だけ」「明日は留学だけ」のような偏りを禁止）。',
        '・最重要エピソードを日替わりで personalized から完全に消去してはならない。当日の deep-dive 対象から外れていても、最低 1 問は最重要エピソードを扱う。',
        '・本人材料に無い活動・経験を seed に合わせて捏造しない（素材外の新規エピソードを持ち込まない）。',
        '・seed そのもの（日付の数値文字列）を question / answerTip / intent / sourceHint に書かない。seed は AI 内部の主題選び基準としてのみ使う。',
      ].join('\n'),
    );
  }

  return sections.join('\n\n');
}

// ── 内部 helper ───────────────────────────────────────────────────

function buildSelfAnalysisSection(materials: InterviewQuestionMaterials): string {
  const { strengths, interests, futureGoals, applicantType } = materials;
  const lines: string[] = ['【自己分析サマリー】'];

  const hasAnyAnalysis =
    strengths.length > 0 || interests.length > 0 || futureGoals.length > 0;
  if (!hasAnyAnalysis) {
    lines.push('自己分析サマリーなし');
  } else {
    if (strengths.length > 0) {
      lines.push('強み:');
      for (const s of strengths) lines.push(`・${s}`);
    }
    if (interests.length > 0) {
      lines.push('興味・関心タグ:');
      for (const s of interests) lines.push(`・${s}`);
    }
    if (futureGoals.length > 0) {
      lines.push('将来とのつながり:');
      for (const s of futureGoals) lines.push(`・${s}`);
    }
  }

  // STEP E: applicantType（5 種 enum）由来の「傾向」1 行を末尾に optional 注入。
  // 自己分析が「なし」のケースでも applicantType だけは存在しうるため、
  // hasAnyAnalysis の判定とは独立に append する。
  // applicantType=undefined の旧 StudentProfile では本ブロックを skip するため
  // prompt 文字列は従来と byte-identical。
  if (applicantType) {
    lines.push(formatInterviewApplicantTypeHint(applicantType));
  }

  return lines.join('\n');
}
