// STEP6.10: app/admission-matching/page.tsx から抽出した feature-local UI。
//   admission-matching でのみ使用される accordion 形式カード。
//   accordion 開閉用の useState を内部に持つ点で純 view より重いが、外部 state へ
//   昇格させる必要がない局所的 ephemeral state のため component に閉じ込めている。
//   helper 4 つ (getScoreSubLabel / getAffinityLabel / getAcceptanceLabel / getSummaryComment)
//   は現状 MatchingCard 専用のため同ファイル top-level に同居させる
//   (utils 分離は STEP6.10 のスコープ外、過剰分割を避ける指示)。
//   ロジック・文言・className・accordion 挙動・helper 判定条件は page.tsx 内に同居していた
//   時点から無変更。

import { useState } from 'react';
import type {
  MatchingResult,
  AiMatchAdvice,
  EligibilityResult,
  EligibilityStatus,
} from '@/types/matching';
import { ImprovementList } from '@/components/shared/result';

// ── 出願条件 eligibility：要約と表示 mapping ───────────────────
// 1 大学に複数 entries（入試方式）があるとき、「最も楽観的な」status を pill に出す。
// AO 適性 score とは別レーン。「断定しない」UX 要件に従い、文言は柔らかく赤を避ける。

// best ルートから順に検索する優先度（先頭ほど楽観的）。
const ELIGIBILITY_BEST_PRIORITY: EligibilityStatus[] = [
  'eligible',
  'likely_eligible',
  'needs_confirmation',
  'not_eligible',
  'insufficient_user_data',
  'insufficient_db_data',
];

function summarizeEligibility(results: EligibilityResult[]): EligibilityStatus | null {
  if (results.length === 0) return null;
  for (const target of ELIGIBILITY_BEST_PRIORITY) {
    if (results.some((r) => r.overallStatus === target)) return target;
  }
  return null;
}

