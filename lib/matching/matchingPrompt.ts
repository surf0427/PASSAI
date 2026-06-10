// matching route の AI prompt builder。
//
// 役割:
//   /api/matching の Claude 呼び出しで使う system / user prompt を生成する純関数群。
//   候補大学ごとに 1 回 generateUniversityDetail() が呼ばれ、その都度 system は同一・
//   user は dynamic data として変化する設計。system caching の利得を取りに行く。
//
// 責務境界（厳守）:
//   - score / eligibility / rank / sorting には一切影響させない。それらは deterministic layer
//     （lib/matching/calculateScore.ts, lib/matching/checkEligibility.ts, lib/matching/suggestUniversities.ts）
//     の責務で、本 prompt builder は narrative（reason）の生成方針を AI に伝えるのみ。
//   - 本ファイルは prompt 文字列の組み立てだけを行い、AI 呼び出し（anthropic.messages.create）や
//     storage 操作は持たない。呼び出しは app/api/matching/route.ts に閉じる。
//
// STEP15d: subjectGrades semantic instruction を SYSTEM_PROMPT に接続する。
//   - shared 2 つ（SUBJECT_GRADES_SHARED_INSTRUCTION / SUBJECT_GRADES_ASYMMETRY_RULE）を import
//   - route 固有の field-level 制約は MATCHING_SUBJECT_GRADES_QUALIFIER に集約（route 内 const、非 export）
//   - 既存 prompt の役割宣言・出力 schema・出力ルールはそのままの意味で system 側に移設
//   - user prompt 側は dynamic data セクションのみを返す（basicInfo / activity / studentProfile /
//     universityContext / 大学情報）。
//
// cache 互換性（重要）:
//   matching の cache は localStorage:aiMatchAdvice に単一エントリで保存される単純な仕組み。
//   PROMPT_VERSION 概念は持たないため、本 STEP の prompt 改修では cache を強制 invalidate しない。
//   既存ユーザは admission-matching ページの「再診断する」ボタンを押すまで旧 reason を見続ける。
//   これは仕様として許容する（強制 cache invalidation は別 STEP のスコープ）。

import type { MatchingResult } from '@/types/matching';
import type { StudentProfile } from '@/types/studentProfile';
import type { BasicInfo } from '@/types/basicInfo';
import type { ActivityData } from '@/types/activity';
import type { UniversityContext } from '@/types/universityContext';

import {
  buildBasicInfoPromptSection,
  hasAnyDepartmentSpecified,
} from '@/lib/buildBasicInfoPromptSection';
import { buildUniversityContextPromptSection } from '@/lib/buildUniversityContext';
import { buildMatchingStudentProfileContext } from '@/lib/contextBuilders/matchingContext';
import {
  SUBJECT_GRADES_SHARED_INSTRUCTION,
  SUBJECT_GRADES_ASYMMETRY_RULE,
} from '@/lib/prompts';

// matching 固有の subjectGrades 取り扱い制約。
// shared 側（lib/prompts.ts）で断定禁止 / AO 推薦混同禁止 / 関連科目以外の過剰減点禁止は既に効いている。
// ここでは route 固有の field-level 制約（reason 冒頭 / 主要弱点としての扱い / score 不可侵 等）を縛る。
const MATCHING_SUBJECT_GRADES_QUALIFIER = `【matching route での subjectGrades の使い方】
・subjectGrades は reason の narrative 補助文脈としてのみ使う。

・matching score / eligibility / rank / sorting は deterministic layer の結果を絶対に変更しない。reason の文面で「向いている」と評価しても、それは AI の解釈であり、score を上書きする意図ではない。

・志望学部に関連する科目の高評定は、活動・志望理由・将来目標との接続がある場合のみ reason に含めてよい。評定値単独で「向いている」「有利」「合格可能性が高い」と断定しない。

・志望学部に関連しない科目の低評定を reason 冒頭や主要弱点として扱わない。reason 冒頭は活動・志望理由・学部適性の接続から書き始める。

・reason を評定数値（例: "英語4.8" "数学4.8"）から始めない。数値を引用する場合は活動・学部接続の文脈に組み込む。

・評定が低くても AO / 総合型では活動・探究・志望理由との組み合わせを優先して narrative を構築する。

・欠席日数は説明準備の文脈でのみ軽く触れてよい。不利断定や「推薦に不向き」型の表現は使わない。

・subjectGrades 未入力時は、評定・欠席を推測せず、活動・自己分析・志望理由から reason を構築する。`;

