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
// ── Promise.allSettled semantics（STEP-API-MATCHING-01 で all-or-nothing から脱却）─
// 後段の per-candidate AI 呼び出しは Promise.allSettled で並列実行する。
// 1 大学失敗で全体が reject される旧 Promise.all 構造は廃止（PR9 audit で予告済）。
//   - fulfilled candidate: そのまま AiMatchAdvice を採用
//   - rejected candidate : universityId だけ確定させた空 reason の fallback advice を入れる
//   - 全 candidate 失敗時のみ 500（既存 UX 維持: 空 advices を返さない）
//   - partial-fail 観測: response に partial / successfulCandidates / failedCandidates を optional 添付
// per-call logAiUsage は generateUniversityDetail 内で全 status（success / truncated /
// parse_failed / failed）に出すため、失敗時の token 課金観測は per-call で確保される。
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
import { createTimeoutSignal } from '@/lib/aiTimeout';
import { safeParseJson } from '@/lib/matching/safeParseJson';
import { formatActivityData } from '@/lib/formatActivity';
import { checkMaxLengths } from '@/lib/validation/checkMaxLengths';
import { INPUT_MAX_LENGTHS } from '@/lib/validation/inputLimits';
import { logAiUsage } from '@/lib/aiUsageLog';
import { captureRouteException } from '@/lib/sentry/capture';
import { ensurePlanQuota } from '@/lib/billing/planGate';
import { recordUsage } from '@/lib/billing/usageLog';
import {
  buildUniversityContextsFromBasicInfo,
  findUniversityContextByName,
} from '@/lib/matching/buildUniversityContextsFromBasicInfo';
import { getStudentProfileFromRequest } from '@/lib/getStudentProfileFromRequest';
// STEP15d: prompt 文字列の組み立ては lib/matching/matchingPrompt.ts に切り出した。
//   - MATCHING_SYSTEM_PROMPT: 役割宣言 + subjectGrades semantic instruction + 出力ルール / schema
//   - buildMatchingUserPrompt: 候補大学 1 件分の dynamic data セクション
// 旧 route 内 buildDetailPrompt / buildActivityContext / buildExamTypeMatchingGuidance は撤去済み。
import {
  MATCHING_SYSTEM_PROMPT,
  buildMatchingUserPrompt,
  type BuildMatchingUserPromptOptions,
} from '@/lib/matching/matchingPrompt';
import {
  MATCHING_RERANK_SYSTEM_PROMPT,
  buildMatchingRerankPrompt,
} from '@/lib/matching/rerankPrompt';
import type { StudentProfile } from '@/types/studentProfile';

// 使用 model / route 識別子の constant 化（messages.create() と usage log で共有）。
// 本 route は候補 5 大学それぞれに対して generateUniversityDetail() で 1 回ずつ
// anthropic.messages.create() を呼ぶため、log は per-call で発火する（1 request = 5 log line）。
const MODEL = 'claude-sonnet-4-6';
// M4: Vercel 実行時間上限。候補大学を Promise.allSettled で並列 AI 呼び出しするが
// 各呼び出しは AI timeout（lib/aiTimeout.ts = 60s）で並列のため壁時計は ≈60s。それに余裕を加算。
// Pro 前提（Hobby は 60s 上限で吸収できない）。runtime は既定 nodejs（edge 不可）。
export const maxDuration = 80;

const ROUTE = 'api/matching';
const USAGE_ROUTE = 'matching';