const ELIGIBILITY_PILL: Record<EligibilityStatus, { label: string; className: string }> = {
  eligible:               { label: '出願可能性が高い', className: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  likely_eligible:        { label: '条件確認推奨',     className: 'bg-teal-50 text-teal-700 border border-teal-200' },
  needs_confirmation:     { label: '要項確認推奨',     className: 'bg-amber-50 text-amber-700 border border-amber-200' },
  not_eligible:           { label: '評定条件に注意',   className: 'bg-orange-50 text-orange-700 border border-orange-200' },
  insufficient_user_data: { label: '情報不足',         className: 'bg-gray-50 text-gray-500 border border-gray-200' },
  insufficient_db_data:   { label: 'DB情報不足',       className: 'bg-gray-50 text-gray-500 border border-gray-200' },
};

// ── マッチングカード：評価サマリー導出 ───────────────────────────

function getScoreSubLabel(score: number): string {
  if (score >= 80) return '相性：高い';
  if (score >= 70) return '相性：やや高め';
  if (score >= 60) return '相性：中';
  if (score >= 50) return '相性：やや低め';
  return '相性：低い';
}

function getAffinityLabel(score: number): string {
  if (score >= 80) return '高い';
  if (score >= 60) return '中';
  return '低い';
}

function getAcceptanceLabel(score: number): string {
  if (score >= 80) return '高';
  if (score >= 60) return '中';
  return '低';
}

function getSummaryComment(score: number, weaknesses: string[]): string {
  const top = weaknesses[0];
  if (score >= 80) return '現状でも十分戦える。さらに磨くと盤石になる。';
  if (score >= 70) return top ? `あと一歩の強化で合格圏へ。特に「${top}」に集中しよう。` : 'あと一歩の強化で合格圏に入れる。';
  if (score >= 60) return top ? `可能性はある。「${top}」を強化すれば合格確度が上がる。` : '現状でも可能性はある。重点強化で確度が上がる。';
  if (score >= 50) return '準備を重ねれば逆転の可能性がある。今すぐ動き出そう。';
  return '今から集中的に取り組めば差を縮められる。焦らず着実に進めよう。';
}

// ── マッチングカード ──────────────────────────────────────────────

type MatchingCardProps = {
  result: MatchingResult;
  aiAdvice: AiMatchAdvice | null;
  // 出願条件 eligibility（同大学・複数入試方式分を array で受ける）。
  // MatchingResult には混ぜず別 prop で受け取り、score と独立に表示する。
  eligibilityResults?: EligibilityResult[];
};

export function MatchingCard({ result, aiAdvice, eligibilityResults }: MatchingCardProps) {
  const [open, setOpen] = useState(false);

  const reason     = aiAdvice?.reason        ?? result.reason;
  const strengths  = aiAdvice?.strengthPoints ?? result.strengthPoints;
  const weaknesses = aiAdvice?.weaknesses    ?? result.weaknesses;
  const actions    = aiAdvice?.actionItems   ?? result.actionItems;
  // STEP-SILENT-FALLBACK-01:
  //   reasonSource='fallback' のとき、UI 上は (1)「AI強化済み」バッジを出さない、
  //   (2) 詳細展開時に「一時的にテンプレ表示中」の注意文を出す。
  //   reasonSource が undefined（旧 cache）の場合は従来挙動を維持（AI として扱う）。
  const isFallback = aiAdvice?.reasonSource === 'fallback';
  const aiEnhanced = aiAdvice !== null && !isFallback;

  const { score, suggestionType } = result;
  const isMyChoice = suggestionType === '自分の志望校';
  const eligibilitySummary = eligibilityResults ? summarizeEligibility(eligibilityResults) : null;
  const eligibilityMeta = eligibilitySummary ? ELIGIBILITY_PILL[eligibilitySummary] : null;

  const scoreColor   = score >= 80 ? 'text-green-600' : score >= 60 ? 'text-blue-600' : 'text-orange-500';
  const levelColor   = score >= 80 ? 'text-green-600' : score >= 60 ? 'text-blue-600' : 'text-orange-500';
  const tagColor     = isMyChoice                      ? 'bg-purple-100 text-purple-700'
                     : suggestionType === 'ストレートマッチ' ? 'bg-blue-100 text-blue-700'
                     : 'bg-green-100 text-green-700';
  const cardBorder   = isMyChoice
    ? 'bg-white border-2 border-purple-200 rounded-xl overflow-hidden'
    : 'bg-white border border-gray-200 rounded-xl overflow-hidden';

  return (
    <div className={cardBorder}>
      {/* ヘッダー（常に表示） */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left p-5 flex items-start justify-between gap-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tagColor}`}>
              {suggestionType}
            </span>
            {aiEnhanced && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 border border-purple-200">
                AI強化済み
              </span>
            )}
            {isFallback && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                基本テンプレート表示中
              </span>
            )}
          </div>
          <p className="font-bold text-gray-800">{result.university.name}</p>
          <p className="text-sm text-gray-500">{result.university.faculty}　{result.university.admissionType}</p>
          {eligibilityMeta && (
            <p className="mt-1.5 text-xs text-gray-500">
              <span className="mr-1.5">出願条件（参考）</span>
              <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${eligibilityMeta.className}`}>
                {eligibilityMeta.label}
              </span>
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className={`text-2xl font-bold ${scoreColor}`}>
            {score}
            <span className="text-sm font-normal text-gray-400">点</span>
          </p>
          <p className={`text-xs font-medium mt-0.5 ${levelColor}`}>{getScoreSubLabel(score)}</p>
          <p className="text-xs text-gray-400 mt-1">{open ? '▲ 閉じる' : '▼ 詳細'}</p>
        </div>
      </button>

      {/* 詳細（展開時） */}
      {open && (
        <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-4">

          {/* STEP-SILENT-FALLBACK-01: AI 失敗時の注意文 */}
          {isFallback && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs text-amber-800 leading-relaxed">
                一時的にAI生成に失敗したため、基本テンプレートを表示しています。
                <br className="sm:hidden" />
                必要に応じて再診断をお試しください。
              </p>
            </div>
          )}

          {/* 評価サマリー */}
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="flex items-center gap-4 mb-2">
              <div className="text-sm">
                <span className="text-xs text-gray-500">相性　</span>
                <span className={`font-bold ${levelColor}`}>{getAffinityLabel(score)}</span>
              </div>
              <div className="w-px h-4 bg-gray-300" />
              <div className="text-sm">
                <span className="text-xs text-gray-500">合格可能性　</span>
                <span className={`font-bold ${levelColor}`}>{getAcceptanceLabel(score)}</span>
              </div>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              {getSummaryComment(score, weaknesses)}
            </p>
          </div>

          {/* マッチ理由 */}
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">マッチ理由</p>
            <p className="text-sm text-gray-700 leading-relaxed">{reason}</p>
          </div>

          {/* スコア内訳 */}
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-2">スコア内訳</p>
            <div className="space-y-1.5">
              {result.scoreBreakdown.items.map((item, j) => (
                <div key={j} className="flex items-center gap-2 text-xs">
                  <span className="w-28 text-gray-500 shrink-0">{item.label}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${item.studentScore >= item.required ? 'bg-blue-400' : 'bg-orange-300'}`}
                      style={{ width: `${Math.min(100, (item.contribution / 35) * 100)}%` }}
                    />
                  </div>
                  <span className={`shrink-0 font-semibold ${item.studentScore >= item.required ? 'text-blue-600' : 'text-orange-500'}`}>
                    {item.studentScore}/{item.required}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 合っている点 */}
          {strengths.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">合っている点</p>
              <ImprovementList items={strengths} variant="success" />
            </div>
          )}

          {/* 課題（優先順位付き）：先頭は専用の「⚠ 最優先」ハイライト箱、
              2 件目以降は ImprovementList(variant=warning) でリスト化。 */}
          {weaknesses.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">課題</p>
              <div className="space-y-1.5">
                <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                  <span className="text-xs font-bold text-orange-500 shrink-0 mt-0.5">⚠ 最優先</span>
                  <span className="text-sm text-orange-800">{weaknesses[0]}</span>
                </div>
                {weaknesses.length > 1 && (
                  <ImprovementList
                    items={weaknesses.slice(1)}
                    variant="warning"
                    density="relaxed"
                  />
                )}
              </div>
            </div>
          )}

          {/* 今すぐできること */}
          {actions.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs font-semibold text-gray-700 mb-2">🔥 これやれば一気に評価上がる</p>
              <ImprovementList items={actions} variant="info" density="relaxed" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