// matching SYSTEM_PROMPT。
// 5 大学分の generateUniversityDetail で再利用される。固定文字列のため prompt caching 対象として最適。
// 役割宣言 / subjectGrades semantic instruction / 出力ルール / 出力 schema を含む。
export const MATCHING_SYSTEM_PROMPT = `あなたは総合型選抜・学校推薦型選抜の受験指導のプロです。
入力された生徒データと大学情報をもとに、その大学への individual narrative を 5 つの field で
JSON 形式で 1 件出力してください。

${SUBJECT_GRADES_SHARED_INSTRUCTION}

${SUBJECT_GRADES_ASYMMETRY_RULE}

${MATCHING_SUBJECT_GRADES_QUALIFIER}

【出力 5 fields の意味】
- reason          : この大学が生徒に合う / 合わないを 1 段落で総合的に説明する narrative（120 字以内）
- strengthPoints  : 生徒の強みのうち、この大学の評価軸・カリキュラム・受験方式に直接接続するものを 1〜3 件
- weaknesses      : この大学を受験する上で補強が必要な点を 1〜2 件（断定せず「ここを掘り下げると伸びる」視点）
- actionItems     : 生徒が今から取れる具体的アクションを 1〜3 件（行動レベル・抽象禁止）
- matchSummary    : 候補一覧で一目見て分かるよう、この大学とのマッチ感を 1 行で（40 字以内）

【出力ルール（必ず守ること）】
- 「汎用的な褒め文章」にしない。志望大学・学部・学科・活動整理・自己分析・受験方式の具体に踏み込むこと。
- 各 field は生徒の活動・志望・自己分析・大学 context の固有要素に直接言及する。
- score / eligibility / rank の数値判定は本 AI の責務外。narrative の生成のみを行う。
- strengthPoints / weaknesses / actionItems の各要素は 40〜80 字以内・自然な敬体・1 文。
- actionItems は「〇〇（具体的に何を）して、〇〇（何を得る / 書く / 調べる）」の形に揃え、
  「具体性を上げる」「もっと頑張る」のような抽象表現は禁止。

【reason / strengthPoints の観点分散（出力収束の防止・必須）】
- 「あなたの興味・経験・将来像が〇〇大学に合っています」型の、どの大学にも言える書き出し・観点に揃えない。学部名だけ差し替えた汎用文を禁止する。
- reason / strengthPoints は、その大学固有の特色（【大学情報】の特徴・【大学DB情報】に実在する要素）に紐付け、下記の観点バンクから、その大学で最も差が出るものを選んで構成する（全部使う必要はない）:
  - 学問内容との接続（学べる分野・研究テーマと生徒の関心の重なり）
  - 過去活動との接続（部活・探究・留学・資格 等、生徒の具体活動との結びつき）
  - 将来像との接続（生徒の将来目標に向けた道筋）
  - 入試方式との相性（総合型 / 学校推薦 / 一般 等と生徒の強みの噛み合い）
  - 学び方の相性（少人数 / 実践 / 研究重視 等、提示情報にある場合のみ）
  - キャンパス / 地域 / 環境（提示情報にある場合のみ）
  - 他大学との差分（候補の中でこの大学を選ぶ固有の理由）
  - 弱点・注意点（この大学固有の補強ポイント）
- 「この大学ならでは」の要素が提示情報に無い場合は、特色を作らず、weaknesses か actionItems で「確認すべき情報」として出す。

【actionItems の分散（出力収束の防止・必須）】
- 「公式サイトを見る」「オープンキャンパスに行く」「志望理由を深める」のような、毎回同じ一般アクションに寄せない。
- 下記の actionバンクから、その大学・その生徒の状況（不足点・接続点）に最も効くものを選ぶ（全部使う必要はない）:
  - アドミッションポリシー確認（生徒の経験と重なる語を探す）
  - ゼミ / 授業 / 研究室の検索（関心テーマに合う具体名を 1 つ見つける）
  - 入試要項の確認（出願要件・評定基準・提出書類）
  - 過去問 / 小論文・面接傾向の確認
  - 志望理由書での接続点メモ（この大学の特色 × 自分の経験）
  - 自分の活動との接続メモ（どの活動がどの評価軸に効くか）
  - 比較校との差分整理（他候補と何が違うかを 1 行で）
  - 不足情報の洗い出し（この大学について分かっていないことを書き出す）
  - 面接で聞かれそうな論点整理
- 5 大学で actionItems が同一の並びにならないようにする。

【他の候補大学との差分（提示された場合のみ）】
- user prompt に【他の候補大学（差分の参考）】section がある場合、その大学群との違いを踏まえ、この大学を選ぶ固有の理由を 1 点 reason または strengthPoints に織り込む。
- 差分は、提示された各大学の説明文に実在する要素にのみ基づく。説明に無い違いを推測で断定しない。判断材料が無い場合は actionItems の「比較校との差分整理」に回す。

【禁止】
- 「素晴らしいですね」「あなたなら大丈夫」型の中身のない称賛
- 数字を 1 つも含まない reason（活動データの実数・大学要求値などを織り込むこと）
- universityId / reason 等のフィールドを欠落させること
- 5 大学で書き出し・観点・actionItems が同型になること（学部名だけ差し替えた汎用文の量産）
- 【大学情報】【大学DB情報】に無い特色・科目・制度・研究室名・カリキュラムを作ること。不明な点は断定せず「確認すべき情報」として出す

【出力形式】
必ず JSON のみを出力してください。説明文・補足・前置き・後書きは一切禁止です。
最初の1文字は「{」、最後の1文字は「}」にしてください。
{
  "universityId": "<入力された大学IDをそのまま転記>",
  "reason": "...",
  "strengthPoints": ["...", "..."],
  "weaknesses": ["..."],
  "actionItems": ["...", "..."],
  "matchSummary": "..."
}`;