// STEP DET-M1 / STEP-AUDIT-TOP1-5-FIX-01: マッチング reason の AI 経路。
//   true       : AI 経路を有効化（generateUniversityDetail → Claude 呼び出し）。
//                マッチング reason / strengthPoints / weaknesses / actionItems /
//                matchSummary の 5 fields すべてを AI が個別最適化された narrative として
//                生成する。client UI は `aiAdvice?.X ?? result.X` の fallback 経路を
//                既に持つため、AI 出力が空 / 失敗の場合は generateReason.ts の
//                deterministic テンプレに自動で倒れる。
//   false      : Claude 呼び出しをスキップし、deterministic reason のみ返す（旧 DET-M1 経路）。
// STEP-AUDIT-TOP1-5-FIX-01 で true に切替（マッチング reason が PASSAI の差別化価値の中核）。
// 型は明示 boolean にして TS の literal narrowing による未到達分岐警告を回避する。
const USE_AI_MATCHING_REASON: boolean = true;

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
      // STEP-AUDIT-TOP1-5-FIX-01: 出力 schema を 5 fields に拡張したため 500 → 1400 へ。
      // reason 120 字 + strengthPoints*3 + weaknesses*2 + actionItems*3 + matchSummary 40 字 +
      // JSON 構造の合計目安 ~700-1000 tokens に対し 1400 はヘッドルームを残す。
      max_tokens: 1400,
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
    }, { signal: createTimeoutSignal() });
  } catch (error) {
    // network / API error 経路: response が無いため usage は取れない。
    logAiUsage({ route: ROUTE, model: MODEL, status: 'failed' });
    throw error;
  }

  if (message.stop_reason === 'max_tokens') {
    logAiUsage({ route: ROUTE, model: MODEL, status: 'truncated', usage: message.usage, cache_creation_input_tokens: message.usage?.cache_creation_input_tokens, cache_read_input_tokens: message.usage?.cache_read_input_tokens });
    throw new Error(
      `Claude response was truncated by max_tokens for university ${universityId}. Reduce output length or increase max_tokens.`,
    );
  }

  const raw = message.content[0].type === 'text' ? message.content[0].text : '';

  // STEP-AUDIT-TOP1-5-FIX-01: AI 出力 5 fields をすべて取り出す。
  // universityId は opts 側を真実とする（プロンプトでテンプレ埋めしているが安全側に倒す）。
  // 各 field が schema 違反 / 欠落の場合は空配列 / 空文字を返し、UI 側で
  // `aiAdvice?.X ?? result.X` の deterministic fallback に倒れる。
  let parsed: {
    reason?: unknown;
    strengthPoints?: unknown;
    weaknesses?: unknown;
    actionItems?: unknown;
    matchSummary?: unknown;
  };
  try {
    parsed = safeParseJson<typeof parsed>(raw);
  } catch (error) {
    // PR9d-2 / M3 marker:
    //   safeParseJson も内部で console.error を 2 行出す（"JSON parse failed:" /
    //   "Text to parse:"）。本 catch でも logAiUsage と throw により observability に
    //   layer 情報が出る。**2 重 console.error は intentional**: lib 側はパース失敗の
    //   生 text、route 側は per-call status (parse_failed) + 上位 catch までの伝播を
    //   それぞれ独立 stream として記録する責務分離。集約ログ整理は別 STEP。
    logAiUsage({ route: ROUTE, model: MODEL, status: 'parse_failed', usage: message.usage, cache_creation_input_tokens: message.usage?.cache_creation_input_tokens, cache_read_input_tokens: message.usage?.cache_read_input_tokens });
    throw error;
  }
  const reason = typeof parsed.reason === 'string' ? parsed.reason : '';
  const strengthPoints = Array.isArray(parsed.strengthPoints)
    ? parsed.strengthPoints.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    : [];
  const weaknesses = Array.isArray(parsed.weaknesses)
    ? parsed.weaknesses.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    : [];
  const actionItems = Array.isArray(parsed.actionItems)
    ? parsed.actionItems.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    : [];
  const matchSummary = typeof parsed.matchSummary === 'string' ? parsed.matchSummary : '';

  logAiUsage({ route: ROUTE, model: MODEL, status: 'success', usage: message.usage, cache_creation_input_tokens: message.usage?.cache_creation_input_tokens, cache_read_input_tokens: message.usage?.cache_read_input_tokens });
  // STEP-SILENT-FALLBACK-01: AI 出力が空 reason のときは fallback 注意を立てる。
  // 既存 UI は `aiAdvice?.reason ?? result.reason` で deterministic テンプレに自動 fallback
  // するが、ユーザーは AI が動いたのか不動だったのか判別できない問題があった。
  // reason が空（AI が schema 違反 / 空文字を返した）の場合は明示的に fallback としてマーク。
  if (reason.trim() === '') {
    console.warn('[fallback]', {
      route: ROUTE,
      universityId,
      reason: 'empty_ai_reason',
      timestamp: new Date().toISOString(),
    });
    return {
      universityId,
      reason,
      strengthPoints,
      weaknesses,
      actionItems,
      matchSummary,
      reasonSource: 'fallback',
      fallbackReason: 'empty_ai_reason',
    };
  }
  return {
    universityId,
    reason,
    strengthPoints,
    weaknesses,
    actionItems,
    matchSummary,
    reasonSource: 'ai',
  };
}

