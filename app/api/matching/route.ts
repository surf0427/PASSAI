// ── 文章生成層 (Narrative Layer) ─────────────────────────────────
// このAPIは Claude を使って各大学への narrative（reason / strengthPoints /
// weaknesses / actionItems / nextStep）を生成する。
//
// スコアリング層 (lib/matching/*) で deterministic に算出した
// MatchingResult[] を入力として受け取り、AI による文章だけを返す。
// 数値判定（スコア・breakdown）は AI に依存させない。
//
// ── admissionFocus 接続方針（PR9d-2 / C2 marker） ────────────────
// matching route は admissionFocus context を **意図的に prompt に流さない**。
// 理由:
//   1. matching は activity / studentProfile / universityContext を起点に短文 reason
//      （120 字目安）を生成する設計で、admissionFocus を加えるメリットが薄い
//   2. matching は 5 大学並列で AI を呼び出すため、admissionFocus context（~500-800
//      tokens / 大学）を加えると prompt token が約 +20% 膨張、コスト効率が悪い
//   3. admissionFocus と studentProfile を同 prompt に同居させると「活動」keyword が
//      重複し AI が強調 signal と誤認するリスクがある（StudentProfile overlap）
//   4. admissionFocus は本質的に「入試タイプ推定」であり、interview-feedback /
//      statement-review の長文評価で活きる設計。matching の責務範囲外
// 将来 matching score の調整に admissionFocus signals を deterministic 利用する
// 案（Option C）は別 STEP で検討可能。
//
// ── Promise.all semantics（PR9d-2 / C3 marker） ────────────────
// 後段 line ~158 で Promise.all を使う。1 大学でも fail すれば全体が fail する。
// この semantics は **intentional known behavior** として現状維持。
// partial-fail handling（Promise.allSettled 化 + per-candidate fail-safe）は
// 別 STEP で扱う（PR9 audit 決定）。
//
// TODO: 大学DB が整備されたら以下の処理を追加する
//   1. UniversityContext[] を受け取った時点で、それぞれの universityId をキーに
//      admissionPolicy / preferredTraits / preferredExperiences を DB から enrich
//   2. 学科別の面接傾向・小論文傾向を DB から取得して prompt に注入
//   3. 学科適性（学部より細かい deterministic 判定）を score breakdown に追加
//
import type { WallHittingResult } from '@/types/analysis';
import type { MatchingResult, AiMatchAdvice } from '@/types/matching';
import type { BasicInfo } from '@/types/basicInfo';
import type { ActivityData } from '@/types/activity';
import type { UniversityContext } from '@/types/universityContext';
import { anthropic } from '@/lib/ai';
import { safeParseJson } from '@/lib/matching/safeParseJson';
import { logAiUsage } from '@/lib/aiUsageLog';
import {
  buildUniversityContextsFromBasicInfo,
  findUniversityContextByName,
} from '@/lib/matching/buildUniversityContextsFromBasicInfo';
import { toStudentProfile } from '@/lib/studentProfile';
import { isStudentProfile } from '@/lib/studentProfileStorage';
// STEP15d: prompt 文字列の組み立ては lib/matching/matchingPrompt.ts に切り出した。
//   - MATCHING_SYSTEM_PROMPT: 役割宣言 + subjectGrades semantic instruction + 出力ルール / schema
//   - buildMatchingUserPrompt: 候補大学 1 件分の dynamic data セクション
// 旧 route 内 buildDetailPrompt / buildActivityContext / buildExamTypeMatchingGuidance は撤去済み。
import {
  MATCHING_SYSTEM_PROMPT,
  buildMatchingUserPrompt,
  type BuildMatchingUserPromptOptions,
} from '@/lib/matching/matchingPrompt';

// 使用 model / route 識別子の constant 化（messages.create() と usage log で共有）。
// 本 route は候補 5 大学それぞれに対して generateUniversityDetail() で 1 回ずつ
// anthropic.messages.create() を呼ぶため、log は per-call で発火する（1 request = 5 log line）。
const MODEL = 'claude-sonnet-4-6';
const ROUTE = 'api/matching';