// 候補大学 1 件分の user prompt を組み立てる入力型。
// 旧 BuildDetailPromptOptions（app/api/matching/route.ts 内 type）と shape 同等。
export type BuildMatchingUserPromptOptions = {
  result: MatchingResult;
  studentProfile: StudentProfile | null;
  basicInfo: BasicInfo | null;
  activityData: ActivityData | null;
  universityContext: UniversityContext | null;
  // 出力収束化対策（同一 run 内の他候補大学）。同じマッチング結果の他の大学群を
  // 渡し、AI が「この大学を選ぶ固有の理由」を差分として書けるようにする。
  // 決定論的入力（route が候補リストから組み立てる。乱数なし）。
  // 未指定 / 空なら section を出さない（後方互換・QA harness 互換）。
  otherCandidates?: { name: string; faculty: string; description: string }[];
};

// 活動整理の概要を短く整形する。詳細は出さず件数とラベルだけ出して、AI の文脈に渡す。
// 旧 app/api/matching/route.ts の buildActivityContext を STEP15d で本ファイルへ移設。
function buildActivityContext(data: ActivityData | null): string {
  if (!data) return '';
  const lines: string[] = [];
  if (data.clubActivities?.length)
    lines.push(
      `部活: ${data.clubActivities.map((a) => a.clubName).filter(Boolean).join('・') || `${data.clubActivities.length}件`}`,
    );
  if (data.volunteerActivities?.length) lines.push(`ボランティア: ${data.volunteerActivities.length}件`);
  if (data.researchActivities?.length)
    lines.push(
      `探究: ${data.researchActivities.map((a) => a.theme).filter(Boolean).join('・') || `${data.researchActivities.length}件`}`,
    );
  if (data.studyAbroadActivities?.length) lines.push(`留学: ${data.studyAbroadActivities.length}件`);
  if (data.contestActivities?.length) lines.push(`コンテスト: ${data.contestActivities.length}件`);
  if (data.certificationActivities?.length)
    lines.push(
      `資格: ${data.certificationActivities.map((a) => a.certificationName).filter(Boolean).join('・') || `${data.certificationActivities.length}件`}`,
    );
  if (data.otherActivities?.length)
    lines.push(
      `その他: ${data.otherActivities.map((a) => a.activityName).filter(Boolean).join('・') || `${data.otherActivities.length}件`}`,
    );
  if (lines.length === 0) return '';
  return ['【活動整理の概要】', ...lines].join('\n');
}