// STEP-AUDIT-TOP1-5-FIX-01: AI rerank step。
//   deterministic スコア層が選んだ上位 10 件を AI に渡し、生徒の個別文脈に基づいて
//   Top 5 を選び直す。完全 AI 推薦ではなく hybrid（deterministic candidate selection →
//   AI rerank → Top 5）。失敗時は deterministic スコア順 Top 5 にフォールバック。
//
//   入力候補数: 10 件（results.slice(0, 10)）
//     - 10 を超える候補は rerank で無理に詰め込まず、deterministic 層を信用する
//     - 10 件未満なら全件を rerank に渡す
//
//   AI 出力: { topUniversityIds: string[5] }
//     - 入力候補に含まれない id は drop
//     - 5 件未満が返ったら残りを deterministic 順で補完
//     - parse failure / 空配列の場合は deterministic 順で返す
const RERANK_POOL_SIZE = 10;
const RERANK_MAX_TOKENS = 250; // universityId 5 件 + JSON 構造で十分

async function rerankCandidatesWithAi(
  pool: MatchingResult[],
  studentProfile: StudentProfile | null,
  basicInfo: BasicInfo | null,
): Promise<MatchingResult[]> {
  if (pool.length === 0) return [];
  // pool 5 件以下なら rerank 不要（deterministic 順そのまま返す）
  if (pool.length <= 5) return pool.slice(0, 5);

  const userPrompt = buildMatchingRerankPrompt({
    candidates: pool,
    studentProfile,
    basicInfo,
  });

  let message;
  try {
    message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: RERANK_MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: MATCHING_RERANK_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    }, { signal: createTimeoutSignal() });
  } catch (error) {
    // network / API error: rerank をスキップして deterministic 順で返す
    logAiUsage({ route: 'api/matching/rerank', model: MODEL, status: 'failed' });
    console.warn('matching rerank: AI call failed, falling back to score order', {
      name: error instanceof Error ? error.name : 'UnknownError',
    });
    return pool.slice(0, 5);
  }

  if (message.stop_reason === 'max_tokens') {
    logAiUsage({ route: 'api/matching/rerank', model: MODEL, status: 'truncated', usage: message.usage });
    console.warn('matching rerank: truncated, falling back to score order');
    return pool.slice(0, 5);
  }

  const raw = message.content[0].type === 'text' ? message.content[0].text : '';
  let parsed: { topUniversityIds?: unknown };
  try {
    parsed = safeParseJson<{ topUniversityIds?: unknown }>(raw);
  } catch {
    logAiUsage({ route: 'api/matching/rerank', model: MODEL, status: 'parse_failed', usage: message.usage });
    console.warn('matching rerank: parse failed, falling back to score order');
    return pool.slice(0, 5);
  }

  logAiUsage({ route: 'api/matching/rerank', model: MODEL, status: 'success', usage: message.usage, cache_creation_input_tokens: message.usage?.cache_creation_input_tokens, cache_read_input_tokens: message.usage?.cache_read_input_tokens });

  const aiOrder = Array.isArray(parsed.topUniversityIds)
    ? parsed.topUniversityIds.filter((id): id is string => typeof id === 'string')
    : [];
  if (aiOrder.length === 0) {
    console.warn('matching rerank: empty topUniversityIds, falling back to score order');
    return pool.slice(0, 5);
  }

  // 入力 pool に含まれる id だけ採用。重複は最初の出現だけ。
  const poolById = new Map(pool.map((c) => [c.university.id, c]));
  const seen = new Set<string>();
  const reranked: MatchingResult[] = [];
  for (const id of aiOrder) {
    if (seen.has(id)) continue;
    const candidate = poolById.get(id);
    if (candidate) {
      reranked.push(candidate);
      seen.add(id);
    }
    if (reranked.length >= 5) break;
  }
  // AI が 5 件未満 / id 不正で揃わなかった分は deterministic 順で補完
  if (reranked.length < 5) {
    for (const candidate of pool) {
      if (seen.has(candidate.university.id)) continue;
      reranked.push(candidate);
      seen.add(candidate.university.id);
      if (reranked.length >= 5) break;
    }
  }
  return reranked.slice(0, 5);
}