// safeParseJson<T> は lib/matching/safeParseJson.ts に切り出した。挙動・ログ文言は完全に同一。

// 1大学分の詳細アドバイスを生成する。
//
// STEP15d: prompt 文字列は lib/matching/matchingPrompt.ts に切り出し、本関数は
//   anthropic API 呼び出し / parse / usage log だけに専念する。
//   - system: MATCHING_SYSTEM_PROMPT（候補大学 5 件で同一・cache_control: 'ephemeral' で prompt caching）
//   - user:  buildMatchingUserPrompt(opts)（候補大学ごとに変わる dynamic data）
//   既存の AI 出力契約（{ universityId, reason }）と route 内の status ログ経路は変えない。
async function generateUniversityDetail(
  opts: BuildMatchingUserPromptOptions,
): Promise<AiMatchAdvice> {
  const universityId = opts.result.university.id;
  // STEP4.9: per-call で usage log を発火させる構造にする。
  // 各 status 経路（success / truncated / parse_failed / failed）で必ず 1 回だけログするため、
  // anthropic.messages.create() と safeParseJson() を個別に try/catch で囲む。
  // 既存の throw 挙動は変えない（log 後に re-throw、outer の POST handler の catch に届く）。
  let message;
  try {
    message = await anthropic.messages.create({
      model: MODEL,
      // STEP1.1: AI 出力は reason（120字以内）のみに縮小したため 1500 → 500 へ。
      // 余裕を持って 500 に設定（reason 本文 + 周辺 JSON 構造で約 200 tokens 想定）。
      max_tokens: 500,
      // STEP15d: system は固定文字列（MATCHING_SYSTEM_PROMPT）。5 大学呼び出し間で
      // 共有されるため cache_control: 'ephemeral' で prompt caching を効かせる。
      // user 側は候補大学ごとに変わる dynamic data。
      system: [
        {
          type: 'text',
          text: MATCHING_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: buildMatchingUserPrompt(opts) }],
    });
  } catch (error) {
    // network / API error 経路: response が無いため usage は取れない。
    logAiUsage({ route: ROUTE, model: MODEL, status: 'failed' });
    throw error;
  }

  if (message.stop_reason === 'max_tokens') {
    logAiUsage({ route: ROUTE, model: MODEL, status: 'truncated', usage: message.usage });
    throw new Error(
      `Claude response was truncated by max_tokens for university ${universityId}. Reduce output length or increase max_tokens.`,
    );
  }

  const raw = message.content[0].type === 'text' ? message.content[0].text : '';

  // STEP1.1: AI 出力は { universityId, reason } のみを信用する。
  // strengthPoints / weaknesses / actionItems / nextStep は型上 optional として残しているが、
  // 仮に AI が古いプロンプト記憶で返してきても無視し、UI 側の deterministic フォールバック
  // （MatchingResult.* / generateReason.ts 由来）に揃える。
  // universityId は AI 出力ではなく opts 側を真実とする（プロンプトでテンプレ埋めしているが安全側に倒す）。
  let parsed: { reason?: unknown };
  try {
    parsed = safeParseJson<{ reason?: unknown }>(raw);
  } catch (error) {
    // PR9d-2 / M3 marker:
    //   safeParseJson も内部で console.error を 2 行出す（"JSON parse failed:" /
    //   "Text to parse:"）。本 catch でも logAiUsage と throw により observability に
    //   layer 情報が出る。**2 重 console.error は intentional**: lib 側はパース失敗の
    //   生 text、route 側は per-call status (parse_failed) + 上位 catch までの伝播を
    //   それぞれ独立 stream として記録する責務分離。集約ログ整理は別 STEP。
    logAiUsage({ route: ROUTE, model: MODEL, status: 'parse_failed', usage: message.usage });
    throw error;
  }
  const reason = typeof parsed.reason === 'string' ? parsed.reason : '';

  logAiUsage({ route: ROUTE, model: MODEL, status: 'success', usage: message.usage });
  return { universityId, reason };
}