// 受験方式に応じた AI 助言の方針。examTypes 単位の指示で、subjectGrades 値とは独立。
// 旧 app/api/matching/route.ts の buildExamTypeMatchingGuidance を STEP15d で本ファイルへ移設。
function buildExamTypeMatchingGuidance(
  examTypes: string[] | undefined,
  hasDepartment: boolean,
): string {
  const types = examTypes ?? [];
  const rules: string[] = [];

  if (types.includes('総合型選抜（AO入試）')) {
    rules.push('- 総合型選抜（AO）対策として、活動の一貫性・探究性・将来目標・主体性を重視して判定する。');
  }
  if (types.includes('学校推薦型選抜（公募・指定校）')) {
    rules.push('- 学校推薦型選抜対策として、評定平均（GPA）・学校生活・安定性・継続力を最重要視して判定する。');
  }
  if (types.includes('一般選抜') || types.includes('共通テスト利用')) {
    rules.push('- 一般選抜（共通テスト利用を含む）も併願しているため、一般受験との両立負担・推薦利用の現実性を踏まえて助言する。');
  }
  if (types.includes('海外大学受験')) {
    rules.push('- 海外大学受験を含むため、語学力・国際経験の評価軸も加味する。');
  }
  if (types.includes('まだ決まっていない')) {
    rules.push('- 受験方式が未確定のため、複数方式を比較しながら選び方の助言も行う。');
  }
  if (hasDepartment) {
    rules.push('- 学科名が指定されている場合は、学部全体ではなく該当学科の専門性・カリキュラムとの適合度を一段細かく判定する。');
  }

  if (rules.length === 0) return '';
  return ['【受験方式に応じた助言ルール】', ...rules].join('\n');
}

// 候補大学 1 件分の user prompt を組み立てる。
// system 側（MATCHING_SYSTEM_PROMPT）に役割・規則・出力 schema を集約済みのため、
// 本関数は dynamic data セクションのみを返す:
//   - basicInfoSection（subjectGrades section を含む）
//   - activitySection / studentProfileSection / guidanceSection / universityContextSection
//   - 【大学情報（スコアリング層から）】
//
// 旧 buildDetailPrompt との差分:
//   - 役割宣言・出力ルール・出力 schema を system 側へ移設したため、本関数の戻り値には含まれない
//   - dynamic data セクションの順序と区切りは旧実装と同一に保つ
export function buildMatchingUserPrompt(opts: BuildMatchingUserPromptOptions): string {
  const { result, studentProfile, basicInfo, activityData, universityContext } = opts;
  const basicInfoSection = buildBasicInfoPromptSection(basicInfo);
  const universityContextSection = buildUniversityContextPromptSection(universityContext);
  const activitySection = buildActivityContext(activityData);
  const guidanceSection = buildExamTypeMatchingGuidance(
    basicInfo?.examTypes,
    hasAnyDepartmentSpecified(basicInfo),
  );
  const studentProfileSection = buildMatchingStudentProfileContext(studentProfile);
  const otherCandidatesSection = buildOtherCandidatesSection(opts.otherCandidates);

  return `${basicInfoSection}
${activitySection ? `\n${activitySection}\n` : ''}${studentProfileSection ? `\n${studentProfileSection}\n` : ''}
${guidanceSection ? `\n${guidanceSection}\n` : ''}${universityContextSection ? `\n${universityContextSection}\n` : ''}${otherCandidatesSection ? `\n${otherCandidatesSection}\n` : ''}
【大学情報（スコアリング層から）】
大学ID: ${result.university.id}
大学名: ${result.university.name}（${result.university.faculty}）
入試方式: ${result.university.admissionType}
スコア: ${result.score}点
特徴: ${result.university.description}`;
}

// 同一 run 内の他候補大学を「差分の参考」section に整形する。
// 出力収束化対策: AI が「この大学を選ぶ固有の理由」を他候補との違いとして書けるようにする。
// 提示する説明文に実在する要素のみを差分根拠にするルールは SYSTEM_PROMPT 側に置く（捏造防止）。
// 空 / 未指定なら空文字（section なし＝後方互換）。
function buildOtherCandidatesSection(
  others: { name: string; faculty: string; description: string }[] | undefined,
): string {
  if (!others || others.length === 0) return '';
  const lines = others
    .filter((o) => o && o.name)
    .map((o) => {
      const desc = (o.description ?? '').trim();
      return `- ${o.name}（${o.faculty}）${desc ? `：${desc}` : ''}`;
    });
  if (lines.length === 0) return '';
  return [
    '【他の候補大学（差分の参考）】',
    '同じ生徒に提案された他の候補です。下記の説明に実在する要素のみを根拠に、この大学を選ぶ固有の理由を差分として書いてください（説明に無い違いは断定しない）。',
    ...lines,
  ].join('\n');
}