// 大学候補リストを返す。
// deterministic スコア層が出した上位 RERANK_POOL_SIZE 件を AI に rerank させ、
// 生徒の個別文脈に応じた Top 5 を返す。AI 失敗時は deterministic 順 Top 5 を返す。
async function generateUniversityCandidates(
  _selfAnalysis: WallHittingResult,
  results: MatchingResult[],
  studentProfile: StudentProfile | null,
  basicInfo: BasicInfo | null,
): Promise<MatchingResult[]> {
  const pool = results.slice(0, RERANK_POOL_SIZE);
  return rerankCandidatesWithAi(pool, studentProfile, basicInfo);
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

  // B2: 各候補大学の prompt に埋め込む活動データ（整形後）全体の最大長ガード。
  const lengthCheck = checkMaxLengths([
    {
      label: '活動内容',
      value: activityData ? formatActivityData(activityData) : '',
      max: INPUT_MAX_LENGTHS.ACTIVITY_TOTAL,
    },
  ]);
  if (!lengthCheck.ok) {
    return Response.json({ error: lengthCheck.message }, { status: 400 });
  }

  // STEP-GATE-COMPLETE: Plan Gate (self-pr feature)。本 route は最大 N 大学分
  // (RERANK_POOL_SIZE 分) AI 呼び出しするが、ユーザー視点では「1 回のマッチング
  // リクエスト」なので 1 quota 消費。USE_AI_MATCHING_REASON=false の deterministic
  // 経路でも matching feature を使っている事実は同じなので gate は通す。
  const gate = await ensurePlanQuota('self-pr');
  if (gate.kind === 'reject') return gate.response;
  const userId = gate.userId;

  try {
    // 自己分析は 1 回だけ StudentProfile を確定して、候補大学ごとの prompt 生成で使い回す。
    // 受信側で WallHittingResult を直接 prompt に流さない（questions / answers が混入する
    // 経路を構造的に消す）。優先順位は次のとおり:
    //   1. body.studentProfile（クライアントが localStorage の canonical artifact から送ったもの）
    //   2. 無ければ selfAnalysis (= WallHittingResult) から toStudentProfile() で派生（後方互換）
    // TODO: クライアント側（admission-matching）も getStudentProfileForFeature 経由で
    //   studentProfile を送る形に移行する。今は server-side 受け口だけ先行整備。
    const studentProfile = getStudentProfileFromRequest({ body, fallbackSource: selfAnalysis });

    const candidates = await generateUniversityCandidates(
      selfAnalysis,
      results,
      studentProfile,
      basicInfo,
    );

    // STEP DET-M1: deterministic 経路
    //   USE_AI_MATCHING_REASON=false のとき Claude 呼び出しを丸ごとスキップし、
    //   suggestUniversities が deterministic に算出済みの candidate.reason
    //   （generateMatchReason / 潜在マッチ時 generatePotentialMatchReason 由来）を
    //   そのまま AiMatchAdvice.reason として返す。
    //   logAiUsage は AI 呼び出し時のみ発火する設計のため、本経路では route='api/matching'
    //   の usage log line が 0 件になる（観測 KPI）。
    if (!USE_AI_MATCHING_REASON) {
      const advices: AiMatchAdvice[] = candidates.map((candidate) => ({
        universityId: candidate.university.id,
        reason: candidate.reason,
      }));
      await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'ok' });
      return Response.json({ advices });
    }

    // STEP-API-MATCHING-01:
    //   Promise.allSettled で 5 並列。1 大学失敗で他 4 件の token を浪費しない設計。
    //   - fulfilled : そのまま AiMatchAdvice を採用
    //   - rejected  : universityId だけ確定させた空 reason の fallback advice を入れる
    //   - 全 candidate 失敗時のみ 500（client は alert + 再診断フローへ）
    //   per-call の logAiUsage は generateUniversityDetail 内で全 status を出すため、
    //   失敗 candidate の observability は per-call で確保される。
    const settled = await Promise.allSettled(
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

    let successfulCandidates = 0;
    let failedCandidates = 0;
    const advices: AiMatchAdvice[] = settled.map((res, idx) => {
      if (res.status === 'fulfilled') {
        successfulCandidates += 1;
        return res.value;
      }
      failedCandidates += 1;
      // 失敗 candidate の fallback: universityId だけ確定させ、reason は空文字。
      // client 側の ResultView は空 reason でも crash せず（type 上 string なので空 OK）、
      // 既存 UI の deterministic fallback（MatchingResult.* / generateReason.ts 由来）に委ねる。
      const errName = res.reason instanceof Error ? res.reason.name : 'UnknownError';
      console.error('matching candidate failed', {
        universityId: candidates[idx].university.id,
        name: errName,
      });
      // STEP-SILENT-FALLBACK-01: fallback 経路を明示。
      // 失敗時の fallback: AI fields はすべて空。UI 側で `aiAdvice?.X ?? result.X` の
      // deterministic fallback に倒れる。reasonSource='fallback' で UI が注意文を出せる。
      console.warn('[fallback]', {
        route: ROUTE,
        universityId: candidates[idx].university.id,
        reason: 'ai_call_failed',
        errorName: errName,
        timestamp: new Date().toISOString(),
      });
      return {
        universityId: candidates[idx].university.id,
        reason: '',
        strengthPoints: [],
        weaknesses: [],
        actionItems: [],
        matchSummary: '',
        reasonSource: 'fallback' as const,
        fallbackReason: 'ai_call_failed',
      };
    });

    // 全 candidate 失敗 → 既存 UX 維持で 500 を返す（client 側 alert + 再診断）。
    // 空 advices を返すと UI が「全大学に空 reason」を表示する経路に入ってしまうため。
    if (successfulCandidates === 0) {
      console.error('matching: all candidates failed');
      await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'error' });
      return Response.json(
        { error: 'AI matching failed', detail: 'all candidates failed' },
        { status: 500 },
      );
    }

    // partial fail の観測情報を optional 添付。partial=false（全成功）時は既存 shape `{ advices }` のまま。
    // 既存 client は data.advices だけを読むため、追加 field は無視されても壊れない。
    const partial = failedCandidates > 0;
    // partial 失敗を含めて少なくとも 1 件成功していれば、ユーザーは使える結果を得たので 'ok' で計上。
    await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'ok' });
    return Response.json({
      advices,
      ...(partial && { partial: true, successfulCandidates, failedCandidates }),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Matching AI error:', msg);
    await recordUsage({ userId, route: USAGE_ROUTE, model: MODEL, status: 'error' });
    captureRouteException(error, { route: ROUTE, feature: 'ai', status: 500 }, { status: 500, code: 'AI_REQUEST_FAILED' });
    return Response.json({ error: 'AI matching failed', detail: msg }, { status: 500 });
  }
}