// 大学候補リストを返す
// 現在はクライアント側で生成済みの上位5件をそのまま使用。
// TODO: 大学DBが整備されたら、universityContexts（admission policy 等）を見て
//   AI に候補を再ランクさせる選択肢も検討する。
async function generateUniversityCandidates(
  _selfAnalysis: WallHittingResult,
  results: MatchingResult[],
): Promise<MatchingResult[]> {
  return results.slice(0, 5);
}

export async function POST(req: Request) {
  const body = await req.json();
  // スコアリング層からの出力（クライアント側で計算済み）
  const results: MatchingResult[] | undefined = body.results;
  // 自己分析。後方互換のため body.wallHitting と body.selfAnalysis の両方を受ける。
  const selfAnalysis: WallHittingResult | undefined = body.selfAnalysis ?? body.wallHitting;
  // 基本情報（任意・未送信時 null フォールバック）
  const basicInfo: BasicInfo | null = body.basicInfo ?? null;
  // 活動整理データ（任意）
  const activityData: ActivityData | null = body.activityData ?? null;
  // 各志望校の UniversityContext。クライアント側で構築されて送られてくることもあれば、
  // basicInfo から派生させることもある。
  // TODO: 将来は basicInfo.preferences[*].university から大学DBを引き当てて
  //   admissionPolicy / preferredTraits / requiredGpa などを enrich する処理をここに追加する。
  const universityContexts: UniversityContext[] =
    body.universityContexts ?? buildUniversityContextsFromBasicInfo(basicInfo);

  if (!selfAnalysis || !results || results.length === 0) {
    return Response.json({ error: 'selfAnalysis and results are required' }, { status: 400 });
  }

  try {
    // 自己分析は 1 回だけ StudentProfile を確定して、候補大学ごとの prompt 生成で使い回す。
    // 受信側で WallHittingResult を直接 prompt に流さない（questions / answers が混入する
    // 経路を構造的に消す）。優先順位は次のとおり:
    //   1. body.studentProfile（クライアントが localStorage の canonical artifact から送ったもの）
    //   2. 無ければ selfAnalysis (= WallHittingResult) から toStudentProfile() で派生（後方互換）
    // TODO: クライアント側（admission-matching）も getStudentProfileForFeature 経由で
    //   studentProfile を送る形に移行する。今は server-side 受け口だけ先行整備。
    const studentProfileFromBody = isStudentProfile(body.studentProfile) ? body.studentProfile : null;
    const studentProfile = studentProfileFromBody ?? toStudentProfile(selfAnalysis);

    const candidates = await generateUniversityCandidates(selfAnalysis, results);
    // PR9d-2 / C3 marker:
    //   **Promise.all は 1 大学でも fail すれば全体が reject される** (all-or-nothing)。
    //   よって外側 catch (line ~190) で 500 response が返り、partial advices は提供しない。
    //   この挙動は intentional known behavior として PR9 audit で決定済み。
    //   partial-fail を許容する設計 (Promise.allSettled + per-candidate fallback) は
    //   独立 STEP で扱う（response shape の拡張・client 側 UI 対応も含めて）。
    //   per-call logAiUsage は generateUniversityDetail 内で全 status (success/
    //   truncated/parse_failed/failed) に出すため、失敗時の観測は per-call で確保される。
    const advices = await Promise.all(
      candidates.map((candidate) =>
        generateUniversityDetail({
          result: candidate,
          studentProfile,
          basicInfo,
          activityData,
          // 候補大学に対応する UniversityContext を引く（無ければ null）。
          // DB enrich されている場合は admission policy 等が prompt に流れる。
          universityContext: findUniversityContextByName(
            universityContexts,
            candidate.university.name,
          ),
        }),
      ),
    );
    return Response.json({ advices });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Matching AI error:', msg);
    return Response.json({ error: 'AI matching failed', detail: msg }, { status: 500 });
  }
}
